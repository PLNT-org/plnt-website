export interface GeoBounds {
  west: number
  south: number
  east: number
  north: number
}

/**
 * Convert GeoTIFF bounding box from its native CRS to WGS84 (lat/lng).
 *
 * @param bbox - [west, south, east, north] in the GeoTIFF's native CRS
 * @param geoKeys - GeoKeys from geotiff's image.getGeoKeys()
 * @returns Bounds in WGS84 (longitude/latitude)
 */
export function convertBoundsToWGS84(
  bbox: number[],
  geoKeys: Record<string, number>
): GeoBounds {
  const epsg = geoKeys.ProjectedCSTypeGeoKey

  // If no projected CRS, assume already in geographic coordinates
  if (!epsg || epsg === 4326) {
    return { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }
  }

  // UTM North: EPSG 32601–32660
  if (epsg >= 32601 && epsg <= 32660) {
    const zone = epsg - 32600
    const sw = utmToLatLng(bbox[0], bbox[1], zone, true)
    const ne = utmToLatLng(bbox[2], bbox[3], zone, true)
    return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat }
  }

  // UTM South: EPSG 32701–32760
  if (epsg >= 32701 && epsg <= 32760) {
    const zone = epsg - 32700
    const sw = utmToLatLng(bbox[0], bbox[1], zone, false)
    const ne = utmToLatLng(bbox[2], bbox[3], zone, false)
    return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat }
  }

  console.warn(`Unknown EPSG:${epsg}, returning raw bounds`)
  return { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }
}

/**
 * Convert UTM coordinates to WGS84 lat/lng.
 * Uses the inverse Transverse Mercator formulas with WGS84 ellipsoid.
 */
function utmToLatLng(
  easting: number,
  northing: number,
  zone: number,
  northern: boolean
): { lat: number; lng: number } {
  // WGS84 ellipsoid
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e
  const ep2 = e2 / (1 - e2) // e'^2

  const k0 = 0.9996 // UTM scale factor
  const x = easting - 500000 // Remove false easting
  const y = northern ? northing : northing - 10000000 // Remove false northing for south

  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  // Footpoint latitude
  const phi1 =
    mu +
    (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu) +
    (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = Math.tan(phi1)

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1)
  const T1 = tanPhi1 * tanPhi1
  const C1 = ep2 * cosPhi1 * cosPhi1
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5)
  const D = x / (N1 * k0)

  // Latitude
  const lat =
    phi1 -
    (N1 * tanPhi1 / R1) *
      (D * D / 2 -
        (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24 +
        (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) *
          D * D * D * D * D * D / 720)

  // Longitude
  const centralMeridian = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180)
  const lng =
    centralMeridian +
    (D -
      (1 + 2 * T1 + C1) * D * D * D / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) *
        D * D * D * D * D / 120) /
      cosPhi1

  return {
    lat: lat * (180 / Math.PI),
    lng: lng * (180 / Math.PI),
  }
}
