// app/dashboard/analytics/plant-health/page.tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  Upload, 
  ImageIcon, 
  Activity, 
  AlertCircle, 
  Download,
  RotateCw,
  Info,
  Eye,
  EyeOff,
  Zap,
  BarChart,
  Flower,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move
} from 'lucide-react'

interface AnalysisResults {
  healthScore: string
  meanVari: string
  minVari: string
  maxVari: string
  healthyPixels: number
  stressedPixels: number
  totalPixels: number
  flowersDetected: number
  blackFabricDetected: number
  newGrowthDetected: number
}

interface PlantConfig {
  name: string
  description: string
  variThreshold: number
  plantTypeId: number
  filterFlowers?: boolean
  filterFabric?: boolean
}

export default function PlantHealthAnalysisPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [plantType, setPlantType] = useState<string>('nursery-production')
  const [processing, setProcessing] = useState(false)
  const [threshold, setThreshold] = useState([0.1])
  const [showOriginal, setShowOriginal] = useState(true)
  const [applyHistEq, setApplyHistEq] = useState(true)
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null)
  
  // Zoom and pan states
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Store both versions of the image
  const originalImageDataRef = useRef<ImageData | null>(null)
  const analysisImageDataRef = useRef<ImageData | null>(null)

  // Plant type configurations - Added nursery mode
  const plantConfigs: Record<string, PlantConfig> = {
    'nursery-production': {
      name: 'Nursery Production',
      description: 'Filters flowers, new growth, and ground fabric',
      variThreshold: 0.15,
      plantTypeId: 5,
      filterFlowers: true,
      filterFabric: true
    },
    'green-foliage': {
      name: 'Green Foliage Plants',
      description: 'Standard green plants (most common)',
      variThreshold: 0.1,
      plantTypeId: 0
    },
    'yellow-foliage': {
      name: 'Yellow/Golden Foliage',
      description: 'Plants with naturally yellow or golden leaves',
      variThreshold: -0.1,
      plantTypeId: 6
    },
    'purple-foliage': {
      name: 'Purple/Red Foliage',
      description: 'Plants with naturally purple or red leaves',
      variThreshold: -0.2,
      plantTypeId: 1
    },
    'variegated': {
      name: 'Variegated Plants',
      description: 'Plants with mixed color patterns',
      variThreshold: 0.05,
      plantTypeId: 2
    },
    'flowering': {
      name: 'Flowering Plants',
      description: 'Focus on foliage, ignore flowers',
      variThreshold: 0.1,
      plantTypeId: 3,
      filterFlowers: true
    },
    'succulent': {
      name: 'Succulents/Cacti',
      description: 'Blue-green or gray-green foliage',
      variThreshold: 0.08,
      plantTypeId: 4
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type)
      
      // Check file size (warn if > 10MB)
      if (file.size > 10 * 1024 * 1024) {
        console.warn('Large file detected. Processing may be slow.')
      }
      
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        console.log('File loaded, data URL length:', result.length)
        setSelectedImage(result)
        setShowOriginal(true) // Reset to show original
        setAnalysisResults(null) // Clear previous results
        setZoomLevel(1) // Reset zoom
        setPanPosition({ x: 0, y: 0 }) // Reset pan
      }
      reader.onerror = (error) => {
        console.error('Error reading file:', error)
      }
      reader.readAsDataURL(file)
    }
  }

  // Enhanced VARI calculation with MORE SPECIFIC bluish-gray fabric detection
