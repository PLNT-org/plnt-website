'use client'

import { authFetch } from '@/lib/auth/auth-fetch'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BarcodeScanner } from '@/components/barcode-scanner'
import { GpsCapture } from '@/components/gps-capture'
import {
  Barcode,
  Camera,
  MapPin,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ImageIcon,
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

  // Form state
  const [selectedSpecies, setSelectedSpecies] = useState<Species | null>(null)
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [gpsPosition, setGpsPosition] = useState<GpsPosition | null>(null)
  const [plotName, setPlotName] = useState('')
  const [notes, setNotes] = useState('')

  // Label-photo failsafe (when the barcode can't be scanned)
  const [labelPhotoUrl, setLabelPhotoUrl] = useState<string | null>(null)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const labelPhotoInputRef = useRef<HTMLInputElement>(null)

  // Species state
  const [speciesList, setSpeciesList] = useState<Species[]>([])
  const [isLoadingSpecies, setIsLoadingSpecies] = useState(false)
  // Start the camera only when the user taps "Scan Barcode" — iOS Safari needs a
  // user gesture to render the camera feed (auto-starting it shows a blank frame).
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [newSpeciesName, setNewSpeciesName] = useState('')

  // Load user's species list
  useEffect(() => {
    if (session?.access_token) {
      loadSpecies()
    }
  }, [session])

  const loadSpecies = async () => {
    if (!session?.access_token) return
    setIsLoadingSpecies(true)
    try {
      const response = await authFetch('/api/species', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSpeciesList(data)
      }
    } catch (error) {
      console.error('Failed to load species:', error)
    } finally {
      setIsLoadingSpecies(false)
    }
  }

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
          } else {
            // No species found, prompt to create
            setShowManualEntry(true)
            setNewSpeciesName('')
          }
        }
      } catch (error) {
        console.error('Failed to lookup species:', error)
      }
    }
  }

  const handleLabelPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file || !session?.access_token) return

    setIsUploadingPhoto(true)
    setPhotoError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await authFetch('/api/marker-registrations/label-photo', {
        method: 'POST',
        body: formData,
      })
      if (response.ok) {
        const data = await response.json()
        setLabelPhotoUrl(data.path)
        // A photo is enough to register; close the scanner if it was open.
        setShowBarcodeScanner(false)
      } else {
        setPhotoError('Upload failed. Please try again.')
      }
    } catch (error) {
      console.error('Failed to upload label photo:', error)
      setPhotoError('Upload failed. Please try again.')
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  const handleGpsCapture = (position: GpsPosition) => {
    setGpsPosition(position)
  }

  const handleCreateSpecies = async () => {
    if (!newSpeciesName.trim() || !session?.access_token) return

    try {
      const response = await authFetch('/api/species', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: newSpeciesName.trim(),
          barcode_value: scannedBarcode,
        }),
      })

      if (response.ok) {
        const species = await response.json()
        setSelectedSpecies(species)
        setSpeciesList([...speciesList, species])
        setShowManualEntry(false)
        setNewSpeciesName('')
      }
    } catch (error) {
      console.error('Failed to create species:', error)
    }
  }

  const handleSelectSpecies = (speciesId: string) => {
    const species = speciesList.find((s) => s.id === speciesId)
    if (species) {
      setSelectedSpecies(species)
    }
  }

  const handleSubmit = async () => {
    // A barcode OR a label photo is enough to register.
    if ((!scannedBarcode && !labelPhotoUrl) || !gpsPosition || !session?.access_token) return

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
          marker_code: scannedBarcode || undefined,
          label_photo_url: labelPhotoUrl || undefined,
          species_id: selectedSpecies?.id,
          barcode_value: scannedBarcode || undefined,
          latitude: gpsPosition.lat,
          longitude: gpsPosition.lng,
          gps_accuracy_meters: gpsPosition.accuracy,
          plot_name: plotName || undefined,
          notes: notes || undefined,
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
    setPlotName('')
    setNotes('')
    setLabelPhotoUrl(null)
    setPhotoError(null)
    setShowBarcodeScanner(false)
    setShowManualEntry(false)
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
        return (scannedBarcode !== null || labelPhotoUrl !== null) && gpsPosition !== null
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
                {scannedBarcode
                  ? `Barcode ${scannedBarcode} has been registered`
                  : 'Label photo has been registered'}
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

                {/* Failsafe: photo of the label when the barcode won't scan */}
                <input
                  ref={labelPhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleLabelPhoto}
                />
                {labelPhotoUrl ? (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm text-green-800">
                      <ImageIcon className="h-4 w-4" />
                      Label photo attached
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => labelPhotoInputRef.current?.click()}
                    >
                      Retake
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-gray-600"
                    disabled={isUploadingPhoto}
                    onClick={() => labelPhotoInputRef.current?.click()}
                  >
                    {isUploadingPhoto ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading photo...
                      </>
                    ) : (
                      <>
                        <Camera className="h-4 w-4 mr-2" />
                        Can&apos;t scan? Take a photo of the label
                      </>
                    )}
                  </Button>
                )}
                {photoError && (
                  <p className="text-xs text-red-600 text-center">{photoError}</p>
                )}

                {/* Species Selection */}
                <div className="space-y-2">
                  <Label>Species (auto-filled from barcode, or pick one):</Label>
                  <Select
                    value={selectedSpecies?.id || ''}
                    onValueChange={handleSelectSpecies}
                    disabled={isLoadingSpecies}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a species..." />
                    </SelectTrigger>
                    <SelectContent>
                      {speciesList.map((species) => (
                        <SelectItem key={species.id} value={species.id}>
                          {species.name}
                          {species.scientific_name && ` (${species.scientific_name})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedSpecies && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="font-medium text-green-800">{selectedSpecies.name}</p>
                    {selectedSpecies.scientific_name && (
                      <p className="text-sm text-green-600 italic">{selectedSpecies.scientific_name}</p>
                    )}
                    {selectedSpecies.category && (
                      <p className="text-xs text-green-600 mt-1">{selectedSpecies.category}</p>
                    )}
                  </div>
                )}

                {/* Create new species */}
                {showManualEntry ? (
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 space-y-3">
                    <p className="text-sm text-yellow-800">
                      No species found for barcode. Create one:
                    </p>
                    <Input
                      placeholder="Species name"
                      value={newSpeciesName}
                      onChange={(e) => setNewSpeciesName(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleCreateSpecies}
                        disabled={!newSpeciesName.trim()}
                      >
                        Create
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowManualEntry(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowManualEntry(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Species
                  </Button>
                )}

                <p className="text-xs text-gray-500 text-center">
                  Species is optional - you can link it later
                </p>
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

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="plot-name">Plot Name (optional)</Label>
                    <Input
                      id="plot-name"
                      placeholder="e.g., Row A, Section 3"
                      value={plotName}
                      onChange={(e) => setPlotName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Input
                      id="notes"
                      placeholder="Any additional notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
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
                  {labelPhotoUrl && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">Label Photo:</span>
                      <span className="font-medium flex items-center gap-1 text-green-700">
                        <ImageIcon className="h-4 w-4" /> Attached
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-gray-600">Species:</span>
                    <span className="font-medium">
                      {selectedSpecies?.name || 'Not selected'}
                    </span>
                  </div>
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
                  {plotName && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">Plot Name:</span>
                      <span className="font-medium">{plotName}</span>
                    </div>
                  )}
                  {notes && (
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-gray-600">Notes:</span>
                      <span className="font-medium truncate max-w-[200px]">{notes}</span>
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
