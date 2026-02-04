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
)
from .detector import detect_aruco_markers
from .georef import (
    download_geotiff,
    load_geotiff_for_detection,
    cleanup_temp_file,
)


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


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "ArUco Detection Service",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "detect": "/detect (POST)",
        }
    }
