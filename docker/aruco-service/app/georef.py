"""GeoTIFF coordinate transformation utilities."""

import tempfile
import os
from typing import Tuple
import httpx
import rasterio
from rasterio.transform import xy
import numpy as np


async def download_geotiff(url: str) -> str:
    """
    Download a GeoTIFF from a URL to a temporary file.

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

    # Download the file
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()

        with open(temp_path, "wb") as f:
            f.write(response.content)

    return temp_path


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
    # xy() returns (x, y) which is (longitude, latitude) for WGS84
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
