// OpenSfM Camera Model Projection
// Projects pixel coordinates to GPS using the full camera model from ODM's reconstruction.json
// Provides pixel-accurate plant label placement by using intrinsics (focal, distortion)
// and per-shot extrinsics (full 3D rotation + translation) instead of simplified EXIF math.

// ============================================
// Types
// ============================================

export interface OpenSfMCamera {
  projection_type: string
  focal: number   // normalized focal length (max dim = 1.0)
  k1: number      // Brown radial distortion coefficient
  k2: number      // Brown radial distortion coefficient
}

export interface OpenSfMShot {
  rotation: [number, number, number]      // Rodrigues rotation vector
  translation: [number, number, number]   // translation in camera frame
  camera: string                          // camera ID reference
}

export interface ReferenceLLA {
  latitude: number
  longitude: number
  altitude: number
}

export interface CompactReconstruction {
  reference_lla: ReferenceLLA
  cameras: Record<string, OpenSfMCamera>
  shots: Record<string, OpenSfMShot>
}

// ============================================
// Math Functions
// ============================================

/**
 * Convert a Rodrigues rotation vector to a 3x3 rotation matrix.
 * The rotation vector's direction is the axis, its magnitude is the angle (radians).
 */
export function rodriguesRotation(v: [number, number, number]): number[][] {
  const [rx, ry, rz] = v
  const theta = Math.sqrt(rx * rx + ry * ry + rz * rz)

  if (theta < 1e-10) {
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  }

  const k = [rx / theta, ry / theta, rz / theta]
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const v1 = 1 - c

  return [
    [c + k[0] * k[0] * v1,        k[0] * k[1] * v1 - k[2] * s, k[0] * k[2] * v1 + k[1] * s],
    [k[1] * k[0] * v1 + k[2] * s, c + k[1] * k[1] * v1,        k[1] * k[2] * v1 - k[0] * s],
    [k[2] * k[0] * v1 - k[1] * s, k[2] * k[1] * v1 + k[0] * s, c + k[2] * k[2] * v1],
  ]
}

/**
 * Remove Brown radial distortion from a normalized point.
 * Uses iterative fixed-point inversion: given distorted (xd, yd),
 * find undistorted (xu, yu) such that xu*(1 + k1*r^2 + k2*r^4) = xd.
 */
export function undistortPoint(
  xd: number,
  yd: number,
  k1: number,
  k2: number
): { x: number; y: number } {
  let xu = xd
  let yu = yd

  for (let i = 0; i < 10; i++) {
    const r2 = xu * xu + yu * yu
    const distortion = 1 + k1 * r2 + k2 * r2 * r2
    xu = xd / distortion
    yu = yd / distortion
  }

  return { x: xu, y: yu }
}

/**
 * Project a pixel coordinate from a raw drone image to GPS using the full OpenSfM camera model.
 *
 * Steps:
 * 1. Normalize pixel to OpenSfM image coordinates (center origin, max dim = 1.0)
 * 2. Remove lens distortion (iterative Brown model inversion)
 * 3. Create 3D ray in camera frame using focal length
 * 4. Rotate ray to world frame using full rotation matrix (from Rodrigues vector)
 * 5. Intersect ray with ground plane (z=0 in local ENU frame)
 * 6. Convert ENU ground point to GPS using reference_lla
 */
