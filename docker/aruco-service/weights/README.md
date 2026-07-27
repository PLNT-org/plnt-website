# Model weights

Drop the trained weights here so the Docker build can bundle them — one `.pt`
per selectable model:

```
docker/aruco-service/weights/plnt_v3.pt        # 2 cm/px, the original model
docker/aruco-service/weights/plnt_v6.pt        # 2 cm/px, general (default)
docker/aruco-service/weights/plnt_1cm_v3.pt    # 1 cm/px, high-res
```

Each is the `best.pt` produced by a Colab training run (YOLOv11-seg, ~45 MB).
The Dockerfile copies the whole directory to `/app/weights/`, and the service
loads every model listed in `MODELS` (see `app/main.py`) at startup — a model
whose file is missing is skipped with a warning rather than failing boot, so an
image built without one weight still serves the rest. `deploy.sh` refuses to
build unless all three are present. Override the default model's path with the
`WEIGHTS_PATH` env var if needed.

The `.pt` file itself is **git-ignored** (too large to commit) — store/distribute it
out of band (Supabase Storage, GCS, a release asset) and place it here before building.
