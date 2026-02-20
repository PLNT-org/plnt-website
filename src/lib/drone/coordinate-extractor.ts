// Coordinate Extractor for Nadir Drone Images
// Extracts GPS coordinates for any point in a drone image using EXIF data

import ExifReader from 'exifreader'

export interface DroneImageMetadata {
  // GPS Position of drone
  latitude: number
  longitude: number
  altitude: number // meters above ground (relative altitude)
  absoluteAltitude?: number // meters above sea level

  // Camera parameters
  focalLength: number // mm
  focalLength35mm?: number // 35mm equivalent
  imageWidth: number // pixels
  imageHeight: number // pixels

  // Sensor info (calculated or from known specs)
  sensorWidth: number // mm
  sensorHeight: number // mm

  // Calculated values
  gsdX: number // Ground Sample Distance X (meters per pixel)
  gsdY: number // Ground Sample Distance Y (meters per pixel)
  footprintWidth: number // meters
  footprintHeight: number // meters

  // Optional DJI-specific data
  gimbalPitch?: number
  gimbalYaw?: number
  gimbalRoll?: number
  droneModel?: string
  timestamp?: Date
}

export interface PixelCoordinate {
  x: number
  y: number
}

export interface GroundCoordinate {
  latitude: number
  longitude: number
  distanceFromCenter: number // meters
}

// Known DJI sensor specifications
const DJI_SENSORS: Record<string, { width: number; height: number }> = {
  // DJI Mini 3 / Mini 3 Pro - 1/1.3" sensor
  'FC3582': { width: 9.7, height: 7.3 },  // Mini 3 Pro
  'FC3683': { width: 9.7, height: 7.3 },  // Mini 3
  // DJI Mini 2 - 1/2.3" sensor
  'FC7303': { width: 6.3, height: 4.7 },
  // DJI Mavic 3 - 4/3" sensor
  'FC3411': { width: 17.3, height: 13.0 },
  // DJI Air 2S - 1" sensor
  'FC3170': { width: 13.2, height: 8.8 },
  // DJI Mavic Air 2 - 1/2" sensor
  'FC3040': { width: 6.4, height: 4.8 },
  // Default fallback (1/2.3" sensor common in consumer drones)
  'default': { width: 6.3, height: 4.7 },
}

/**
 * Extract EXIF metadata from a drone image buffer
 */
