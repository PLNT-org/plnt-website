'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { X, Save, Loader2, Info, Plane, Calendar, Settings } from 'lucide-react'

interface MapArea {
  id: number
  points: { x: number; y: number; lat: number; lng: number }[]
  area: string
  coordinates: any[]
  photoIntervalMeters?: number
  estimatedPhotos?: number
  missionType?: MissionType
  gimbalAngles?: number[]
}

type MissionType = 'orthomosaic' | '3d-model' | '3d-fast' | 'custom'

interface FlightPlannerSidebarProps {
  isOpen: boolean
  onClose: () => void
  isEditing: boolean
  // Form values
  name: string
  setName: (name: string) => void
  missionType: MissionType
  setMissionType: (type: MissionType) => void
  droneModel: string
  setDroneModel: (model: string) => void
  altitude: string
  setAltitude: (alt: string) => void
  speed: string
  setSpeed: (speed: string) => void
  overlap: string
  setOverlap: (overlap: string) => void
  scheduledDate: string
  setScheduledDate: (date: string) => void
  mapArea: MapArea | null
  // Actions
  onSave: () => void
  saving: boolean
  error: string
}

export function FlightPlannerSidebar({
  isOpen,
  onClose,
  isEditing,
  name,
  setName,
  missionType,
  setMissionType,
  droneModel,
  setDroneModel,
  altitude,
  setAltitude,
  speed,
  setSpeed,
  overlap,
  setOverlap,
  scheduledDate,
  setScheduledDate,
  mapArea,
  onSave,
  saving,
  error,
}: FlightPlannerSidebarProps) {
  if (!isOpen) return null

  return (
    <div className="absolute top-0 right-0 h-full w-96 bg-white shadow-xl z-[1001] flex flex-col border-l">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <Plane className="h-5 w-5 text-green-600" />
          <h2 className="font-semibold text-lg">
            {isEditing ? 'Edit Flight Plan' : 'New Flight Plan'}
          </h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div>
          <Label htmlFor="plan-name">Flight Plan Name *</Label>
          <Input
            id="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Weekly Survey - North Field"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="mission-type">Mission Type</Label>
          <Select value={missionType} onValueChange={(v: MissionType) => setMissionType(v)}>
            <SelectTrigger id="mission-type" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1100]">
              <SelectItem value="orthomosaic">Orthomosaic (2D)</SelectItem>
              <SelectItem value="3d-model">3D Model (Height Mapping)</SelectItem>
              <SelectItem value="3d-fast">3D Fast (Height Mapping)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {missionType === '3d-model' && (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800">
              <strong>3D Full (Height Mapping)</strong>
              <ul className="mt-2 space-y-1 list-disc list-inside text-xs">
                <li>Full cross-hatch: nadir + oblique perpendicular passes</li>
                <li>85% frontal overlap, 75% side overlap</li>
                <li>Best quality, longest flight time</li>
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {missionType === '3d-fast' && (
          <Alert className="bg-green-50 border-green-200">
            <Info className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-sm text-green-800">
              <strong>3D Fast (Height Mapping)</strong>
              <ul className="mt-2 space-y-1 list-disc list-inside text-xs">
                <li>Single-grid nadir + cross-hatch oblique</li>
                <li>~25% faster than full 3D mode</li>
                <li>Recommended for vegetation surveys</li>
              </ul>
            </AlertDescription>
          </Alert>
        )}


        {/* Drone Settings Section */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="h-4 w-4 text-gray-600" />
            <Label className="text-gray-700 font-medium">Drone Settings</Label>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="drone-model" className="text-sm">Drone Model</Label>
              <Select value={droneModel} onValueChange={setDroneModel}>
                <SelectTrigger id="drone-model" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[1100]">
                  <SelectItem value="DJI Mavic 3">DJI Mavic 3</SelectItem>
                  <SelectItem value="DJI Air 2S">DJI Air 2S</SelectItem>
                  <SelectItem value="DJI Mini 3 Pro">DJI Mini 3 Pro</SelectItem>
                  <SelectItem value="DJI Phantom 4">DJI Phantom 4</SelectItem>
                  <SelectItem value="Autel EVO II">Autel EVO II</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="altitude" className="text-sm">Flight Altitude (feet)</Label>
              <Input
                id="altitude"
                type="number"
                value={altitude}
                onChange={(e) => setAltitude(e.target.value)}
                min="50"
                max="400"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">100-150 ft recommended</p>
            </div>

            <div>
              <Label htmlFor="speed" className="text-sm">Flight Speed (ft/s)</Label>
              <Input
                id="speed"
                type="number"
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
                min="3"
                max="50"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">~16 ft/s recommended</p>
            </div>

            <div>
              <Label htmlFor="overlap" className="text-sm">Image Overlap (%)</Label>
              <Input
                id="overlap"
                type="number"
                value={overlap}
                onChange={(e) => setOverlap(e.target.value)}
                min="60"
                max="90"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">80% recommended</p>
            </div>
          </div>
        </div>

        {/* Schedule Section */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-gray-600" />
            <Label className="text-gray-700 font-medium">Schedule</Label>
          </div>
          <Input
            id="schedule"
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
        </div>

        {/* Flight Summary */}
        {mapArea && (
          <div className="border-t pt-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="font-medium text-green-800 mb-2">Flight Summary</h4>
              <div className="space-y-1 text-sm text-green-700">
                <p>Area: {mapArea.area}</p>
                <p>Waypoints: {mapArea.coordinates.length}</p>
                <p>Estimated Photos: {mapArea.estimatedPhotos || mapArea.coordinates.length}</p>
                {mapArea.photoIntervalMeters && (
                  <p className="font-medium">Photo Interval: {(mapArea.photoIntervalMeters * 3.28084).toFixed(1)} ft</p>
                )}
                <p>Est. Duration: {Math.round(mapArea.coordinates.length * 0.3)} min</p>
              </div>
              {mapArea.photoIntervalMeters && (
                <div className="mt-3 pt-3 border-t border-green-200">
                  <p className="text-xs text-green-600">
                    Export as Litchi CSV for Maven EVO - camera triggers included
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Mission Tips</h4>
          <ul className="space-y-1 text-xs text-gray-600">
            <li>Check weather conditions before flying</li>
            <li>Ensure batteries are fully charged</li>
            <li>Verify GPS signal strength</li>
            <li>Maintain visual line of sight</li>
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-gray-50 space-y-2">
        <Button
          onClick={onSave}
          disabled={saving || !name || !mapArea}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isEditing ? 'Update' : 'Save'} Flight Plan
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
