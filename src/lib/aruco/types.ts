// ArUco Detection Types
// Type definitions for ArUco marker detection API

/**
 * Request body for ArUco detection
 */
export interface ArUcoDetectionRequest {
  geotiff_url: string
  dictionary?: string
  callback_url?: string
}

/**
 * A detected ArUco marker with position and metadata
 */
export interface ArUcoMarker {
  marker_id: number
  latitude: number
  longitude: number
  pixel_x: number
  pixel_y: number
  corner_pixels: number[][]
  corner_coords: number[][]
  confidence: number
  rotation_deg: number
}

/**
 * Response from ArUco detection
 */
export interface ArUcoDetectionResponse {
  success: boolean
  marker_count: number
  markers: ArUcoMarker[]
  dictionary: string
  geotiff_url: string
  error?: string
}

/**
 * Health check response
 */
export interface ArUcoHealthResponse {
  status: string
  opencv_version: string
  rasterio_version: string
}

/**
 * ArUco detection status for orthomosaic
 */
export type ArUcoDetectionStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Supported ArUco dictionaries
 */
export const ARUCO_DICTIONARIES = [
  'DICT_4X4_50',
  'DICT_4X4_100',
  'DICT_4X4_250',
  'DICT_4X4_1000',
  'DICT_5X5_50',
  'DICT_5X5_100',
  'DICT_5X5_250',
  'DICT_5X5_1000',
  'DICT_6X6_50',
  'DICT_6X6_100',
  'DICT_6X6_250',
  'DICT_6X6_1000',
  'DICT_7X7_50',
  'DICT_7X7_100',
  'DICT_7X7_250',
  'DICT_7X7_1000',
  'DICT_ARUCO_ORIGINAL',
] as const

export type ArUcoDictionary = typeof ARUCO_DICTIONARIES[number]

/**
 * Default dictionary for detection
 */
export const DEFAULT_ARUCO_DICTIONARY: ArUcoDictionary = 'DICT_7X7_1000'
