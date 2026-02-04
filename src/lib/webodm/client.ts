// WebODM API Client for PLNT
// Handles all communication with WebODM server for orthomosaic processing

import {
  WebODMProject,
  WebODMTask,
  WebODMStatusCode,
  CreateTaskParams,
  CreateTaskResponse,
  TaskStatusResponse,
  OrthomosaicMetadata,
  WebODMBounds,
  WebODMProcessingOptions,
  PROCESSING_PRESETS,
} from './types'

export class WebODMClient {
  private baseUrl: string
  private token: string

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || process.env.WEBODM_URL || 'http://localhost:8000'
    this.token = token || process.env.WEBODM_TOKEN || ''

    // Remove trailing slash
    this.baseUrl = this.baseUrl.replace(/\/$/, '')
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: HeadersInit = {
      Authorization: `JWT ${this.token}`,
      ...options.headers,
    }

    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`WebODM API Error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // ============================================
  // PROJECT MANAGEMENT
  // ============================================

  async listProjects(): Promise<WebODMProject[]> {
    return this.request<WebODMProject[]>('/api/projects/')
  }

  async createProject(name: string, description?: string): Promise<WebODMProject> {
    return this.request<WebODMProject>('/api/projects/', {
      method: 'POST',
      body: JSON.stringify({ name, description: description || '' }),
    })
  }

  async getProject(projectId: number): Promise<WebODMProject> {
    return this.request<WebODMProject>(`/api/projects/${projectId}/`)
  }

  async deleteProject(projectId: number): Promise<void> {
    await this.request(`/api/projects/${projectId}/`, {
      method: 'DELETE',
    })
  }

  // ============================================
  // TASK MANAGEMENT
  // ============================================

  /**
   * Create a new processing task with images
   * @param params Task creation parameters
   * @returns Created task info
   */
  async createTask(params: CreateTaskParams): Promise<CreateTaskResponse> {
    const { projectId, name, images, options = PROCESSING_PRESETS.plantCounting } = params

    const formData = new FormData()
    formData.append('name', name)

    // Add processing options - WebODM expects all values as strings
    const optionsArray = Object.entries(options).map(([key, value]) => ({
      name: key,
      value: String(value),
    }))
    formData.append('options', JSON.stringify(optionsArray))

    // Add images
    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      if (typeof image === 'string') {
        // URL - WebODM will fetch it
        formData.append('images', image)
      } else {
        // File object
        formData.append('images', image, image.name)
      }
    }

    return this.request<CreateTaskResponse>(
      `/api/projects/${projectId}/tasks/`,
      {
        method: 'POST',
        body: formData,
      }
    )
  }

  /**
   * Get task status and progress
   */
  async getTaskStatus(projectId: number, taskId: string): Promise<TaskStatusResponse> {
    const task = await this.request<any>(
      `/api/projects/${projectId}/tasks/${taskId}/`
    )

    // Get more detailed info
    const info = await this.request<any>(
      `/api/projects/${projectId}/tasks/${taskId}/info/`
    ).catch(() => null)

    // Handle both status formats: integer or {code: integer}
    const statusCode = typeof task.status === 'number' ? task.status : task.status?.code

    return {
      id: task.id,
      status: statusCode,
      progress: info?.progress || 0,
      processingTime: info?.processingTime || 0,
      imagesCount: task.images_count,
      availableAssets: task.available_assets,
      error: statusCode === WebODMStatusCode.FAILED ? info?.error : undefined,
    }
  }

  /**
   * Get list of tasks for a project
   */
  async listTasks(projectId: number): Promise<WebODMTask[]> {
    return this.request<WebODMTask[]>(`/api/projects/${projectId}/tasks/`)
  }

  /**
   * Cancel a running task
   */
  async cancelTask(projectId: number, taskId: string): Promise<void> {
    await this.request(`/api/projects/${projectId}/tasks/${taskId}/cancel/`, {
      method: 'POST',
    })
  }

  /**
   * Remove/delete a task
   */
  async removeTask(projectId: number, taskId: string): Promise<void> {
    await this.request(`/api/projects/${projectId}/tasks/${taskId}/remove/`, {
      method: 'POST',
    })
  }

  /**
   * Restart a failed task
   */
  async restartTask(projectId: number, taskId: string): Promise<void> {
    await this.request(`/api/projects/${projectId}/tasks/${taskId}/restart/`, {
      method: 'POST',
    })
  }

  // ============================================
  // ASSET RETRIEVAL
  // ============================================

  /**
   * Get URL for downloading orthophoto
   */
  getOrthophotoUrl(projectId: number, taskId: string): string {
    return `${this.baseUrl}/api/projects/${projectId}/tasks/${taskId}/download/orthophoto.tif`
  }

  /**
   * Get URL for orthophoto tiles (for map display)
   */
  getTilesUrl(projectId: number, taskId: string): string {
    return `${this.baseUrl}/api/projects/${projectId}/tasks/${taskId}/orthophoto/tiles/{z}/{x}/{y}.png`
  }

  /**
   * Get bounds of the orthophoto (for map positioning)
   * Uses the task endpoint which contains extent as [west, south, east, north]
   */
  async getOrthophotoBounds(
    projectId: number,
    taskId: string
  ): Promise<WebODMBounds> {
    // Get task info which contains the extent
    const taskInfo = await this.request<any>(
      `/api/projects/${projectId}/tasks/${taskId}/`
    )

    // WebODM returns extent as [west, south, east, north]
    if (taskInfo.extent && taskInfo.extent.length === 4) {
      const [west, south, east, north] = taskInfo.extent
      return { north, south, east, west }
    }

    throw new Error('Could not retrieve orthophoto bounds - no extent in task info')
  }

  /**
   * Get orthomosaic metadata including bounds, resolution, dimensions
   * Uses the main task endpoint instead of non-existent /orthophoto/metadata/
   */
  async getOrthomosaicMetadata(
    projectId: number,
    taskId: string
  ): Promise<OrthomosaicMetadata> {
    // Get task info which contains extent and statistics
    const taskInfo = await this.request<any>(
      `/api/projects/${projectId}/tasks/${taskId}/`
    )

    // Extract bounds from extent [west, south, east, north]
    let bounds: WebODMBounds
    if (taskInfo.extent && taskInfo.extent.length === 4) {
      const [west, south, east, north] = taskInfo.extent
      bounds = { north, south, east, west }
    } else {
      throw new Error('Could not retrieve orthophoto bounds')
    }

    // GSD (ground sampling distance) is in statistics
    const gsd = taskInfo.statistics?.gsd || 1

    return {
      bounds,
      resolution: gsd, // cm per pixel
      width: 0, // Not available in task info
      height: 0, // Not available in task info
      crs: taskInfo.srs?.name || 'EPSG:4326',
    }
  }

  /**
   * Get download URL for any available asset
   */
  getAssetUrl(
    projectId: number,
    taskId: string,
    asset: 'orthophoto.tif' | 'dsm.tif' | 'dtm.tif' | 'georeferenced_model.laz' | 'textured_model.zip' | 'all.zip'
  ): string {
    return `${this.baseUrl}/api/projects/${projectId}/tasks/${taskId}/download/${asset}`
  }

  // ============================================
  // HEALTH CHECK
  // ============================================

  /**
   * Check if WebODM is available and responding
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/api/projects/', { method: 'GET' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get processing node status
   */
  async getNodeStatus(): Promise<{
    available: boolean
    version?: string
    maxImages?: number
    queueCount?: number
  }> {
    try {
      // Check NodeODM directly
      const nodeUrl = this.baseUrl.replace(':8000', ':3001')
      const response = await fetch(`${nodeUrl}/info`)
      if (!response.ok) {
        return { available: false }
      }
      const info = await response.json()
      return {
        available: true,
        version: info.version,
        maxImages: info.maxImages,
        queueCount: info.taskQueueCount,
      }
    } catch {
      return { available: false }
    }
  }
}

// Export singleton instance for use in API routes
export const webodm = new WebODMClient()

// Export utility functions
export function isTaskComplete(status: WebODMStatusCode): boolean {
  return status === WebODMStatusCode.COMPLETED
}

export function isTaskFailed(status: WebODMStatusCode): boolean {
  return status === WebODMStatusCode.FAILED || status === WebODMStatusCode.CANCELED
}

export function isTaskRunning(status: WebODMStatusCode): boolean {
  return status === WebODMStatusCode.RUNNING || status === WebODMStatusCode.QUEUED
}

export function getStatusLabel(status: WebODMStatusCode): string {
  switch (status) {
    case WebODMStatusCode.QUEUED:
      return 'Queued'
    case WebODMStatusCode.RUNNING:
      return 'Processing'
    case WebODMStatusCode.FAILED:
      return 'Failed'
    case WebODMStatusCode.COMPLETED:
      return 'Completed'
    case WebODMStatusCode.CANCELED:
      return 'Canceled'
    default:
      return 'Unknown'
  }
}
