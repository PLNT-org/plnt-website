"""FastAPI application for ArUco marker detection service."""

import logging
from contextlib import asynccontextmanager

import cv2
import rasterio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    DetectionRequest,
    DetectionResponse,
    DetectedMarker,
    HealthResponse,
    HomographyRequest,
    HomographyResponse,
    BatchHomographyRequest,
    BatchHomographyResponse,
)
from .detector import detect_aruco_markers
from .georef import (
    download_geotiff,
    load_geotiff_for_detection,
    cleanup_temp_file,
)
from .homography import compute_homography, crop_ortho_by_bounds


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("ArUco Detection Service starting up")
    logger.info(f"OpenCV version: {cv2.__version__}")
    logger.info(f"Rasterio version: {rasterio.__version__}")
    yield
    logger.info("ArUco Detection Service shutting down")


app = FastAPI(
    title="ArUco Detection Service",
    description="Detect ArUco markers in georeferenced orthomosaic images",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check service health and dependencies."""
    return HealthResponse(
        status="ok",
        opencv_version=cv2.__version__,
        rasterio_version=rasterio.__version__,
    )


@app.post("/detect", response_model=DetectionResponse)
async def detect_markers(request: DetectionRequest):
    """
    Detect ArUco markers in a GeoTIFF orthomosaic.

    Downloads the GeoTIFF, runs ArUco detection, and returns
    georeferenced marker positions.
    """
    temp_file = None

    try:
        logger.info(f"Starting detection for: {request.geotiff_url}")
        logger.info(f"Using dictionary: {request.dictionary}")

        # Download the GeoTIFF
        logger.info("Downloading GeoTIFF...")
        temp_file = await download_geotiff(request.geotiff_url)
        logger.info(f"Downloaded to: {temp_file}")

        # Load and prepare image
        logger.info("Loading GeoTIFF for detection...")
        image, transform, crs = load_geotiff_for_detection(temp_file)
        logger.info(f"Image shape: {image.shape}, CRS: {crs}")

        # Run detection
        logger.info("Running ArUco detection...")
        raw_markers = detect_aruco_markers(
            image,
            transform,
            request.dictionary
        )
        logger.info(f"Detected {len(raw_markers)} markers")

        # Convert to response models
        markers = [DetectedMarker(**m) for m in raw_markers]

        return DetectionResponse(
            success=True,
            marker_count=len(markers),
            markers=markers,
            dictionary=request.dictionary,
            geotiff_url=request.geotiff_url,
        )

    except Exception as e:
        logger.error(f"Detection failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {str(e)}"
        )

    finally:
        # Clean up temp file
        if temp_file:
            cleanup_temp_file(temp_file)
            logger.info(f"Cleaned up temp file: {temp_file}")


@app.post("/homography", response_model=HomographyResponse)
async def compute_image_homography(request: HomographyRequest):
    """
    Compute a homography matrix mapping raw drone image pixels to orthomosaic pixels.

    Downloads both images, crops the ortho to the GPS region of the raw image,
    runs SIFT feature matching, and returns the 3x3 homography matrix plus the
    crop offset so the caller can map detections to full-ortho pixel coordinates.
    """
    temp_ortho = None
    temp_raw = None

    try:
        import numpy as np

        # Download both files
        logger.info(f"Downloading ortho: {request.geotiff_url[:80]}...")
        temp_ortho = await download_geotiff(request.geotiff_url)

        logger.info(f"Downloading raw image: {request.raw_image_url[:80]}...")
        temp_raw = await download_geotiff(request.raw_image_url)

        # Load ortho
        ortho_image, _, _ = load_geotiff_for_detection(temp_ortho)
        logger.info(f"Ortho loaded: {ortho_image.shape}")

        # Load raw image with OpenCV (not rasterio — it's a regular JPEG)
        raw_image = cv2.imread(temp_raw, cv2.IMREAD_COLOR)
        if raw_image is None:
            return HomographyResponse(
                success=False, error="Failed to decode raw image"
            )
        logger.info(f"Raw image loaded: {raw_image.shape}")

        # Convert ortho from RGB to BGR for OpenCV
        ortho_bgr = cv2.cvtColor(ortho_image, cv2.COLOR_RGB2BGR)

        # Crop ortho to the approximate GPS region
        ortho_bounds = {
            "north": 0, "south": 0, "east": 0, "west": 0
        }

        # Extract bounds from GeoTIFF
        with rasterio.open(temp_ortho) as src:
            bounds = src.bounds
            ortho_bounds = {
                "north": bounds.top,
                "south": bounds.bottom,
                "east": bounds.right,
                "west": bounds.left,
            }

        image_gps = {
            "latitude": request.image_latitude,
            "longitude": request.image_longitude,
        }
        footprint = (request.footprint_width_m, request.footprint_height_m)

        crop, offset_x, offset_y = crop_ortho_by_bounds(
            ortho_bgr, ortho_bounds, image_gps, footprint,
            padding_factor=request.padding_factor,
        )

        if crop is None:
            return HomographyResponse(
                success=False,
                error="Raw image GPS falls outside orthomosaic bounds",
            )

        logger.info(
            f"Ortho crop: {crop.shape} at offset ({offset_x}, {offset_y})"
        )

        # Compute homography
        result = compute_homography(raw_image, crop)

        if result is None:
            return HomographyResponse(
                success=False,
                error="Feature matching failed — not enough matches between raw image and ortho",
            )

        return HomographyResponse(
            success=True,
            homography=result["homography"],
            crop_offset_x=offset_x,
            crop_offset_y=offset_y,
            crop_width=crop.shape[1],
            crop_height=crop.shape[0],
            good_matches=result["good_matches"],
            inlier_count=result["inlier_count"],
            inlier_ratio=result["inlier_ratio"],
        )

    except Exception as e:
        logger.error(f"Homography computation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Homography computation failed: {str(e)}",
        )

    finally:
        if temp_ortho:
            cleanup_temp_file(temp_ortho)
        if temp_raw:
            cleanup_temp_file(temp_raw)


@app.post("/homography/batch", response_model=BatchHomographyResponse)
async def compute_batch_homography(request: BatchHomographyRequest):
    """
    Compute homography matrices for multiple raw images against one orthomosaic.

    Downloads the ortho once, then processes each raw image. Much more efficient
    than calling /homography individually for each image.
    """
    temp_ortho = None
    temp_files: list[str] = []

    try:
        import numpy as np

        # Download and load ortho once
        logger.info(f"Downloading ortho for batch ({len(request.images)} images)...")
        temp_ortho = await download_geotiff(request.geotiff_url)

        ortho_image, _, _ = load_geotiff_for_detection(temp_ortho)
        ortho_bgr = cv2.cvtColor(ortho_image, cv2.COLOR_RGB2BGR)

        # Extract bounds
        with rasterio.open(temp_ortho) as src:
            bounds = src.bounds
            ortho_bounds = {
                "north": bounds.top,
                "south": bounds.bottom,
                "east": bounds.right,
                "west": bounds.left,
            }

        ortho_h, ortho_w = ortho_bgr.shape[:2]
        logger.info(f"Ortho loaded: {ortho_w}x{ortho_h}")

        results: list[HomographyResponse] = []

        for i, img_spec in enumerate(request.images):
            temp_raw = None
            try:
                raw_url = img_spec["raw_image_url"]
                lat = img_spec["latitude"]
                lon = img_spec["longitude"]
                fw = img_spec["footprint_width_m"]
                fh = img_spec["footprint_height_m"]

                logger.info(f"[{i+1}/{len(request.images)}] Processing {raw_url.split('/')[-1]}...")

                # Download raw image
                temp_raw = await download_geotiff(raw_url)
                temp_files.append(temp_raw)

                raw_image = cv2.imread(temp_raw, cv2.IMREAD_COLOR)
                if raw_image is None:
                    results.append(HomographyResponse(
                        success=False, error="Failed to decode raw image"
                    ))
                    continue

                # Crop ortho
                crop, offset_x, offset_y = crop_ortho_by_bounds(
                    ortho_bgr, ortho_bounds,
                    {"latitude": lat, "longitude": lon},
                    (fw, fh),
                    padding_factor=request.padding_factor,
                )

                if crop is None:
                    results.append(HomographyResponse(
                        success=False,
                        error="Image GPS falls outside orthomosaic bounds",
                    ))
                    continue

                # Compute homography
                result = compute_homography(raw_image, crop)

                if result is None:
                    results.append(HomographyResponse(
                        success=False,
                        error="Feature matching failed",
                    ))
                    continue

                results.append(HomographyResponse(
                    success=True,
                    homography=result["homography"],
                    crop_offset_x=offset_x,
                    crop_offset_y=offset_y,
                    crop_width=crop.shape[1],
                    crop_height=crop.shape[0],
                    good_matches=result["good_matches"],
                    inlier_count=result["inlier_count"],
                    inlier_ratio=result["inlier_ratio"],
                ))

            except Exception as e:
                logger.error(f"Error processing image {i}: {e}")
                results.append(HomographyResponse(
                    success=False, error=str(e)
                ))
            finally:
                if temp_raw:
                    cleanup_temp_file(temp_raw)

        return BatchHomographyResponse(
            success=True,
            results=results,
            ortho_width=ortho_w,
            ortho_height=ortho_h,
        )

    except Exception as e:
        logger.error(f"Batch homography failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Batch homography failed: {str(e)}",
        )

    finally:
        if temp_ortho:
            cleanup_temp_file(temp_ortho)
        for f in temp_files:
            cleanup_temp_file(f)


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "ArUco Detection Service",
        "version": "1.1.0",
        "endpoints": {
            "health": "/health",
            "detect": "/detect (POST)",
            "homography": "/homography (POST)",
            "homography_batch": "/homography/batch (POST)",
        }
    }
