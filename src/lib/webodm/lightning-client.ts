// WebODM Lightning Client
// Uses the NodeODM API for cloud-based processing via WebODM Lightning
// Docs: https://webodm.net/api

import { WebODMProcessingOptions, PROCESSING_PRESETS } from './types'

export interface LightningNodeInfo {
  version: string
  engine: string
  engineVersion: string
  maxImages: number | null
  maxParallelTasks: number
  taskQueueCount: number
}

export interface LightningTaskInfo {
  uuid: string
  name: string
  dateCreated: number
  processingTime: number
  status: {
    code: LightningStatusCode
  }
  imagesCount: number
  progress: number
  options: Array<{ name: string; value: string }>
}

export enum LightningStatusCode {
  QUEUED = 10,
  RUNNING = 20,
  FAILED = 30,
  COMPLETED = 40,
  CANCELED = 50,
}

export interface CreateLightningTaskParams {
  name: string
  images: File[] | Blob[]
  options?: WebODMProcessingOptions
}

export interface LightningTaskResult {
  uuid: string
  status: LightningStatusCode
  progress: number
  processingTime: number
  imagesCount: number
  error?: string
}

/**
 * WebODM Lightning Client
 *
 * Connects to WebODM Lightning processing nodes using the NodeODM API.
 * Unlike self-hosted WebODM, Lightning doesn't use projects - tasks are created directly.
 *
 * Usage:
 *   const client = new LightningClient('spark1.webodm.net', 'your-token')
 *   const { uuid } = await client.createTask({ name: 'My Task', images: [...] })
 *   const status = await client.getTaskStatus(uuid)
 */
export class LightningClient {
  private baseUrl: string
  private token: string

  constructor(host?: string, token?: string) {
    const lightningHost = host || process.env.WEBODM_LIGHTNING_HOST || 'spark1.webodm.net'
    this.token = token || process.env.WEBODM_LIGHTNING_TOKEN || ''

    // Build URL - Lightning uses HTTPS on port 443
    this.baseUrl = `https://${lightningHost}`
  }

