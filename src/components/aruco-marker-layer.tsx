'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'

export interface ArUcoMarker {
  id: string
  marker_id: number
  latitude: number
  longitude: number
  pixel_x?: number
  pixel_y?: number
  confidence?: number
  rotation_deg?: number
  corner_coords?: number[][]
  verified: boolean
  // Species information from registration
  species_name?: string
  scientific_name?: string
  category?: string
  container_size?: string
  plot_name?: string
  registration_id?: string
}

interface ArUcoMarkerLayerProps {
  map: L.Map | null
  markers: ArUcoMarker[]
  visible: boolean
  onVerifyMarker?: (markerId: string, verified: boolean) => void
}

// Create a numbered ArUco marker icon with optional species label
const createArucoIcon = (markerId: number, verified: boolean, confidence?: number, speciesName?: string) => {
  const hasSpecies = !!speciesName
  const bgColor = hasSpecies ? '#10b981' : verified ? '#3b82f6' : '#f59e0b'  // Green if has species, blue if verified, amber if not
  const borderColor = hasSpecies ? '#059669' : verified ? '#2563eb' : '#d97706'
  const opacity = confidence ? Math.max(0.6, confidence) : 1

  // Truncate species name for display
  const displayName = speciesName ? (speciesName.length > 10 ? speciesName.substring(0, 9) + '…' : speciesName) : null

  return L.divIcon({
    className: 'aruco-marker-icon',
    html: `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        opacity: ${opacity};
      ">
        <div style="
          width: 32px;
          height: 32px;
          background: ${bgColor};
          border: 2px solid ${borderColor};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 12px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          ${markerId}
        </div>
        ${displayName ? `
          <div style="
            background: white;
            border: 1px solid ${borderColor};
            border-radius: 3px;
            padding: 2px 6px;
            margin-top: 2px;
            font-size: 10px;
            font-weight: 500;
            color: #374151;
            white-space: nowrap;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
          ">
            ${displayName}
          </div>
        ` : ''}
      </div>
    `,
    iconSize: [32, displayName ? 52 : 32],
    iconAnchor: [16, displayName ? 26 : 16],
    popupAnchor: [0, displayName ? -26 : -16],
  })
}

export default function ArUcoMarkerLayer({
  map,
  markers,
  visible,
  onVerifyMarker,
}: ArUcoMarkerLayerProps) {
  const layerRef = useRef<L.LayerGroup | null>(null)

  // Initialize layer group
  useEffect(() => {
    if (!map) return

    const layer = L.layerGroup()
    layerRef.current = layer

    if (visible) {
      layer.addTo(map)
    }

    return () => {
      layer.remove()
      layerRef.current = null
    }
  }, [map])

  // Toggle visibility
  useEffect(() => {
    if (!layerRef.current || !map) return

    if (visible) {
      layerRef.current.addTo(map)
    } else {
      layerRef.current.remove()
    }
  }, [visible, map])

  // Update markers
  useEffect(() => {
    if (!layerRef.current) return

    layerRef.current.clearLayers()

    if (!visible) return

    markers.forEach((marker) => {
      const leafletMarker = L.marker([marker.latitude, marker.longitude], {
        icon: createArucoIcon(marker.marker_id, marker.verified, marker.confidence, marker.species_name),
      })

      const confidenceText = marker.confidence
        ? `${Math.round(marker.confidence * 100)}%`
        : 'N/A'

      const popupContent = `
        <div style="min-width: 200px;">
          <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px;">
            ArUco Marker #${marker.marker_id}
          </div>

          ${marker.species_name ? `
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 8px; margin-bottom: 8px;">
              <div style="font-weight: 600; color: #065f46; font-size: 14px;">
                ${marker.species_name}
              </div>
              ${marker.scientific_name ? `
                <div style="font-style: italic; color: #047857; font-size: 12px;">
                  ${marker.scientific_name}
                </div>
              ` : ''}
              ${marker.category || marker.container_size ? `
                <div style="font-size: 11px; color: #059669; margin-top: 4px;">
                  ${[marker.category, marker.container_size].filter(Boolean).join(' • ')}
                </div>
              ` : ''}
            </div>
          ` : `
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 6px; padding: 8px; margin-bottom: 8px;">
              <div style="font-size: 12px; color: #92400e;">
                No species registered for this marker
              </div>
            </div>
          `}

          ${marker.plot_name ? `
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
              <strong>Plot:</strong> ${marker.plot_name}
            </div>
          ` : ''}
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            <strong>Status:</strong> ${marker.verified ? '✓ Verified' : '⏳ Unverified'}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            <strong>Confidence:</strong> ${confidenceText}
          </div>
          ${marker.rotation_deg !== undefined ? `
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
              <strong>Rotation:</strong> ${marker.rotation_deg.toFixed(1)}°
            </div>
          ` : ''}
          <div style="font-size: 11px; font-family: monospace; margin-bottom: 8px; color: #888;">
            ${marker.latitude.toFixed(6)}, ${marker.longitude.toFixed(6)}
          </div>
          ${onVerifyMarker ? `
            <div style="display: flex; gap: 8px;">
              ${!marker.verified ? `
                <button onclick="window.dispatchEvent(new CustomEvent('verify-aruco', {detail: {id: '${marker.id}', verified: true}}))"
                        style="padding: 4px 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  Verify
                </button>
              ` : `
                <button onclick="window.dispatchEvent(new CustomEvent('verify-aruco', {detail: {id: '${marker.id}', verified: false}}))"
                        style="padding: 4px 12px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  Unverify
                </button>
              `}
            </div>
          ` : ''}
        </div>
      `

      leafletMarker.bindPopup(popupContent)
      layerRef.current?.addLayer(leafletMarker)
    })
  }, [markers, visible, onVerifyMarker])

  // Listen for verify events from popups
  useEffect(() => {
    if (!onVerifyMarker) return

    const handleVerify = (e: CustomEvent<{ id: string; verified: boolean }>) => {
      onVerifyMarker(e.detail.id, e.detail.verified)
    }

    window.addEventListener('verify-aruco' as any, handleVerify)

    return () => {
      window.removeEventListener('verify-aruco' as any, handleVerify)
    }
  }, [onVerifyMarker])

  return null  // This component only manages the Leaflet layer
}
