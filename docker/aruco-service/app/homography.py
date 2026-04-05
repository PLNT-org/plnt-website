"""Feature-match a raw drone image to an orthomosaic crop and compute homography."""

import logging
from typing import Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Minimum number of good matches to compute a reliable homography
MIN_GOOD_MATCHES = 10


def compute_homography(
    raw_image: np.ndarray,
    ortho_crop: np.ndarray,
    max_features: int = 10000,
    ratio_threshold: float = 0.7,
    ransac_reproj_threshold: float = 5.0,
) -> Optional[dict]:
    """
    Compute the homography matrix that maps raw image pixels to ortho crop pixels.

    Uses SIFT feature detection + FLANN matching + RANSAC.

    Args:
        raw_image: Raw drone image (H, W, 3) BGR or RGB uint8
        ortho_crop: Orthomosaic crop covering the same area (H, W, 3) uint8
        max_features: Max SIFT features to extract per image
        ratio_threshold: Lowe's ratio test threshold (lower = stricter)
        ransac_reproj_threshold: RANSAC reprojection error threshold in pixels

    Returns:
        Dict with homography matrix (3x3), match count, and inlier count,
        or None if matching fails.
    """
    # Convert to grayscale
    if len(raw_image.shape) == 3:
        gray_raw = cv2.cvtColor(raw_image, cv2.COLOR_BGR2GRAY)
    else:
        gray_raw = raw_image

    if len(ortho_crop.shape) == 3:
        gray_ortho = cv2.cvtColor(ortho_crop, cv2.COLOR_BGR2GRAY)
    else:
        gray_ortho = ortho_crop

    # SIFT feature detection
    sift = cv2.SIFT_create(nfeatures=max_features)

    kp_raw, desc_raw = sift.detectAndCompute(gray_raw, None)
    kp_ortho, desc_ortho = sift.detectAndCompute(gray_ortho, None)

    logger.info(
        f"SIFT features: raw={len(kp_raw)}, ortho={len(kp_ortho)}"
    )

    if desc_raw is None or desc_ortho is None:
        logger.warning("No descriptors found in one or both images")
        return None

    if len(kp_raw) < MIN_GOOD_MATCHES or len(kp_ortho) < MIN_GOOD_MATCHES:
        logger.warning(
            f"Too few keypoints: raw={len(kp_raw)}, ortho={len(kp_ortho)}"
        )
        return None

    # FLANN-based matching
    index_params = dict(algorithm=1, trees=5)  # FLANN_INDEX_KDTREE
    search_params = dict(checks=50)
    flann = cv2.FlannBasedMatcher(index_params, search_params)

    matches = flann.knnMatch(desc_raw, desc_ortho, k=2)

    # Lowe's ratio test
    good_matches = []
    for m, n in matches:
        if m.distance < ratio_threshold * n.distance:
            good_matches.append(m)

    logger.info(
        f"Matches: {len(matches)} total, {len(good_matches)} after ratio test"
    )

    if len(good_matches) < MIN_GOOD_MATCHES:
        logger.warning(
            f"Too few good matches ({len(good_matches)}), need {MIN_GOOD_MATCHES}"
        )
        return None

    # Extract matched point coordinates
    pts_raw = np.float32(
        [kp_raw[m.queryIdx].pt for m in good_matches]
    ).reshape(-1, 1, 2)
    pts_ortho = np.float32(
        [kp_ortho[m.trainIdx].pt for m in good_matches]
    ).reshape(-1, 1, 2)

    # Compute homography with RANSAC
    H, mask = cv2.findHomography(
        pts_raw, pts_ortho, cv2.RANSAC, ransac_reproj_threshold
    )

    if H is None:
        logger.warning("findHomography returned None")
        return None

    inlier_count = int(mask.sum()) if mask is not None else 0
    inlier_ratio = inlier_count / len(good_matches) if good_matches else 0

    logger.info(
        f"Homography: {inlier_count}/{len(good_matches)} inliers "
        f"({inlier_ratio:.1%})"
    )

    # Reject if too few inliers (unreliable homography)
    if inlier_count < MIN_GOOD_MATCHES:
        logger.warning(
            f"Too few inliers ({inlier_count}), homography unreliable"
        )
        return None

    return {
        "homography": H.tolist(),  # 3x3 matrix as nested list
        "good_matches": len(good_matches),
        "inlier_count": inlier_count,
        "inlier_ratio": round(inlier_ratio, 4),
        "raw_keypoints": len(kp_raw),
        "ortho_keypoints": len(kp_ortho),
    }


def crop_ortho_by_bounds(
    ortho_image: np.ndarray,
    ortho_bounds: dict,
    image_gps: dict,
    image_footprint_meters: Tuple[float, float],
    padding_factor: float = 1.5,
) -> Tuple[Optional[np.ndarray], int, int]:
    """
    Crop the orthomosaic to the region that a raw drone image covers.

    Uses the image's GPS center and estimated ground footprint to determine
    which pixel region of the ortho to crop. Adds padding to ensure full
    coverage even with GPS error.

    Args:
        ortho_image: Full orthomosaic as numpy array (H, W, 3)
        ortho_bounds: Dict with north, south, east, west (WGS84 degrees)
        image_gps: Dict with latitude, longitude of image center
        image_footprint_meters: (width_m, height_m) ground footprint of image
        padding_factor: Multiply footprint by this for search region

    Returns:
        Tuple of (cropped_ortho, crop_offset_x, crop_offset_y).
        crop_offset_x/y are the pixel coordinates in the full ortho where the crop starts.
        Returns (None, 0, 0) if the image falls outside the ortho.
    """
    ortho_h, ortho_w = ortho_image.shape[:2]

    north = ortho_bounds["north"]
    south = ortho_bounds["south"]
    east = ortho_bounds["east"]
    west = ortho_bounds["west"]

    lat = image_gps["latitude"]
    lon = image_gps["longitude"]

    # Convert footprint meters to degrees
    meters_per_deg_lat = 111320
    meters_per_deg_lon = 111320 * np.cos(np.radians(lat))

    fw_m, fh_m = image_footprint_meters
    half_w_deg = (fw_m * padding_factor / 2) / meters_per_deg_lon
    half_h_deg = (fh_m * padding_factor / 2) / meters_per_deg_lat

    # Crop bounds in degrees
    crop_north = min(lat + half_h_deg, north)
    crop_south = max(lat - half_h_deg, south)
    crop_east = min(lon + half_w_deg, east)
    crop_west = max(lon - half_w_deg, west)

    if crop_north <= crop_south or crop_east <= crop_west:
        return None, 0, 0

    # Convert to pixel coordinates in the ortho
    px_per_deg_x = ortho_w / (east - west)
    px_per_deg_y = ortho_h / (north - south)

    x_min = int((crop_west - west) * px_per_deg_x)
    x_max = int((crop_east - west) * px_per_deg_x)
    y_min = int((north - crop_north) * px_per_deg_y)
    y_max = int((north - crop_south) * px_per_deg_y)

    # Clamp to image bounds
    x_min = max(0, x_min)
    x_max = min(ortho_w, x_max)
    y_min = max(0, y_min)
    y_max = min(ortho_h, y_max)

    if x_max - x_min < 50 or y_max - y_min < 50:
        return None, 0, 0

    crop = ortho_image[y_min:y_max, x_min:x_max]
    return crop, x_min, y_min
