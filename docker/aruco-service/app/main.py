"""FastAPI application for ArUco marker detection service."""

import json
import logging
import os
from contextlib import asynccontextmanager

import cv2
import rasterio
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .models import (
    DetectionRequest,
    DetectionResponse,
    DetectedMarker,
    HealthResponse,
    CogConvertRequest,
    CogConvertResponse,
    SyncOrthoRequest,
    SyncOrthoResponse,
    PlantDetectionRequest,
    AsyncPlantDetectionRequest,
    GenerateTilesRequest,
    GenerateTilesResponse,
    RecomputeCoordsRequest,
    RecomputeCoordsResponse,
    CropToBoundaryRequest,
    CropToBoundaryResponse,
)
from .detector import detect_aruco_markers
from .georef import (
    download_geotiff,
    load_geotiff_for_detection,
    cleanup_temp_file,
)
from .plant_detection import detect_plants_local

from ultralytics import YOLO

# Path to the bundled plnt_v3 weights (override with WEIGHTS_PATH env var)
WEIGHTS_PATH = os.environ.get("WEIGHTS_PATH", "/app/weights/plnt_v3.pt")


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
    # Load the plant-detection model once at boot (not per request).
    logger.info(f"Loading plant detection model: {WEIGHTS_PATH}")
    app.state.model = YOLO(WEIGHTS_PATH)
    logger.info("Plant detection model loaded")
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


@app.post("/convert-cog", response_model=CogConvertResponse)
async def convert_to_cog(request: CogConvertRequest):
    """
    Convert a GeoTIFF to Cloud-Optimized GeoTIFF (COG).

    Downloads the source TIF, converts it using GDAL via rasterio,
    then uploads the COG to the provided signed URL.
    """
    temp_input = None
    temp_output = None

    try:
        import subprocess

        # Download source GeoTIFF
        logger.info(f"Downloading source GeoTIFF for COG conversion...")
        temp_input = await download_geotiff(request.geotiff_url)
        file_size = os.path.getsize(temp_input)
        logger.info(f"Downloaded: {file_size / 1024 / 1024:.1f} MB")

        # Create output path
        temp_output = temp_input.replace(".tif", "_cog.tif")

        # Convert to COG using gdal_translate
        # JPEG compression for RGB orthomosaics with quality 85
        # Internal tiling (512x512) and overviews for progressive loading
        cmd = [
            "gdal_translate",
            "-of", "COG",
            "-co", "COMPRESS=JPEG",
            "-co", "QUALITY=85",
            "-co", "OVERVIEWS=AUTO",
            "-co", "BLOCKSIZE=512",
            temp_input,
            temp_output,
        ]

        logger.info(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"gdal_translate failed: {result.stderr}")
            return CogConvertResponse(
                success=False,
                error=f"GDAL conversion failed: {result.stderr[:500]}",
            )

        cog_size = os.path.getsize(temp_output)
        logger.info(f"COG created: {cog_size / 1024 / 1024:.1f} MB")

        # Upload COG to signed URL
        logger.info("Uploading COG to storage...")
        import httpx
        async with httpx.AsyncClient(timeout=600.0) as client:
            with open(temp_output, "rb") as f:
                upload_response = await client.put(
                    request.upload_url,
                    content=f.read(),
                    headers={"Content-Type": "image/tiff"},
                )

            if upload_response.status_code >= 400:
                error_text = upload_response.text[:500]
                logger.error(f"Upload failed ({upload_response.status_code}): {error_text}")
                return CogConvertResponse(
                    success=False,
                    error=f"Upload failed: {error_text}",
                )

        logger.info("COG uploaded successfully")
        return CogConvertResponse(
            success=True,
            file_size_mb=round(cog_size / 1024 / 1024, 1),
        )

    except subprocess.TimeoutExpired:
        logger.error("COG conversion timed out after 600s")
        return CogConvertResponse(success=False, error="Conversion timed out")
    except Exception as e:
        logger.error(f"COG conversion failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"COG conversion failed: {str(e)}",
        )
    finally:
        if temp_input:
            cleanup_temp_file(temp_input)
        if temp_output:
            cleanup_temp_file(temp_output)


