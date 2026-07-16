"""SAM 3 (Meta) plant detection via Roboflow's hosted serverless PCS endpoint.

Hosted-trial path: per tile we POST the tile image (base64) to Roboflow's
concept-segmentation endpoint with a text prompt, then reduce each returned
instance mask to its centroid so it drops into the exact same center-format
pipeline the local YOLO path uses (dedup -> georeference -> Supabase).

Response schema (confirmed against the live endpoint):
    { "prompt_results": [ { "predictions": [
        { "masks": [ [[x,y],[x,y], ...] ], "confidence": float, "format": "polygon" },
        ... one per detected instance ...
    ] } ] }
So: count = len(predictions); one plant point = the centroid of its polygon.
"""

import base64
import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SAM3_ENDPOINT = "https://serverless.roboflow.com/sam3/concept_segment"

# Log the raw shape of the first response once per process, so any future schema
# drift is visible in the service logs without spamming them.
_logged_sample = False


def _polygon_centroid(poly) -> tuple[float, float, float, float]:
    """Return (cx, cy, width, height) for a polygon given as [[x,y], ...].

    Uses the shoelace centroid; falls back to the vertex mean for degenerate
    (collinear / <3 point) polygons. Width/height come from the bbox.
    """
    a = np.asarray(poly, dtype=float)
    if a.ndim != 2 or a.shape[0] == 0:
        return 0.0, 0.0, 0.0, 0.0
    xs, ys = a[:, 0], a[:, 1]
    w = float(xs.max() - xs.min())
    h = float(ys.max() - ys.min())
    if a.shape[0] < 3:
        return float(xs.mean()), float(ys.mean()), w, h
    x1 = np.roll(xs, -1)
    y1 = np.roll(ys, -1)
    cross = xs * y1 - x1 * ys
    area = cross.sum() / 2.0
    if abs(area) < 1e-9:
        return float(xs.mean()), float(ys.mean()), w, h
    cx = ((xs + x1) * cross).sum() / (6.0 * area)
    cy = ((ys + y1) * cross).sum() / (6.0 * area)
    return float(cx), float(cy), w, h


def _parse_predictions(data: dict) -> list[dict]:
    """Flatten Roboflow SAM3 PCS response -> center-format detections."""
    out: list[dict] = []
    for pr in data.get("prompt_results", []) or []:
        for pred in pr.get("predictions", []) or []:
            masks = pred.get("masks") or []
            if not masks:
                continue
            # One instance may return multiple polygons (disjoint parts); the
            # largest one carries the instance's location.
            poly = max(masks, key=lambda m: len(m) if isinstance(m, list) else 0)
            cx, cy, w, h = _polygon_centroid(poly)
            if w == 0 and h == 0:
                continue
            out.append({
                "x": cx,
                "y": cy,
                "width": w,
                "height": h,
                "confidence": float(pred.get("confidence", 0.5)),
                "class": "plant",
            })
    return out


async def run_tile_inference_sam3(
    http_client,
    tile_rgb: np.ndarray,
    prompt: str,
    api_key: str,
    prob_thresh: float = 0.5,
) -> list[dict]:
    """POST one RGB tile to Roboflow SAM3 PCS; return center-format detections.

    Tile-local pixel coords (caller offsets them to full-ortho space, exactly as
    with the YOLO path).
    """
    global _logged_sample
    # cv2 encodes BGR; our tile is RGB, so flip channels to get a correct JPEG.
    ok, buf = cv2.imencode(".jpg", np.ascontiguousarray(tile_rgb[:, :, ::-1]))
    if not ok:
        return []
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    payload = {
        "image": {"type": "base64", "value": b64},
        "prompts": [{"type": "text", "text": prompt}],
        "format": "polygon",
        "output_prob_thresh": prob_thresh,
    }
    try:
        res = await http_client.post(
            f"{SAM3_ENDPOINT}?api_key={api_key}", json=payload
        )
    except Exception as e:  # network / timeout — skip this tile, keep going
        logger.warning(f"[SAM3] request failed: {e}")
        return []
    if res.status_code >= 400:
        logger.warning(f"[SAM3] {res.status_code}: {res.text[:200]}")
        return []
    try:
        data = res.json()
    except Exception:
        logger.warning("[SAM3] non-JSON response")
        return []
    if not _logged_sample:
        _logged_sample = True
        pr = (data.get("prompt_results") or [{}])[0]
        logger.info(
            f"[SAM3] first response: prompt_results keys={list(pr.keys())}, "
            f"predictions={len(pr.get('predictions', []))}"
        )
    return _parse_predictions(data)
