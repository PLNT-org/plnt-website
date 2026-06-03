'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Camera, X, AlertCircle } from 'lucide-react'

interface BarcodeScannerProps {
  onScan: (value: string, format: string) => void
  onError?: (error: string) => void
  onClose?: () => void
}

export function BarcodeScanner({ onScan, onError, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scannedValue, setScannedValue] = useState<string | null>(null)
  const scannedRef = useRef(false)

  // Keep the latest callbacks in refs so the camera effect can run once on
  // mount without restarting (and re-prompting for permission) every time the
  // parent re-renders and passes new inline onScan/onError functions.
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  })

  // Stop the running scanner, tolerating both async rejections and the
  // synchronous "Cannot stop, scanner is not running" throw from html5-qrcode.
  const stopScanner = () => {
    const scanner = scannerRef.current
    if (!scanner) return
    scannerRef.current = null
    try {
      const result = scanner.stop()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(() => {})
      }
    } catch {
      // Scanner was not running/paused — safe to ignore.
    }
  }

  useEffect(() => {
    const startScanner = async () => {
      if (!containerRef.current || scannedRef.current) return

      const scannerId = 'barcode-scanner-' + Math.random().toString(36).substr(2, 9)
      containerRef.current.id = scannerId

      try {
        setIsLoading(true)
        setError(null)

        const scanner = new Html5Qrcode(scannerId)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
          },
          (decodedText, result) => {
            if (!scannedRef.current) {
              scannedRef.current = true
              setScannedValue(decodedText)

              // Vibrate on success
              if ('vibrate' in navigator) {
                navigator.vibrate(100)
              }

              const format = result.result.format?.formatName || 'UNKNOWN'
              onScanRef.current(decodedText, format)

              // Stop scanner after successful scan
              stopScanner()
            }
          },
          () => {
            // Ignore scan failures (no barcode in frame)
          }
        )

        setIsLoading(false)
      } catch (err) {
        console.error('Scanner error:', err)
        const message = err instanceof Error ? err.message : 'Failed to start scanner'
        setError(message)
        onErrorRef.current?.(message)
        setIsLoading(false)
      }
    }

    startScanner()

    return () => {
      stopScanner()
    }
    // Start once on mount; latest callbacks are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRetry = () => {
    scannedRef.current = false
    setScannedValue(null)
    setError(null)

    // Trigger re-mount by reloading
    stopScanner()

    // Small delay to allow cleanup
    setTimeout(() => {
      window.location.reload()
    }, 100)
  }

  const handleClose = () => {
    stopScanner()
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

        {/* The video container is always laid out (never display:none) so that
            iOS Safari actually renders the camera feed. Loading/error states are
            overlaid on top instead of replacing it. */}
        <div className="relative w-full min-h-[300px] bg-gray-900">
          <div ref={containerRef} className="w-full min-h-[300px]" />

          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
              <Camera className="h-8 w-8 text-gray-400 animate-pulse" />
              <p className="text-gray-400 mt-2">Starting camera...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 p-4">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-red-400 mt-2 text-center">{error}</p>
              <Button onClick={handleRetry} className="mt-4" variant="outline">
                Retry
              </Button>
            </div>
          )}

          {scannedValue && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-full font-bold max-w-[90%] truncate">
              {scannedValue}
            </div>
          )}
        </div>

        <div className="p-3 bg-gray-100 text-center text-sm text-gray-600">
          Point camera at a barcode
        </div>
      </CardContent>
    </Card>
  )
}
