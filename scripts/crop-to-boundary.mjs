// crop-to-boundary.mjs — clip a raw ortho to a SAVED parcel boundary locally,
// so the dashboard's manual "Draw Boundary → Crop to Boundary" step can be
// skipped entirely on re-flights of a parcel that has been cropped before.
//
//   node scripts/crop-to-boundary.mjs <rawTif> <boundary.geojson> <out.tif>
//
// The output is a 4-band RGB+alpha GeoTIFF (alpha carries the boundary: 255
// inside, 0 clipped away) — the same shape the dashboard crop produces, so it
// feeds upload-ortho.mjs → detection → publish-survey.mjs unchanged.
//
// Boundaries live in scripts/*.geojson and are produced from an already-cropped
// file with:
//   gdal_footprint -t_srs EPSG:4326 -of GeoJSON cropped.tif boundary.geojson
//
// Env overrides:
//   COMPRESS   DEFLATE (default) | JPEG   — JPEG is much smaller, lossy
//   RESAMPLE   near (default) | cubic

import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'

const [, , rawTif, cutline, outTif] = process.argv
if (!rawTif || !cutline || !outTif) {
  console.error('Usage: node scripts/crop-to-boundary.mjs <rawTif> <boundary.geojson> <out.tif>')
  process.exit(1)
}
for (const f of [rawTif, cutline]) {
  if (!existsSync(f)) { console.error(`❌ not found: ${f}`); process.exit(1) }
}

const COMPRESS = process.env.COMPRESS || 'DEFLATE'
const RESAMPLE = process.env.RESAMPLE || 'near'

const describe = (label, file) => {
  const j = JSON.parse(execFileSync('gdalinfo', ['-json', file]).toString())
  const [w, h] = j.size
  const gsdM = Math.abs(j.geoTransform[1])
  const cc = j.cornerCoordinates
  const acres = (Math.abs(cc.upperRight[0] - cc.lowerLeft[0]) *
                 Math.abs(cc.upperRight[1] - cc.lowerLeft[1])) / 4046.856
  console.log(`  ${label}: ${w}×${h} px · ${(gsdM * 100).toFixed(2)} cm/px · ` +
    `${(statSync(file).size / 1e9).toFixed(2)} GB · bbox ≈ ${acres.toFixed(1)} ac · ` +
    `${j.bands.length} band(s)`)
  return { gsdM, bands: j.bands.length }
}

console.log(`\n▸ Cropping to saved boundary`)
console.log(`  raw:      ${rawTif}`)
console.log(`  boundary: ${cutline}`)
const src = describe('in ', rawTif)

const opts = [
  '-overwrite',
  '-cutline', cutline, '-cutline_srs', 'EPSG:4326', '-crop_to_cutline',
  '-r', RESAMPLE,
  '-of', 'GTiff',
  '-co', 'TILED=YES',
  '-co', `COMPRESS=${COMPRESS}`,
  '-co', 'BLOCKXSIZE=512', '-co', 'BLOCKYSIZE=512',
  '-co', 'BIGTIFF=IF_SAFER',
  '-wo', 'NUM_THREADS=ALL_CPUS', '-multi',
]
// Only add an alpha band if the source doesn't already carry one — a second
// -dstalpha on a 4-band RGBA input yields a 5-band file the viewer won't read.
if (src.bands < 4) opts.push('-dstalpha')
if (COMPRESS === 'DEFLATE') opts.push('-co', 'PREDICTOR=2')

execFileSync('gdalwarp', [...opts, rawTif, outTif], { stdio: 'inherit' })

const out = describe('out', outTif)
console.log(`\n✅ ${outTif}`)
if (out.gsdM * 100 < 1.7) {
  // Not a problem — just worth seeing. The detection service scales tile
  // geometry by ref_gsd_cm / gsd so a finer ortho still hits the model's
  // validated operating point (see scale_for_gsd in app/plant_detection.py).
  console.log(`   NOTE: ${(out.gsdM * 100).toFixed(2)} cm/px is finer than plnt_v7's 2.0 cm/px reference —`)
  console.log(`   the service rescales tiling by ${(2.0 / (out.gsdM * 100)).toFixed(2)}× to hold v7's operating point.`)
}
console.log(`   Next: node scripts/upload-ortho.mjs ${outTif} "<Ortho name>"\n`)
