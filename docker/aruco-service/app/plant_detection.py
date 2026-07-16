"""Plant detection via tiled local YOLO (plnt_v3) inference on orthomosaics.

This module owns the single source of truth for the tiling -> inference ->
dedup -> georeference pipeline. Both the streaming (`/detect-plants`) and the
async (`/detect-plants-async`) endpoints consume `detect_plants_local`, so the
detection logic lives in exactly one place.
"""

import asyncio
import logging

import numpy as np

logger = logging.getLogger(__name__)

# Skip tiles where >90% of pixels are black/transparent
EMPTY_TILE_THRESHOLD = 0.9

# Inference image size for the model. NOT YOLO's 640 default — small-plant
# recall depends on running at 1280 (the validated operating point for plnt_v3).
INFER_IMGSZ = 1280


def pixels_to_wgs84(transform, crs, pixel_xs, pixel_ys):
    """Batch-convert pixel (col, row) coords to WGS84 (lngs, lats) using the
    GeoTIFF's affine transform + a CRS reprojection.

    Correct for ANY source CRS (UTM, etc.). The previous implementation linearly
    interpolated between the WGS84 corner bounds, which is only exact for an
    axis-aligned WGS84 raster and drifts by metres toward the edges otherwise.
    Reprojection is identity when the source is already EPSG:4326.
    """
    import rasterio.warp
    from rasterio.transform import xy as _xy

    if not pixel_xs:
        return [], []
    # Affine: pixel (col, row) -> source-CRS (x, y) at each pixel centre.
    # rasterio.transform.xy takes (transform, rows, cols) — rows first.
    xs, ys = _xy(transform, list(pixel_ys), list(pixel_xs))
    if not isinstance(xs, list):  # xy() returns scalars for scalar input
        xs, ys = [xs], [ys]
    crs_str = str(crs) if crs is not None else ""
    if not crs_str or crs_str.lower() == "none":
        return list(xs), list(ys)  # no CRS — assume transform already yields lng/lat
    # source CRS -> WGS84; for EPSG:4326 the result is (longitudes, latitudes).
    lngs, lats = rasterio.warp.transform(crs_str, "EPSG:4326", xs, ys)
    return list(lngs), list(lats)


