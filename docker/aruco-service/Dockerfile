# ArUco + plant-detection service
# CUDA-enabled PyTorch base so plnt models (YOLOv11-seg) run on GPU.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

# System dependencies:
#   gdal-bin          -> gdal_translate CLI used by /sync-ortho COG conversion
#   python3-gdal      -> gdal2tiles.py used by /generate-tiles (XYZ tile pyramid)
#   libgdal/geos/proj -> rasterio runtime
#   libgl1/glib       -> OpenCV runtime libs
#   curl              -> container HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    python3-gdal \
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

# Bundle the models into the image — fetching at runtime would slow cold starts.
# Copies every .pt in weights/ (plnt_v3, plnt_v6, plnt_1cm_v3); the service
# loads them by name (see MODELS in app/main.py).
COPY weights/ /app/weights/

# Expose port (kept at 8001 to match ARUCO_SERVICE_URL across the app;
# deploy to Cloud Run with `--port 8001`).
EXPOSE 8001

# Health check (start-period bumped for model + CUDA init on cold start)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
