'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MapPin, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

interface GpsPosition {
  lat: number
  lng: number
  accuracy: number
}

interface GpsCaptureProps {
  onCapture: (position: GpsPosition) => void
  autoCapture?: boolean
  minAccuracy?: number // Meters - warn if accuracy is worse than this
}

export function GpsCapture({ onCapture, autoCapture = true, minAccuracy = 10 }: GpsCaptureProps) {
  const [position, setPosition] = useState<GpsPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [watchId, setWatchId] = useState<number | null>(null)

  const handlePositionUpdate = useCallback(
    (pos: GeolocationPosition) => {
      const newPosition: GpsPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
      setPosition(newPosition)
      setIsLoading(false)
      setError(null)

      // Auto-capture when we get a good fix
      if (autoCapture && newPosition.accuracy <= minAccuracy) {
        onCapture(newPosition)
      }
    },
    [autoCapture, minAccuracy, onCapture]
  )

  const handleError = useCallback((err: GeolocationPositionError) => {
    setIsLoading(false)
    let message: string
    switch (err.code) {
      case err.PERMISSION_DENIED:
        message = 'Location permission denied. Please enable location access.'
        break
      case err.POSITION_UNAVAILABLE:
        message = 'Location unavailable. Please try again.'
        break
      case err.TIMEOUT:
        message = 'Location request timed out. Please try again.'
        break
      default:
        message = 'Failed to get location.'
    }
    setError(message)
  }, [])

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    const id = navigator.geolocation.watchPosition(handlePositionUpdate, handleError, {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 0,
    })
    setWatchId(id)
  }, [handlePositionUpdate, handleError])

  const stopWatching = useCallback(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      setWatchId(null)
    }
  }, [watchId])

  const refreshPosition = useCallback(() => {
    stopWatching()
    startWatching()
  }, [stopWatching, startWatching])

  const handleManualCapture = () => {
    if (position) {
      onCapture(position)
    }
  }

  // Start watching on mount
  useEffect(() => {
    startWatching()
    return () => {
      stopWatching()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const accuracyColor =
    position && position.accuracy <= minAccuracy
      ? 'text-green-600'
      : position && position.accuracy <= minAccuracy * 2
      ? 'text-yellow-600'
      : 'text-red-600'

  const accuracyBgColor =
    position && position.accuracy <= minAccuracy
      ? 'bg-green-50 border-green-200'
      : position && position.accuracy <= minAccuracy * 2
      ? 'bg-yellow-50 border-yellow-200'
      : 'bg-red-50 border-red-200'

  return (
    <Card className={`${position ? accuracyBgColor : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-full ${position ? accuracyBgColor : 'bg-gray-100'}`}>
              <MapPin className={`h-5 w-5 ${position ? accuracyColor : 'text-gray-400'}`} />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">GPS Location</h3>
              {isLoading && (
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Getting location...
                </p>
              )}
              {error && (
                <div className="flex items-center gap-1 text-sm text-red-600">
                  <AlertCircle className="h-3 w-3" />
                  {error}
                </div>
              )}
              {position && !error && (
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">
                    {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
                  </p>
                  <div className={`text-sm flex items-center gap-1 ${accuracyColor}`}>
                    {position.accuracy <= minAccuracy ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    Accuracy: ±{position.accuracy.toFixed(1)}m
                    {position.accuracy > minAccuracy && (
                      <span className="text-xs">(waiting for better signal)</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshPosition}
              disabled={isLoading}
              title="Refresh position"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {!autoCapture && position && (
          <Button
            onClick={handleManualCapture}
            className="w-full mt-4"
            variant={position.accuracy <= minAccuracy ? 'default' : 'outline'}
          >
            <MapPin className="h-4 w-4 mr-2" />
            Use This Location
            {position.accuracy > minAccuracy && ' (Low Accuracy)'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