def point_in_ring(lng: float, lat: float, ring) -> bool:
    """Ray-cast point-in-polygon test. `ring` is [[lng, lat], ...] (WGS84)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


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


def run_tile_inference(model, tile_rgb: np.ndarray, imgsz: int = INFER_IMGSZ, conf: float = 0.25) -> list[dict]:
    """Run plnt_v3 on a single tile. Returns center-format detections.

    YOLO emits xyxy corner boxes; we convert to center-format
    {x, y, width, height} right here at the boundary so everything downstream
    (GPS conversion, Supabase schema, Leaflet rendering) is untouched.
    """
    # Ultralytics treats a numpy-array input as BGR (OpenCV convention) and flips
    # it BGR->RGB internally before the network. Our tile comes from rasterio as
    # RGB, so we hand the model BGR, which Ultralytics flips back to the RGB it was
    # trained on. Passing RGB directly silently swaps the R/B channels and tanks
    # recall — measured 1,420 detections (RGB) vs 13,266 (BGR) on the same ortho.
    tile_bgr = np.ascontiguousarray(tile_rgb[:, :, ::-1])
    r = model.predict(tile_bgr, imgsz=imgsz, conf=conf, verbose=False)[0]
    if r.boxes is None or len(r.boxes) == 0:
        return []

    xy = r.boxes.xyxy.cpu().numpy()
    cf = r.boxes.conf.cpu().numpy()
    out = []
    for (x1, y1, x2, y2), c in zip(xy, cf):
        out.append({
            "x": float((x1 + x2) / 2),
            "y": float((y1 + y2) / 2),
            "width": float(x2 - x1),
            "height": float(y2 - y1),
            "confidence": float(c),
            "class": "plant",
        })
    return out


def centroid_dedup(detections: list[dict], r_dedup: int = 22) -> list[dict]:
    """Greedy centroid-distance dedup.

    Robust to the offset same-plant duplicates produced by overlapping tiles —
    duplicates that IoU-NMS leaves behind, which is why we dedup on centroid
    distance instead of box IoU.
    """
    if not detections:
        return []

    from scipy.spatial import cKDTree

    ordered = sorted(detections, key=lambda d: d["confidence"], reverse=True)
    cxy = np.array([(d["x"], d["y"]) for d in ordered])
    tree = cKDTree(cxy)
    suppressed = np.zeros(len(ordered), bool)
    kept = []
    for i in range(len(ordered)):
        if suppressed[i]:
            continue
        kept.append(ordered[i])
        # ordered is highest-confidence-first, so any neighbour with a larger
        # index is a lower-confidence duplicate and gets suppressed.
        for j in tree.query_ball_point(cxy[i], r_dedup):
            if j > i:
                suppressed[j] = True
    return kept


async def detect_plants_local(
    model,
    image: np.ndarray,
    transform,
    crs,
    *,
    tile_w: int = 640,
    tile_h: int = 640,
    overlap_x: int = 64,
    overlap_y: int = 64,
    confidence: float = 0.25,
    r_dedup: int = 22,
    imgsz: int = INFER_IMGSZ,
    include_classes=("plant", "plants"),
    progress_every: int = 20,
    engine: str = "yolo",
    sam3_prompt: str = "plant",
    roboflow_api_key: str | None = None,
    region=None,
):
    """Run tiled detection on an orthomosaic image.

    engine="yolo" (default): local plnt_v3. engine="sam3": Meta SAM 3 via
    Roboflow's hosted PCS endpoint (one HTTP call per tile). `region`, when given
    as a WGS84 ring [[lng, lat], ...], limits detection to tiles whose center
    falls inside it — used to bound the cost of the hosted SAM 3 trial.

    Async generator yielding NDJSON-ready events:
      {"type": "progress", processedTiles, totalTiles, detectionsCount, phase}
      {"type": "result", success, totalDetections, classCounts,
       averageConfidence, imageWidth, imageHeight, detections}

    Detections in the final "result" event carry pixel coords, GPS coords,
    confidence, and class.
    """
    img_height, img_width = image.shape[:2]
    allowed_classes = {c.lower() for c in include_classes}

    stride_x = max(1, tile_w - overlap_x)
    stride_y = max(1, tile_h - overlap_y)

    # Build tile jobs, skipping mostly-empty (black/transparent) tiles
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

    # Optional region gate: keep only tiles whose center lands inside the drawn
    # WGS84 polygon. Uses the same correct pixel->WGS84 path as final georef.
    if region:
        centers_x = [x + cw / 2 for (x, y, cw, ch) in tile_jobs]
        centers_y = [y + ch / 2 for (x, y, cw, ch) in tile_jobs]
        c_lngs, c_lats = pixels_to_wgs84(transform, crs, centers_x, centers_y)
        tile_jobs = [
            tj for tj, ln, la in zip(tile_jobs, c_lngs, c_lats)
            if point_in_ring(ln, la, region)
        ]
        logger.info(f"Region gate: {len(tile_jobs)} tiles inside the drawn polygon")

    total_tiles = len(tile_jobs)
    logger.info(
        f"Tiling: {img_width}x{img_height}, {total_tiles} tiles to process, "
        f"{skipped} empty skipped, tile={tile_w}x{tile_h}, stride={stride_x}x{stride_y}, engine={engine}"
    )

    yield {
        "type": "progress",
        "processedTiles": 0,
        "totalTiles": total_tiles,
        "detectionsCount": 0,
        "phase": "tiling",
    }

    # NOTE: local YOLO inference is GIL-bound and runs sequentially. The old
    # per-tile asyncio.gather existed only to parallelize Roboflow HTTP calls
    # and buys nothing here. A follow-up can switch to batched model.predict
    # (chunks of 16-32 tiles) for ~3x speedup.
    all_detections = []
    progress_every = max(1, progress_every)

    # SAM 3 talks to a hosted HTTP endpoint per tile; share one client for the run.
    sam3_http = None
    if engine == "sam3":
        import httpx
        from .sam3_client import run_tile_inference_sam3
        if not roboflow_api_key:
            raise RuntimeError("SAM3 engine requires ROBOFLOW_API_KEY (not set on the service)")
        sam3_http = httpx.AsyncClient(timeout=90.0)

    try:
        for idx, (x, y, crop_w, crop_h) in enumerate(tile_jobs, start=1):
            tile = image[y:y + crop_h, x:x + crop_w]
            # `image` is already RGB (load_geotiff_for_detection).
            if engine == "sam3":
                preds = await run_tile_inference_sam3(sam3_http, tile, sam3_prompt, roboflow_api_key)
            else:
                preds = run_tile_inference(model, tile, imgsz=imgsz, conf=confidence)
            for pred in preds:
                if pred["class"].lower() not in allowed_classes:
                    continue
                all_detections.append({
                    "x": x + pred["x"],
                    "y": y + pred["y"],
                    "width": pred["width"],
                    "height": pred["height"],
                    "confidence": pred["confidence"],
                    "class": pred["class"],
                })

            if idx % progress_every == 0 or idx == total_tiles:
                yield {
                    "type": "progress",
                    "processedTiles": idx,
                    "totalTiles": total_tiles,
                    "detectionsCount": len(all_detections),
                    "phase": "tiling",
                }
                # Let the event loop flush streamed bytes / service other tasks.
                await asyncio.sleep(0)
    finally:
        if sam3_http is not None:
            await sam3_http.aclose()

    # Centroid dedup across all tiles
    yield {
        "type": "progress",
        "processedTiles": total_tiles,
        "totalTiles": total_tiles,
        "detectionsCount": len(all_detections),
        "phase": "nms",
    }
    logger.info(f"Detections before dedup: {len(all_detections)}")
    final_detections = centroid_dedup(all_detections, r_dedup)
    logger.info(f"Detections after dedup (r={r_dedup}): {len(final_detections)}")

    # Pixel -> WGS84 via the GeoTIFF affine transform + CRS reprojection, in one
    # batched call (correct for projected sources like UTM; the old linear-bounds
    # interpolation drifted by metres toward the edges).
    lngs, lats = pixels_to_wgs84(
        transform, crs,
        [d["x"] for d in final_detections],
        [d["y"] for d in final_detections],
    )
    for d, lng, lat in zip(final_detections, lngs, lats):
        d["latitude"] = lat
        d["longitude"] = lng
        d["pixel_x"] = round(d["x"])
        d["pixel_y"] = round(d["y"])

    class_counts: dict[str, int] = {}
    total_confidence = 0.0
    for det in final_detections:
        cls = det.get("class", "plant")
        class_counts[cls] = class_counts.get(cls, 0) + 1
        total_confidence += det["confidence"]
    avg_confidence = total_confidence / len(final_detections) if final_detections else 0

    yield {
        "type": "result",
        "success": True,
        "totalDetections": len(final_detections),
        "classCounts": class_counts,
        "averageConfidence": avg_confidence,
        "imageWidth": img_width,
        "imageHeight": img_height,
        "detections": final_detections,
    }