@app.post("/detect-plants")
async def detect_plants_endpoint(request: PlantDetectionRequest):
    """
    Run tiled plant detection on an orthomosaic with the local plnt_v3 model.

    Downloads the GeoTIFF, runs the shared detection pipeline, and streams
    NDJSON progress events followed by the final result.
    """
    temp_file = None

    async def generate():
        nonlocal temp_file
        try:
            # Download the GeoTIFF
            yield json.dumps({"type": "status", "message": "Downloading orthomosaic..."}) + "\n"
            temp_file = await download_geotiff(request.geotiff_url)
            file_size = os.path.getsize(temp_file)
            logger.info(f"Downloaded: {file_size / 1024 / 1024:.1f} MB")

            # Load image
            yield json.dumps({"type": "status", "message": "Decoding image..."}) + "\n"
            image, transform, crs = load_geotiff_for_detection(temp_file)
            logger.info(f"Image shape: {image.shape}, CRS: {crs}")

            # Shared tiling -> inference -> dedup -> georeference pipeline
            async for event in detect_plants_local(
                app.state.model,
                image,
                transform,
                crs,
                tile_w=request.tile_width,
                tile_h=request.tile_height,
                overlap_x=request.overlap_x,
                overlap_y=request.overlap_y,
                confidence=request.confidence_threshold,
                r_dedup=request.r_dedup,
                include_classes=request.include_classes,
                progress_every=request.concurrent_tiles,
            ):
                yield json.dumps(event) + "\n"

        except Exception as e:
            logger.error(f"Plant detection failed: {str(e)}", exc_info=True)
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"
        finally:
            if temp_file:
                cleanup_temp_file(temp_file)

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
    )


@app.post("/detect-plants-async")
async def detect_plants_async_endpoint(request: AsyncPlantDetectionRequest, background_tasks: BackgroundTasks):
    """
    Start plant detection as a background task.

    Returns immediately with 202 Accepted. The detection runs in the background
    and writes progress/results directly to Supabase.
    """
    background_tasks.add_task(
        run_async_detection, request
    )

    return {"accepted": True, "job_id": request.job_id}


