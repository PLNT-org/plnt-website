# Model weights

Drop the trained weights here so the Docker build can bundle them — one `.pt`
per selectable model:

```
docker/aruco-service/weights/plnt_v7.pt        # 2 cm/px, trained 2026-07-05
docker/aruco-service/weights/plnt_v6.pt        # 2 cm/px, general (default)
docker/aruco-service/weights/plnt_1cm_v3.pt    # 1 cm/px, high-res
```

**Name the file after the model it actually contains.** Through July 2026 the
file called `plnt_v3.pt` in fact held `plnt_v7` (dataset_v7, trained 2026-07-05),
because the weights are gitignored and a swapped `.pt` leaves no trace in git or
in the logs — the pre-registry service only logged the path. Counts generated on
orthos between 2026-07-06 and 2026-07-26 came from v7, not v3. Verify a
checkpoint's identity before bundling it:

```bash
python3 -c "import zipfile,re;z=zipfile.ZipFile('plnt_v7.pt');\
d=z.read([n for n in z.namelist() if n.endswith('data.pkl')][0]).decode('latin-1');\
print(re.findall(r'dataset[a-z0-9_]*',d)[:1], re.findall(r'20..-..-..T[0-9:.]+',d)[:1])"
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
