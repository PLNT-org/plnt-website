// ArUco Detection API Client
// Handles communication with the ArUco detection Python service

import {
  ArUcoDetectionRequest,
  ArUcoDetectionResponse,
  ArUcoHealthResponse,
  ArUcoDictionary,
  DEFAULT_ARUCO_DICTIONARY,
} from './types'

export class ArUcoClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'
    // Remove trailing slash
    this.baseUrl = this.baseUrl.replace(/\/$/, '')
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ArUco API Error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  /**
   * Check if the ArUco service is healthy
   */
  async healthCheck(): Promise<ArUcoHealthResponse> {
    return this.request<ArUcoHealthResponse>('/health')
  }

  /**
   * Check if the service is available (returns boolean)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.healthCheck()
      return health.status === 'ok'
    } catch {
      return false
    }
  }

  /**
   * Detect ArUco markers in a GeoTIFF orthomosaic
   *
   * @param geotiffUrl URL of the GeoTIFF to process
   * @param dictionary ArUco dictionary to use (default: DICT_7X7_1000)
   * @returns Detection results with marker positions
   */
  async detect(
    geotiffUrl: string,
    dictionary: ArUcoDictionary = DEFAULT_ARUCO_DICTIONARY
  ): Promise<ArUcoDetectionResponse> {
    const request: ArUcoDetectionRequest = {
      geotiff_url: geotiffUrl,
      dictionary,
    }

    return this.request<ArUcoDetectionResponse>('/detect', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }
}

// Export singleton instance for convenience
export const arucoClient = new ArUcoClient()

// Re-export types
export * from './types'
