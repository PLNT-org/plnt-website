'use client'

import { authFetch } from '@/lib/auth/auth-fetch'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BarcodeScanner } from '@/components/barcode-scanner'
import { GpsCapture } from '@/components/gps-capture'
import {
  Barcode,
  MapPin,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'

interface Species {
  id: string
  name: string
  scientific_name?: string
  category?: string
  container_size?: string
  barcode_value?: string
}

interface GpsPosition {
  lat: number
  lng: number
  accuracy: number
}

type Step = 'scan' | 'confirm'

export default function RegisterMarkerPage() {
  const { user, session } = useAuth()
  const [currentStep, setCurrentStep] = useState<Step>('scan')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Form state. Species auto-links silently when the barcode is known —
  // there is no manual species selection (kept the page to scan + GPS only).
  const [selectedSpecies, setSelectedSpecies] = useState<Species | null>(null)
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [gpsPosition, setGpsPosition] = useState<GpsPosition | null>(null)
  // Start the camera only when the user taps "Scan Barcode" — iOS Safari needs a
  // user gesture to render the camera feed (auto-starting it shows a blank frame).
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)

  // Persist every successful decode immediately (raw value, format, best-effort
  // GPS) so no field scan is ever lost, even if the wizard is abandoned.
  // Fire-and-forget: failures never block or surface in the scan flow.
  const logRawScan = (value: string, format?: string) => {
    if (!session?.access_token) return
    const send = (coords?: GeolocationCoordinates) => {
      authFetch('/api/barcode-scans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          raw_value: value,
          format,
          latitude: coords?.latitude,
          longitude: coords?.longitude,
          gps_accuracy_meters: coords?.accuracy,
        }),
      }).catch(() => {})
    }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords),
        () => send(),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 15000 }
      )
    } else {
      send()
    }
  }

  const handleBarcodeScanned = async (value: string, format?: string) => {
    setScannedBarcode(value)
    setShowBarcodeScanner(false)
    logRawScan(value, format)

    // Try to look up species by barcode
    if (session?.access_token) {
      try {
        const response = await authFetch(`/api/species/lookup?barcode=${encodeURIComponent(value)}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        if (response.ok) {
          const species = await response.json()
          if (species) {
            setSelectedSpecies(species)
          }
        }
      } catch (error) {
        console.error('Failed to lookup species:', error)
      }
    }
  }

  const handleGpsCapture = (position: GpsPosition) => {
    setGpsPosition(position)
  }

  const handleSubmit = async () => {
    if (!scannedBarcode || !gpsPosition || !session?.access_token) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await authFetch('/api/marker-registrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          marker_code: scannedBarcode,
          species_id: selectedSpecies?.id,
          barcode_value: scannedBarcode,
          latitude: gpsPosition.lat,
          longitude: gpsPosition.lng,
          gps_accuracy_meters: gpsPosition.accuracy,
        }),
      })

      if (response.ok) {
        setSubmitSuccess(true)
        // Vibrate on success
        if ('vibrate' in navigator) {
          navigator.vibrate([100, 50, 100])
        }
      } else {
        const error = await response.json()
        setSubmitError(error.error || 'Failed to register marker')
      }
    } catch (error) {
      console.error('Submit error:', error)
      setSubmitError('Failed to register marker. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRegisterAnother = () => {
    // Reset all state
    setCurrentStep('scan')
    setSelectedSpecies(null)
    setScannedBarcode(null)
    setGpsPosition(null)
    setShowBarcodeScanner(false)
    setSubmitSuccess(false)
    setSubmitError(null)
  }

  const goToStep = (step: Step) => {
    setCurrentStep(step)
  }

  const steps: { key: Step; label: string; icon: any }[] = [
    { key: 'scan', label: 'Scan & Location', icon: Barcode },
    { key: 'confirm', label: 'Confirm', icon: Check },
  ]

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep)
  const canProceed = () => {
    switch (currentStep) {
      case 'scan':
        return scannedBarcode !== null && gpsPosition !== null
      case 'confirm':
        return true
      default:
        return false
    }
  }

  // Success state
  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-lg mx-auto">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-green-800 mb-2">Plant Registered!</h2>
              <p className="text-green-700 mb-6">
                Barcode {scannedBarcode} has been registered
                {selectedSpecies && ` as "${selectedSpecies.name}"`}.
              </p>
              <div className="flex flex-col gap-3">
                <Button onClick={handleRegisterAnother} className="w-full" size="lg">
                  <Plus className="h-4 w-4 mr-2" />
                  Register Another Plant
                </Button>
                <Button
                  variant="outline"
                  onClick={() => (window.location.href = '/dashboard')}
                  className="w-full"
                >
                  Back to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Logo */}
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 py-3">
          {/* Logo in upper left */}
          <div className="flex justify-start mb-2">
            <Link href="/dashboard">
              <Image
                src="/images/plnt-logo.svg"
                alt="PLNT Logo"
                width={80}
                height={27}
                className="h-7 w-auto"
                priority
              />
            </Link>
          </div>
          {/* Progress Bar */}
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.key} className="flex items-center">
                <button
                  onClick={() => index < currentStepIndex && goToStep(step.key)}
                  disabled={index > currentStepIndex}
                  className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                    index < currentStepIndex
                      ? 'bg-green-500 text-white cursor-pointer hover:bg-green-600'
                      : index === currentStepIndex
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {index < currentStepIndex ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </button>
                {index < steps.length - 1 && (
                  <div
                    className={`w-8 h-1 mx-1 rounded ${
                      index < currentStepIndex ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-600 mt-2">
            Step {currentStepIndex + 1}: {steps[currentStepIndex].label}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-lg mx-auto p-4 pb-24">
        {/* Step 1: Scan Plant Barcode */}
        {currentStep === 'scan' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Barcode className="h-5 w-5" />
                  Scan Plant Barcode
                </CardTitle>
                <CardDescription>
                  Scan the plant&apos;s barcode to identify it and tag this location
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Barcode Scanner */}
                {showBarcodeScanner ? (
                  <BarcodeScanner
                    onScan={handleBarcodeScanned}
                    onClose={() => setShowBarcodeScanner(false)}
                    onError={(error) => console.error('Barcode error:', error)}
                  />
                ) : (
                  <Button
                    variant="outline"
                    className="w-full h-12"
                    onClick={() => setShowBarcodeScanner(true)}
                  >
                    <Barcode className="h-4 w-4 mr-2" />
                    {scannedBarcode ? 'Scan Again' : 'Scan Barcode'}
                  </Button>
                )}

                {scannedBarcode && (
                  <div className="p-3 bg-blue-50 rounded-lg text-sm">
                    <span className="font-medium">Scanned:</span> {scannedBarcode}
                  </div>
                )}

                {/* Species shows only when the barcode auto-matched one — no manual UI */}
                {selectedSpecies && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="font-medium text-green-800">{selectedSpecies.name}</p>
                    {selectedSpecies.scientific_name && (
                      <p className="text-sm text-green-600 italic">{selectedSpecies.scientific_name}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Location confirmation lives on the same page as the scanner so
                the field flow is scan → confirm GPS → Next, no page hopping. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Confirm Location
                </CardTitle>
                <CardDescription>
                  Your GPS coordinates will be saved with this registration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <GpsCapture
                  onCapture={handleGpsCapture}
                  autoCapture={false}
                  minAccuracy={10}
                  capturedPosition={gpsPosition}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2: Confirm & Submit */}
        {currentStep === 'confirm' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Check className="h-5 w-5" />
                  Confirm Registration
                </CardTitle>
                <CardDescription>Review and submit your plant registration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-sm">
                  {scannedBarcode && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">Barcode:</span>
                      <span className="font-medium truncate max-w-[200px]">{scannedBarcode}</span>
                    </div>
                  )}
                  {selectedSpecies && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">Species:</span>
                      <span className="font-medium">{selectedSpecies.name}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Location:</span>
                    <span className="font-medium">
                      {gpsPosition
                        ? `${gpsPosition.lat.toFixed(6)}, ${gpsPosition.lng.toFixed(6)}`
                        : 'Not captured'}
                    </span>
                  </div>
                  {gpsPosition && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">GPS Accuracy:</span>
                      <span className="font-medium">±{gpsPosition.accuracy.toFixed(1)}m</span>
                    </div>
                  )}
                </div>

                {submitError && (
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <p className="text-sm text-red-600">{submitError}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <div className="max-w-lg mx-auto flex gap-3">
          {currentStepIndex > 0 && (
            <Button
              variant="outline"
              onClick={() => goToStep(steps[currentStepIndex - 1].key)}
              className="flex-1"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          {currentStep === 'confirm' ? (
            <Button
              onClick={handleSubmit}
              disabled={!canProceed() || isSubmitting}
              className="flex-1"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Register Plant
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={() => goToStep(steps[currentStepIndex + 1].key)}
              disabled={!canProceed()}
              className="flex-1"
              size="lg"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
