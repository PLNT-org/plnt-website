"""Pydantic models for ArUco detection and homography matching API."""

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


# ============================================
# Homography Models
# ============================================


class HomographyRequest(BaseModel):
    """Request body for homography computation."""

    geotiff_url: str = Field(..., description="URL of the orthomosaic GeoTIFF")
    raw_image_url: str = Field(..., description="URL of the raw drone image")
    image_latitude: float = Field(..., description="GPS latitude of the raw image center")
    image_longitude: float = Field(..., description="GPS longitude of the raw image center")
    footprint_width_m: float = Field(..., description="Estimated ground footprint width in meters")
    footprint_height_m: float = Field(..., description="Estimated ground footprint height in meters")
    padding_factor: float = Field(default=1.5, description="Multiply footprint by this for search region")


class HomographyResponse(BaseModel):
    """Response from homography computation."""

    success: bool
    homography: Optional[list[list[float]]] = Field(
        None, description="3x3 homography matrix (raw image pixels -> ortho crop pixels)"
    )
    crop_offset_x: int = Field(0, description="X pixel offset of crop in full ortho")
    crop_offset_y: int = Field(0, description="Y pixel offset of crop in full ortho")
    crop_width: int = Field(0, description="Width of the ortho crop in pixels")
    crop_height: int = Field(0, description="Height of the ortho crop in pixels")
    good_matches: int = Field(0, description="Number of feature matches after ratio test")
    inlier_count: int = Field(0, description="Number of RANSAC inliers")
    inlier_ratio: float = Field(0, description="Ratio of inliers to good matches")
    error: Optional[str] = None


class BatchHomographyRequest(BaseModel):
    """Request body for batch homography computation (ortho loaded once)."""

    geotiff_url: str = Field(..., description="URL of the orthomosaic GeoTIFF")
    images: list[dict] = Field(
        ...,
        description="List of {raw_image_url, latitude, longitude, footprint_width_m, footprint_height_m}"
    )
    padding_factor: float = Field(default=1.5, description="Multiply footprint by this for search region")


class BatchHomographyResponse(BaseModel):
    """Response from batch homography computation."""

    success: bool
    results: list[HomographyResponse]
    ortho_width: int = Field(0, description="Full ortho width in pixels")
    ortho_height: int = Field(0, description="Full ortho height in pixels")
    error: Optional[str] = None