const enhancedVARI = (r: number, g: number, b: number, config: PlantConfig): { variIndex: number, pixelType: string } => {
  // Pre-filters
  const brightness = (r + g + b) / 3
  const maxChannel = Math.max(r, g, b)
  const minChannel = Math.min(r, g, b)
  const saturation = maxChannel - minChannel
  
  // 1. Filter out black/dark pixels (fabric, shadows)
  if (config.filterFabric) {
    // Check if this is a green-dominant pixel (likely vegetation, even if dark)
    const isGreenDominant = g > r && g > b
    const greenRatio = g / (r + b + 0.001) // How much greener than red+blue
    const isDarkGreen = isGreenDominant && greenRatio > 0.4 && brightness < 0.3

    // True black detection - but PRESERVE dark green foliage
    if (maxChannel < 0.1 && !isDarkGreen) {
      // Additional check: if green is still the highest channel, it might be very dark foliage
      if (!(g >= r && g >= b && g > 0.03)) {
        return { variIndex: -999, pixelType: 'fabric' }
      }
    }

    // Skip fabric detection entirely for green-dominant pixels
    if (isGreenDominant && greenRatio > 0.35) {
      // This is likely vegetation, don't filter as fabric
    } else {
      // BLUISH-GRAY FABRIC DETECTION - MORE SPECIFIC
      // Only catch fabric, not dark plants
      // Key difference: fabric has blue > green > red, plants have green > blue
      if (b > g && g > r && saturation < 0.15 && brightness > 0.25 && brightness < 0.6) {
        // Additional check: make sure green isn't too close to blue (which would indicate a plant)
        const blueDominance = (b - g) / b
        if (blueDominance > 0.05) { // Blue must be at least 5% higher than green
          return { variIndex: -999, pixelType: 'fabric' }
        }
      }

      // Very neutral gray detection (for true gray fabrics only)
      // Much stricter - all channels must be VERY similar
      if (saturation < 0.05 && brightness > 0.2 && brightness < 0.45) {
        const channelDiff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b)
        if (channelDiff < 0.05) { // Much stricter tolerance
          return { variIndex: -999, pixelType: 'fabric' }
        }
      }
    }
  }
  
  // 2. Detect and handle flowers (high saturation, non-green dominant)
  if (config.filterFlowers && saturation > 0.4 && g < Math.max(r, b)) {
    return { variIndex: -998, pixelType: 'flower' }
  }
  
  // 3. Detect new growth (reddish but not flower-like)
  if (config.filterFlowers && r > g * 1.2 && r < g * 1.8 && brightness > 0.3 && brightness < 0.6) {
    return { variIndex: -997, pixelType: 'newgrowth' }
  }
  
  // 4. Calculate VARI based on plant type
  let variIndex: number

  if (config.plantTypeId === 1) {
    // Purple/Red foliage - modified VARI
    // For purple plants, healthy means MORE red/purple, less green
    variIndex = (r - g) / (r + g - b + 0.001)
  } else if (config.plantTypeId === 2) {
    // Variegated plants - average approach
    const variance = Math.abs(g - r) + Math.abs(g - b) + Math.abs(r - b)
    variIndex = (g - r) / (g + r - b + 0.001)
    // Reduce impact of variance
    variIndex = variIndex * (1.0 - variance * 0.2)
  } else if (config.plantTypeId === 3 && saturation > 0.5) {
    // Flowering plants - ignore high saturation areas
    return { variIndex: 0, pixelType: 'neutral' }
  } else if (config.plantTypeId === 4) {
    // Succulents - blue-green adjustment
    // Account for blue-green coloration
    variIndex = (g - r * 0.8) / (g + r - b * 1.2 + 0.001)
  } else if (config.plantTypeId === 6) {
    // Yellow/Golden foliage - modified VARI
    // For yellow plants, healthy = high red AND green, low blue
    // Yellow is R+G dominant, so we measure yellowness
    const yellowness = (r + g) / 2 - b
    const rgBalance = 1 - Math.abs(r - g) // Closer R and G = more yellow
    // Combine yellowness with R-G balance for health metric
    variIndex = (yellowness * rgBalance) / (r + g + 0.001)
    // Normalize to similar range as standard VARI
    variIndex = variIndex * 2 - 0.3
  } else {
    // Standard VARI for green plants
    variIndex = (g - r) / (g + r - b + 0.001)
  }
  
  // Check for near-zero denominator issues
  if (!isFinite(variIndex)) {
    return { variIndex: 0, pixelType: 'neutral' }
  }
  
  return { variIndex: variIndex, pixelType: 'vegetation' }
}
  // Zoom functions - REDUCED SENSITIVITY
  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev * 1.5, 5)) // Changed from 1.5 to 1.2 for less sensitivity
  }

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev / 1.5, 0.5)) // Changed from 1.5 to 1.2
  }

  const handleResetZoom = () => {
  setZoomLevel(1)
  setPanPosition({ x: 0, y: 0 })
}

  const handleMouseDown = (e: React.MouseEvent) => {
  if (zoomLevel > 1) {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({
      x: e.clientX - panPosition.x * zoomLevel,  // Multiply by zoom
      y: e.clientY - panPosition.y * zoomLevel   // Multiply by zoom
    })
  }
}

