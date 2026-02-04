"""ArUco marker detection logic using OpenCV."""

import math
from typing import List, Dict, Any
import cv2
import numpy as np
from rasterio import Affine

from .georef import pixel_to_coords


# Map dictionary names to OpenCV constants
ARUCO_DICTIONARIES = {
    "DICT_4X4_50": cv2.aruco.DICT_4X4_50,
    "DICT_4X4_100": cv2.aruco.DICT_4X4_100,
    "DICT_4X4_250": cv2.aruco.DICT_4X4_250,
    "DICT_4X4_1000": cv2.aruco.DICT_4X4_1000,
    "DICT_5X5_50": cv2.aruco.DICT_5X5_50,
    "DICT_5X5_100": cv2.aruco.DICT_5X5_100,
    "DICT_5X5_250": cv2.aruco.DICT_5X5_250,
    "DICT_5X5_1000": cv2.aruco.DICT_5X5_1000,
    "DICT_6X6_50": cv2.aruco.DICT_6X6_50,
    "DICT_6X6_100": cv2.aruco.DICT_6X6_100,
    "DICT_6X6_250": cv2.aruco.DICT_6X6_250,
    "DICT_6X6_1000": cv2.aruco.DICT_6X6_1000,
    "DICT_7X7_50": cv2.aruco.DICT_7X7_50,
    "DICT_7X7_100": cv2.aruco.DICT_7X7_100,
    "DICT_7X7_250": cv2.aruco.DICT_7X7_250,
    "DICT_7X7_1000": cv2.aruco.DICT_7X7_1000,
    "DICT_ARUCO_ORIGINAL": cv2.aruco.DICT_ARUCO_ORIGINAL,
}


def get_aruco_dictionary(name: str) -> cv2.aruco.Dictionary:
    """
    Get an OpenCV ArUco dictionary by name.

    Args:
        name: Dictionary name (e.g., "DICT_7X7_1000")

    Returns:
        OpenCV ArUco dictionary object

    Raises:
        ValueError: If dictionary name is not recognized
    """
    if name not in ARUCO_DICTIONARIES:
        raise ValueError(
            f"Unknown ArUco dictionary: {name}. "
            f"Available: {list(ARUCO_DICTIONARIES.keys())}"
        )

    return cv2.aruco.getPredefinedDictionary(ARUCO_DICTIONARIES[name])


def calculate_confidence(corners: np.ndarray) -> float:
    """
    Calculate a confidence score for a detected marker based on its shape.

    A perfect square marker viewed head-on would have equal side lengths.
    Perspective distortion reduces confidence.

    Args:
        corners: 4x2 array of corner coordinates

    Returns:
        Confidence score between 0 and 1
    """
    # Calculate side lengths
    sides = []
    for i in range(4):
        p1 = corners[i]
        p2 = corners[(i + 1) % 4]
        side_length = np.sqrt(np.sum((p2 - p1) ** 2))
        sides.append(side_length)

    # Calculate variance of side lengths (lower = more square)
    mean_side = np.mean(sides)
    if mean_side == 0:
        return 0.0

    variance = np.var(sides) / (mean_side ** 2)

    # Convert to confidence (0 variance = 1.0 confidence)
    # Use exponential decay: confidence = exp(-k * variance)
    confidence = math.exp(-5 * variance)

    return min(1.0, max(0.0, confidence))


def calculate_rotation(corners: np.ndarray) -> float:
    """
    Calculate the rotation angle of a marker in degrees.

    The rotation is measured from the horizontal axis to the
    top edge of the marker.

    Args:
        corners: 4x2 array of corner coordinates (clockwise from top-left)

    Returns:
        Rotation angle in degrees (-180 to 180)
    """
    # Top edge is from corner 0 to corner 1
    top_left = corners[0]
    top_right = corners[1]

    # Calculate angle of top edge
    dx = top_right[0] - top_left[0]
    dy = top_right[1] - top_left[1]

    angle_rad = math.atan2(dy, dx)
    angle_deg = math.degrees(angle_rad)

    return angle_deg


def detect_aruco_markers(
    image: np.ndarray,
    transform: Affine,
    dictionary_name: str = "DICT_7X7_1000"
) -> List[Dict[str, Any]]:
    """
    Detect ArUco markers in an image and return georeferenced positions.

    Args:
        image: RGB image as numpy array (H, W, 3)
        transform: Rasterio affine transform for coordinate conversion
        dictionary_name: ArUco dictionary to use

    Returns:
        List of detected markers with positions and metadata
    """
    # Get ArUco dictionary and detector
    aruco_dict = get_aruco_dictionary(dictionary_name)
    parameters = cv2.aruco.DetectorParameters()

    # Tune parameters for aerial imagery
    parameters.adaptiveThreshConstant = 7
    parameters.adaptiveThreshWinSizeMin = 3
    parameters.adaptiveThreshWinSizeMax = 23
    parameters.adaptiveThreshWinSizeStep = 10
    parameters.minMarkerPerimeterRate = 0.01  # Allow smaller markers
    parameters.maxMarkerPerimeterRate = 4.0
    parameters.polygonalApproxAccuracyRate = 0.05
    parameters.minCornerDistanceRate = 0.05
    parameters.minDistanceToBorder = 3

    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)

    # Convert to grayscale for detection
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    # Detect markers
    corners, ids, rejected = detector.detectMarkers(gray)

    markers = []

    if ids is not None:
        for i, marker_id in enumerate(ids.flatten()):
            corner_pixels = corners[i][0]  # Shape: (4, 2)

            # Calculate center
            center_pixel = corner_pixels.mean(axis=0)
            center_x = float(center_pixel[0])
            center_y = float(center_pixel[1])

            # Convert center to geographic coordinates
            center_lng, center_lat = pixel_to_coords(
                transform, center_x, center_y
            )

            # Convert corners to geographic coordinates
            corner_coords = []
            for px, py in corner_pixels:
                lng, lat = pixel_to_coords(transform, float(px), float(py))
                corner_coords.append([lat, lng])

            # Calculate confidence and rotation
            confidence = calculate_confidence(corner_pixels)
            rotation = calculate_rotation(corner_pixels)

            markers.append({
                "marker_id": int(marker_id),
                "latitude": center_lat,
                "longitude": center_lng,
                "pixel_x": int(center_x),
                "pixel_y": int(center_y),
                "corner_pixels": corner_pixels.tolist(),
                "corner_coords": corner_coords,
                "confidence": round(confidence, 4),
                "rotation_deg": round(rotation, 2),
            })

    # Sort by marker ID for consistent ordering
    markers.sort(key=lambda m: m["marker_id"])

    return markers
