"""Pydantic models for ArUco detection API."""

from typing import Optional
from pydantic import BaseModel, Field


class DetectionRequest(BaseModel):
    """Request body for ArUco detection."""

    geotiff_url: str = Field(..., description="URL of the GeoTIFF orthomosaic to process")
    dictionary: str = Field(
        default="DICT_7X7_1000",
        description="ArUco dictionary to use for detection"
    )
    callback_url: Optional[str] = Field(
        default=None,
        description="Optional URL to POST results to when detection completes"
    )


class MarkerCorner(BaseModel):
    """A single corner of a detected marker."""

    x: float
    y: float


class DetectedMarker(BaseModel):
    """A detected ArUco marker with position and metadata."""

    marker_id: int = Field(..., description="The ArUco marker ID (0-999)")
    latitude: float = Field(..., description="Center latitude (WGS84)")
    longitude: float = Field(..., description="Center longitude (WGS84)")
    pixel_x: int = Field(..., description="Center pixel X coordinate")
    pixel_y: int = Field(..., description="Center pixel Y coordinate")
    corner_pixels: list[list[float]] = Field(
        ...,
        description="Four corner pixel coordinates [[x,y], ...]"
    )
    corner_coords: list[list[float]] = Field(
        ...,
        description="Four corner geographic coordinates [[lat,lng], ...]"
    )
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence score")
    rotation_deg: float = Field(..., description="Marker rotation in degrees")


class DetectionResponse(BaseModel):
    """Response from ArUco detection."""

    success: bool
    marker_count: int
    markers: list[DetectedMarker]
    dictionary: str
    geotiff_url: str
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    opencv_version: str
    rasterio_version: str
