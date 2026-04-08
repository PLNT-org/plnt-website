"""Plant detection via tiled YOLO inference on orthomosaics."""

import asyncio
import io
import logging
from typing import Any

import cv2
import httpx
import numpy as np

logger = logging.getLogger(__name__)

# Skip tiles where >90% of pixels are black/transparent
EMPTY_TILE_THRESHOLD = 0.9


def calculate_iou(box1: dict, box2: dict) -> float:
    """Calculate IoU between two center-format boxes."""
    x1_1 = box1["x"] - box1["width"] / 2
    y1_1 = box1["y"] - box1["height"] / 2
    x2_1 = box1["x"] + box1["width"] / 2
    y2_1 = box1["y"] + box1["height"] / 2

    x1_2 = box2["x"] - box2["width"] / 2
    y1_2 = box2["y"] - box2["height"] / 2
    x2_2 = box2["x"] + box2["width"] / 2
    y2_2 = box2["y"] + box2["height"] / 2

    xa = max(x1_1, x1_2)
    ya = max(y1_1, y1_2)
    xb = min(x2_1, x2_2)
    yb = min(y2_1, y2_2)

    intersection = max(0, xb - xa) * max(0, yb - ya)
    area1 = box1["width"] * box1["height"]
    area2 = box2["width"] * box2["height"]
    union = area1 + area2 - intersection

    return intersection / union if union > 0 else 0


def apply_nms(detections: list[dict], iou_threshold: float) -> list[dict]:
    """Non-Maximum Suppression to remove duplicate detections."""
    if not detections:
        return []

    sorted_dets = sorted(detections, key=lambda d: d["confidence"], reverse=True)
    kept = []

    while sorted_dets:
        best = sorted_dets.pop(0)
        kept.append(best)
        sorted_dets = [
            d for d in sorted_dets
            if calculate_iou(best, d) <= iou_threshold
        ]

    return kept


def pixel_to_gps(
    pixel_x: float, pixel_y: float,
    bounds: dict, image_width: int, image_height: int,
) -> dict:
    """Convert pixel coordinates to GPS coordinates."""
    lat = bounds["north"] - (pixel_y / image_height) * (bounds["north"] - bounds["south"])
    lng = bounds["west"] + (pixel_x / image_width) * (bounds["east"] - bounds["west"])
    return {"lat": lat, "lng": lng}


def is_tile_empty(image: np.ndarray, x: int, y: int, w: int, h: int) -> bool:
    """Check if a tile region is mostly empty (black/transparent)."""
    tile = image[y:y+h, x:x+w]
    if tile.size == 0:
        return True

    # Sample every 8th pixel for speed
    sampled = tile[::8, ::8]
    if sampled.size == 0:
        return True

    # Check for black pixels (all channels <= 10)
    if sampled.ndim == 3:
        is_black = np.all(sampled <= 10, axis=-1)
    else:
        is_black = sampled <= 10

    return np.mean(is_black) > EMPTY_TILE_THRESHOLD


async def run_tile_inference(
    client: httpx.AsyncClient,
    tile_png: bytes,
    api_url: str,
    model_id: str,
    api_key: str,
    confidence: float,
) -> list[dict]:
    """Run YOLO inference on a single tile via Roboflow."""
    url = f"{api_url}/{model_id}?api_key={api_key}&confidence={confidence}"

    response = await client.post(
        url,
        files={"file": ("tile.png", tile_png, "image/png")},
    )

    if response.status_code != 200:
        logger.error(f"Roboflow error: {response.status_code} {response.text[:200]}")
        return []

    data = response.json()
    return data.get("predictions", [])


async def detect_plants(
    image: np.ndarray,
    bounds: dict,
    roboflow_api_key: str,
    roboflow_model_id: str,
    roboflow_api_url: str,
    confidence_threshold: float,
    include_classes: list[str],
    tile_w: int,
    tile_h: int,
    overlap_x: int,
    overlap_y: int,
    nms_iou_threshold: float,
    concurrent_tiles: int,
    progress_callback: Any = None,
) -> list[dict]:
    """
    Run tiled plant detection on an orthomosaic image.

    Returns list of detections with pixel coords, GPS coords, confidence, and class.
    """
    img_height, img_width = image.shape[:2]
    allowed_classes = [c.lower() for c in include_classes]

    stride_x = tile_w - overlap_x
    stride_y = tile_h - overlap_y

    # Build tile jobs, skipping empty tiles
    tile_jobs = []
    skipped = 0
    for y in range(0, img_height, stride_y):
        for x in range(0, img_width, stride_x):
            crop_w = min(tile_w, img_width - x)
            crop_h = min(tile_h, img_height - y)
            if is_tile_empty(image, x, y, crop_w, crop_h):
                skipped += 1
            else:
                tile_jobs.append((x, y, crop_w, crop_h))

    total_tiles = len(tile_jobs)
    logger.info(
        f"Tiling: {img_width}x{img_height}, {total_tiles} tiles to process, "
        f"{skipped} empty skipped, tile={tile_w}x{tile_h}, stride={stride_x}x{stride_y}"
    )

    all_detections = []
    processed = 0

    async with httpx.AsyncClient(timeout=60.0) as client:
        for i in range(0, len(tile_jobs), concurrent_tiles):
            batch = tile_jobs[i:i + concurrent_tiles]

            async def process_tile(job):
                x, y, crop_w, crop_h = job

                # Extract tile as PNG using OpenCV
                tile = image[y:y+crop_h, x:x+crop_w]
                # Convert RGB to BGR for OpenCV encoding
                tile_bgr = cv2.cvtColor(tile, cv2.COLOR_RGB2BGR)
                _, png_buf = cv2.imencode(".png", tile_bgr)
                tile_png = png_buf.tobytes()

                predictions = await run_tile_inference(
                    client, tile_png,
                    roboflow_api_url, roboflow_model_id,
                    roboflow_api_key, confidence_threshold,
                )

                detections = []
                for pred in predictions:
                    pred_class = (pred.get("class") or "plant").lower()
                    if pred_class not in allowed_classes:
                        continue
                    detections.append({
                        "x": x + pred["x"],
                        "y": y + pred["y"],
                        "width": pred["width"],
                        "height": pred["height"],
                        "confidence": pred["confidence"],
                        "class": pred.get("class", "plant"),
                    })
                return detections

            results = await asyncio.gather(
                *[process_tile(job) for job in batch],
                return_exceptions=True,
            )

            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"Tile error: {result}")
                else:
                    all_detections.extend(result)

            processed += len(batch)

            if progress_callback:
                await progress_callback(processed, total_tiles, len(all_detections))

    # Apply NMS
    logger.info(f"Detections before NMS: {len(all_detections)}")
    final_detections = apply_nms(all_detections, nms_iou_threshold)
    logger.info(f"Detections after NMS: {len(final_detections)}")

    # Add GPS coordinates
    for det in final_detections:
        gps = pixel_to_gps(det["x"], det["y"], bounds, img_width, img_height)
        det["latitude"] = gps["lat"]
        det["longitude"] = gps["lng"]
        det["pixel_x"] = round(det["x"])
        det["pixel_y"] = round(det["y"])

    return final_detections
