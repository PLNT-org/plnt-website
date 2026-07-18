"""GeoTIFF coordinate transformation utilities."""

import math
import tempfile
import os
from typing import Callable, Tuple
import httpx
import rasterio
from rasterio.transform import xy
from rasterio.windows import Window
import numpy as np


def geotiff_gsd_cm(src) -> float | None:
    """Ground sample distance (cm/pixel) of an open rasterio dataset.

    Handles both projected sources (UTM etc. — pixel size is already a linear
    unit, converted to metres via the CRS's unit factor) and geographic sources
    (EPSG:4326 — pixel size is in degrees, converted to metres at the scene's
    centre latitude). Returns None if it can't be determined, so callers fall
    back to unscaled behavior.
    """
    try:
        px = abs(src.transform.a)
        if not px:
            return None
        crs = src.crs
        if crs is not None and crs.is_projected:
            factor = 1.0  # metres per linear unit; UTM = 1.0
            try:
                lf = crs.linear_units_factor  # (unit_name, metres_per_unit)
                if lf and len(lf) == 2 and lf[1]:
                    factor = float(lf[1])
            except Exception:
                factor = 1.0
            return px * factor * 100.0
        # Geographic (degrees) — convert at the scene centre latitude.
        b = src.bounds
        center_lat = (b.bottom + b.top) / 2.0
        metres = px * 111320.0 * math.cos(math.radians(center_lat))
        return metres * 100.0
    except Exception:
        return None


async def download_geotiff(url: str) -> str:
    """
    Download a GeoTIFF from a URL to a temporary file.

    Streams the response to disk in chunks rather than buffering the whole file
    in memory — a multi-GB orthomosaic would otherwise blow the container's RAM
    before detection even starts. Peak memory here is one chunk, not the file.

    Args:
        url: URL of the GeoTIFF to download

    Returns:
        Path to the downloaded temporary file
    """
    # Create temp directory if it doesn't exist
    temp_dir = "/tmp/aruco"
    os.makedirs(temp_dir, exist_ok=True)

    # Generate temp file path
    temp_file = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".tif",
        dir=temp_dir
    )
    temp_path = temp_file.name
    temp_file.close()

    # Stream the file to disk. The read timeout is per-chunk (not total), so a
    # long multi-GB download won't be aborted as long as bytes keep flowing.
    timeout = httpx.Timeout(600.0, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with open(temp_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)

    return temp_path


def make_tile_reader(src) -> Tuple[Callable[[int, int, int, int], np.ndarray], int, int, rasterio.Affine, str]:
    """Build a per-tile reader over an open rasterio dataset for plant detection.

    Returns (reader, width, height, transform, crs) where
    ``reader(x, y, w, h)`` yields an ``(h, w, 3)`` uint8 RGB array for that pixel
    window. This is the low-memory replacement for loading the entire raster:
    for a uint8 source each call reads only the requested window (a few internal
    tiles), so a 73k×59k ortho costs megabytes, not ~13 GB.

    The pixels returned for a given (x, y, w, h) are identical to slicing the
    fully-loaded array the old path produced — only the source changes, so
    detections are unaffected.

    uint8 sources (all drone RGB orthos, incl. RGBA) take the windowed path.
    Non-uint8 sources (rare analytic rasters) fall back to materializing the
    whole array once so the model still sees the same global-max normalization
    ``load_geotiff_for_detection`` applied — those products are small, so the
    memory cost is acceptable and behavior is preserved exactly.

    The caller must keep ``src`` open for the lifetime of the returned reader.
    """
    width, height = src.width, src.height
    transform = src.transform
    crs = str(src.crs)

    def _read_rgb_window(win: Window) -> np.ndarray:
        if src.count >= 3:
            arr = src.read([1, 2, 3], window=win)  # (3, h, w)
        else:
            band = src.read(1, window=win)          # (h, w)
            arr = np.stack([band, band, band])       # (3, h, w)
        return np.ascontiguousarray(np.transpose(arr, (1, 2, 0)))  # (h, w, 3)

    if src.dtypes[0] == "uint8":
        def reader(x: int, y: int, w: int, h: int) -> np.ndarray:
            return _read_rgb_window(Window(x, y, w, h))
        return reader, width, height, transform, crs

    # Non-uint8: materialize once, normalizing by the GLOBAL max (per-tile
    # scaling would be inconsistent across tiles). Mirrors the legacy loader.
    if src.count >= 3:
        full = np.transpose(src.read([1, 2, 3]), (1, 2, 0))
    else:
        band = src.read(1)
        full = np.stack([band, band, band], axis=-1)
    if full.dtype != np.uint8:
        full = (full / full.max() * 255).astype(np.uint8) if full.max() > 255 else full.astype(np.uint8)

    def reader(x: int, y: int, w: int, h: int) -> np.ndarray:
        return full[y:y + h, x:x + w]
    return reader, width, height, transform, crs


def pixel_to_coords(
    transform: rasterio.Affine,
    pixel_x: float,
    pixel_y: float
) -> Tuple[float, float]:
    """
    Convert pixel coordinates to geographic coordinates.

    Args:
        transform: Rasterio affine transform from the GeoTIFF
        pixel_x: X pixel coordinate (column)
        pixel_y: Y pixel coordinate (row)

    Returns:
        Tuple of (longitude, latitude) in WGS84
    """
    # TODO(georef): this does NOT reproject — it returns the affine output in the
    # source CRS and assumes that's already lng/lat. Correct only for EPSG:4326
    # sources; for projected sources (e.g. UTM) it's wrong, drifting toward the
    # edges. The plant-detection path (plant_detection.pixels_to_wgs84) does the
    # correct affine + rasterio.warp.transform(crs -> EPSG:4326). The ArUco path
    # should adopt the same pattern (separate PR — needs its own testing).
    lng, lat = xy(transform, int(pixel_y), int(pixel_x))
    return lng, lat


def load_geotiff_for_detection(file_path: str) -> Tuple[np.ndarray, rasterio.Affine, str]:
    """
    Load a GeoTIFF and prepare it for ArUco detection.

    Args:
        file_path: Path to the GeoTIFF file

    Returns:
        Tuple of (image_array, transform, crs)
        - image_array: RGB numpy array (H, W, 3)
        - transform: Affine transform for coordinate conversion
        - crs: Coordinate reference system string
    """
    with rasterio.open(file_path) as src:
        # Read bands - orthomosaics are typically RGB or RGBA
        band_count = src.count

        if band_count >= 3:
            # Read as RGB
            img = src.read([1, 2, 3])  # Shape: (3, H, W)
            img = np.transpose(img, (1, 2, 0))  # Shape: (H, W, 3)
        elif band_count == 1:
            # Grayscale - replicate to 3 channels
            img = src.read(1)  # Shape: (H, W)
            img = np.stack([img, img, img], axis=-1)  # Shape: (H, W, 3)
        else:
            raise ValueError(f"Unexpected band count: {band_count}")

        # Ensure uint8 for OpenCV
        if img.dtype != np.uint8:
            # Normalize to 0-255 if needed
            if img.max() > 255:
                img = (img / img.max() * 255).astype(np.uint8)
            else:
                img = img.astype(np.uint8)

        transform = src.transform
        crs = str(src.crs)

    return img, transform, crs


def cleanup_temp_file(file_path: str) -> None:
    """Remove a temporary file if it exists."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception:
        pass  # Ignore cleanup errors