  private getAuthParam(): string {
    return this.token ? `?token=${this.token}` : ''
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const separator = endpoint.includes('?') ? '&' : '?'
    const url = `${this.baseUrl}${endpoint}${this.token ? `${separator}token=${this.token}` : ''}`

    const response = await fetch(url, options)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Lightning API Error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // ============================================
  // SERVER INFO
  // ============================================

  /**
   * Get information about the Lightning processing node
   */
  async getNodeInfo(): Promise<LightningNodeInfo> {
    return this.request<LightningNodeInfo>('/info')
  }

  /**
   * Get available processing options
   */
  async getOptions(): Promise<Array<{
    name: string
    type: string
    value: string
    domain: string
    help: string
  }>> {
    return this.request('/options')
  }

  /**
   * Check if the Lightning node is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getNodeInfo()
      return true
    } catch {
      return false
    }
  }

  // ============================================
  // TASK MANAGEMENT
  // ============================================

  /**
   * Create a new processing task with images
   *
   * This uses the chunked upload flow:
   * 1. POST /task/new/init - Initialize task
   * 2. POST /task/new/upload/{uuid} - Upload images in chunks
   * 3. POST /task/new/commit/{uuid} - Start processing
   */
  async createTask(params: CreateLightningTaskParams): Promise<{ uuid: string }> {
    const { name, images, options = PROCESSING_PRESETS.plantCounting } = params

    // Step 1: Initialize task
    const initFormData = new FormData()
    initFormData.append('name', name)

    // Add processing options as JSON array
    const optionsArray = Object.entries(options).map(([key, value]) => ({
      name: key,
      value: String(value),
    }))
    initFormData.append('options', JSON.stringify(optionsArray))

    const initResponse = await fetch(
      `${this.baseUrl}/task/new/init${this.getAuthParam()}`,
      {
        method: 'POST',
        body: initFormData,
      }
    )

    if (!initResponse.ok) {
      const error = await initResponse.text()
      throw new Error(`Failed to initialize task: ${error}`)
    }

    const { uuid } = await initResponse.json()

    // Step 2: Upload images
    // Upload in batches to avoid memory issues with large uploads
    const BATCH_SIZE = 10
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE)
      const uploadFormData = new FormData()

      for (const image of batch) {
        if (image instanceof File) {
          uploadFormData.append('images', image, image.name)
        } else {
          // Blob - generate a name
          uploadFormData.append('images', image, `image_${i}.jpg`)
        }
      }

      const uploadResponse = await fetch(
        `${this.baseUrl}/task/new/upload/${uuid}${this.getAuthParam()}`,
        {
          method: 'POST',
          body: uploadFormData,
        }
      )

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text()
        throw new Error(`Failed to upload images: ${error}`)
      }
    }

    // Step 3: Commit task to start processing
    const commitResponse = await fetch(
      `${this.baseUrl}/task/new/commit/${uuid}${this.getAuthParam()}`,
      {
        method: 'POST',
      }
    )

    if (!commitResponse.ok) {
      const error = await commitResponse.text()
      throw new Error(`Failed to commit task: ${error}`)
    }

    return { uuid }
  }

  /**
   * Create task with a single request (for smaller uploads)
   */
  async createTaskSimple(params: CreateLightningTaskParams): Promise<{ uuid: string }> {
    const { name, images, options = PROCESSING_PRESETS.plantCounting } = params

    const formData = new FormData()
    formData.append('name', name)

    const optionsArray = Object.entries(options).map(([key, value]) => ({
      name: key,
      value: String(value),
    }))
    formData.append('options', JSON.stringify(optionsArray))

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      if (image instanceof File) {
        formData.append('images', image, image.name)
      } else {
        formData.append('images', image, `image_${i}.jpg`)
      }
    }

    const response = await fetch(
      `${this.baseUrl}/task/new${this.getAuthParam()}`,
      {
        method: 'POST',
        body: formData,
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create task: ${error}`)
    }

    return response.json()
  }

  /**
   * Get task status and progress
   */
  async getTaskStatus(uuid: string): Promise<LightningTaskResult> {
    const info = await this.request<LightningTaskInfo>(`/task/${uuid}/info`)

    return {
      uuid: info.uuid,
      status: info.status.code,
      progress: info.progress || 0,
      processingTime: info.processingTime || 0,
      imagesCount: info.imagesCount || 0,
      error: info.status.code === LightningStatusCode.FAILED
        ? 'Processing failed'
        : undefined,
    }
  }

  /**
   * Get task output/logs
   */
  async getTaskOutput(uuid: string, line?: number): Promise<string[]> {
    const endpoint = line !== undefined
      ? `/task/${uuid}/output?line=${line}`
      : `/task/${uuid}/output`
    return this.request<string[]>(endpoint)
  }

  /**
   * List all tasks on the node
   */
  async listTasks(): Promise<string[]> {
    return this.request<string[]>('/task/list')
  }

  /**
   * Cancel a running task
   */
  async cancelTask(uuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/task/cancel${this.getAuthParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid }),
    })
  }

  /**
   * Remove/delete a task
   */
  async removeTask(uuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/task/remove${this.getAuthParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid }),
    })
  }

  /**
   * Restart a failed task
   */
  async restartTask(uuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/task/restart${this.getAuthParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid }),
    })
  }

  // ============================================
  // ASSET RETRIEVAL
  // ============================================

  /**
   * Get URL for downloading an asset
   */
  getAssetUrl(uuid: string, asset: string): string {
    return `${this.baseUrl}/task/${uuid}/download/${asset}${this.getAuthParam()}`
  }

  /**
   * Get URL for orthophoto download
   */
  getOrthophotoUrl(uuid: string): string {
    return this.getAssetUrl(uuid, 'orthophoto.tif')
  }

  /**
   * Download an asset as a buffer
   */
  async downloadAsset(uuid: string, asset: string): Promise<ArrayBuffer> {
    const url = this.getAssetUrl(uuid, asset)
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to download asset: ${response.status}`)
    }

    return response.arrayBuffer()
  }

  /**
   * Download orthophoto as buffer.
   * Tries direct orthophoto.tif first; if Lightning returns 404
   * (known issue with COG-enabled tasks), falls back to downloading
   * all.zip and extracting the orthophoto from it.
   */
  async downloadOrthophoto(uuid: string): Promise<ArrayBuffer> {
    // Try direct download first
    const directUrl = this.getAssetUrl(uuid, 'orthophoto.tif')
    const directRes = await fetch(directUrl)

    if (directRes.ok) {
      return directRes.arrayBuffer()
    }

    console.log(`Direct orthophoto.tif returned ${directRes.status}, falling back to all.zip extraction...`)

    // Fallback: download all.zip and extract the orthophoto
    const zipBuffer = await this.downloadAsset(uuid, 'all.zip')
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(zipBuffer)

    // Look for the orthophoto in common paths
    const orthoPaths = [
      'odm_orthophoto/odm_orthophoto.tif',
      'odm_orthophoto/odm_orthophoto.cog.tif',
      'orthophoto.tif',
    ]

    for (const path of orthoPaths) {
      const entry = zip.file(path)
      if (entry) {
        console.log(`Found orthophoto at: ${path}`)
        return entry.async('arraybuffer')
      }
    }

    // Try to find any .tif file in the zip
    const tifFiles = Object.keys(zip.files).filter(f =>
      f.endsWith('.tif') && f.includes('ortho')
    )
    if (tifFiles.length > 0) {
      console.log(`Found orthophoto at: ${tifFiles[0]}`)
      return zip.file(tifFiles[0])!.async('arraybuffer')
    }

    throw new Error('Orthophoto not found in all.zip')
  }

  /**
   * Download all assets as zip
   */
  async downloadAllAssets(uuid: string): Promise<ArrayBuffer> {
    return this.downloadAsset(uuid, 'all.zip')
  }

  /**
   * Try to download corrected camera positions from the ODM output.
   * ODM's bundle adjustment produces more accurate camera positions than raw EXIF GPS.
   * Returns a map of filename → {latitude, longitude, altitude} or null if unavailable.
   */
  async downloadCameraPositions(uuid: string): Promise<Record<string, { latitude: number; longitude: number; altitude: number }> | null> {
    // Try individual file downloads — some NodeODM implementations support /download/all/{path}
    const filesToTry = [
      'opensfm/shots.geojson',
      'odm_report/shots.geojson',
    ]

    for (const filePath of filesToTry) {
      try {
        const url = `${this.baseUrl}/task/${uuid}/download/all/${filePath}${this.getAuthParam()}`
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (response.ok) {
          const geojson = await response.json()
          const positions = parseShotsGeoJSON(geojson)
          if (positions && Object.keys(positions).length > 0) {
            console.log(`[Lightning] Got ${Object.keys(positions).length} camera positions from ${filePath}`)
            return positions
          }
        }
      } catch {
        // Try next path
      }
    }

    // Try reconstruction.json (needs more parsing)
    try {
      const url = `${this.baseUrl}/task/${uuid}/download/all/opensfm/reconstruction.json${this.getAuthParam()}`
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (response.ok) {
        const reconstruction = await response.json()
        const positions = parseReconstructionJSON(reconstruction)
        if (positions && Object.keys(positions).length > 0) {
          console.log(`[Lightning] Got ${Object.keys(positions).length} camera positions from reconstruction.json`)
          return positions
        }
      }
    } catch {
      // Not available
    }

    console.log('[Lightning] Camera positions not available from this task')
    return null
  }
}