async def run_async_detection(request: AsyncPlantDetectionRequest):
    """Background task that runs the full detection pipeline and writes to Supabase."""
    from .supabase_client import SupabaseClient

    sb = SupabaseClient(request.supabase_url, request.supabase_service_key)
    temp_file = None

    try:
        # Update status: downloading
        await sb.update_job(request.job_id, {
            "status": "downloading",
            "updated_at": "now()",
        })

        logger.info(f"[AsyncDetect] Job {request.job_id}: downloading GeoTIFF...")
        temp_file = await download_geotiff(request.geotiff_url)
        file_size = os.path.getsize(temp_file)
        logger.info(f"[AsyncDetect] Downloaded: {file_size / 1024 / 1024:.1f} MB")

        # Update status: detecting
        await sb.update_job(request.job_id, {
            "status": "detecting",
            "updated_at": "now()",
        })

        # Load image
        image, transform, crs = load_geotiff_for_detection(temp_file)
        logger.info(f"[AsyncDetect] Image: {image.shape[1]}x{image.shape[0]}, CRS: {crs}")

        # Shared tiling -> inference -> dedup -> georeference pipeline.
        # Throttle Supabase progress writes so we don't hammer the DB.
        result_event = None
        total_tiles = 0
        last_written = -1
        progress_stride = max(1, request.concurrent_tiles * 5)
        async for event in detect_plants_local(
            app.state.model,
            image,
            transform,
            crs,
            tile_w=request.tile_width,
            tile_h=request.tile_height,
            overlap_x=request.overlap_x,
            overlap_y=request.overlap_y,
            confidence=request.confidence_threshold,
            r_dedup=request.r_dedup,
            include_classes=request.include_classes,
            progress_every=request.concurrent_tiles,
        ):
            if event["type"] == "result":
                result_event = event
            elif event["type"] == "progress":
                total_tiles = event["totalTiles"]
                processed = event["processedTiles"]
                # Always write the dedup ("nms") phase; throttle tiling updates.
                if (event["phase"] != "tiling"
                        or processed - last_written >= progress_stride
                        or processed >= total_tiles):
                    last_written = processed
                    await sb.update_job(request.job_id, {
                        "progress": {
                            "processedTiles": processed,
                            "totalTiles": total_tiles,
                            "detectionsCount": event["detectionsCount"],
                            "phase": event["phase"],
                        },
                        "updated_at": "now()",
                    })

        if result_event is None:
            raise RuntimeError("Detection produced no result event")

        final_detections = result_event["detections"]
        logger.info(f"[AsyncDetect] Detections after dedup: {len(final_detections)}")

        # Save to DB
        await sb.update_job(request.job_id, {
            "status": "saving",
            "progress": {
                "processedTiles": total_tiles,
                "totalTiles": total_tiles,
                "detectionsCount": len(final_detections),
                "phase": "saving",
            },
            "updated_at": "now()",
        })

        # Delete existing AI labels
        await sb.delete_ai_labels(request.orthomosaic_id)

        # Insert new labels
        labels = [{
            "orthomosaic_id": request.orthomosaic_id,
            "user_id": request.user_id,
            "latitude": det["latitude"],
            "longitude": det["longitude"],
            "pixel_x": det["pixel_x"],
            "pixel_y": det["pixel_y"],
            "source": "ai",
            "confidence": det["confidence"],
            "label": det.get("class", "plant"),
            "verified": False,
        } for det in final_detections]

        saved_count = await sb.insert_labels(labels)
        logger.info(f"[AsyncDetect] Saved {saved_count} of {len(labels)} labels")

        # Build class counts
        class_counts = {}
        for det in final_detections:
            cls = det.get("class", "plant")
            class_counts[cls] = class_counts.get(cls, 0) + 1

        avg_confidence = (
            sum(d["confidence"] for d in final_detections) / len(final_detections)
            if final_detections else 0
        )

        # Mark completed
        await sb.update_job(request.job_id, {
            "status": "completed",
            "result": {
                "totalDetections": len(final_detections),
                "savedCount": saved_count,
                "classCounts": class_counts,
                "averageConfidence": round(avg_confidence, 4),
            },
            "completed_at": "now()",
            "updated_at": "now()",
        })

        logger.info(f"[AsyncDetect] Job {request.job_id} completed: {len(final_detections)} detections")

    except Exception as e:
        logger.error(f"[AsyncDetect] Job {request.job_id} failed: {str(e)}", exc_info=True)
        await sb.update_job(request.job_id, {
            "status": "failed",
            "error_message": str(e)[:1000],
            "updated_at": "now()",
        })
    finally:
        if temp_file:
            cleanup_temp_file(temp_file)


