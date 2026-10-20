'use client'

// Guided walkthrough of a gated share: a card that steps the viewer through a
// list of places (hand-counted blocks with the survey count beside the ground
// truth) and then through the inventory. The map component owns the camera,
// the highlight layer and the inventory drawer; this card only renders the
// step and asks for the next/previous one.
//
// The step list is `tour.json` in the share's storage folder, signed by the
// access route (`tourUrl`). A share without that file has no walkthrough.

import { ChevronLeft, ChevronRight, Footprints, X } from 'lucide-react'

export interface TourStep {
  kind: 'block' | 'inventory'
  title: string
  note?: string
  // block steps
  bounds?: { north: number; south: number; east: number; west: number }
  polygon?: { type: 'Polygon'; coordinates: number[][][] }
  ours?: number
  truth?: number | null
  diff_pct?: number
  // inventory steps: what the map should do when the step opens
  action?: 'open' | 'expand' | 'export'
  // for 'expand': the block number to open and fly to
  block?: number
}

export interface Tour {
  title: string
  intro?: string
  steps: TourStep[]
}

export function ShareWalkthrough({
  tour,
  step,
  onStep,
  onClose,
}: {
  tour: Tour
  step: number // -1 = intro
  onStep: (n: number) => void
  onClose: () => void
}) {
  const total = tour.steps.length
  const current = step >= 0 ? tour.steps[step] : null
  const last = step >= total - 1

  return (
    <div
      className="absolute top-14 left-1/2 -translate-x-1/2 z-[1200] w-[min(24rem,calc(100%-1.5rem))] rounded-xl bg-white shadow-xl border border-gray-200"
      role="dialog"
      aria-label={tour.title}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <Footprints className="h-4 w-4 text-[#0f2e1d] shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">
          {current ? `${step + 1} of ${total}` : tour.title}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-gray-400 hover:text-gray-700 p-1"
          title="Close the walkthrough"
          aria-label="Close the walkthrough"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3">
        {current ? (
          <>
            <h2 className="text-base font-semibold text-gray-900">{current.title}</h2>
            {current.kind === 'block' && typeof current.ours === 'number' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Counted by hand</div>
                  <div className="text-lg font-semibold tabular-nums text-gray-900">
                    {typeof current.truth === 'number' ? current.truth.toLocaleString() : '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-[#0f2e1d] px-3 py-2 text-white">
                  <div className="text-[10px] uppercase tracking-wide text-green-200/80">From the flight</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {current.ours.toLocaleString()}
                    {typeof current.diff_pct === 'number' && (
                      <span className="ml-1.5 text-xs font-normal text-green-200/80">
                        {current.diff_pct > 0 ? '+' : ''}
                        {current.diff_pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {current.note && <p className="mt-2 text-sm leading-snug text-gray-600">{current.note}</p>}
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-gray-900">{tour.title}</h2>
            {tour.intro && <p className="mt-2 text-sm leading-snug text-gray-600">{tour.intro}</p>}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100">
        {step >= 0 ? (
          <button
            onClick={() => onStep(step - 1)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <button onClick={onClose} className="rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
            Skip
          </button>
        )}
        <div className="ml-auto flex items-center gap-1" aria-hidden="true">
          {tour.steps.map((s, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-[#0f2e1d]' : i < step ? 'bg-green-500' : 'bg-gray-200'}`}
            />
          ))}
        </div>
        <button
          onClick={() => (last ? onClose() : onStep(step + 1))}
          className="ml-2 inline-flex items-center gap-1 rounded-md bg-[#0f2e1d] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#143d27]"
        >
          {step < 0 ? 'Start' : last ? 'Done' : 'Next'}
          {!last && <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
