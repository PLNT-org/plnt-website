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
    HomographyRequest,
    HomographyResponse,
    BatchHomographyRequest,
    BatchHomographyResponse,
    CogConvertRequest,
    CogConvertResponse,
    SyncOrthoRequest,
    SyncOrthoResponse,
    PlantDetectionRequest,
    AsyncPlantDetectionRequest,
)
from .detector import detect_aruco_markers
from .georef import (
    download_geotiff,
    load_geotiff_for_detection,
    cleanup_temp_file,
)
from .plant_detection import detect_plants
from .homography import compute_homography, crop_ortho_by_bounds


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


@app.post("/homography", response_model=HomographyResponse)
async def compute_image_homography(request: HomographyRequest):
    """
    Compute a homography matrix mapping raw drone image pixels to orthomosaic pixels.

    Downloads both images, crops the ortho to the GPS region of the raw image,
    runs SIFT feature matching, and returns the 3x3 homography matrix plus the
    crop offset so the caller can map detections to full-ortho pixel coordinates.
    """
    temp_ortho = None
    temp_raw = None

    try:
        import numpy as np

        # Download both files
        logger.info(f"Downloading ortho: {request.geotiff_url[:80]}...")
        temp_ortho = await download_geotiff(request.geotiff_url)

        logger.info(f"Downloading raw image: {request.raw_image_url[:80]}...")
        temp_raw = await download_geotiff(request.raw_image_url)

        # Load ortho
        ortho_image, _, _ = load_geotiff_for_detection(temp_ortho)
        logger.info(f"Ortho loaded: {ortho_image.shape}")

        # Load raw image with OpenCV (not rasterio — it's a regular JPEG)
        raw_image = cv2.imread(temp_raw, cv2.IMREAD_COLOR)
        if raw_image is None:
            return HomographyResponse(
                success=False, error="Failed to decode raw image"
            )
        logger.info(f"Raw image loaded: {raw_image.shape}")

        # Convert ortho from RGB to BGR for OpenCV
        ortho_bgr = cv2.cvtColor(ortho_image, cv2.COLOR_RGB2BGR)

        # Crop ortho to the approximate GPS region
        ortho_bounds = {
            "north": 0, "south": 0, "east": 0, "west": 0
        }

        # Extract bounds from GeoTIFF, converting to WGS84 if needed
        with rasterio.open(temp_ortho) as src:
            bounds = src.bounds
            crs = src.crs

            if crs and not crs.is_geographic:
                # Projected CRS (e.g. UTM) — convert corners to WGS84
                from rasterio.warp import transform_bounds
                west, south, east, north = transform_bounds(
                    crs, "EPSG:4326",
                    bounds.left, bounds.bottom, bounds.right, bounds.top
                )
                logger.info(f"Converted bounds from {crs} to WGS84: N={north:.6f} S={south:.6f} E={east:.6f} W={west:.6f}")
                ortho_bounds = {
                    "north": north,
                    "south": south,
                    "east": east,
                    "west": west,
                }
            else:
                ortho_bounds = {
                    "north": bounds.top,
                    "south": bounds.bottom,
                    "east": bounds.right,
                    "west": bounds.left,
                }

        image_gps = {
            "latitude": request.image_latitude,
            "longitude": request.image_longitude,
        }
        footprint = (request.footprint_width_m, request.footprint_height_m)

        crop, offset_x, offset_y = crop_ortho_by_bounds(
            ortho_bgr, ortho_bounds, image_gps, footprint,
            padding_factor=request.padding_factor,
        )

        if crop is None:
            return HomographyResponse(
                success=False,
                error="Raw image GPS falls outside orthomosaic bounds",
            )

        logger.info(
            f"Ortho crop: {crop.shape} at offset ({offset_x}, {offset_y})"
        )

        # Compute homography
        result = compute_homography(raw_image, crop)

        if result is None:
            return HomographyResponse(
                success=False,
                error="Feature matching failed — not enough matches between raw image and ortho",
            )

        return HomographyResponse(
            success=True,
            homography=result["homography"],
            crop_offset_x=offset_x,
            crop_offset_y=offset_y,
            crop_width=crop.shape[1],
            crop_height=crop.shape[0],
            good_matches=result["good_matches"],
            inlier_count=result["inlier_count"],
            inlier_ratio=result["inlier_ratio"],
        )

    except Exception as e:
        logger.error(f"Homography computation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Homography computation failed: {str(e)}",
        )

    finally:
        if temp_ortho:
            cleanup_temp_file(temp_ortho)
        if temp_raw:
            cleanup_temp_file(temp_raw)


