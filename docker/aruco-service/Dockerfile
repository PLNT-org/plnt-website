# ArUco + plant-detection service
# CUDA-enabled PyTorch base so plnt_v3 (YOLOv11-seg) runs on GPU.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

# System dependencies:
#   gdal-bin          -> gdal_translate CLI used by /sync-ortho COG conversion
#   libgdal/geos/proj -> rasterio runtime
#   libgl1/glib       -> OpenCV runtime libs
#   curl              -> container HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies first for better caching.
# torch is already present in the base image, so pip treats it as satisfied.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Bundle the model into the image — fetching at runtime would slow cold starts.
COPY weights/plnt_v3.pt /app/weights/plnt_v3.pt

# Expose port (kept at 8001 to match ARUCO_SERVICE_URL across the app;
# deploy to Cloud Run with `--port 8001`).
EXPOSE 8001

# Health check (start-period bumped for model + CUDA init on cold start)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
