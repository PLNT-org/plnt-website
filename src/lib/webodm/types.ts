// WebODM API Types

export interface WebODMProject {
  id: number
  name: string
  description: string
  created_at: string
  permissions: string[]
}

export interface WebODMTask {
  id: string
  project: number
  name: string
  processing_node: number | null
  processing_node_name: string | null
  images_count: number
  status: WebODMTaskStatus
  available_assets: string[]
  created_at: string
  pending_action: string | null
  options: WebODMTaskOption[]
}

export type WebODMTaskStatus = {
  code: WebODMStatusCode
}

export enum WebODMStatusCode {
  QUEUED = 10,
  RUNNING = 20,
  FAILED = 30,
  COMPLETED = 40,
  CANCELED = 50,
}

export interface WebODMTaskOption {
  name: string
  value: string | number | boolean
}

export interface WebODMTaskInfo {
  id: string
  uuid: string
  name: string
  dateCreated: number
  processingTime: number
  status: {
    code: WebODMStatusCode
  }
  options: WebODMTaskOption[]
  imagesCount: number
  progress: number
}

export interface WebODMProcessingOptions {
  // Quality presets
  'auto-boundary'?: boolean
  'crop'?: number
  'dem-resolution'?: number
  'dsm'?: boolean
  'dtm'?: boolean
  'feature-quality'?: 'ultra' | 'high' | 'medium' | 'low' | 'lowest'
  'gps-accuracy'?: number
  'mesh-octree-depth'?: number
  'mesh-size'?: number
  'min-num-features'?: number
  'orthophoto-resolution'?: number
  'pc-quality'?: 'ultra' | 'high' | 'medium' | 'low' | 'lowest'
  'skip-3dmodel'?: boolean
  'use-3dmesh'?: boolean
  'fast-orthophoto'?: boolean
  'split'?: number
  'split-overlap'?: number
}

export interface WebODMBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface CreateTaskParams {
  projectId: number
  name: string
  images: File[] | string[]  // File objects or URLs
  options?: WebODMProcessingOptions
}

export interface CreateTaskResponse {
  id: string
  project: number
  name: string
}

export interface TaskStatusResponse {
  id: string
  status: WebODMStatusCode
  progress: number
  processingTime: number
  imagesCount: number
  availableAssets: string[]
  error?: string
}

export interface OrthomosaicMetadata {
  bounds: WebODMBounds
  resolution: number  // cm per pixel
  width: number
  height: number
  crs: string  // Coordinate reference system
}

// Preset configurations for different use cases
export const PROCESSING_PRESETS = {
  fast: {
    'feature-quality': 'low' as const,
    'pc-quality': 'low' as const,
    'fast-orthophoto': true,
    'skip-3dmodel': true,
    'orthophoto-resolution': 5,
  },
  balanced: {
    'feature-quality': 'medium' as const,
    'pc-quality': 'medium' as const,
    'orthophoto-resolution': 3,
    'skip-3dmodel': true,
  },
  highQuality: {
    'feature-quality': 'high' as const,
    'pc-quality': 'high' as const,
    'orthophoto-resolution': 1,
    'dsm': true,
  },
  plantCounting: {
    'feature-quality': 'high' as const,
    'pc-quality': 'medium' as const,
    'orthophoto-resolution': 1,  // 1cm/pixel for plant detection
    'skip-3dmodel': true,
    'auto-boundary': true,
    'crop': 3,
  },
  // Height mapping preset for tree/canopy height measurement
  // Generates DSM (Digital Surface Model) and DTM (Digital Terrain Model)
  // CHM (Canopy Height Model) = DSM - DTM
  heightMapping: {
    'feature-quality': 'high' as const,
    'pc-quality': 'high' as const,
    'orthophoto-resolution': 2,   // 2cm/pixel for terrain detail
    'dsm': true,                   // Digital Surface Model (with vegetation)
    'dtm': true,                   // Digital Terrain Model (bare ground)
    'dem-resolution': 2,           // 2cm DEM resolution
    'use-3dmesh': true,            // Enable 3D mesh for better terrain
    'mesh-octree-depth': 11,       // Higher detail mesh
    'mesh-size': 300000,           // More mesh faces
    'skip-3dmodel': false,         // Generate 3D model
    'auto-boundary': true,
    'crop': 3,
  },
} as const
