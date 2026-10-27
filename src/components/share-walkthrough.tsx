'use client'

// Guided walkthrough of a gated share: a card that steps the viewer through a
// list of places (hand-counted blocks with the survey count beside the ground
// truth) and then through the inventory. The map component owns the camera,
// the highlight layer and the inventory drawer; this card only renders the
// step and asks for the next/previous one.
//
// The step list is `tour.json` in the share's storage folder, signed by the
// access route (`tourUrl`). A share without that file has no walkthrough.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Footprints, X } from 'lucide-react'

export interface TourStep {
  // info: a how-to step that only points at controls; summary: a results card computed from
  // the tour's block steps (hand count vs flight, average error)
  kind: 'block' | 'inventory' | 'info' | 'summary'
  title: string
  note?: string
  // block steps
  bounds?: { north: number; south: number; east: number; west: number }
  polygon?: { type: 'Polygon'; coordinates: number[][][] }
  ours?: number
  truth?: number | null
  diff_pct?: number
  // Ask the viewer to check this step's flight count; their answer is sent as a
  // work order (task 'other') so PLNT sees it in the Orders list.
  verify?: { prompt: string; bay_ref?: string }
  // Red "click here" tabs on real controls (elements tagged data-tour="<target>").
  // When `advance` is set, clicking that control moves the walkthrough on.
  point?: TourPoint[]
  // inventory steps: what the map should do when the step opens
  action?: 'open' | 'expand' | 'export'
  // for 'expand': the block number to open and fly to
  block?: number
  // Pills mode: move on by itself when the viewer has already done this step
  // (`skip_if` is on screen) or when its result appears (`next_when` is on screen),
  // and go back to step `return_to` when its controls vanish (e.g. a drawing cancelled).
  skip_if?: string
  next_when?: string
  return_to?: number
  // Pills mode: a dashed outline (GeoJSON polygon, lng/lat) for the viewer to trace while drawing;
  // drawing clicks near its corners snap onto them.
  guide?: { type: 'Polygon'; coordinates: number[][][] }
  // Cards mode: false hides this step's card and leaves only its pills and the progress chip
  // (e.g. once the inventory is open, so the card doesn't cover the block it zooms to).
  card?: boolean
}

export interface TourPoint {
  target: string // data-tour value, e.g. 'inventory-button', 'inv-block-200', 'download', 'add-remove'
  label: string
  advance?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left' // where the pill sits; default above (below when no room)
}

export interface Tour {
  title: string
  intro?: string
  steps: TourStep[]
  // When set, the inventory lists only these block numbers (the hand-counted ones).
  inventory_blocks?: number[]
  // Species shown on inventory lines for blocks with no species drawn (e.g. "Test Blocks").
  inventory_species?: string
  // 'pills': no step cards; each step is only its pills (with arrows) on the controls to use,
  // plus a small progress chip. 'cards' (default): the step card with Back/Next.
  mode?: 'cards' | 'pills'
  // Species suggestions for this link (e.g. the grower's catalog), offered before the general list.
  species_list?: string[]
  // Greeting on the intro card by the viewer's email, e.g. {"andrewc@…": "Andrew"} -> "Welcome, Andrew".
  viewer_names?: Record<string, string>
}

