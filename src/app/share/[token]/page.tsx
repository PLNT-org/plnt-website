'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Lock } from 'lucide-react'
import type { SharedPropertyData } from '@/components/shared-property-map'

const SharedPropertyMap = dynamic(() => import('@/components/shared-property-map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  ),
})

function formatFlightDate(date: string | null): string {
  if (!date) return 'Survey'
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function SharePage() {
  const params = useParams()
  const urlToken = Array.isArray(params.token) ? params.token[0] : params.token

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<SharedPropertyData | null>(null)
  // Which location (share token) is currently open — starts at the URL's token.
  const [currentToken, setCurrentToken] = useState<string>(urlToken as string)
  // Which flight (date) within the current location is selected.
  const [selectedFlightKey, setSelectedFlightKey] = useState<string>('')

  // Open a location: redeem its email gate and load its layers. The same email
  // is authorized for every location in the dropdown, so this passes for each.
  const loadShare = async (tok: string, opts: { switching?: boolean; flightKey?: string } = {}) => {
    if (!email.trim()) return
    opts.switching ? setSwitching(true) : setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/share/${tok}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Unable to open this survey.')
        return
      }
      setData(body)
      setCurrentToken(tok)
      setSelectedFlightKey(opts.flightKey ?? body.flights?.[0]?.key ?? '')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      setSwitching(false)
    }
  }

  // Pick a parcel + date from its dropdown. Same parcel = swap date; different
  // parcel = load it (and jump straight to the chosen date).
  const pickFlight = (tok: string, flightKey: string) => {
    if (tok === currentToken) setSelectedFlightKey(flightKey)
    else loadShare(tok, { switching: true, flightKey })
  }

  const submit = () => loadShare(urlToken as string)

  if (data) {
    // The selected flight supplies the imagery; boundaries/inventory come from the parcel.
    const flights = data.flights || []
    const selectedFlight = flights.find((f) => f.key === selectedFlightKey) || flights[0]
    const mapData: SharedPropertyData = selectedFlight
      ? { ...data, bounds: selectedFlight.bounds, layers: selectedFlight.layers }
      : data

    return (
      <div className="fixed inset-0 flex flex-col">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 bg-[#0f2e1d] text-white shrink-0 border-b border-black/20">
          {/* Left: location title + client (where the logo used to be) */}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold leading-tight truncate">{data.title}</h1>
            {data.client_name && (
              <p className="text-[11px] sm:text-xs text-green-200/80 truncate">{data.client_name}</p>
            )}
          </div>
          {/* Center: brand */}
          <Image
            src="/images/plnt-logo-darkbg.svg"
            alt="PLNT"
            width={90}
            height={30}
            className="h-6 w-auto"
            priority
          />
          {/* Right: one labeled date dropdown per parcel */}
          <div className="justify-self-end min-w-0 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {switching && <Loader2 className="h-4 w-4 animate-spin text-green-200 shrink-0" />}
            {(data.locations || []).map((loc) => {
              const isActive = loc.token === currentToken
              return (
                <div key={loc.token} className="flex items-center gap-1.5">
                  <span
                    className={`text-[11px] truncate max-w-[7rem] ${isActive ? 'text-green-100 font-medium' : 'text-green-200/70'}`}
                  >
                    {loc.title}
                  </span>
                  <select
                    value={isActive ? selectedFlight?.key ?? '' : ''}
                    onChange={(e) => pickFlight(loc.token, e.target.value)}
                    disabled={switching}
                    aria-label={`${loc.title} flight date`}
                    className={`max-w-[9rem] truncate rounded-md bg-white/10 text-green-50 text-xs sm:text-sm px-2 py-1.5 border focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-60 ${isActive ? 'border-green-400/70' : 'border-white/20'}`}
                  >
                    {!isActive && (
                      <option value="" disabled>
                        Select date…
                      </option>
                    )}
                    {(loc.flights || []).map((f) => (
                      <option key={f.key} value={f.key} className="text-gray-900">
                        {formatFlightDate(f.date)}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </header>
        <div className="flex-1 relative">
          <SharedPropertyMap
            key={`${currentToken}:${selectedFlight?.key ?? ''}`}
            data={mapData}
            token={currentToken}
            viewerEmail={email.trim().toLowerCase()}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-center mb-5">
          <Image
            src="/images/plnt-logo.svg"
            alt="PLNT"
            width={150}
            height={50}
            className="h-12 w-auto"
            priority
          />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mt-4">View property survey</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">
          Enter your email to access this drone survey. Access is limited to authorized addresses.
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <Button
          onClick={submit}
          disabled={loading || !email.trim()}
          className="w-full mt-4 bg-green-600 hover:bg-green-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Lock className="h-4 w-4 mr-2" />
              View survey
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
