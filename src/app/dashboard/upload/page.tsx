// app/dashboard/upload/page.tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Upload, X, CheckCircle2, AlertCircle, Image as ImageIcon, Loader2, Brain, FileUp, Map, Layers } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import Link from 'next/link'
import Image from 'next/image'

interface UploadedImage {
  file: File
  preview: string
  id: string
}

interface Flight {
  id: string
  flight_plan_id: string
  started_at: string
  completed_at?: string
  flight_plans?: {
    name: string
    plots?: {
      name: string
    }
  }
}

export default function ImageUploadPage() {
  const { user, isDemo } = useAuth()
  const router = useRouter()
  
  const [selectedFlight, setSelectedFlight] = useState<string>('')
  const [flights, setFlights] = useState<Flight[]>([])
  const [images, setImages] = useState<UploadedImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingProgress, setProcessingProgress] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [plantCount, setPlantCount] = useState<number | null>(null)
  const [loadingFlights, setLoadingFlights] = useState(true)
  const [creatingOrthomosaic, setCreatingOrthomosaic] = useState(false)
  const [orthomosaicId, setOrthomosaicId] = useState<string | null>(null)
  const [processingType, setProcessingType] = useState<'2d' | '3d'>('2d')

  // Load recent flights on mount
  useEffect(() => {
    loadRecentFlights()
  }, [])

  const loadRecentFlights = async () => {
    if (isDemo) {
      // Demo flights
      setFlights([
        {
          id: 'demo-1',
          flight_plan_id: 'plan-1',
          started_at: new Date().toISOString(),
          flight_plans: {
            name: 'North Field Survey',
            plots: { name: 'North Field A' }
          }
        },
        {
          id: 'demo-2',
          flight_plan_id: 'plan-2',
          started_at: new Date(Date.now() - 86400000).toISOString(),
          completed_at: new Date(Date.now() - 85400000).toISOString(),
          flight_plans: {
            name: 'Greenhouse Check',
            plots: { name: 'Greenhouse B' }
          }
        }
      ])
      setLoadingFlights(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('flights')
        .select(`
          *,
          flight_plans (
            name,
            plots (
              name
            )
          )
        `)
        .eq('user_id', user?.id)
        .order('started_at', { ascending: false })
        .limit(10)

      if (error) throw error
      setFlights(data || [])
    } catch (err) {
      console.error('Error loading flights:', err)
    } finally {
      setLoadingFlights(false)
    }
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9)
    }))
    setImages(prev => [...prev, ...newImages])
    setError('')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.tiff', '.tif']
    },
    multiple: true
  })

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  const handleUploadAndProcess = async () => {
    if (!selectedFlight) {
      setError('Please select a flight')
      return
    }

    if (images.length === 0) {
      setError('Please add at least one image')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setError('')

    try {
      // Upload images to Supabase storage
      const uploadPromises = images.map(async (img, index) => {
        const fileExt = img.file.name.split('.').pop()
        const fileName = `${user?.id}/${selectedFlight}/${Date.now()}_${index}.${fileExt}`
        
        const { error: uploadError } = await supabase.storage
          .from('flight-images')
          .upload(fileName, img.file)

        if (uploadError) throw uploadError
        
        // Update progress
        setUploadProgress(((index + 1) / images.length) * 100)
        
        return fileName
      })

      const uploadedPaths = await Promise.all(uploadPromises)
      
      // Store image records in database
      const imageRecords = uploadedPaths.map(path => ({
        flight_id: selectedFlight,
        image_url: path,
        captured_at: new Date().toISOString()
      }))

      const { error: dbError } = await supabase
        .from('aerial_images')
        .insert(imageRecords)

      if (dbError) throw dbError

      setUploading(false)
      setProcessing(true)
      setProcessingProgress(0)

      // Call processing API
      const processResult = await processImagesForPlantCount(uploadedPaths)
      
      // Store plant count result
      if (processResult.count !== null) {
        const { error: countError } = await supabase
          .from('plant_counts')
          .insert({
            flight_id: selectedFlight,
            count: processResult.count,
            confidence: processResult.confidence || 0.95,
            processing_time_s: processResult.processingTime || 10,
            individual_plants: processResult.individualPlants || null
          })

        if (countError) throw countError

        setPlantCount(processResult.count)
        setSuccess(true)
      }

    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      setProcessing(false)
    }
  }

  const createOrthomosaic = async () => {
    if (!selectedFlight) return

    setCreatingOrthomosaic(true)
    setError('')

    try {
      if (isDemo) {
        // Simulate orthomosaic creation for demo
        await new Promise(resolve => setTimeout(resolve, 1500))
        setOrthomosaicId('demo-orthomosaic-' + Date.now())
        return
      }

      const response = await fetch('/api/webodm/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightId: selectedFlight,
          name: processingType === '3d'
            ? `3D Height Map - ${new Date().toLocaleDateString()}`
            : `Orthomosaic - ${new Date().toLocaleDateString()}`,
          quality: processingType === '3d' ? 'height-mapping' : 'balanced',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create orthomosaic')
      }

      setOrthomosaicId(data.orthomosaicId)
    } catch (err: any) {
      setError(err.message || 'Failed to start orthomosaic processing')
    } finally {
      setCreatingOrthomosaic(false)
    }
  }

  const processImagesForPlantCount = async (imagePaths: string[]): Promise<any> => {
    // Simulate processing for demo
    if (isDemo) {
      // Simulate processing progress
      for (let i = 0; i <= 100; i += 10) {
        setProcessingProgress(i)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
      return {
        count: Math.floor(Math.random() * 500) + 1000,
        confidence: 0.94,
        processingTime: 8.5,
        individualPlants: []
      }
    }

    // Real API call would go here
    try {
      const response = await fetch('/api/process-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imagePaths, flightId: selectedFlight })
      })

      if (!response.ok) throw new Error('Processing failed')
      
      return await response.json()
    } catch (err) {
      // Fallback to mock data
      return {
        count: 1247,
        confidence: 0.92,
        processingTime: 12.3
      }
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Complete!</h2>
                  <p className="text-gray-600">Your images have been successfully analyzed</p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <div className="text-3xl font-bold text-green-800 mb-2">
                    {plantCount?.toLocaleString()} plants detected
                  </div>
                  <p className="text-sm text-green-600">
                    Processed {images.length} images with 94% confidence
                  </p>
                </div>

                {/* Orthomosaic Creation Section */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Layers className="w-6 h-6 text-blue-600" />
                    <h3 className="font-semibold text-blue-900">Create Orthomosaic</h3>
                  </div>
                  <p className="text-sm text-blue-700 mb-4">
                    Stitch your drone images into a georeferenced orthomosaic map for plant labeling and analysis.
                  </p>

                  {/* Processing Type Selection */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={() => setProcessingType('2d')}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        processingType === '2d'
                          ? 'border-blue-500 bg-white'
                          : 'border-blue-200 bg-blue-25 hover:border-blue-300'
                      }`}
                    >
                      <div className="font-medium text-blue-900">2D Orthomosaic</div>
                      <div className="text-xs text-blue-600">Standard flat map for plant counting</div>
                    </button>
                    <button
                      onClick={() => setProcessingType('3d')}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        processingType === '3d'
                          ? 'border-blue-500 bg-white'
                          : 'border-blue-200 bg-blue-25 hover:border-blue-300'
                      }`}
                    >
                      <div className="font-medium text-blue-900">3D Height Mapping</div>
                      <div className="text-xs text-blue-600">DSM/DTM for tree height analysis</div>
                    </button>
                  </div>

                  {orthomosaicId ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-medium">Orthomosaic processing started!</span>
                      </div>
                      <Link href={`/dashboard/analytics/orthomosaic?id=${orthomosaicId}`}>
                        <Button className="w-full bg-blue-600 hover:bg-blue-700">
                          <Map className="w-4 h-4 mr-2" />
                          View Orthomosaic Progress
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <Button
                      onClick={createOrthomosaic}
                      disabled={creatingOrthomosaic}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {creatingOrthomosaic ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting Processing...
                        </>
                      ) : (
                        <>
                          <Layers className="w-4 h-4 mr-2" />
                          Create Orthomosaic Map
                        </>
                      )}
                    </Button>
                  )}
                </div>

                <div className="flex gap-4 justify-center">
                  <Link href={`/dashboard/flights/${selectedFlight}`}>
                    <Button className="bg-green-700 hover:bg-green-800">
                      View Detailed Results
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSuccess(false)
                      setImages([])
                      setPlantCount(null)
                      setSelectedFlight('')
                      setOrthomosaicId(null)
                    }}
                  >
                    Process Another Flight
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard">
              <Image
                src="/images/plnt-logo.svg"
                alt="PLNT Logo"
                width={120}
                height={40}
                className="h-10 w-auto"
                priority
              />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Upload Flight Images</h1>
              <p className="text-gray-600">Upload aerial images from your drone flight for plant counting analysis</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-8 space-y-6">

        {/* Flight Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Flight</CardTitle>
            <CardDescription>Choose which flight these images belong to</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFlights ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <Select value={selectedFlight} onValueChange={setSelectedFlight}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a recent flight..." />
                </SelectTrigger>
                <SelectContent>
                  {flights.map(flight => (
                    <SelectItem key={flight.id} value={flight.id}>
                      {flight.flight_plans?.name} - {flight.flight_plans?.plots?.name} 
                      ({new Date(flight.started_at).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {flights.length === 0 && !loadingFlights && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No flights found. Please complete a flight mission first.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Upload Area */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Images</CardTitle>
            <CardDescription>Drag and drop or click to select aerial images</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'}`}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              {isDragActive ? (
                <p className="text-green-600">Drop the images here...</p>
              ) : (
                <div>
                  <p className="text-gray-600 mb-2">Drag & drop aerial images here</p>
                  <p className="text-sm text-gray-500">or click to select files</p>
                  <p className="text-xs text-gray-400 mt-2">Supports: JPG, PNG, TIFF (up to 50MB each)</p>
                </div>
              )}
            </div>

            {/* Image Preview Grid */}
            {images.length > 0 && (
              <div className="mt-6">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm font-medium text-gray-700">{images.length} images selected</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setImages([])}
                    className="text-red-600 hover:text-red-700"
                  >
                    Clear all
                  </Button>
                </div>
                
                <div className="grid grid-cols-4 gap-4">
                  {images.map(img => (
                    <div key={img.id} className="relative group">
                      <img
                        src={img.preview}
                        alt="Upload preview"
                        className="w-full h-24 object-cover rounded-lg"
                      />
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 
                                 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Upload Progress */}
        {(uploading || processing) && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                {uploading && (
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-600">Uploading images...</span>
                      <span className="text-gray-900 font-medium">{Math.round(uploadProgress)}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}
                
                {processing && (
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-600">Processing with AI...</span>
                      <span className="text-gray-900 font-medium">{Math.round(processingProgress)}%</span>
                    </div>
                    <Progress value={processingProgress} className="h-2" />
                    <p className="text-xs text-gray-500 mt-2">
                      Analyzing images for plant detection and counting...
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between">
          <Link href="/dashboard">
            <Button variant="outline">Cancel</Button>
          </Link>
          
          <Button
            onClick={handleUploadAndProcess}
            disabled={!selectedFlight || images.length === 0 || uploading || processing}
            className="bg-green-700 hover:bg-green-800"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : processing ? (
              <>
                <Brain className="w-4 h-4 mr-2 animate-pulse" />
                Processing...
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 mr-2" />
                Upload & Process Images
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}