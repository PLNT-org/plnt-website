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
   * Download orthophoto as buffer
   */
  async downloadOrthophoto(uuid: string): Promise<ArrayBuffer> {
    return this.downloadAsset(uuid, 'orthophoto.tif')
  }

  /**
   * Download all assets as zip
   */
  async downloadAllAssets(uuid: string): Promise<ArrayBuffer> {
    return this.downloadAsset(uuid, 'all.zip')
  }
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
