'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Leaf, Lock } from 'lucide-react'
import type { SharedPropertyData } from '@/components/shared-property-map'

const SharedPropertyMap = dynamic(() => import('@/components/shared-property-map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  ),
})

export default function SharePage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : params.token

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<SharedPropertyData | null>(null)

  const submit = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/share/${token}/access`, {
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
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (data) {
    return (
      <div className="fixed inset-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 py-2.5 bg-[#0f2e1d] text-white shrink-0 border-b border-black/20">
          <div className="flex items-center gap-1.5 shrink-0">
            <Leaf className="h-5 w-5 text-green-300" />
            <span className="font-semibold tracking-wider text-sm text-green-100">PLNT</span>
          </div>
          <div className="h-5 w-px bg-white/15 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-base font-semibold leading-tight truncate">{data.title}</h1>
            {data.client_name && (
              <p className="text-[11px] sm:text-xs text-green-200/80 truncate">{data.client_name}</p>
            )}
          </div>
        </header>
        <div className="flex-1 relative">
          <SharedPropertyMap data={data} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Leaf className="h-6 w-6 text-green-600" />
          <span className="text-lg font-semibold text-gray-900">PLNT</span>
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
