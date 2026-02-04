'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Camera, X, AlertCircle } from 'lucide-react'

interface ArucoScannerProps {
  onDetect: (markerId: number) => void
  dictionary?: string
  onError?: (error: string) => void
  onClose?: () => void
}

export function ArucoScanner({ onDetect, onError, onClose }: ArucoScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detectedId, setDetectedId] = useState<number | null>(null)
  const [AR, setAR] = useState<any>(null)

  // Load js-aruco dynamically
  useEffect(() => {
    const loadAruco = async () => {
      try {
        const aruco = await import('js-aruco')
        setAR(aruco)
      } catch (err) {
        console.error('Failed to load js-aruco:', err)
        setError('Failed to load ArUco library')
        onError?.('Failed to load ArUco library')
      }
    }
    loadAruco()
  }, [onError])

  const startCamera = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const constraints = {
        video: {
          facingMode: 'environment', // Prefer back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsLoading(false)
      }
    } catch (err) {
      console.error('Camera error:', err)
      const message = err instanceof Error ? err.message : 'Failed to access camera'
      setError(message)
      onError?.(message)
      setIsLoading(false)
    }
  }, [onError])

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  // Detect ArUco markers in video frame
  const detectMarkers = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !AR) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Wait for video to have valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      animationRef.current = requestAnimationFrame(detectMarkers)
      return
    }

    // Set canvas size to match video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw current frame
    ctx.drawImage(video, 0, 0)

    // Get image data for detection
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    try {
      // Create detector - js-aruco uses DICT_7X7_1000 by default
      const detector = new AR.AR.Detector()
      const markers = detector.detect(imageData)

      // Draw detected markers
      if (markers.length > 0) {
        markers.forEach((marker: any) => {
          // Draw marker outline
          ctx.strokeStyle = '#00ff00'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(marker.corners[0].x, marker.corners[0].y)
          for (let i = 1; i < marker.corners.length; i++) {
            ctx.lineTo(marker.corners[i].x, marker.corners[i].y)
          }
          ctx.closePath()
          ctx.stroke()

          // Draw marker ID
          const centerX = marker.corners.reduce((sum: number, c: any) => sum + c.x, 0) / 4
          const centerY = marker.corners.reduce((sum: number, c: any) => sum + c.y, 0) / 4
          ctx.fillStyle = '#00ff00'
          ctx.font = 'bold 24px Arial'
          ctx.textAlign = 'center'
          ctx.fillText(`ID: ${marker.id}`, centerX, centerY)
        })

        // Report first detected marker
        const firstMarker = markers[0]
        if (detectedId !== firstMarker.id) {
          setDetectedId(firstMarker.id)
          // Vibrate on detection (if supported)
          if ('vibrate' in navigator) {
            navigator.vibrate(100)
          }
          onDetect(firstMarker.id)
        }
      }
    } catch (err) {
      console.error('Detection error:', err)
    }

    // Continue detection loop
    animationRef.current = requestAnimationFrame(detectMarkers)
  }, [AR, detectedId, onDetect])

  // Start camera and detection on mount
  useEffect(() => {
    if (AR) {
      startCamera()
    }
    return () => {
      stopCamera()
    }
  }, [AR, startCamera, stopCamera])

  // Start detection loop when video is playing
  useEffect(() => {
    if (!isLoading && AR && videoRef.current) {
      animationRef.current = requestAnimationFrame(detectMarkers)
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isLoading, AR, detectMarkers])

  const handleClose = () => {
    stopCamera()
    onClose?.()
  }

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-0">
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center h-64 bg-gray-900">
            <Camera className="h-8 w-8 text-gray-400 animate-pulse" />
            <p className="text-gray-400 mt-2">Starting camera...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-64 bg-gray-900 p-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-red-400 mt-2 text-center">{error}</p>
            <Button onClick={startCamera} className="mt-4" variant="outline">
              Retry
            </Button>
          </div>
        )}

        <div className={`relative ${isLoading || error ? 'hidden' : ''}`}>
          <video
            ref={videoRef}
            className="w-full h-auto"
            playsInline
            muted
            autoPlay
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full"
          />
          {detectedId !== null && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-full font-bold">
              Marker ID: {detectedId}
            </div>
          )}
        </div>

        <div className="p-3 bg-gray-100 text-center text-sm text-gray-600">
          Point camera at an ArUco marker
        </div>
      </CardContent>
    </Card>
  )
}
