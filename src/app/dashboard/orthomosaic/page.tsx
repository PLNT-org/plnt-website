'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  MapIcon,
  Image as ImageIcon
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import Link from 'next/link'
import Image from 'next/image'

interface UploadedImage {
  file: File
  preview: string
  id: string
}

export default function OrthomosaicUploadPage() {
  const { user, isDemo } = useAuth()
  const router = useRouter()

  const [projectName, setProjectName] = useState('')
  const [quality, setQuality] = useState('balanced')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [taskInfo, setTaskInfo] = useState<{
    taskId: string
    projectId: number
    orthomosaicId?: string
  } | null>(null)

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

  const handleCreateOrthomosaic = async () => {
    if (images.length < 3) {
      setError('Please add at least 3 images for orthomosaic creation')
      return
    }

    if (!projectName.trim()) {
      setError('Please enter a project name')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setError('')

    try {
      // For demo mode, simulate the process
      if (isDemo) {
        for (let i = 0; i <= 100; i += 5) {
          setUploadProgress(i)
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        setUploading(false)
        setProcessing(true)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setTaskInfo({
          taskId: 'demo-task-' + Date.now(),
          projectId: 1,
          orthomosaicId: 'demo-ortho-' + Date.now()
        })
        setSuccess(true)
        setProcessing(false)
        return
      }

      // Create FormData with images
      const formData = new FormData()
      formData.append('name', projectName)
      formData.append('quality', quality)

      images.forEach((img, index) => {
        formData.append('images', img.file)
        setUploadProgress(((index + 1) / images.length) * 90)
      })

      setUploadProgress(95)

      // Send directly to WebODM API
      const response = await fetch('/api/orthomosaic/create', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create orthomosaic')
      }

      setUploadProgress(100)
      setUploading(false)
      setProcessing(true)

      setTaskInfo({
        taskId: data.taskId,
        projectId: data.projectId,
        orthomosaicId: data.orthomosaicId
      })

      setSuccess(true)
      setProcessing(false)

    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setUploading(false)
      setProcessing(false)
    }
  }

  if (success && taskInfo) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Orthomosaic Processing Started!</h2>
                <p className="text-gray-600">
                  Your {images.length} images have been submitted to WebODM for processing.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left">
                <h3 className="font-semibold text-blue-900 mb-2">What happens next?</h3>
                <ul className="text-sm text-blue-700 space-y-2">
                  <li>• WebODM will stitch your images into a georeferenced orthomosaic</li>
                  <li>• Processing typically takes 15-60 minutes depending on image count</li>
                  <li>• You can monitor progress in the orthomosaic viewer</li>
                  <li>• Once complete, you can label plants with GPS coordinates</li>
                </ul>
              </div>

              <div className="flex gap-4 justify-center">
                <Link href={`/dashboard/analytics/orthomosaic${taskInfo.orthomosaicId ? `?id=${taskInfo.orthomosaicId}` : ''}`}>
                  <Button className="bg-green-700 hover:bg-green-800">
                    <MapIcon className="w-4 h-4 mr-2" />
                    View Progress
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSuccess(false)
                    setImages([])
                    setProjectName('')
                    setTaskInfo(null)
                  }}
                >
                  Create Another
                </Button>
              </div>

            </div>
          </CardContent>
        </Card>
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
              <h1 className="text-2xl font-bold text-gray-900">Create Orthomosaic</h1>
              <p className="text-gray-600">Upload drone images to create a georeferenced map</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">

      {/* Project Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Project Settings</CardTitle>
          <CardDescription>Configure your orthomosaic processing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Project Name</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., North Field Survey - Dec 2024"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Processing Quality</label>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast (Lower quality, quicker processing)</SelectItem>
                <SelectItem value="balanced">Balanced (Recommended)</SelectItem>
                <SelectItem value="high">High Quality (Best for plant counting)</SelectItem>
                <SelectItem value="height-mapping">Height Mapping 3D (DSM, DTM, Point Cloud)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              {quality === 'height-mapping'
                ? 'Generates DSM, DTM, point cloud & 3D mesh from cross-hatch flights'
                : 'Higher quality = longer processing time but better detail for plant detection'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Drone Images</CardTitle>
          <CardDescription>
            Upload overlapping aerial photos. Images should have GPS data (EXIF) for best results.
          </CardDescription>
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
                <p className="text-gray-600 mb-2">Drag & drop drone images here</p>
                <p className="text-sm text-gray-500">or click to select files</p>
                <p className="text-xs text-gray-400 mt-2">
                  Supports: JPG, PNG, TIFF • Minimum 3 images • 70-80% overlap recommended
                </p>
              </div>
            )}
          </div>

          {/* Image Preview Grid */}
          {images.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm font-medium text-gray-700">
                  <ImageIcon className="w-4 h-4 inline mr-1" />
                  {images.length} images selected
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImages([])}
                  className="text-red-600 hover:text-red-700"
                >
                  Clear all
                </Button>
              </div>

              <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                {images.map(img => (
                  <div key={img.id} className="relative group">
                    <img
                      src={img.preview}
                      alt="Upload preview"
                      className="w-full h-16 object-cover rounded"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5
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
                    <span className="text-gray-600">Uploading images to WebODM...</span>
                    <span className="text-gray-900 font-medium">{Math.round(uploadProgress)}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}

              {processing && (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="text-gray-600">Starting orthomosaic processing...</span>
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
          onClick={handleCreateOrthomosaic}
          disabled={images.length < 3 || !projectName.trim() || uploading || processing}
          className="bg-green-700 hover:bg-green-800"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : processing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Layers className="w-4 h-4 mr-2" />
              Create Orthomosaic ({images.length} images)
            </>
          )}
        </Button>
      </div>

      {/* Tips */}
      <Card className="bg-gray-50">
        <CardContent className="pt-6">
          <h3 className="font-medium mb-3">Tips for best results:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Use images with 70-80% overlap (front and side)</li>
            <li>• Ensure images have GPS coordinates in EXIF data</li>
            <li>• Fly at consistent altitude for uniform resolution</li>
            <li>• Avoid shadows and overexposed areas</li>
            <li>• More images = better accuracy but longer processing</li>
          </ul>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
