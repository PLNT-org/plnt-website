import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: List folders in the flight-images bucket that contain images
export async function GET(request: NextRequest) {
  try {
    // List top-level folders in flight-images bucket
    const { data: topFolders, error: listError } = await supabase
      .storage
      .from('flight-images')
      .list('', { limit: 100 })

    if (listError) {
      console.error('[flight-detection/flights] Storage list error:', listError)
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }

    if (!topFolders || topFolders.length === 0) {
      return NextResponse.json({ flights: [] })
    }

    // For each top-level folder, find subfolders with images
    const flights: Array<{ id: string; name: string; imageCount: number; storagePath: string }> = []

    for (const folder of topFolders) {
      if (!folder.id && folder.name) {
        // It's a folder (no id means it's a prefix, not a file)
        const imageFiles = await listImagesRecursive(folder.name)
        if (imageFiles.length > 0) {
          flights.push({
            id: folder.name,
            name: `${folder.name.substring(0, 8)}... (${imageFiles.length} images)`,
            imageCount: imageFiles.length,
            storagePath: folder.name,
          })
        }
      }
    }

    return NextResponse.json({ flights })
  } catch (error) {
    console.error('[flight-detection/flights] Error:', error)
    return NextResponse.json({ error: 'Failed to list image folders' }, { status: 500 })
  }
}

// Recursively list image files in a storage folder
async function listImagesRecursive(prefix: string): Promise<string[]> {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.dng']
  const allImages: string[] = []

  const { data: items, error } = await supabase
    .storage
    .from('flight-images')
    .list(prefix, { limit: 1000 })

  if (error || !items) return allImages

  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`
    if (item.id) {
      // It's a file — check if it's an image
      const ext = item.name.toLowerCase().substring(item.name.lastIndexOf('.'))
      if (imageExtensions.includes(ext)) {
        allImages.push(fullPath)
      }
    } else {
      // It's a subfolder — recurse
      const subImages = await listImagesRecursive(fullPath)
      allImages.push(...subImages)
    }
  }

  return allImages
}