@app.post("/homography/batch", response_model=BatchHomographyResponse)
async def compute_batch_homography(request: BatchHomographyRequest):
    """
    Compute homography matrices for multiple raw images against one orthomosaic.

    Downloads the ortho once, then processes each raw image. Much more efficient
    than calling /homography individually for each image.
    """
    temp_ortho = None
    temp_files: list[str] = []

    try:
        import numpy as np

        # Download and load ortho once
        logger.info(f"Downloading ortho for batch ({len(request.images)} images)...")
        temp_ortho = await download_geotiff(request.geotiff_url)

        ortho_image, _, _ = load_geotiff_for_detection(temp_ortho)
        ortho_bgr = cv2.cvtColor(ortho_image, cv2.COLOR_RGB2BGR)

        # Extract bounds, converting to WGS84 if needed
        with rasterio.open(temp_ortho) as src:
            bounds = src.bounds
            crs = src.crs

            if crs and not crs.is_geographic:
                from rasterio.warp import transform_bounds
                west, south, east, north = transform_bounds(
                    crs, "EPSG:4326",
                    bounds.left, bounds.bottom, bounds.right, bounds.top
                )
                logger.info(f"Converted bounds from {crs} to WGS84")
                ortho_bounds = {
                    "north": north,
                    "south": south,
                    "east": east,
                    "west": west,
                }
            else:
                ortho_bounds = {
                    "north": bounds.top,
                    "south": bounds.bottom,
                    "east": bounds.right,
                    "west": bounds.left,
                }

        ortho_h, ortho_w = ortho_bgr.shape[:2]
        logger.info(f"Ortho loaded: {ortho_w}x{ortho_h}")

        results: list[HomographyResponse] = []

        for i, img_spec in enumerate(request.images):
            temp_raw = None
            try:
                raw_url = img_spec["raw_image_url"]
                lat = img_spec["latitude"]
                lon = img_spec["longitude"]
                fw = img_spec["footprint_width_m"]
                fh = img_spec["footprint_height_m"]

                logger.info(f"[{i+1}/{len(request.images)}] Processing {raw_url.split('/')[-1]}...")

                # Download raw image
                temp_raw = await download_geotiff(raw_url)
                temp_files.append(temp_raw)

                raw_image = cv2.imread(temp_raw, cv2.IMREAD_COLOR)
                if raw_image is None:
                    results.append(HomographyResponse(
                        success=False, error="Failed to decode raw image"
                    ))
                    continue

                # Crop ortho
                crop, offset_x, offset_y = crop_ortho_by_bounds(
                    ortho_bgr, ortho_bounds,
                    {"latitude": lat, "longitude": lon},
                    (fw, fh),
                    padding_factor=request.padding_factor,
                )

                if crop is None:
                    results.append(HomographyResponse(
                        success=False,
                        error="Image GPS falls outside orthomosaic bounds",
                    ))
                    continue

                # Compute homography
                result = compute_homography(raw_image, crop)

                if result is None:
                    results.append(HomographyResponse(
                        success=False,
                        error="Feature matching failed",
                    ))
                    continue

                results.append(HomographyResponse(
                    success=True,
                    homography=result["homography"],
                    crop_offset_x=offset_x,
                    crop_offset_y=offset_y,
                    crop_width=crop.shape[1],
                    crop_height=crop.shape[0],
                    good_matches=result["good_matches"],
                    inlier_count=result["inlier_count"],
                    inlier_ratio=result["inlier_ratio"],
                ))

            except Exception as e:
                logger.error(f"Error processing image {i}: {e}")
                results.append(HomographyResponse(
                    success=False, error=str(e)
                ))
            finally:
                if temp_raw:
                    cleanup_temp_file(temp_raw)

        return BatchHomographyResponse(
            success=True,
            results=results,
            ortho_width=ortho_w,
            ortho_height=ortho_h,
        )

    except Exception as e:
        logger.error(f"Batch homography failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Batch homography failed: {str(e)}",
        )

    finally:
        if temp_ortho:
            cleanup_temp_file(temp_ortho)
        for f in temp_files:
            cleanup_temp_file(f)


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
    Run tiled plant detection on an orthomosaic via Roboflow YOLO.

    Downloads the GeoTIFF, tiles it, sends tiles to Roboflow for inference,
    runs NMS, and streams NDJSON progress events followed by the final result.
    """
    temp_file = None

    async def generate():
        nonlocal temp_file
        try:
            import asyncio
            from .plant_detection import (
                is_tile_empty, run_tile_inference, apply_nms, pixel_to_gps,
            )

            # Download the GeoTIFF
            yield json.dumps({"type": "status", "message": "Downloading orthomosaic..."}) + "\n"
            temp_file = await download_geotiff(request.geotiff_url)
            file_size = os.path.getsize(temp_file)
            logger.info(f"Downloaded: {file_size / 1024 / 1024:.1f} MB")

            # Load image
            yield json.dumps({"type": "status", "message": "Decoding image..."}) + "\n"
            image, _, _ = load_geotiff_for_detection(temp_file)
            img_height, img_width = image.shape[:2]
            logger.info(f"Image shape: {image.shape}")

            # Build tile jobs
            tile_w = request.tile_width
            tile_h = request.tile_height
            stride_x = tile_w - request.overlap_x
            stride_y = tile_h - request.overlap_y
            allowed_classes = [c.lower() for c in request.include_classes]

            tile_jobs = []
            skipped = 0
            for ty in range(0, img_height, stride_y):
                for tx in range(0, img_width, stride_x):
                    crop_w = min(tile_w, img_width - tx)
                    crop_h = min(tile_h, img_height - ty)
                    if is_tile_empty(image, tx, ty, crop_w, crop_h):
                        skipped += 1
                    else:
                        tile_jobs.append((tx, ty, crop_w, crop_h))

            total_tiles = len(tile_jobs)
            logger.info(f"Tiling: {img_width}x{img_height}, {total_tiles} tiles, {skipped} empty skipped")

            yield json.dumps({
                "type": "progress",
                "processedTiles": 0,
                "totalTiles": total_tiles,
                "detectionsCount": 0,
                "phase": "tiling",
            }) + "\n"

            # Process tiles in batches, streaming progress after each batch
            all_detections = []
            processed = 0
            concurrent = request.concurrent_tiles

            import httpx as httpx_client
            async with httpx_client.AsyncClient(timeout=60.0) as client:
                for i in range(0, len(tile_jobs), concurrent):
                    batch = tile_jobs[i:i + concurrent]

                    async def process_tile(job):
                        x, y, crop_w, crop_h = job
                        tile = image[y:y+crop_h, x:x+crop_w]
                        tile_bgr = cv2.cvtColor(tile, cv2.COLOR_RGB2BGR)
                        _, png_buf = cv2.imencode(".png", tile_bgr)
                        tile_png = png_buf.tobytes()

                        predictions = await run_tile_inference(
                            client, tile_png,
                            request.roboflow_api_url, request.roboflow_model_id,
                            request.roboflow_api_key, request.confidence_threshold,
                        )

                        dets = []
                        for pred in predictions:
                            pred_class = (pred.get("class") or "plant").lower()
                            if pred_class not in allowed_classes:
                                continue
                            dets.append({
                                "x": x + pred["x"],
                                "y": y + pred["y"],
                                "width": pred["width"],
                                "height": pred["height"],
                                "confidence": pred["confidence"],
                                "class": pred.get("class", "plant"),
                            })
                        return dets

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

                    # Stream progress after every batch to keep connection alive
                    yield json.dumps({
                        "type": "progress",
                        "processedTiles": processed,
                        "totalTiles": total_tiles,
                        "detectionsCount": len(all_detections),
                        "phase": "tiling",
                    }) + "\n"

            # NMS
            yield json.dumps({
                "type": "progress",
                "processedTiles": total_tiles,
                "totalTiles": total_tiles,
                "detectionsCount": len(all_detections),
                "phase": "nms",
            }) + "\n"

            logger.info(f"Detections before NMS: {len(all_detections)}")
            final_detections = apply_nms(all_detections, request.nms_iou_threshold)
            logger.info(f"Detections after NMS: {len(final_detections)}")

            # Add GPS coordinates
            for det in final_detections:
                gps = pixel_to_gps(det["x"], det["y"], request.bounds, img_width, img_height)
                det["latitude"] = gps["lat"]
                det["longitude"] = gps["lng"]
                det["pixel_x"] = round(det["x"])
                det["pixel_y"] = round(det["y"])

            # Build class counts
            class_counts = {}
            total_confidence = 0.0
            for det in final_detections:
                cls = det.get("class", "plant")
                class_counts[cls] = class_counts.get(cls, 0) + 1
                total_confidence += det["confidence"]

            avg_confidence = total_confidence / len(final_detections) if final_detections else 0

            yield json.dumps({
                "type": "result",
                "success": True,
                "totalDetections": len(final_detections),
                "classCounts": class_counts,
                "averageConfidence": avg_confidence,
                "imageWidth": img_width,
                "imageHeight": img_height,
                "detections": final_detections,
            }) + "\n"

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
    import asyncio
    from .plant_detection import is_tile_empty, run_tile_inference, apply_nms, pixel_to_gps
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
        image, _, _ = load_geotiff_for_detection(temp_file)
        img_height, img_width = image.shape[:2]
        logger.info(f"[AsyncDetect] Image: {img_width}x{img_height}")

        # Build tile jobs
        tile_w = request.tile_width
        tile_h = request.tile_height
        stride_x = tile_w - request.overlap_x
        stride_y = tile_h - request.overlap_y
        allowed_classes = [c.lower() for c in request.include_classes]

        tile_jobs = []
        skipped = 0
        for ty in range(0, img_height, stride_y):
            for tx in range(0, img_width, stride_x):
                crop_w = min(tile_w, img_width - tx)
                crop_h = min(tile_h, img_height - ty)
                if is_tile_empty(image, tx, ty, crop_w, crop_h):
                    skipped += 1
                else:
                    tile_jobs.append((tx, ty, crop_w, crop_h))

        total_tiles = len(tile_jobs)
        logger.info(f"[AsyncDetect] {total_tiles} tiles to process, {skipped} empty skipped")

        await sb.update_job(request.job_id, {
            "progress": {"processedTiles": 0, "totalTiles": total_tiles, "detectionsCount": 0, "phase": "tiling"},
            "updated_at": "now()",
        })

        # Process tiles
        all_detections = []
        processed = 0
        concurrent = request.concurrent_tiles

        import httpx as httpx_client
        async with httpx_client.AsyncClient(timeout=60.0) as client:
            for i in range(0, len(tile_jobs), concurrent):
                batch = tile_jobs[i:i + concurrent]

                async def process_tile(job):
                    x, y, crop_w, crop_h = job
                    tile = image[y:y+crop_h, x:x+crop_w]
                    tile_bgr = cv2.cvtColor(tile, cv2.COLOR_RGB2BGR)
                    _, png_buf = cv2.imencode(".png", tile_bgr)
                    tile_png = png_buf.tobytes()

                    predictions = await run_tile_inference(
                        client, tile_png,
                        request.roboflow_api_url, request.roboflow_model_id,
                        request.roboflow_api_key, request.confidence_threshold,
                    )

                    dets = []
                    for pred in predictions:
                        pred_class = (pred.get("class") or "plant").lower()
                        if pred_class not in allowed_classes:
                            continue
                        dets.append({
                            "x": x + pred["x"],
                            "y": y + pred["y"],
                            "width": pred["width"],
                            "height": pred["height"],
                            "confidence": pred["confidence"],
                            "class": pred.get("class", "plant"),
                        })
                    return dets

                results = await asyncio.gather(
                    *[process_tile(job) for job in batch],
                    return_exceptions=True,
                )

                for result in results:
                    if isinstance(result, Exception):
                        logger.error(f"[AsyncDetect] Tile error: {result}")
                    else:
                        all_detections.extend(result)

                processed += len(batch)

                # Update progress every 5 batches to avoid hammering Supabase
                if processed % (concurrent * 5) < concurrent or processed >= total_tiles:
                    await sb.update_job(request.job_id, {
                        "progress": {
                            "processedTiles": processed,
                            "totalTiles": total_tiles,
                            "detectionsCount": len(all_detections),
                            "phase": "tiling",
                        },
                        "updated_at": "now()",
                    })

        # NMS
        logger.info(f"[AsyncDetect] Detections before NMS: {len(all_detections)}")
        final_detections = apply_nms(all_detections, request.nms_iou_threshold)
        logger.info(f"[AsyncDetect] Detections after NMS: {len(final_detections)}")

        # Add GPS coordinates
        for det in final_detections:
            gps = pixel_to_gps(det["x"], det["y"], request.bounds, img_width, img_height)
            det["latitude"] = gps["lat"]
            det["longitude"] = gps["lng"]
            det["pixel_x"] = round(det["x"])
            det["pixel_y"] = round(det["y"])

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


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "ArUco Detection Service",
        "version": "1.4.0",
        "endpoints": {
            "health": "/health",
            "detect": "/detect (POST)",
            "detect_plants": "/detect-plants (POST)",
            "homography": "/homography (POST)",
            "homography_batch": "/homography/batch (POST)",
            "convert_cog": "/convert-cog (POST)",
            "sync_ortho": "/sync-ortho (POST)",
        }
    }
