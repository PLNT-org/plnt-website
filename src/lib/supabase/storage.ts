// Supabase Storage helpers for orthomosaic tiles and assets
import { createClient } from '@supabase/supabase-js'

// Bucket names
export const BUCKETS = {
  ORTHOMOSAICS: 'orthomosaics',
  TILES: 'orthomosaic-tiles',
  FLIGHT_IMAGES: 'flight-images',
} as const

/**
 * Storage helper for orthomosaic assets
 * Uses service role key for server-side operations
 */
export class OrthomosaicStorage {
  private supabase

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    this.supabase = createClient(url, serviceKey)
  }

  /**
   * Upload an orthophoto file to storage
   * @param orthomosaicId - The database ID of the orthomosaic
   * @param file - The orthophoto file (GeoTIFF or image)
   * @param filename - Original filename
   */
  async uploadOrthophoto(
    orthomosaicId: string,
    file: ArrayBuffer | Blob,
    filename: string = 'orthophoto.tif'
  ): Promise<{ url: string; path: string }> {
    const path = `${orthomosaicId}/${filename}`

    const { data, error } = await this.supabase.storage
      .from(BUCKETS.ORTHOMOSAICS)
      .upload(path, file, {
        contentType: this.getContentType(filename),
        upsert: true,
      })

    if (error) {
      throw new Error(`Failed to upload orthophoto: ${error.message}`)
    }

    // Get public URL
    const { data: urlData } = this.supabase.storage
      .from(BUCKETS.ORTHOMOSAICS)
      .getPublicUrl(path)

    return {
      url: urlData.publicUrl,
      path: data.path,
    }
  }

  /**
   * Upload a tile to storage
   * @param orthomosaicId - The database ID of the orthomosaic
   * @param z - Zoom level
   * @param x - Tile X coordinate
   * @param y - Tile Y coordinate
   * @param tile - The tile image data
   */
  async uploadTile(
    orthomosaicId: string,
    z: number,
    x: number,
    y: number,
    tile: ArrayBuffer | Blob
  ): Promise<string> {
    const path = `${orthomosaicId}/${z}/${x}/${y}.png`

    const { error } = await this.supabase.storage
      .from(BUCKETS.TILES)
      .upload(path, tile, {
        contentType: 'image/png',
        upsert: true,
      })

    if (error) {
      throw new Error(`Failed to upload tile: ${error.message}`)
    }

    const { data: urlData } = this.supabase.storage
      .from(BUCKETS.TILES)
      .getPublicUrl(path)

    return urlData.publicUrl
  }

  /**
   * Upload multiple tiles in batch
   */
  async uploadTiles(
    orthomosaicId: string,
    tiles: Array<{ z: number; x: number; y: number; data: ArrayBuffer | Blob }>
  ): Promise<void> {
    // Upload in parallel batches
    const BATCH_SIZE = 20
    for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
      const batch = tiles.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map((tile) =>
          this.uploadTile(orthomosaicId, tile.z, tile.x, tile.y, tile.data)
        )
      )
    }
  }

  /**
   * Get the tiles URL template for Leaflet
   * Returns a URL template like: https://xxx.supabase.co/storage/v1/object/public/orthomosaic-tiles/{orthomosaicId}/{z}/{x}/{y}.png
   */
  getTilesUrlTemplate(orthomosaicId: string): string {
    const { data } = this.supabase.storage
      .from(BUCKETS.TILES)
      .getPublicUrl(`${orthomosaicId}/{z}/{x}/{y}.png`)

    // The URL will have the literal {z}/{x}/{y} which Leaflet will replace
    return data.publicUrl
  }

  /**
   * Get public URL for an orthophoto
   */
  getOrthophotoUrl(orthomosaicId: string, filename: string = 'orthophoto.tif'): string {
    const { data } = this.supabase.storage
      .from(BUCKETS.ORTHOMOSAICS)
      .getPublicUrl(`${orthomosaicId}/${filename}`)

    return data.publicUrl
  }

  /**
   * Delete all assets for an orthomosaic
   */
  async deleteOrthomosaicAssets(orthomosaicId: string): Promise<void> {
    // Delete from orthomosaics bucket
    const { data: orthoFiles } = await this.supabase.storage
      .from(BUCKETS.ORTHOMOSAICS)
      .list(orthomosaicId)

    if (orthoFiles && orthoFiles.length > 0) {
      await this.supabase.storage
        .from(BUCKETS.ORTHOMOSAICS)
        .remove(orthoFiles.map((f) => `${orthomosaicId}/${f.name}`))
    }

    // Delete tiles - this is more complex as tiles are in subdirectories
    // For now, we'll rely on the bucket having a lifecycle policy or manual cleanup
  }

  /**
   * Check if tiles exist for an orthomosaic
   */
  async hasTiles(orthomosaicId: string): Promise<boolean> {
    const { data, error } = await this.supabase.storage
      .from(BUCKETS.TILES)
      .list(orthomosaicId)

    if (error) return false
    return data && data.length > 0
  }

  private getContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop()
    switch (ext) {
      case 'tif':
      case 'tiff':
        return 'image/tiff'
      case 'png':
        return 'image/png'
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      default:
        return 'application/octet-stream'
    }
  }
}

// Export singleton for server-side use
let storageInstance: OrthomosaicStorage | null = null

export function getOrthomosaicStorage(): OrthomosaicStorage {
  if (!storageInstance) {
    storageInstance = new OrthomosaicStorage()
  }
  return storageInstance
}

/**
 * Generate a signed URL for temporary access to private assets
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)

  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`)
  }

  return data.signedUrl
}