const handleMouseMove = (e: React.MouseEvent) => {
  if (isDragging && zoomLevel > 1) {
    setPanPosition({
      x: (e.clientX - dragStart.x) / zoomLevel,  // Divide by zoom
      y: (e.clientY - dragStart.y) / zoomLevel   // Divide by zoom
    })
  }
}

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = useCallback((e: WheelEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  if (!containerRef.current) return
  
  // Get container dimensions
  const rect = containerRef.current.getBoundingClientRect()
  
  // Mouse position relative to container
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  // Smoother zoom calculation
  const zoomFactor = 1.1
  const oldZoom = zoomLevel
  let newZoom: number
  
  if (e.deltaY < 0) {
    newZoom = Math.min(oldZoom * zoomFactor, 5)
  } else {
    newZoom = Math.max(oldZoom / zoomFactor, 0.5)
  }
  
  // Calculate the point on the image that's under the mouse BEFORE zoom
  const imagePointX = (mouseX - rect.width / 2 - panPosition.x * oldZoom) / oldZoom
  const imagePointY = (mouseY - rect.height / 2 - panPosition.y * oldZoom) / oldZoom
  
  // After zoom, we want this same image point to still be under the mouse
  const newPanX = (mouseX - rect.width / 2 - imagePointX * newZoom) / newZoom
  const newPanY = (mouseY - rect.height / 2 - imagePointY * newZoom) / newZoom
  
  // Batch the state updates
  setZoomLevel(newZoom)
  setPanPosition({ x: newPanX, y: newPanY })
  
}, [zoomLevel, panPosition])

