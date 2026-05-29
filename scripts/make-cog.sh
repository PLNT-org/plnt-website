#!/usr/bin/env bash
#
# make-cog.sh — Convert WebODM GeoTIFF outputs into Cloud-Optimized GeoTIFFs (COGs)
# ready to upload as a shareable property survey (RGB / NDVI / CHM).
#
# Requires GDAL:  brew install gdal
#
# Usage:
#   ./scripts/make-cog.sh rgb  input_orthophoto.tif   rgb_cog.tif
#   ./scripts/make-cog.sh chm  input_chm.tif          chm_cog.tif
#   ./scripts/make-cog.sh ndvi input_nir_red.tif      ndvi_cog.tif  [NIR_BAND] [RED_BAND]
#
# Notes:
#   - "ndvi" computes a single-band NDVI = (NIR - Red) / (NIR + Red) from the
#     orthophoto that contains your NIR and Red bands. Band order defaults to
#     NIR=1, Red=2. Run `gdalinfo input.tif` to confirm which band is which and
#     pass the band numbers explicitly if they differ.
#   - Output COGs include internal tiling + overviews so the website can stream
#     them with HTTP range requests (smooth pan/zoom, no full-file download).

set -euo pipefail

if ! command -v gdal_translate >/dev/null 2>&1; then
  echo "ERROR: GDAL not found. Install it with:  brew install gdal" >&2
  exit 1
fi

MODE="${1:-}"
INPUT="${2:-}"
OUTPUT="${3:-}"

if [[ -z "$MODE" || -z "$INPUT" || -z "$OUTPUT" ]]; then
  echo "Usage: $0 <rgb|chm|ndvi> <input.tif> <output_cog.tif> [NIR_BAND] [RED_BAND]" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: input file not found: $INPUT" >&2
  exit 1
fi

# Shared COG creation options (lossless, tiled, with overviews).
COG_OPTS=(-of COG
  -co COMPRESS=DEFLATE
  -co PREDICTOR=2
  -co BLOCKSIZE=512
  -co OVERVIEWS=AUTO
  -co OVERVIEW_RESAMPLING=AVERAGE
  -co BIGTIFF=IF_SAFER)

case "$MODE" in
  rgb)
    echo "[make-cog] RGB orthophoto -> COG"
    gdal_translate "${COG_OPTS[@]}" "$INPUT" "$OUTPUT"
    ;;

  chm)
    echo "[make-cog] Canopy Height Model -> single-band COG"
    gdal_translate "${COG_OPTS[@]}" "$INPUT" "$OUTPUT"
    ;;

  ndvi)
    if ! command -v gdal_calc.py >/dev/null 2>&1; then
      echo "ERROR: gdal_calc.py not found (ships with GDAL). Reinstall GDAL." >&2
      exit 1
    fi
    NIR_BAND="${4:-1}"
    RED_BAND="${5:-2}"
    TMP="$(mktemp -t ndvi).tif"
    trap 'rm -f "$TMP"' EXIT

    echo "[make-cog] NDVI = (NIR[band ${NIR_BAND}] - Red[band ${RED_BAND}]) / (NIR + Red)"
    gdal_calc.py \
      -A "$INPUT" --A_band="$NIR_BAND" \
      -B "$INPUT" --B_band="$RED_BAND" \
      --outfile="$TMP" \
      --type=Float32 \
      --NoDataValue=-9999 \
      --calc="(A.astype(numpy.float32)-B.astype(numpy.float32))/(A.astype(numpy.float32)+B.astype(numpy.float32)+1e-6)" \
      --overwrite

    echo "[make-cog] NDVI -> COG"
    gdal_translate "${COG_OPTS[@]}" "$TMP" "$OUTPUT"
    ;;

  *)
    echo "ERROR: unknown mode '$MODE' (expected rgb, chm, or ndvi)" >&2
    exit 1
    ;;
esac

echo "[make-cog] Done -> $OUTPUT"
gdalinfo "$OUTPUT" | grep -E "Size is|LAYOUT|OVERVIEW|Band " | head -20 || true