export function projectPixelToGPS(
  px: number,
  py: number,
  imgW: number,
  imgH: number,
  shot: OpenSfMShot,
  camera: OpenSfMCamera,
  refLLA: ReferenceLLA
): { latitude: number; longitude: number } {
  // Step 1: Normalize to OpenSfM coordinates
  // OpenSfM uses center origin, max dimension = 1.0
  const maxDim = Math.max(imgW, imgH)
  const xd = (px - imgW / 2) / maxDim
  const yd = (py - imgH / 2) / maxDim

  // Step 2: Remove lens distortion
  const { x: xu, y: yu } = undistortPoint(xd, yd, camera.k1, camera.k2)

  // Step 3: Create 3D ray in camera frame
  // Camera looks along +z, x=right, y=down
  const ray_cam = [xu, yu, camera.focal]

  // Step 4: Rotate ray from camera frame to world frame
  // R maps world→camera, so R^T maps camera→world
  const R = rodriguesRotation(shot.rotation)

  // R^T * ray_cam
  const ray_world = [
    R[0][0] * ray_cam[0] + R[1][0] * ray_cam[1] + R[2][0] * ray_cam[2],
    R[0][1] * ray_cam[0] + R[1][1] * ray_cam[1] + R[2][1] * ray_cam[2],
    R[0][2] * ray_cam[0] + R[1][2] * ray_cam[1] + R[2][2] * ray_cam[2],
  ]

  // Camera position in world (ENU) = -R^T * t
  const t = shot.translation
  const cam_pos = [
    -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
    -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
    -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
  ]

  // Step 5: Intersect ray with ground plane (z=0)
  // Point on ray: P = cam_pos + t * ray_world
  // Ground: P.z = 0 → t = -cam_pos.z / ray_world.z
  if (Math.abs(ray_world[2]) < 1e-10) {
    // Ray is parallel to ground — fall back to camera position
    return enuToGPS(cam_pos[0], cam_pos[1], refLLA)
  }

  const param = -cam_pos[2] / ray_world[2]

  // If param is negative, the ray points away from the ground — use camera position
  if (param < 0) {
    return enuToGPS(cam_pos[0], cam_pos[1], refLLA)
  }

  const groundE = cam_pos[0] + param * ray_world[0]
  const groundN = cam_pos[1] + param * ray_world[1]

  // Step 6: Convert ENU to GPS
  return enuToGPS(groundE, groundN, refLLA)
}

/**
 * Convert local ENU (East, North, Up) coordinates to GPS latitude/longitude.
 * Uses flat-earth approximation — accurate for small areas (< few km).
 */
function enuToGPS(
  east: number,
  north: number,
  refLLA: ReferenceLLA
): { latitude: number; longitude: number } {
  const lat = refLLA.latitude + north / 111320
  const lon = refLLA.longitude + east / (111320 * Math.cos(refLLA.latitude * Math.PI / 180))
  return { latitude: lat, longitude: lon }
}

/**
 * Extract a compact reconstruction from the raw reconstruction.json.
 * Strips the full reconstruction down to just the fields needed for projection:
 * reference_lla, cameras (focal, k1, k2), shots (rotation, translation, camera ref).
 *
 * Returns null if the data is missing or malformed.
 * Output is typically ~20-30KB for ~100 images (safe to store in JSONB).
 */
export function extractCompactReconstruction(
  rawJson: any
): CompactReconstruction | null {
  const recon = Array.isArray(rawJson) ? rawJson[0] : rawJson
  if (!recon?.shots || !recon?.cameras || !recon?.reference_lla) return null

  const refLLA: ReferenceLLA = {
    latitude: recon.reference_lla.latitude,
    longitude: recon.reference_lla.longitude,
    altitude: recon.reference_lla.altitude || 0,
  }

  const cameras: Record<string, OpenSfMCamera> = {}
  for (const [camId, camData] of Object.entries(recon.cameras) as [string, any][]) {
    cameras[camId] = {
      projection_type: camData.projection_type || 'brown',
      focal: camData.focal,
      k1: camData.k1 || 0,
      k2: camData.k2 || 0,
    }
  }

  if (Object.keys(cameras).length === 0) return null

  const shots: Record<string, OpenSfMShot> = {}
  for (const [filename, shotData] of Object.entries(recon.shots) as [string, any][]) {
    if (!shotData.rotation || !shotData.translation || !shotData.camera) continue
    shots[filename] = {
      rotation: shotData.rotation as [number, number, number],
      translation: shotData.translation as [number, number, number],
      camera: shotData.camera,
    }
  }

  if (Object.keys(shots).length === 0) return null

  return { reference_lla: refLLA, cameras, shots }
}
