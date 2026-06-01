"""Pydantic models for the ArUco detection and plant detection API."""

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
# COG Conversion Models
# ============================================


class CogConvertRequest(BaseModel):
    """Request body for COG conversion."""

    geotiff_url: str = Field(..., description="URL of the source GeoTIFF to convert")
    upload_url: str = Field(..., description="Signed URL to upload the resulting COG")


class CogConvertResponse(BaseModel):
    """Response from COG conversion."""

    success: bool
    file_size_mb: float = Field(0, description="Size of the output COG in MB")
    error: Optional[str] = None


class SyncOrthoRequest(BaseModel):
    """Request body for full orthophoto sync (download, upload TIF, convert COG, extract metadata)."""

    geotiff_url: str = Field(..., description="URL to download the source GeoTIFF from (e.g. Lightning)")
    tif_upload_url: str = Field(..., description="Signed URL to upload the original TIF")
    cog_upload_url: str = Field(..., description="Signed URL to upload the COG")


class SyncOrthoResponse(BaseModel):
    """Response from orthophoto sync."""

    success: bool
    tif_size_mb: float = Field(0, description="Size of the original TIF in MB")
    cog_size_mb: float = Field(0, description="Size of the COG in MB")
    bounds: Optional[dict] = Field(None, description="Extracted WGS84 bounds {west, south, east, north}")
    image_width: int = Field(0, description="Image width in pixels")
    image_height: int = Field(0, description="Image height in pixels")
    resolution_cm: float = Field(0, description="Ground resolution in cm/pixel")
    error: Optional[str] = None


# ============================================
# Plant Detection Models
# ============================================


class PlantDetectionRequest(BaseModel):
    """Request body for plant detection on an orthomosaic.

    Defaults encode the validated plnt_v3 operating point (imgsz=1280 is fixed
    server-side): tile 640x640, overlap 64, conf 0.25, centroid dedup r=22.
    """

    geotiff_url: str = Field(..., description="URL of the orthomosaic GeoTIFF")
    confidence_threshold: float = Field(default=0.25, description="Minimum confidence threshold")
    include_classes: list[str] = Field(default=["plant", "plants"], description="Classes to include")
    tile_width: int = Field(default=640, description="Tile width in pixels")
    tile_height: int = Field(default=640, description="Tile height in pixels")
    overlap_x: int = Field(default=64, description="Horizontal overlap in pixels")
    overlap_y: int = Field(default=64, description="Vertical overlap in pixels")
    r_dedup: int = Field(default=22, description="Centroid-distance dedup radius in pixels")
    concurrent_tiles: int = Field(default=20, description="Tiles between streamed progress updates")
    nms_iou_threshold: Optional[float] = Field(default=None, description="DEPRECATED: ignored (centroid dedup replaced IoU-NMS)")
    bounds: dict = Field(..., description="Orthomosaic bounds {west, south, east, north}")


class AsyncPlantDetectionRequest(BaseModel):
    """Request body for async plant detection (runs in background, writes to Supabase)."""

    job_id: str = Field(..., description="Detection job ID for status updates")
    geotiff_url: str = Field(..., description="URL of the orthomosaic GeoTIFF")
    confidence_threshold: float = Field(default=0.25)
    include_classes: list[str] = Field(default=["plant", "plants"])
    tile_width: int = Field(default=640)
    tile_height: int = Field(default=640)
    overlap_x: int = Field(default=64)
    overlap_y: int = Field(default=64)
    r_dedup: int = Field(default=22)
    concurrent_tiles: int = Field(default=20)
    nms_iou_threshold: Optional[float] = Field(default=None, description="DEPRECATED: ignored")
    bounds: dict = Field(...)
    orthomosaic_id: str = Field(...)
    user_id: str = Field(...)
    supabase_url: str = Field(...)
    supabase_service_key: str = Field(...)


# ============================================
# Tile Generation Models
# ============================================


class GenerateTilesRequest(BaseModel):
    """Request body for XYZ tile-pyramid generation via gdal2tiles."""

    geotiff_url: str = Field(..., description="URL of the source GeoTIFF/COG to tile")
    orthomosaic_id: str = Field(..., description="Orthomosaic ID (tile storage prefix)")
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_service_key: str = Field(..., description="Supabase service-role key")
    min_zoom: Optional[int] = Field(default=None, description="Min zoom (auto if omitted)")
    max_zoom: Optional[int] = Field(default=None, description="Max zoom (auto if omitted)")


class GenerateTilesResponse(BaseModel):
    """Response from tile generation."""

    success: bool
    tile_count: int = 0
    tiles_url: Optional[str] = None
    zoom_range: Optional[str] = None
    error: Optional[str] = None