// Add this useEffect right after the handleWheel function
useEffect(() => {
  const container = containerRef.current
  if (!container) return

  const wheelHandler = (e: WheelEvent) => handleWheel(e)
  container.addEventListener('wheel', wheelHandler, { passive: false })

  return () => {
    container.removeEventListener('wheel', wheelHandler)
  }
}, [handleWheel])

  const processImage = async () => {
    if (!selectedImage || !canvasRef.current || !imageRef.current) {
      console.error('Missing required elements')
      return
    }
    
    console.log('Starting image processing...')
    setProcessing(true)
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const img = imageRef.current
    
    if (!ctx) {
      console.error('Could not get canvas context')
      setProcessing(false)
      return
    }
    
    // Wait for image to be fully loaded
    const processImageData = () => {
      console.log('Processing image:', img.naturalWidth, 'x', img.naturalHeight)
      
      // Handle large images by scaling down if needed
      let targetWidth = img.naturalWidth || img.width
      let targetHeight = img.naturalHeight || img.height
      const maxDimension = 2000 // Process at max 2000px for performance
      
      if (targetWidth > maxDimension || targetHeight > maxDimension) {
        const scale = maxDimension / Math.max(targetWidth, targetHeight)
        targetWidth = Math.floor(targetWidth * scale)
        targetHeight = Math.floor(targetHeight * scale)
        console.log(`Scaling image from ${img.naturalWidth}x${img.naturalHeight} to ${targetWidth}x${targetHeight} for processing`)
      }
      
      // Set canvas size to match target dimensions
      canvas.width = targetWidth
      canvas.height = targetHeight
      
      // Draw image to canvas (will scale if needed)
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
      
      // Store original image data BEFORE any processing
      const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      originalImageDataRef.current = ctx.createImageData(originalImageData)
      originalImageDataRef.current.data.set(originalImageData.data)
      
      // Get image data for processing
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      
      // Apply histogram equalization if enabled
      if (applyHistEq) {
        applyHistogramEqualization(data)
      }
      
      // Process VARI
      let healthyCount = 0
      let stressedCount = 0
      let flowersCount = 0
      let fabricCount = 0
      let newGrowthCount = 0
      let totalVari = 0
      let minVari = 1
      let maxVari = -1
      const sampleRate = Math.max(1, Math.floor(data.length / 4 / 100000)) // Sample for performance
      
      // Create a copy for complete color replacement
      const processedData = new Uint8ClampedArray(data.length)
      
      const config = plantConfigs[plantType]
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255
        const g = data[i + 1] / 255
        const b = data[i + 2] / 255
        
        // Use enhanced VARI
        const { variIndex, pixelType } = enhancedVARI(r, g, b, config)
        
        // Handle special cases
        if (pixelType === 'fabric') {
          // Black fabric/shadows - mark as dark gray
          processedData[i] = 50
          processedData[i + 1] = 50
          processedData[i + 2] = 50
          processedData[i + 3] = 255
          if (i % sampleRate === 0) fabricCount++
          continue
        } else if (pixelType === 'flower') {
          // Flowers - mark as purple/pink
          processedData[i] = 255
          processedData[i + 1] = 192
          processedData[i + 2] = 203
          processedData[i + 3] = 255
          if (i % sampleRate === 0) flowersCount++
          continue
        } else if (pixelType === 'newgrowth') {
          // New growth - mark as light yellow (neutral)
          processedData[i] = 255
          processedData[i + 1] = 245
          processedData[i + 2] = 186
          processedData[i + 3] = 255
          if (i % sampleRate === 0) newGrowthCount++
          continue
        }
        
        // Regular VARI processing for vegetation
        const currentThreshold = threshold[0]
        const distanceFromThreshold = variIndex - currentThreshold

        // RdYlGn colormap (matching WebODM VARI colors)
        // Normalize distanceFromThreshold to 0-1 range for color interpolation
        // Range: -0.4 (red) to +0.4 (green)
        const normalizedValue = Math.max(0, Math.min(1, (distanceFromThreshold + 0.4) / 0.8))

        // RdYlGn color stops (from colorbrewer)
        const rdYlGn = [
          { pos: 0.0, r: 165, g: 0, b: 38 },    // #a50026 - Dark red
          { pos: 0.1, r: 215, g: 48, b: 39 },   // #d73027 - Red
          { pos: 0.2, r: 244, g: 109, b: 67 },  // #f46d43 - Orange-red
          { pos: 0.3, r: 253, g: 174, b: 97 },  // #fdae61 - Orange
          { pos: 0.4, r: 254, g: 224, b: 139 }, // #fee08b - Yellow-orange
          { pos: 0.5, r: 255, g: 255, b: 191 }, // #ffffbf - Yellow
          { pos: 0.6, r: 217, g: 239, b: 139 }, // #d9ef8b - Yellow-green
          { pos: 0.7, r: 166, g: 217, b: 106 }, // #a6d96a - Light green
          { pos: 0.8, r: 102, g: 189, b: 99 },  // #66bd63 - Green
          { pos: 0.9, r: 26, g: 152, b: 80 },   // #1a9850 - Dark green
          { pos: 1.0, r: 0, g: 104, b: 55 },    // #006837 - Very dark green
        ]

        // Find the two color stops to interpolate between
        let lowerStop = rdYlGn[0]
        let upperStop = rdYlGn[rdYlGn.length - 1]
        for (let j = 0; j < rdYlGn.length - 1; j++) {
          if (normalizedValue >= rdYlGn[j].pos && normalizedValue <= rdYlGn[j + 1].pos) {
            lowerStop = rdYlGn[j]
            upperStop = rdYlGn[j + 1]
            break
          }
        }

        // Interpolate between the two stops
        const range = upperStop.pos - lowerStop.pos
        const t = range > 0 ? (normalizedValue - lowerStop.pos) / range : 0

        processedData[i] = Math.round(lowerStop.r + t * (upperStop.r - lowerStop.r))
        processedData[i + 1] = Math.round(lowerStop.g + t * (upperStop.g - lowerStop.g))
        processedData[i + 2] = Math.round(lowerStop.b + t * (upperStop.b - lowerStop.b))
        processedData[i + 3] = 255
        
        if (i % sampleRate === 0) {
          if (variIndex >= currentThreshold) {
            healthyCount++
          } else {
            stressedCount++
          }
          totalVari += variIndex
          minVari = Math.min(minVari, variIndex)
          maxVari = Math.max(maxVari, variIndex)
        }
      }
      
      // Store the analysis result
      const analysisImageData = ctx.createImageData(imageData)
      for (let i = 0; i < data.length; i++) {
        analysisImageData.data[i] = processedData[i]
      }
      analysisImageDataRef.current = analysisImageData
      
      // Put processed image on canvas
      ctx.putImageData(analysisImageData, 0, 0)
      
      // Log the actual threshold being used
      console.log('Processed with threshold:', threshold[0], 'Mode: Enhanced VARI')
      console.log('Black fabric pixels detected:', fabricCount)
      
      // Calculate statistics
      const totalPixels = Math.floor(data.length / 4 / sampleRate)
      const vegetationPixels = healthyCount + stressedCount
      const healthScore = vegetationPixels > 0 ? (healthyCount / vegetationPixels) * 100 : 0
      const meanVari = vegetationPixels > 0 ? totalVari / vegetationPixels : 0
      
      console.log('Analysis complete:', {
        healthScore: healthScore.toFixed(1),
        healthyPixels: healthyCount,
        stressedPixels: stressedCount,
        totalPixels: totalPixels,
        flowersDetected: flowersCount,
        blackFabricDetected: fabricCount,
        newGrowthDetected: newGrowthCount
      })
      
      setAnalysisResults({
        healthScore: healthScore.toFixed(1),
        meanVari: meanVari.toFixed(3),
        minVari: minVari.toFixed(3),
        maxVari: maxVari.toFixed(3),
        healthyPixels: healthyCount,
        stressedPixels: stressedCount,
        totalPixels: vegetationPixels,
        flowersDetected: flowersCount,
        blackFabricDetected: fabricCount,
        newGrowthDetected: newGrowthCount
      })
      
      setProcessing(false)
      setShowOriginal(false) // Show analysis after processing
      console.log('Processing complete')
    }
    
    // Check if image is already loaded
    if (img.complete && img.naturalWidth > 0) {
      processImageData()
    } else {
      img.onload = processImageData
    }
  }

  // Simple toggle function
  const toggleView = () => {
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    
    if (showOriginal && originalImageDataRef.current) {
      // Show original
      ctx.putImageData(originalImageDataRef.current, 0, 0)
    } else if (!showOriginal && analysisImageDataRef.current) {
      // Show analysis
      ctx.putImageData(analysisImageDataRef.current, 0, 0)
    }
  }

  // Call toggle when showOriginal changes
  useEffect(() => {
    if (analysisResults) {
      toggleView()
    }
  }, [showOriginal])

  const applyHistogramEqualization = (data: Uint8ClampedArray) => {
    // Calculate histogram
    const histogram = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      if (luminance >= 0 && luminance < 256) {
        histogram[luminance]++
      }
    }
    
    // Calculate CDF
    const cdf = new Array(256)
    cdf[0] = histogram[0]
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i]
    }
    
    // Normalize CDF
    const totalPixels = data.length / 4
    const normalizedCdf = cdf.map(val => Math.round((val / totalPixels) * 255))
    
    // Apply equalization
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      if (luminance >= 0 && luminance < 256 && luminance > 0) {
        const scale = normalizedCdf[luminance] / luminance
        data[i] = Math.min(255, Math.max(0, data[i] * scale))
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * scale))
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * scale))
      }
    }
  }

  const exportResults = () => {
    if (!canvasRef.current || !analysisResults) return
    
    // Export processed image
    canvasRef.current.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `plant-health-analysis-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(url)
    })
    
    // Export JSON results
    const jsonResults = {
      timestamp: new Date().toISOString(),
      plantType,
      threshold: threshold[0],
      results: analysisResults,
      settings: {
        histogramEqualization: applyHistEq,
        filteringEnabled: plantConfigs[plantType].filterFlowers || plantConfigs[plantType].filterFabric
      }
    }
    
    const jsonBlob = new Blob([JSON.stringify(jsonResults, null, 2)], { type: 'application/json' })
    const jsonUrl = URL.createObjectURL(jsonBlob)
    const jsonLink = document.createElement('a')
    jsonLink.href = jsonUrl
    jsonLink.download = `plant-health-results-${Date.now()}.json`
    jsonLink.click()
    URL.revokeObjectURL(jsonUrl)
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Plant Health Analysis</h1>
        <p className="text-gray-600">
          Analyze aerial imagery to assess plant health using enhanced VARI algorithms
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <div className="lg:col-span-1 space-y-4">
          {/* Image Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Image Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="image-upload">Upload Aerial Image</Label>
                <Input
                  id="image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="mt-2"
                />
              </div>
              
              {selectedImage && (
                <div className="text-sm text-green-600">
                  ✓ Image loaded
                </div>
              )}
            </CardContent>
          </Card>

          {/* Plant Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Analysis Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Plant Type</Label>
                <Select value={plantType} onValueChange={setPlantType}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-200 shadow-lg">
                    {Object.entries(plantConfigs).map(([key, config]) => (
                      <SelectItem key={key} value={key} className="hover:bg-gray-50">
                        <div>
                          <div className="font-medium">{config.name}</div>
                          <div className="text-xs text-gray-500">{config.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {plantConfigs[plantType].filterFlowers && (
                  <div className="mt-2 text-xs text-blue-600 flex items-center">
                    <Flower className="w-3 h-3 mr-1" />
                    Flower filtering enabled
                  </div>
                )}
                {plantConfigs[plantType].filterFabric && (
                  <div className="mt-1 text-xs text-gray-600 flex items-center">
                    <Layers className="w-3 h-3 mr-1" />
                    Black fabric filtering enabled
                  </div>
                )}
              </div>

              <div>
                <Label>
                  Health Threshold: {threshold[0].toFixed(2)}
                </Label>
                <Slider
                  value={threshold}
                  onValueChange={(newValue) => {
                    setThreshold(newValue)
                    // Re-process image with new threshold if we have results
                    if (analysisResults && selectedImage) {
                      console.log('Threshold changed to:', newValue[0])
                      setShowOriginal(false)
                      // Small delay to ensure state updates
                      setTimeout(() => processImage(), 100)
                    }
                  }}
                  min={-1}
                  max={1}
                  step={0.01}
                  className="mt-2"
                />
                <div className="text-xs text-gray-500 mt-2 space-y-1">
                  <p>• <strong>Lower threshold</strong> (-1 to 0): More areas marked as healthy</p>
                  <p>• <strong>Higher threshold</strong> (0 to 1): More strict, more areas marked as stressed</p>
                  <p>• Default: {plantConfigs[plantType].variThreshold.toFixed(2)} for {plantConfigs[plantType].name}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="hist-eq"
                  checked={applyHistEq}
                  onChange={(e) => {
                    setApplyHistEq(e.target.checked)
                    // Re-process with new histogram setting
                    if (analysisResults && selectedImage) {
                      console.log('Histogram equalization:', e.target.checked ? 'ON' : 'OFF')
                      setShowOriginal(false)
                      setTimeout(() => processImage(), 100)
                    }
                  }}
                  className="rounded"
                />
                <Label htmlFor="hist-eq" className="text-sm cursor-pointer">
                  Apply Histogram Equalization
                  <span className="text-xs text-gray-500 block">
                    Improves contrast in varying light
                  </span>
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardContent className="pt-6 space-y-2">
              <Button 
                onClick={() => {
                  console.log('Analyze button clicked')
                  setShowOriginal(false)  // Make sure we process the analysis
                  processImage()
                }}
                disabled={!selectedImage || processing}
                className="w-full bg-green-700 hover:bg-green-800 text-white"
              >
                {processing ? (
                  <>
                    <RotateCw className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4 mr-2" />
                    Analyze Health
                  </>
                )}
              </Button>

              {analysisResults && (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowOriginal(!showOriginal)}
                  >
                    {showOriginal ? (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        Show Analysis
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4 mr-2" />
                        Show Original
                      </>
                    )}
                  </Button>
                  
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={exportResults}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Results
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Results with Visual Indicator */}
          {analysisResults && (
            <Card>
              <CardHeader>
                <CardTitle>Analysis Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Health Score with Visual Bar */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Health Score</span>
                      <span className={`font-bold ${
                        parseFloat(analysisResults.healthScore) > 70 ? 'text-green-600' :
                        parseFloat(analysisResults.healthScore) > 40 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {analysisResults.healthScore}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all ${
                          parseFloat(analysisResults.healthScore) > 70 ? 'bg-green-600' :
                          parseFloat(analysisResults.healthScore) > 40 ? 'bg-yellow-600' :
                          'bg-red-600'
                        }`}
                        style={{ width: `${analysisResults.healthScore}%` }}
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Mean VARI</span>
                    <span className="font-mono text-sm">{analysisResults.meanVari}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">VARI Range</span>
                    <span className="font-mono text-sm">
                      [{analysisResults.minVari}, {analysisResults.maxVari}]
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Vegetation Pixels</span>
                    <span className="text-sm">
                      {analysisResults.healthyPixels.toLocaleString()} / {analysisResults.totalPixels.toLocaleString()}
                    </span>
                  </div>

                  {/* Filtered Elements Count */}
                  {(analysisResults.flowersDetected > 0 || 
                    analysisResults.blackFabricDetected > 0 || 
                    analysisResults.newGrowthDetected > 0) && (
                    <div className="pt-3 border-t">
                      <div className="text-xs text-gray-600 mb-2">Filtered Elements:</div>
                      <div className="space-y-1">
                        {analysisResults.flowersDetected > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="flex items-center">
                              <Flower className="w-3 h-3 mr-1 text-pink-500" />
                              Flowers
                            </span>
                            <span>{analysisResults.flowersDetected.toLocaleString()} pixels</span>
                          </div>
                        )}
                        {analysisResults.blackFabricDetected > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="flex items-center">
                              <Layers className="w-3 h-3 mr-1 text-gray-600" />
                              Black Fabric
                            </span>
                            <span>{analysisResults.blackFabricDetected.toLocaleString()} pixels</span>
                          </div>
                        )}
                        {analysisResults.newGrowthDetected > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="flex items-center">
                              <Zap className="w-3 h-3 mr-1 text-yellow-600" />
                              New Growth
                            </span>
                            <span>{analysisResults.newGrowthDetected.toLocaleString()} pixels</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Threshold Impact Indicator */}
                  <div className="pt-3 border-t">
                    <div className="text-xs text-gray-600 mb-2">Threshold Impact:</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="text-center">
                        <div className="font-semibold text-gray-700">Low (-0.5)</div>
                        <div className="text-gray-500">More lenient</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-green-600">Current ({threshold[0].toFixed(2)})</div>
                        <div className="text-gray-500">Your setting</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-gray-700">High (0.5)</div>
                        <div className="text-gray-500">More strict</div>
                      </div>
                    </div>
                  </div>
                </div>

                {parseFloat(analysisResults.healthScore) < 50 && (
                  <Alert className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Significant stress detected. Consider investigating affected areas.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Image Display with Zoom Controls */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Image Analysis</CardTitle>
                <div className="flex gap-2 items-center">
                  {/* Zoom Controls */}
                  {selectedImage && (
                    <div className="flex gap-1 mr-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleZoomOut}
                        disabled={zoomLevel <= 0.5}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleResetZoom}
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleZoomIn}
                        disabled={zoomLevel >= 5}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-gray-600 ml-2">
                        {Math.round(zoomLevel * 100)}%
                      </span>
                    </div>
                  )}
                  <Badge variant="default">
                    Enhanced VARI
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div 
  ref={containerRef}
  className="relative bg-gray-100 rounded-lg overflow-hidden"
  style={{ 
    minHeight: '500px',
    cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
    touchAction: 'none' // Prevents touch scrolling
  }}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
  onMouseLeave={handleMouseUp}
  // Add this to prevent the browser's default scroll behavior
  onTouchMove={(e) => e.preventDefault()}
>
                {selectedImage ? (
                  <div
  style={{
    transform: `scale(${zoomLevel}) translate(${panPosition.x}px, ${panPosition.y}px)`,
    transformOrigin: 'center',
    transition: 'none' // Always none for smooth real-time updates
  }}
>
                    <img
                      ref={imageRef}
                      src={selectedImage}
                      alt="Original"
                      className={showOriginal && !analysisResults ? "w-full h-auto" : "hidden"}
                      crossOrigin="anonymous"
                      style={{ maxWidth: '100%' }}
                      onLoad={() => {
                        console.log('Image loaded in img element')
                      }}
                      onError={(e) => {
                        console.error('Image failed to load:', e)
                      }}
                    />
                    <canvas
                      ref={canvasRef}
                      className={!showOriginal || analysisResults ? "w-full h-auto" : "hidden"}
                      style={{ maxWidth: '100%', display: !showOriginal || analysisResults ? 'block' : 'none' }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[500px] text-gray-400">
                    <ImageIcon className="w-16 h-16 mb-4" />
                    <p>Upload an aerial image to begin analysis</p>
                  </div>
                )}
                
                {/* Zoom Instructions */}
                {selectedImage && zoomLevel > 1 && (
                  <div className="absolute top-2 left-2 bg-white/90 p-2 rounded shadow-sm text-xs">
                    <div className="flex items-center gap-1">
                      <Move className="w-3 h-3" />
                      <span>Drag to pan • Scroll to zoom</span>
                    </div>
                  </div>
                )}
                
                {/* Legend */}
                {analysisResults && !showOriginal && (
                  <div className="absolute bottom-4 right-4 bg-white/95 p-4 rounded-lg shadow-lg">
                    <div className="text-sm font-semibold mb-3">
                      RdYlGn VARI Scale
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium mb-2">Vegetation Health:</div>
                      {/* RdYlGn Gradient Bar */}
                      <div className="w-full h-4 rounded shadow" style={{
                        background: 'linear-gradient(to right, #a50026, #d73027, #f46d43, #fdae61, #fee08b, #ffffbf, #d9ef8b, #a6d96a, #66bd63, #1a9850, #006837)'
                      }}></div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Stressed</span>
                        <span>Healthy</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#006837' }}></div>
                        <span className="text-xs font-medium">Very Healthy (+0.4)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#66bd63' }}></div>
                        <span className="text-xs">Healthy (&gt;{threshold[0].toFixed(2)})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#ffffbf' }}></div>
                        <span className="text-xs">Borderline</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#fdae61' }}></div>
                        <span className="text-xs">Stressed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#a50026' }}></div>
                        <span className="text-xs">Severe Stress (-0.4)</span>
                      </div>
                      
                      {(plantConfigs[plantType].filterFlowers || plantConfigs[plantType].filterFabric) && (
                        <>
                          <div className="text-xs font-medium mt-3 mb-2 pt-2 border-t">Filtered Elements:</div>
                          {plantConfigs[plantType].filterFlowers && (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#FFC0CB' }}></div>
                                <span className="text-xs">Flowers (ignored)</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#FFF5BA' }}></div>
                                <span className="text-xs">New Growth (neutral)</span>
                              </div>
                            </>
                          )}
                          {plantConfigs[plantType].filterFabric && (
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded shadow" style={{ backgroundColor: '#323232' }}></div>
                              <span className="text-xs">Black Fabric (ignored)</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    
                    {plantType !== 'green-foliage' && (
                      <div className="mt-3 pt-3 border-t text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <Info className="w-3 h-3" />
                          <span>Mode: {plantConfigs[plantType].name}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Info Panel */}
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Enhanced VARI Analysis</strong>
                    <p className="text-xs mt-1">
                      Filters out flowers, new growth, and black fabric for accurate foliage health assessment.
                    </p>
                  </AlertDescription>
                </Alert>
                
                <Alert>
                  <BarChart className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Nursery Mode Active</strong>
                    <p className="text-xs mt-1">
                      Optimized for production nurseries with mixed vegetation and ground covers.
                    </p>
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}