'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Upload,
  MapPin,
  Crosshair,
  Info,
  Copy,
  Check,
  Plane,
  Camera,
  Ruler,
  Clock
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'

interface DroneMetadata {
  dronePosition: {
    latitude: number
    longitude: number
    altitude: number
    absoluteAltitude?: number
  }
  camera: {
    focalLength: number
    focalLength35mm?: number
    sensorWidth: number
    sensorHeight: number
  }
  image: {
    width: number
    height: number
    gsdX: number
    gsdY: number
    gsdCm: number
  }
  footprint: {
    width: number
    height: number
    corners: {
      topLeft: { latitude: number; longitude: number }
      topRight: { latitude: number; longitude: number }
      bottomLeft: { latitude: number; longitude: number }
      bottomRight: { latitude: number; longitude: number }
    }
  }
  gimbal: {
    pitch?: number
    yaw?: number
    roll?: number
    isNadir: boolean
  }
  droneModel?: string
  timestamp?: string
}

interface ClickedPoint {
  latitude: number
  longitude: number
  distanceFromCenter: number
}

interface PixelPosition {
  x: number
  y: number
  displayX: number
  displayY: number
}

export default function CoordinateExtractorPage() {
  const { isDemo } = useAuth()

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<DroneMetadata | null>(null)
  const [clickedPoint, setClickedPoint] = useState<ClickedPoint | null>(null)
  const [pixelPosition, setPixelPosition] = useState<PixelPosition | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [clickHistory, setClickHistory] = useState<Array<{ pixel: PixelPosition; coord: ClickedPoint }>>([])

  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setError('')
    setClickedPoint(null)
    setPixelPosition(null)
    setClickHistory([])
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('image', file)

      const response = await fetch('/api/drone-coordinates', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract metadata')
      }

      setMetadata(data.metadata)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image')
      setMetadata(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.dng'],
    },
    maxFiles: 1,
  })

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!metadata || !imageRef.current) return

    const rect = imageRef.current.getBoundingClientRect()
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top

    // Scale to actual image dimensions
    const scaleX = metadata.image.width / rect.width
    const scaleY = metadata.image.height / rect.height
    const actualX = displayX * scaleX
    const actualY = displayY * scaleY

    const pixel: PixelPosition = {
      x: Math.round(actualX),
      y: Math.round(actualY),
      displayX,
      displayY,
    }
    setPixelPosition(pixel)

    try {
      const formData = new FormData()
      formData.append('image', imageFile!)
      formData.append('pixelX', String(actualX))
      formData.append('pixelY', String(actualY))

      const response = await fetch('/api/drone-coordinates', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (data.clickedPoint) {
        setClickedPoint(data.clickedPoint)
        setClickHistory(prev => [...prev, { pixel, coord: data.clickedPoint }])
      }
    } catch (err) {
      console.error('Failed to calculate coordinates:', err)
    }
  }

  const copyCoordinates = () => {
    if (!clickedPoint) return
    const text = `${clickedPoint.latitude.toFixed(8)}, ${clickedPoint.longitude.toFixed(8)}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyAllPoints = () => {
    if (clickHistory.length === 0) return
    const lines = clickHistory.map((h, i) =>
      `Point ${i + 1}: ${h.coord.latitude.toFixed(8)}, ${h.coord.longitude.toFixed(8)}`
    ).join('\n')
    navigator.clipboard.writeText(lines)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatCoord = (val: number, digits = 6) => val.toFixed(digits)

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Coordinate Extractor</h1>
          <p className="text-gray-600 mt-1">
            Extract GPS coordinates from any point in a drone image
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Image Panel */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Drone Image
              </CardTitle>
              <CardDescription>
                {imagePreview
                  ? 'Click anywhere on the image to get ground coordinates'
                  : 'Upload a drone image with GPS metadata'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!imagePreview ? (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                    ${isDragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'}`}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600 mb-2">
                    {isDragActive ? 'Drop the image here' : 'Drag & drop a drone image here'}
                  </p>
                  <p className="text-sm text-gray-500">or click to select a file</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Supports JPG, PNG, TIFF, DNG with EXIF GPS data
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    ref={containerRef}
                    className="relative border rounded-lg overflow-hidden bg-gray-100"
                  >
                    {loading && (
                      <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                        <div className="text-center">
                          <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-2" />
                          <p className="text-gray-600">Extracting metadata...</p>
                        </div>
                      </div>
                    )}
                    <img
                      ref={imageRef}
                      src={imagePreview}
                      alt="Drone capture"
                      className={`w-full h-auto ${metadata ? 'cursor-crosshair' : ''}`}
                      onClick={handleImageClick}
                    />
                    {/* Click markers */}
                    {clickHistory.map((h, i) => (
                      <div
                        key={i}
                        className="absolute w-6 h-6 -ml-3 -mt-3 pointer-events-none"
                        style={{ left: h.pixel.displayX, top: h.pixel.displayY }}
                      >
                        <div className="w-full h-full rounded-full border-2 border-red-500 bg-red-500/20 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-red-700">{i + 1}</span>
                        </div>
                      </div>
                    ))}
                    {/* Current crosshair */}
                    {pixelPosition && (
                      <Crosshair
                        className="absolute w-8 h-8 -ml-4 -mt-4 text-green-500 pointer-events-none drop-shadow-lg"
                        style={{ left: pixelPosition.displayX, top: pixelPosition.displayY }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImageFile(null)
                        setImagePreview(null)
                        setMetadata(null)
                        setClickedPoint(null)
                        setPixelPosition(null)
                        setClickHistory([])
                      }}
                    >
                      Upload Different Image
                    </Button>
                    {clickHistory.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setClickHistory([])
                          setClickedPoint(null)
                          setPixelPosition(null)
                        }}
                      >
                        Clear Points
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Info Panel */}
        <div className="space-y-6">
          {/* Clicked Coordinate */}
          {clickedPoint && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-green-800">
                  <MapPin className="w-5 h-5" />
                  Selected Point
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-white rounded-lg p-3 font-mono text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Latitude:</span>
                    <span className="font-semibold">{formatCoord(clickedPoint.latitude, 8)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-gray-600">Longitude:</span>
                    <span className="font-semibold">{formatCoord(clickedPoint.longitude, 8)}</span>
                  </div>
                </div>
                {pixelPosition && (
                  <div className="text-xs text-gray-500">
                    Pixel: ({pixelPosition.x}, {pixelPosition.y}) |
                    {' '}{clickedPoint.distanceFromCenter.toFixed(1)}m from center
                  </div>
                )}
                <Button
                  onClick={copyCoordinates}
                  className="w-full"
                  variant={copied ? "outline" : "default"}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Coordinates
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Click History */}
          {clickHistory.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex justify-between items-center">
                  <span>All Points ({clickHistory.length})</span>
                  <Button size="sm" variant="outline" onClick={copyAllPoints}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-32 overflow-y-auto space-y-1 text-xs font-mono">
                  {clickHistory.map((h, i) => (
                    <div key={i} className="flex justify-between text-gray-600">
                      <span className="text-red-600">#{i + 1}</span>
                      <span>{formatCoord(h.coord.latitude, 6)}, {formatCoord(h.coord.longitude, 6)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Image Metadata */}
          {metadata && (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Plane className="w-4 h-4" />
                    Drone Position
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Latitude:</span>
                    <span className="font-mono">{formatCoord(metadata.dronePosition.latitude)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Longitude:</span>
                    <span className="font-mono">{formatCoord(metadata.dronePosition.longitude)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Altitude:</span>
                    <span className="font-mono">{metadata.dronePosition.altitude.toFixed(1)}m</span>
                  </div>
                  {metadata.droneModel && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Drone:</span>
                      <span className="text-xs">{metadata.droneModel}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Ruler className="w-4 h-4" />
                    Image Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Resolution:</span>
                    <span className="font-mono">{metadata.image.width} x {metadata.image.height}</span>
                  </div>
                  {metadata.image.gsdCm != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">GSD:</span>
                      <span className="font-mono">{metadata.image.gsdCm.toFixed(2)} cm/px</span>
                    </div>
                  )}
                  {metadata.footprint.width != null && metadata.footprint.height != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Footprint:</span>
                      <span className="font-mono">
                        {metadata.footprint.width.toFixed(1)}m x {metadata.footprint.height.toFixed(1)}m
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Focal Length:</span>
                    <span className="font-mono">{metadata.camera.focalLength}mm</span>
                  </div>
                  {!metadata.gimbal.isNadir && metadata.gimbal.pitch !== undefined && (
                    <Alert className="mt-2">
                      <Info className="w-4 h-4" />
                      <AlertDescription className="text-xs">
                        Gimbal pitch: {metadata.gimbal.pitch.toFixed(1)}°.
                        Coordinates may be less accurate for non-nadir shots.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {metadata.timestamp && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="w-4 h-4" />
                      Capture Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-sm text-gray-600">
                      {new Date(metadata.timestamp).toLocaleString()}
                    </span>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Instructions */}
          {!metadata && !loading && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Info className="w-4 h-4" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600 space-y-2">
                <p>1. Upload a nadir (straight-down) drone image</p>
                <p>2. GPS and camera data is extracted from EXIF metadata</p>
                <p>3. Click anywhere on the image to get ground coordinates</p>
                <p className="text-xs text-gray-400 mt-4">
                  Works best with DJI drones. Ensure location services were enabled during capture.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