/**
 * Parse OpenSfM shots.geojson into a filename → position map
 */
function parseShotsGeoJSON(
  geojson: any
): Record<string, { latitude: number; longitude: number; altitude: number }> | null {
  if (!geojson?.features || !Array.isArray(geojson.features)) return null

  const positions: Record<string, { latitude: number; longitude: number; altitude: number }> = {}

  for (const feature of geojson.features) {
    const filename = feature.properties?.filename || feature.properties?.name
    const coords = feature.geometry?.coordinates // [lon, lat, alt]
    if (filename && coords && coords.length >= 2) {
      positions[filename] = {
        latitude: coords[1],
        longitude: coords[0],
        altitude: coords[2] || 0,
      }
    }
  }

  return Object.keys(positions).length > 0 ? positions : null
}

/**
 * Parse OpenSfM reconstruction.json to extract corrected camera positions.
 * Converts from local ENU frame to geographic coordinates using reference_lla.
 */
function parseReconstructionJSON(
  reconstruction: any
): Record<string, { latitude: number; longitude: number; altitude: number }> | null {
  const recon = Array.isArray(reconstruction) ? reconstruction[0] : reconstruction
  if (!recon?.shots || !recon?.reference_lla) return null

  const refLat = recon.reference_lla.latitude
  const refLon = recon.reference_lla.longitude
  const refAlt = recon.reference_lla.altitude || 0

  const positions: Record<string, { latitude: number; longitude: number; altitude: number }> = {}

  for (const [filename, shot] of Object.entries(recon.shots) as [string, any][]) {
    if (!shot.translation || !shot.rotation) continue

    // Convert Rodrigues rotation vector to rotation matrix
    const [rx, ry, rz] = shot.rotation
    const theta = Math.sqrt(rx * rx + ry * ry + rz * rz)

    let R: number[][]
    if (theta < 1e-10) {
      R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    } else {
      const k = [rx / theta, ry / theta, rz / theta]
      const c = Math.cos(theta)
      const s = Math.sin(theta)
      const v = 1 - c
      R = [
        [c + k[0] * k[0] * v,        k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s],
        [k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v,        k[1] * k[2] * v - k[0] * s],
        [k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v],
      ]
    }

    // Camera position in ENU = -R^T * t
    const t = shot.translation
    const posENU = [
      -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
      -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
      -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
    ]

    // ENU to geographic: East=x, North=y, Up=z
    const lat = refLat + posENU[1] / 111320
    const lon = refLon + posENU[0] / (111320 * Math.cos(refLat * Math.PI / 180))
    const alt = refAlt + posENU[2]

    positions[filename] = { latitude: lat, longitude: lon, altitude: alt }
  }

  return Object.keys(positions).length > 0 ? positions : null
}

// Export singleton instance
export const lightning = new LightningClient()

// Export utility functions
export function isLightningTaskComplete(status: LightningStatusCode): boolean {
  return status === LightningStatusCode.COMPLETED
}

export function isLightningTaskFailed(status: LightningStatusCode): boolean {
  return status === LightningStatusCode.FAILED || status === LightningStatusCode.CANCELED
}

export function isLightningTaskRunning(status: LightningStatusCode): boolean {
  return status === LightningStatusCode.RUNNING || status === LightningStatusCode.QUEUED
}

export function getLightningStatusLabel(status: LightningStatusCode): string {
  switch (status) {
    case LightningStatusCode.QUEUED:
      return 'Queued'
    case LightningStatusCode.RUNNING:
      return 'Processing'
    case LightningStatusCode.FAILED:
      return 'Failed'
    case LightningStatusCode.COMPLETED:
      return 'Completed'
    case LightningStatusCode.CANCELED:
      return 'Canceled'
    default:
      return 'Unknown'
  }
}
