// GPS-space Non-Maximum Suppression for cross-image plant deduplication
// Uses haversine distance instead of IoU since detections come from different images
// with independent pixel coordinate systems.

export interface GPSDetection {
  id: string
  latitude: number
  longitude: number
  confidence: number
}

/**
 * Calculate the great-circle distance between two GPS points using the Haversine formula.
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Apply distance-based NMS in GPS space.
 * If two detections are within `distanceThresholdMeters`, keep the higher-confidence one.
 *
 * @param detections - Array of GPS detections with confidence scores
 * @param distanceThresholdMeters - Merge radius in meters (default 0.15m)
 * @returns IDs of detections that were suppressed (should be deleted)
 */
export function applyGPSNMS(
  detections: GPSDetection[],
  distanceThresholdMeters: number = 0.15
): string[] {
  if (detections.length === 0) return []

  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const suppressedIds: string[] = []
  const kept = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (suppressedIds.includes(sorted[i].id)) continue
    kept.add(i)

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressedIds.includes(sorted[j].id)) continue

      const dist = haversineDistance(
        sorted[i].latitude,
        sorted[i].longitude,
        sorted[j].latitude,
        sorted[j].longitude
      )

      if (dist <= distanceThresholdMeters) {
        suppressedIds.push(sorted[j].id)
      }
    }
  }

  return suppressedIds
}