export async function extractDroneMetadata(
  imageBuffer: ArrayBuffer
): Promise<DroneImageMetadata> {
  const tags = ExifReader.load(imageBuffer, { expanded: true })

  // Extract GPS coordinates
  const gps = tags.gps
  if (!gps?.Latitude || !gps?.Longitude) {
    throw new Error('No GPS data found in image. Ensure the image has embedded location data.')
  }

  const latitude = gps.Latitude
  const longitude = gps.Longitude

  // Get altitude - prefer relative altitude for accurate GSD calculation
  // DJI stores relative altitude in XMP as RelativeAltitude
  let altitude = 0
  let absoluteAltitude: number | undefined

  // Check for DJI XMP data first (most accurate for relative altitude)
  const xmp = tags.xmp
  if (xmp?.RelativeAltitude) {
    const relAlt = xmp.RelativeAltitude
    altitude = parseFloat(String(relAlt.value ?? relAlt.description ?? relAlt))
  } else if (gps.Altitude) {
    // Fallback to GPS altitude (usually absolute)
    const gpsAlt = gps.Altitude
    altitude = typeof gpsAlt === 'number' ? gpsAlt : parseFloat(String(gpsAlt))
    absoluteAltitude = altitude
    // If we only have absolute altitude, it's less accurate for GSD
    console.warn('Using absolute altitude - relative altitude not found. GSD may be less accurate.')
  }

  // Ensure altitude is a valid number
  if (isNaN(altitude)) {
    altitude = 0
  }

  if (altitude <= 0) {
    // Use a reasonable default altitude if none found
    console.warn('No valid altitude found in EXIF. Using default of 50m. GSD calculations will be approximate.')
    altitude = 50
  }

  // Extract camera parameters
  const exif = tags.exif || {}

  // Helper to extract numeric value from EXIF tag (handles various formats)
  const getNumericValue = (tag: any, fallback: number): number => {
    if (!tag) return fallback
    if (typeof tag === 'number') return tag
    if (typeof tag.value === 'number') return tag.value
    if (Array.isArray(tag.value)) return tag.value[0] // Rational numbers stored as [numerator, denominator]
    if (tag.description) {
      const num = parseFloat(tag.description)
      if (!isNaN(num)) return num
    }
    return fallback
  }

  const focalLength = getNumericValue(exif.FocalLength, 6.7) // DJI Mini 3 default
  const focalLength35mm = getNumericValue(exif.FocalLengthIn35mmFilm, 0) || undefined

  // Get image dimensions
  const imageWidth = getNumericValue(exif.PixelXDimension, 0) ||
                     getNumericValue(exif.ImageWidth, 0) ||
                     getNumericValue(tags.file?.['Image Width'], 0) ||
                     4000
  const imageHeight = getNumericValue(exif.PixelYDimension, 0) ||
                      getNumericValue(exif.ImageHeight, 0) ||
                      getNumericValue(tags.file?.['Image Height'], 0) ||
                      3000

  // Determine sensor size
  // Try to identify drone model from EXIF
  const make = exif.Make?.description || ''
  const model = exif.Model?.description || ''
  const droneModel = `${make} ${model}`.trim()

  // Look up sensor by model code or use default
  let sensorSpec = DJI_SENSORS['default']
  for (const [code, spec] of Object.entries(DJI_SENSORS)) {
    if (model.includes(code)) {
      sensorSpec = spec
      break
    }
  }

  // If we have 35mm equivalent focal length, we can calculate sensor size
  // sensor_width = focal_length * 36 / focal_length_35mm
  if (focalLength35mm && focalLength) {
    sensorSpec = {
      width: (focalLength * 36) / focalLength35mm,
      height: (focalLength * 24) / focalLength35mm,
    }
  }

  const sensorWidth = sensorSpec.width
  const sensorHeight = sensorSpec.height

  // Calculate Ground Sample Distance (GSD)
  // GSD = (altitude * sensor_dimension) / (focal_length * image_dimension)
  const gsdX = (altitude * sensorWidth) / (focalLength * imageWidth) // meters per pixel
  const gsdY = (altitude * sensorHeight) / (focalLength * imageHeight)

  // Calculate image footprint on ground
  const footprintWidth = gsdX * imageWidth
  const footprintHeight = gsdY * imageHeight

  // Extract gimbal data if available (DJI XMP)
  let gimbalPitch: number | undefined
  let gimbalYaw: number | undefined
  let gimbalRoll: number | undefined

  if (xmp) {
    if (xmp.GimbalPitchDegree) gimbalPitch = parseFloat(String(xmp.GimbalPitchDegree.value || xmp.GimbalPitchDegree))
    if (xmp.GimbalYawDegree) gimbalYaw = parseFloat(String(xmp.GimbalYawDegree.value || xmp.GimbalYawDegree))
    if (xmp.GimbalRollDegree) gimbalRoll = parseFloat(String(xmp.GimbalRollDegree.value || xmp.GimbalRollDegree))
  }

  // Extract timestamp
  let timestamp: Date | undefined
  if (exif.DateTimeOriginal?.description) {
    // Format: "2024:01:15 14:30:00"
    const dateStr = exif.DateTimeOriginal.description.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    timestamp = new Date(dateStr)
  }

  return {
    latitude,
    longitude,
    altitude,
    absoluteAltitude,
    focalLength,
    focalLength35mm,
    imageWidth,
    imageHeight,
    sensorWidth,
    sensorHeight,
    gsdX,
    gsdY,
    footprintWidth,
    footprintHeight,
    gimbalPitch,
    gimbalYaw,
    gimbalRoll,
    droneModel: droneModel || undefined,
    timestamp,
  }
}

/**
 * Convert pixel coordinates to ground coordinates
 * Assumes nadir (straight-down) image
 */
