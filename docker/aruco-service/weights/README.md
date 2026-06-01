# Model weights

Drop the trained plnt_v3 weights here so the Docker build can bundle them:

```
docker/aruco-service/weights/plnt_v3.pt
```

This is the `best.pt` produced by the Colab training run (YOLOv11-seg, ~45 MB).
The Dockerfile copies it to `/app/weights/plnt_v3.pt`, and the service loads it at
startup. Override the path with the `WEIGHTS_PATH` env var if needed.

The `.pt` file itself is **git-ignored** (too large to commit) — store/distribute it
out of band (Supabase Storage, GCS, a release asset) and place it here before building.
