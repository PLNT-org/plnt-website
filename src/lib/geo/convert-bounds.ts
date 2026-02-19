import proj4 from 'proj4'

export interface GeoBounds {
  west: number
  south: number
  east: number
  north: number
}

/**
 * Convert GeoTIFF bounding box from its native CRS to WGS84 (lat/lng).
 *
 * GeoTIFFs from WebODM Lightning are typically in a UTM projection
 * (EPSG:326xx for north / 327xx for south). Leaflet needs WGS84 (EPSG:4326).
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

  // Build proj4 definition for the source CRS
  const sourceProj = getProj4Definition(epsg)
  if (!sourceProj) {
    console.warn(`Unknown EPSG:${epsg}, returning raw bounds`)
    return { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }
  }

  // Convert SW and NE corners to WGS84
  const [swLng, swLat] = proj4(sourceProj, 'EPSG:4326', [bbox[0], bbox[1]])
  const [neLng, neLat] = proj4(sourceProj, 'EPSG:4326', [bbox[2], bbox[3]])

  return {
    west: swLng,
    south: swLat,
    east: neLng,
    north: neLat,
  }
}

/**
 * Get a proj4 definition string for common EPSG codes.
 * Handles UTM zones (326xx North, 327xx South) which are the most common
 * output CRS from OpenDroneMap / WebODM.
 */
function getProj4Definition(epsg: number): string | null {
  // UTM North: EPSG 32601–32660
  if (epsg >= 32601 && epsg <= 32660) {
    const zone = epsg - 32600
    return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`
  }

  // UTM South: EPSG 32701–32760
  if (epsg >= 32701 && epsg <= 32760) {
    const zone = epsg - 32700
    return `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
  }

  // WGS84 geographic
  if (epsg === 4326) {
    return 'EPSG:4326'
  }

  // Web Mercator
  if (epsg === 3857) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs'
  }

  return null
}
