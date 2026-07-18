"""Cloud Run Job entrypoint for plant detection.

Runs the SAME pipeline as the service's /detect-plants-async, but as a Cloud Run
Job — which runs the container to completion with no request-lifetime cap, so a
large ortho (thousands of tiles, >10 min) can't be reclaimed mid-run the way a
fire-after-response FastAPI BackgroundTask on a Cloud Run *service* is.

Params arrive as env vars (set per execution via `gcloud run jobs execute
--update-env-vars` or the Admin API overrides). Reuses run_async_detection so
the detection/dedup/georeference/save logic stays in exactly one place; we only
have to load the model (the service does this in its lifespan, which a Job never
runs).

Required env: JOB_ID, GEOTIFF_URL, BOUNDS (JSON), ORTHO_ID, USER_ID,
SUPABASE_URL, SUPABASE_SERVICE_KEY.
Optional env: CONF, INCLUDE_CLASSES (JSON), ENGINE, SAM3_PROMPT, REGION (JSON),
TILE_WIDTH, TILE_HEIGHT, OVERLAP_X, OVERLAP_Y, R_DEDUP, CONCURRENT_TILES.
"""

import asyncio
import json
import logging
import os

from ultralytics import YOLO

from .main import app, run_async_detection, WEIGHTS_PATH
from .models import AsyncPlantDetectionRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("job_runner")


def _build_request() -> AsyncPlantDetectionRequest:
    kwargs = dict(
        job_id=os.environ["JOB_ID"],
        geotiff_url=os.environ["GEOTIFF_URL"],
        bounds=json.loads(os.environ["BOUNDS"]),
        orthomosaic_id=os.environ["ORTHO_ID"],
        user_id=os.environ["USER_ID"],
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
        confidence_threshold=float(os.environ.get("CONF", "0.25")),
        include_classes=json.loads(os.environ.get("INCLUDE_CLASSES", '["plant","plants"]')),
        engine=os.environ.get("ENGINE", "yolo"),
        sam3_prompt=os.environ.get("SAM3_PROMPT", "plant"),
    )
    # Optional numeric tiling overrides (otherwise the service defaults + GSD
    # auto-scaling apply).
    for env_key, field in [
        ("TILE_WIDTH", "tile_width"), ("TILE_HEIGHT", "tile_height"),
        ("OVERLAP_X", "overlap_x"), ("OVERLAP_Y", "overlap_y"),
        ("R_DEDUP", "r_dedup"), ("CONCURRENT_TILES", "concurrent_tiles"),
    ]:
        if os.environ.get(env_key):
            kwargs[field] = int(os.environ[env_key])
    if os.environ.get("REGION"):
        kwargs["region"] = json.loads(os.environ["REGION"])
    return AsyncPlantDetectionRequest(**kwargs)


def main():
    request = _build_request()
    logger.info(f"[Job] loading model {WEIGHTS_PATH} for job {request.job_id} / ortho {request.orthomosaic_id}")
    # The service loads the model in its ASGI lifespan, which a Job never runs —
    # so populate app.state.model here, then reuse the shared pipeline verbatim.
    app.state.model = YOLO(WEIGHTS_PATH)
    asyncio.run(run_async_detection(request))
    logger.info(f"[Job] finished job {request.job_id}")


if __name__ == "__main__":
    main()