export function ShareWalkthrough({
  tour,
  step,
  onStep,
  onClose,
  onVerify,
  dock = 'center',
  viewerEmail,
}: {
  tour: Tour
  step: number // -1 = intro
  onStep: (n: number) => void
  onClose: () => void
  // Sends the viewer's check of a step's count: null = "looks right", a number = their own count.
  onVerify?: (step: TourStep, count: number | null) => Promise<void>
  // 'left' moves the card out of the middle of the screen (e.g. while the plot form is open there).
  dock?: 'center' | 'left'
  viewerEmail?: string
}) {
  const viewerName = viewerEmail ? tour.viewer_names?.[viewerEmail.trim().toLowerCase()] : undefined
  const total = tour.steps.length
  const current = step >= 0 ? tour.steps[step] : null
  const last = step >= total - 1

  return (
    <div
      className={`absolute top-14 z-[1200] w-[min(24rem,calc(100%-1.5rem))] rounded-xl bg-white shadow-xl border border-gray-200 ${
        dock === 'left' ? 'left-3' : 'left-1/2 -translate-x-1/2'
      }`}
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
            {/* No hand count: the flight count is the number to look at, on its own. */}
            {current.kind === 'summary' && <TourSummary tour={tour} />}
            {current.kind === 'block' && typeof current.ours === 'number' && typeof current.truth !== 'number' && (
              <div className="mt-2 rounded-lg bg-[#0f2e1d] px-3 py-2 text-white">
                <div className="text-[10px] uppercase tracking-wide text-green-200/80">From the flight</div>
                <div className="text-lg font-semibold tabular-nums">{current.ours.toLocaleString()}</div>
              </div>
            )}
            {current.kind === 'block' && typeof current.ours === 'number' && typeof current.truth === 'number' && (
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
            {current.verify && onVerify && <VerifyBox key={step} step={current} onVerify={onVerify} />}
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-gray-900">
              {tour.viewer_names ? (viewerName ? `Welcome, ${viewerName}` : 'Welcome') : tour.title}
            </h2>
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

// Asks the viewer to check a step's flight count on the ground: "Looks right",
// or their own number. Keyed by step, so it starts empty on each visit.
function VerifyBox({ step, onVerify }: { step: TourStep; onVerify: (step: TourStep, count: number | null) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const send = async (count: number | null) => {
    setState('sending')
    setMsg('')
    try {
      await onVerify(step, count)
      setState('sent')
      setMsg(count == null ? 'Thanks. We noted that the count looks right.' : `Thanks. We noted your count of ${count.toLocaleString()}.`)
    } catch (e) {
      setState('error')
      setMsg((e instanceof Error && e.message) || 'Could not send. Please try again.')
    }
  }
  const n = Number.parseInt(value, 10)
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-sm font-medium text-gray-900">{step.verify!.prompt}</p>
      {state === 'sent' ? (
        <p className="mt-1.5 text-sm text-green-800">{msg}</p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Your count"
              aria-label="Your count"
              className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm tabular-nums"
            />
            <button
              onClick={() => send(n)}
              disabled={!valid || state === 'sending'}
              className="rounded-md bg-[#0f2e1d] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Send count
            </button>
            <button
              onClick={() => send(null)}
              disabled={state === 'sending'}
              className="ml-auto rounded-md px-2 py-1.5 text-sm text-[#0f2e1d] hover:bg-amber-100 disabled:opacity-40"
            >
              Looks right
            </button>
          </div>
          {msg && <p className="mt-1.5 text-xs text-red-700">{msg}</p>}
        </>
      )}
    </div>
  )
}

// Red pill tabs that sit on the control the viewer should click next, like a
// guided product demo. Each follows its target element (re-measured on a short
// timer, which keeps running when the tab is in the background, unlike
// requestAnimationFrame) and hides while the target is missing. Clicking the pill
// clicks the control itself.
// A map shape is an SVG path, which has no click(): send it a click at its centre instead.
function clickTarget(el: Element | null) {
  if (!el) return
  if (el instanceof HTMLElement) return el.click()
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
}

export function TourPointers({ points, root }: { points: TourPoint[]; root: HTMLElement | null }) {
  const [boxes, setBoxes] = useState<({ x: number; y: number; w: number; h: number } | null)[]>([])
  // The map's size and each pill's own size, so a pill can be kept inside the screen.
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const pillEls = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (!root) return
    const tick = () => {
      const r = root.getBoundingClientRect()
      setFrame((f) => (f.w === r.width && f.h === r.height ? f : { w: r.width, h: r.height }))
      setBoxes((prev) => {
        const next = points.map((p) => {
          const el = root.querySelector(`[data-tour="${p.target}"]`) as HTMLElement | null
          if (!el) return null
          const b = el.getBoundingClientRect()
          if (b.width === 0 && b.height === 0) return null
          return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height }
        })
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
      })
      setSizes((prev) => {
        const next = points.map((_, i) => ({ w: pillEls.current[i]?.offsetWidth ?? 0, h: pillEls.current[i]?.offsetHeight ?? 0 }))
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
      })
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [points, root])

  const M = 8 // gap kept between a pill and the edge of the screen
  return (
    <>
      {points.map((p, i) => {
        const b = boxes[i]
        if (!b) return null
        const pw = sizes[i]?.w || 200
        const ph = sizes[i]?.h || 24
        const clampX = (x: number) => Math.max(M, Math.min(x, frame.w - pw - M))
        const clampY = (y: number) => Math.max(M, Math.min(y, frame.h - ph - M))
        // Pill above the control (below when there is no room), or beside it; the whole pill
        // is then pushed back inside the screen, while its arrow stays on the control.
        const side = p.side ?? (b.y > 48 ? 'top' : 'bottom')
        const pos =
          side === 'right'
            ? { left: clampX(b.x + b.w + 18), top: clampY(b.y + b.h / 2 - ph / 2) }
            : side === 'left'
            ? { left: clampX(b.x - 18 - pw), top: clampY(b.y + b.h / 2 - ph / 2) }
            : { left: clampX(b.x + b.w / 2 - pw / 2), top: clampY(side === 'top' ? b.y - ph - 12 : b.y + b.h + 12) }
        return (
          <div key={p.target} className="pointer-events-none absolute inset-0 z-[1250]">
            <div
              className="absolute rounded-md ring-2 ring-[#e5484d] ring-offset-2 animate-pulse"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
            />
            {/* arrow from the pill to the control */}
            <span
              className="absolute h-0 w-0 border-transparent"
              style={
                side === 'right'
                  ? { left: b.x + b.w + 2, top: b.y + b.h / 2 - 6, borderWidth: '6px 8px 6px 0', borderRightColor: '#e5484d' }
                  : side === 'left'
                  ? { left: b.x - 10, top: b.y + b.h / 2 - 6, borderWidth: '6px 0 6px 8px', borderLeftColor: '#e5484d' }
                  : side === 'top'
                  ? { left: b.x + b.w / 2 - 6, top: b.y - 10, borderWidth: '8px 6px 0 6px', borderTopColor: '#e5484d' }
                  : { left: b.x + b.w / 2 - 6, top: b.y + b.h + 2, borderWidth: '0 6px 8px 6px', borderBottomColor: '#e5484d' }
              }
            />
            <button
              ref={(el) => {
                pillEls.current[i] = el
              }}
              onClick={() => clickTarget(root?.querySelector(`[data-tour="${p.target}"]`) ?? null)}
              className="pointer-events-auto absolute w-max rounded-2xl bg-[#e5484d] px-3 py-1 text-xs font-semibold leading-snug text-white shadow-lg hover:bg-[#d13c41]"
              style={{ ...pos, maxWidth: Math.min(288, Math.max(160, frame.w - 2 * M)) }}
            >
              {p.label}
            </button>
          </div>
        )
      })}
    </>
  )
}

// Pills mode: the only fixed piece of the tour, a small chip with the step count
// and a way out (the pills themselves carry the instructions).
export function TourChip({ step, total, onClose }: { step: number; total: number; onClose: () => void }) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1250] flex items-center gap-2 rounded-full bg-[#0f2e1d] px-3 py-1 text-xs text-white shadow-lg">
      <Footprints className="h-3.5 w-3.5 text-green-300" />
      <span className="tabular-nums">Quick tour {step + 1} of {total}</span>
      <button onClick={onClose} className="ml-1 text-green-200 hover:text-white" title="End the tour" aria-label="End the tour">
        Skip <X className="inline h-3 w-3" />
      </button>
    </div>
  )
}

// Results card: every block step with a hand count, the flight count beside it, and the
// average error across them (the mean of the per-block differences, ignoring sign).
function TourSummary({ tour }: { tour: Tour }) {
  const rows = tour.steps.filter(
    (st) => st.kind === 'block' && typeof st.ours === 'number' && typeof st.truth === 'number' && st.truth > 0
  )
  if (!rows.length) return null
  const pct = (st: TourStep) => ((st.ours! - st.truth!) / st.truth!) * 100
  const meanAbs = rows.reduce((a, st) => a + Math.abs(pct(st)), 0) / rows.length
  const hand = rows.reduce((a, st) => a + st.truth!, 0)
  const flight = rows.reduce((a, st) => a + st.ours!, 0)
  // Rounded first, so a difference under 0.05% reads "0.0%" rather than "-0.0%".
  const fmtPct = (v: number) => {
    const r = Math.round(v * 10) / 10
    return r === 0 ? '0.0%' : `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
  }
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[#0f2e1d] px-3 py-2 text-white">
          <div className="text-[10px] uppercase tracking-wide text-green-200/80">Average margin of error</div>
          <div className="text-lg font-semibold tabular-nums">{meanAbs.toFixed(1)}%</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">All {rows.length} blocks</div>
          <div className="text-sm font-semibold tabular-nums text-gray-900">
            {flight.toLocaleString()} vs {hand.toLocaleString()} by hand
          </div>
          <div className="text-xs tabular-nums text-gray-500">{fmtPct(((flight - hand) / hand) * 100)}</div>
        </div>
      </div>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left font-medium py-0.5">Block</th>
            <th className="text-right font-medium">By hand</th>
            <th className="text-right font-medium">Flight</th>
            <th className="text-right font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((st) => (
            <tr key={st.title} className="border-t border-gray-100">
              <td className="py-0.5 text-gray-800">{st.title.replace(/,.*$/, '')}</td>
              <td className="text-right text-gray-700">{st.truth!.toLocaleString()}</td>
              <td className="text-right text-gray-700">{st.ours!.toLocaleString()}</td>
              <td className="text-right text-gray-700">{fmtPct(pct(st))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
