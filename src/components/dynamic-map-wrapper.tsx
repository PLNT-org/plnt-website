// For any map component that uses Leaflet (enhanced-satellite-map.tsx, real-satellite-map.tsx, etc.)
// Wrap the component with dynamic import to prevent server-side rendering

// Create a new file: components/dynamic-map-wrapper.tsx
'use client'

import dynamic from 'next/dynamic'

// Dynamically import map components with no SSR
export const EnhancedSatelliteMap = dynamic(
  () => import('./enhanced-satellite-map'),
  { 
    ssr: false,
    loading: () => <div className="h-[700px] w-full rounded-lg bg-gray-100 animate-pulse flex items-center justify-center">
      <p className="text-gray-500">Loading map...</p>
    </div>
  }
)

export const RealSatelliteMap = dynamic(
  () => import('./real-satellite-map'),
  { 
    ssr: false,
    loading: () => <div className="h-[400px] w-full rounded-lg bg-gray-100 animate-pulse flex items-center justify-center">
      <p className="text-gray-500">Loading map...</p>
    </div>
  }
)

export const FlightPathPreviewMap = dynamic(
  () => import('./flight-path-preview-map'),
  {
    ssr: false,
    loading: () => <div className="h-[400px] w-full rounded-lg bg-gray-100 animate-pulse flex items-center justify-center">
      <p className="text-gray-500">Loading flight path...</p>
    </div>
  }
)

export const PlotBoundaryMap = dynamic(
  () => import('./plot-boundary-map'),
  {
    ssr: false,
    loading: () => <div className="h-[500px] w-full rounded-lg bg-gray-100 animate-pulse flex items-center justify-center">
      <p className="text-gray-500">Loading map...</p>
    </div>
  }
)