@app.post("/sync-ortho", response_model=SyncOrthoResponse)
async def sync_orthophoto(request: SyncOrthoRequest):
    """
    Full orthophoto sync: download from source, upload TIF, convert to COG, extract metadata.

    Used by the Lightning sync flow to offload all heavy processing from Vercel.
    Downloads the GeoTIFF from the source URL (e.g. WebODM Lightning), uploads the
    original TIF to Supabase, converts to COG, uploads the COG, and returns metadata.
    """
    temp_input = None
    temp_cog = None

    try:
        import subprocess
        import httpx as httpx_client
        from rasterio.warp import transform_bounds

        # Step 1: Download source GeoTIFF
        logger.info(f"Downloading source GeoTIFF...")
        temp_input = await download_geotiff(request.geotiff_url)
        tif_size = os.path.getsize(temp_input)
        logger.info(f"Downloaded: {tif_size / 1024 / 1024:.1f} MB")

        # Step 2: Extract metadata
        logger.info("Extracting metadata...")
        bounds_dict = None
        img_width = 0
        img_height = 0
        resolution_cm = 0.0

        with rasterio.open(temp_input) as src:
            img_width = src.width
            img_height = src.height
            res_x = src.res[0]
            resolution_cm = abs(res_x) * 100

            raw_bounds = src.bounds
            crs = src.crs

            if crs and not crs.is_geographic:
                west, south, east, north = transform_bounds(
                    crs, "EPSG:4326",
                    raw_bounds.left, raw_bounds.bottom, raw_bounds.right, raw_bounds.top
                )
                # Resolution was in projected units (meters), convert correctly
                resolution_cm = abs(res_x) * 100
            else:
                west, south, east, north = raw_bounds.left, raw_bounds.bottom, raw_bounds.right, raw_bounds.top
                # If geographic CRS, resolution is in degrees — approximate to cm
                resolution_cm = abs(res_x) * 111320 * 100

            bounds_dict = {"west": west, "south": south, "east": east, "north": north}

        logger.info(f"Metadata: {img_width}x{img_height}, {resolution_cm:.1f} cm/px, bounds={bounds_dict}")

        # Step 3: Upload original TIF to Supabase
        logger.info("Uploading original TIF to storage...")
        async with httpx_client.AsyncClient(timeout=600.0) as client:
            with open(temp_input, "rb") as f:
                tif_upload_res = await client.put(
                    request.tif_upload_url,
                    content=f.read(),
                    headers={"Content-Type": "image/tiff"},
                )
            if tif_upload_res.status_code >= 400:
                logger.error(f"TIF upload failed: {tif_upload_res.text[:500]}")
                return SyncOrthoResponse(success=False, error="Failed to upload TIF to storage")

        logger.info("TIF uploaded")

        # Step 4: Convert to COG
        temp_cog = temp_input.replace(".tif", "_cog.tif")
        cmd = [
            "gdal_translate",
            "-of", "COG",
            "-co", "COMPRESS=JPEG",
            "-co", "QUALITY=85",
            "-co", "OVERVIEWS=AUTO",
            "-co", "BLOCKSIZE=512",
            temp_input,
            temp_cog,
        ]
        logger.info(f"Converting to COG...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"gdal_translate failed: {result.stderr}")
            return SyncOrthoResponse(
                success=False,
                error=f"COG conversion failed: {result.stderr[:500]}",
            )

        cog_size = os.path.getsize(temp_cog)
        logger.info(f"COG created: {cog_size / 1024 / 1024:.1f} MB")

        # Step 5: Upload COG to Supabase
        logger.info("Uploading COG to storage...")
        async with httpx_client.AsyncClient(timeout=600.0) as client:
            with open(temp_cog, "rb") as f:
                cog_upload_res = await client.put(
                    request.cog_upload_url,
                    content=f.read(),
                    headers={"Content-Type": "image/tiff"},
                )
            if cog_upload_res.status_code >= 400:
                logger.error(f"COG upload failed: {cog_upload_res.text[:500]}")
                return SyncOrthoResponse(
                    success=False,
                    error="Failed to upload COG to storage",
                )

        logger.info("COG uploaded successfully")

        return SyncOrthoResponse(
            success=True,
            tif_size_mb=round(tif_size / 1024 / 1024, 1),
            cog_size_mb=round(cog_size / 1024 / 1024, 1),
            bounds=bounds_dict,
            image_width=img_width,
            image_height=img_height,
            resolution_cm=round(resolution_cm, 2),
        )

    except Exception as e:
        logger.error(f"Sync ortho failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Sync ortho failed: {str(e)}",
        )
    finally:
        if temp_input:
            cleanup_temp_file(temp_input)
        if temp_cog:
            cleanup_temp_file(temp_cog)


@app.post("/generate-tiles", response_model=GenerateTilesResponse)
async def generate_tiles(request: GenerateTilesRequest):
    """
    Generate an XYZ tile pyramid from a GeoTIFF/COG with gdal2tiles, upload it to
    the `orthomosaic-tiles` Supabase bucket, and set the orthomosaic's tiles_url.

    Uses GDAL (handles arbitrarily large rasters via overviews) — the right tool
    for orthos too big for the sharp/Vercel path. --xyz produces top-origin tiles
    matching Leaflet and the {z}/{x}/{y}.png serving convention.
    """
    import asyncio
    import glob
    import shutil
    import subprocess
    import tempfile
    import httpx as httpx_client

    temp_src = None
    tile_dir = None
    try:
        logger.info(f"[Tiles] Downloading source: {request.geotiff_url[:80]}...")
        temp_src = await download_geotiff(request.geotiff_url)
        tile_dir = tempfile.mkdtemp(prefix="tiles_")

        cmd = ["gdal2tiles.py", "--xyz", "-w", "none", "--processes", "4", "--resampling", "average"]
        if request.min_zoom is not None and request.max_zoom is not None:
            cmd += ["-z", f"{request.min_zoom}-{request.max_zoom}"]
        cmd += [temp_src, tile_dir]
        logger.info(f"[Tiles] {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3000)
        if result.returncode != 0:
            logger.error(f"[Tiles] gdal2tiles failed: {result.stderr[-800:]}")
            return GenerateTilesResponse(success=False, error=f"gdal2tiles failed: {result.stderr[-300:]}")

        # Collect produced tiles: {tile_dir}/{z}/{x}/{y}.png
        tile_files = []
        for path in glob.glob(os.path.join(tile_dir, "*", "*", "*.png")):
            parts = os.path.relpath(path, tile_dir).split(os.sep)
            if len(parts) == 3:
                tile_files.append((path, "/".join(parts)))  # (local, "z/x/y.png")
        logger.info(f"[Tiles] Produced {len(tile_files)} tiles")
        if not tile_files:
            return GenerateTilesResponse(success=False, error="gdal2tiles produced no tiles")

        zlevels = sorted({int(rel.split("/")[0]) for _, rel in tile_files})
        zoom_range = f"{zlevels[0]}-{zlevels[-1]}"

        base = request.supabase_url.rstrip("/")
        up_headers = {
            "Authorization": f"Bearer {request.supabase_service_key}",
            "apikey": request.supabase_service_key,
            "Content-Type": "image/png",
            "x-upsert": "true",
        }
        uploaded = 0
        sem = asyncio.Semaphore(32)
        async with httpx_client.AsyncClient(timeout=60.0) as client:
            async def upload_one(local_path: str, rel: str):
                nonlocal uploaded
                obj = f"{request.orthomosaic_id}/{rel}"
                url = f"{base}/storage/v1/object/orthomosaic-tiles/{obj}"
                with open(local_path, "rb") as fh:
                    data = fh.read()
                async with sem:
                    for attempt in range(3):
                        try:
                            r = await client.post(url, content=data, headers=up_headers)
                            if r.status_code < 300:
                                uploaded += 1
                                return
                            if attempt == 2:
                                logger.error(f"[Tiles] upload {obj}: {r.status_code} {r.text[:120]}")
                        except Exception as e:
                            if attempt == 2:
                                logger.error(f"[Tiles] upload error {obj}: {e}")
                        await asyncio.sleep(0.4 * (attempt + 1))
            await asyncio.gather(*[upload_one(p, rel) for p, rel in tile_files])

        logger.info(f"[Tiles] Uploaded {uploaded}/{len(tile_files)} tiles (zoom {zoom_range})")

        tiles_url = (
            f"{base}/storage/v1/object/public/orthomosaic-tiles/"
            f"{request.orthomosaic_id}/{{z}}/{{x}}/{{y}}.png"
        )
        async with httpx_client.AsyncClient(timeout=30.0) as client:
            await client.patch(
                f"{base}/rest/v1/orthomosaics?id=eq.{request.orthomosaic_id}",
                headers={
                    "Authorization": f"Bearer {request.supabase_service_key}",
                    "apikey": request.supabase_service_key,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={"tiles_url": tiles_url, "updated_at": "now()"},
            )

        return GenerateTilesResponse(
            success=True, tile_count=uploaded, tiles_url=tiles_url, zoom_range=zoom_range
        )

    except Exception as e:
        logger.error(f"Tile generation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Tile generation failed: {str(e)}")
    finally:
        if temp_src:
            cleanup_temp_file(temp_src)
        if tile_dir and os.path.isdir(tile_dir):
            shutil.rmtree(tile_dir, ignore_errors=True)


@app.post("/recompute-coords", response_model=RecomputeCoordsResponse)
async def recompute_coords(request: RecomputeCoordsRequest):
    """Recompute latitude/longitude for an ortho's stored AI plant_labels from
    their pixel_x/pixel_y using the GeoTIFF affine transform + CRS reprojection.

    Fixes rows written with the old linear-bounds approximation — no re-detection
    needed (pixel coords are stored). Idempotent (recomputes unconditionally);
    skips rows whose pixel_x/pixel_y are NULL (those predate pixel storage).
    """
    import asyncio
    import httpx as httpx_client
    from .plant_detection import pixels_to_wgs84

    temp_file = None
    try:
        temp_file = await download_geotiff(request.geotiff_url)
        _, transform, crs = load_geotiff_for_detection(temp_file)
        logger.info(f"[Recompute] {request.orthomosaic_id}: CRS={crs}")

        base = request.supabase_url.rstrip("/")
        headers = {
            "Authorization": f"Bearer {request.supabase_service_key}",
            "apikey": request.supabase_service_key,
        }

        # Fetch all AI labels (paginated) with their pixel coords.
        rows = []
        page_size = 1000
        offset = 0
        async with httpx_client.AsyncClient(timeout=60.0) as client:
            while True:
                r = await client.get(
                    f"{base}/rest/v1/plant_labels",
                    headers=headers,
                    params={
                        "orthomosaic_id": f"eq.{request.orthomosaic_id}",
                        "source": "eq.ai",
                        "select": "id,pixel_x,pixel_y",
                        "limit": page_size,
                        "offset": offset,
                    },
                )
                batch = r.json()
                if not isinstance(batch, list) or not batch:
                    break
                rows.extend(batch)
                if len(batch) < page_size:
                    break
                offset += page_size

        with_px = [r for r in rows if r.get("pixel_x") is not None and r.get("pixel_y") is not None]
        skipped = len(rows) - len(with_px)
        logger.info(f"[Recompute] {len(rows)} labels, {len(with_px)} with pixels, {skipped} skipped")
        if not with_px:
            return RecomputeCoordsResponse(success=True, updated=0, skipped_no_pixels=skipped, crs=str(crs))

        # One batched reprojection for the whole ortho.
        lngs, lats = pixels_to_wgs84(
            transform, crs,
            [r["pixel_x"] for r in with_px],
            [r["pixel_y"] for r in with_px],
        )

        updated = 0
        sem = asyncio.Semaphore(32)
        async with httpx_client.AsyncClient(timeout=60.0) as client:
            async def patch_one(row_id, lat, lng):
                nonlocal updated
                async with sem:
                    for attempt in range(3):
                        try:
                            rr = await client.patch(
                                f"{base}/rest/v1/plant_labels",
                                headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                                params={"id": f"eq.{row_id}"},
                                json={"latitude": lat, "longitude": lng},
                            )
                            if rr.status_code < 300:
                                updated += 1
                                return
                        except Exception:
                            pass
                        await asyncio.sleep(0.3 * (attempt + 1))
            await asyncio.gather(*[
                patch_one(r["id"], lat, lng)
                for r, lat, lng in zip(with_px, lats, lngs)
            ])

        logger.info(f"[Recompute] Updated {updated}/{len(with_px)} labels (CRS={crs})")
        return RecomputeCoordsResponse(
            success=True, updated=updated, skipped_no_pixels=skipped, crs=str(crs)
        )

    except Exception as e:
        logger.error(f"Recompute coords failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Recompute failed: {str(e)}")
    finally:
        if temp_file:
            cleanup_temp_file(temp_file)


@app.post("/crop-to-boundary", response_model=CropToBoundaryResponse)
async def crop_to_boundary(request: CropToBoundaryRequest):
    """Clip the ortho to a WGS84 boundary polygon with gdalwarp -cutline, writing
    a cropped TIF + COG (transparent outside the polygon, tight bounds) and
    pointing the ortho record at them with updated bounds.

    Non-destructive: writes to *_cropped paths (original files preserved) and
    clears tiles_url so tiles regenerate. Re-run Count Plants afterward — the
    cropped-out area is transparent/black, so the empty-tile skip ignores it.
    """
    import json as _json
    import subprocess
    import httpx as httpx_client
    import rasterio
    from rasterio.warp import transform_bounds

    temp_src = cropped = cropped_cog = cutline = None
    try:
        temp_src = await download_geotiff(request.geotiff_url)

        # Boundary -> GeoJSON cutline (WGS84). gdalwarp reprojects it to the
        # raster's CRS via -cutline_srs.
        cutline = temp_src.replace(".tif", "_cut.geojson")
        with open(cutline, "w") as f:
            _json.dump(
                {"type": "FeatureCollection",
                 "features": [{"type": "Feature", "properties": {}, "geometry": request.boundary}]},
                f,
            )

        cropped = temp_src.replace(".tif", "_cropped.tif")
        # The GeoJSON cutline is WGS84 (CRS84); gdalwarp auto-reprojects it to the
        # raster's CRS. (No -cutline_srs flag — not supported by this GDAL.)
        warp_cmd = [
            "gdalwarp", "-cutline", cutline, "-crop_to_cutline", "-dstalpha",
            "-of", "GTiff",
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES", "-overwrite",
            temp_src, cropped,
        ]
        logger.info(f"[Crop] {' '.join(warp_cmd)}")
        r = subprocess.run(warp_cmd, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            logger.error(f"[Crop] gdalwarp failed: {r.stderr[-800:]}")
            return CropToBoundaryResponse(success=False, error=f"gdalwarp failed: {r.stderr[-300:]}")

        # COG (DEFLATE keeps the alpha band so the crop stays transparent).
        cropped_cog = temp_src.replace(".tif", "_cropped_cog.tif")
        cog_cmd = [
            "gdal_translate", "-of", "COG", "-co", "COMPRESS=DEFLATE",
            "-co", "OVERVIEWS=AUTO", "-co", "BLOCKSIZE=512", cropped, cropped_cog,
        ]
        r2 = subprocess.run(cog_cmd, capture_output=True, text=True, timeout=1800)
        if r2.returncode != 0:
            logger.error(f"[Crop] COG conversion failed: {r2.stderr[-800:]}")
            return CropToBoundaryResponse(success=False, error=f"COG failed: {r2.stderr[-300:]}")

        with rasterio.open(cropped) as src:
            w, h = src.width, src.height
            b = src.bounds
            crs = src.crs
            if crs and not crs.is_geographic:
                west, south, east, north = transform_bounds(crs, "EPSG:4326", b.left, b.bottom, b.right, b.top)
            else:
                west, south, east, north = b.left, b.bottom, b.right, b.top
        bounds = {"west": west, "south": south, "east": east, "north": north}

        base = request.supabase_url.rstrip("/")
        sk = request.supabase_service_key
        tif_path = f"{request.orthomosaic_id}/orthophoto_cropped.tif"
        cog_path = f"{request.orthomosaic_id}/orthophoto_cropped_cog.tif"

        async with httpx_client.AsyncClient(timeout=600.0) as client:
            async def upload(path, local):
                with open(local, "rb") as fh:
                    data = fh.read()
                rr = await client.post(
                    f"{base}/storage/v1/object/orthomosaics/{path}",
                    content=data,
                    headers={"Authorization": f"Bearer {sk}", "apikey": sk,
                             "Content-Type": "image/tiff", "x-upsert": "true"},
                )
                rr.raise_for_status()
            await upload(tif_path, cropped)
            await upload(cog_path, cropped_cog)

        def pub(p):
            return f"{base}/storage/v1/object/public/orthomosaics/{p}"

        async with httpx_client.AsyncClient(timeout=60.0) as client:
            await client.patch(
                f"{base}/rest/v1/orthomosaics?id=eq.{request.orthomosaic_id}",
                headers={"Authorization": f"Bearer {sk}", "apikey": sk,
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
                json={
                    "original_tif_url": pub(tif_path),
                    "orthomosaic_url": pub(cog_path),
                    "bounds": bounds,
                    "image_width": w,
                    "image_height": h,
                    "tiles_url": None,  # force tile regeneration
                    "updated_at": "now()",
                },
            )

        logger.info(f"[Crop] {request.orthomosaic_id}: cropped to {w}x{h}, bounds={bounds}")
        return CropToBoundaryResponse(success=True, bounds=bounds, image_width=w, image_height=h)

    except Exception as e:
        logger.error(f"Crop to boundary failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Crop failed: {str(e)}")
    finally:
        for f in (temp_src, cropped, cropped_cog, cutline):
            if f:
                cleanup_temp_file(f)


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "ArUco Detection Service",
        "version": "1.8.1",
        "endpoints": {
            "health": "/health",
            "detect": "/detect (POST)",
            "detect_plants": "/detect-plants (POST)",
            "generate_tiles": "/generate-tiles (POST)",
            "recompute_coords": "/recompute-coords (POST)",
            "crop_to_boundary": "/crop-to-boundary (POST)",
            "convert_cog": "/convert-cog (POST)",
            "sync_ortho": "/sync-ortho (POST)",
        }
    }