export function pixelToGroundCoordinate(
  pixel: PixelCoordinate,
  metadata: DroneImageMetadata
): GroundCoordinate {
  const { latitude, longitude, imageWidth, imageHeight, gsdX, gsdY, gimbalYaw } = metadata

  // Calculate offset from image center in pixels
  const centerX = imageWidth / 2
  const centerY = imageHeight / 2

  const offsetPixelX = pixel.x - centerX
  const offsetPixelY = centerY - pixel.y // Y is inverted (image Y increases downward)

  // Convert pixel offset to meters
  let offsetMetersX = offsetPixelX * gsdX
  let offsetMetersY = offsetPixelY * gsdY

  // Rotate by gimbal yaw to account for drone heading
  // Yaw 0° = north (image top points north), 90° = east, etc.
  // Without rotation, we assume image top = north, which is wrong when the drone faces other directions
  if (gimbalYaw !== undefined && gimbalYaw !== 0) {
    const yawRad = gimbalYaw * Math.PI / 180
    const cosYaw = Math.cos(yawRad)
    const sinYaw = Math.sin(yawRad)

    const rotatedX = offsetMetersX * cosYaw - offsetMetersY * sinYaw
    const rotatedY = offsetMetersX * sinYaw + offsetMetersY * cosYaw

    offsetMetersX = rotatedX
    offsetMetersY = rotatedY
  }

  // Convert meters to lat/long degrees
  // At the equator: 1 degree latitude ≈ 111,320 meters
  // Longitude varies with latitude: 1 degree ≈ 111,320 * cos(latitude) meters
  const metersPerDegreeLat = 111320
  const metersPerDegreeLon = 111320 * Math.cos(latitude * Math.PI / 180)

  const offsetLat = offsetMetersY / metersPerDegreeLat
  const offsetLon = offsetMetersX / metersPerDegreeLon

  // Calculate distance from center
  const distanceFromCenter = Math.sqrt(offsetMetersX ** 2 + offsetMetersY ** 2)

  return {
    latitude: latitude + offsetLat,
    longitude: longitude + offsetLon,
    distanceFromCenter,
  }
}

/**
 * Convert ground coordinates back to pixel coordinates
 */
export function groundToPixelCoordinate(
  ground: { latitude: number; longitude: number },
  metadata: DroneImageMetadata
): PixelCoordinate {
  const { latitude, longitude, imageWidth, imageHeight, gsdX, gsdY } = metadata

  // Convert lat/long offset to meters
  const metersPerDegreeLat = 111320
  const metersPerDegreeLon = 111320 * Math.cos(latitude * Math.PI / 180)

  const offsetMetersY = (ground.latitude - latitude) * metersPerDegreeLat
  const offsetMetersX = (ground.longitude - longitude) * metersPerDegreeLon

  // Convert meters to pixels
  const offsetPixelX = offsetMetersX / gsdX
  const offsetPixelY = offsetMetersY / gsdY

  // Convert from center-based to top-left-based coordinates
  const centerX = imageWidth / 2
  const centerY = imageHeight / 2

  return {
    x: centerX + offsetPixelX,
    y: centerY - offsetPixelY, // Y is inverted
  }
}

/**
 * Get the corner coordinates of the image footprint
 */
export function getImageFootprintCorners(
  metadata: DroneImageMetadata
): { topLeft: GroundCoordinate; topRight: GroundCoordinate; bottomLeft: GroundCoordinate; bottomRight: GroundCoordinate } {
  const { imageWidth, imageHeight } = metadata

  return {
    topLeft: pixelToGroundCoordinate({ x: 0, y: 0 }, metadata),
    topRight: pixelToGroundCoordinate({ x: imageWidth, y: 0 }, metadata),
    bottomLeft: pixelToGroundCoordinate({ x: 0, y: imageHeight }, metadata),
    bottomRight: pixelToGroundCoordinate({ x: imageWidth, y: imageHeight }, metadata),
  }
}

/**
 * Check if the gimbal was pointing straight down (nadir)
 * Returns true if pitch is within tolerance of -90 degrees
 */
export function isNadirShot(metadata: DroneImageMetadata, toleranceDegrees = 10): boolean {
  if (metadata.gimbalPitch === undefined) {
    // Can't determine, assume nadir
    return true
  }
  // Nadir is -90 degrees (pointing straight down)
  return Math.abs(metadata.gimbalPitch + 90) <= toleranceDegrees
}
