'use client'

import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, Share2, Copy, Loader2, Check, X, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface LookedUpUser {
  id: string
  email: string
}

interface Orthomosaic {
  id: string
  name: string
  status: string
  created_at: string
}

interface Species {
  id: string
  name: string
  scientific_name: string | null
  category: string | null
  container_size: string | null
}

interface Share {
  id: string
  orthomosaic_id: string
  shared_with_user_id: string
  created_at: string
}

export default function AdminSharePage() {
  const [email, setEmail] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [targetUser, setTargetUser] = useState<LookedUpUser | null>(null)

  const [orthomosaics, setOrthomosaics] = useState<Orthomosaic[]>([])
  const [species, setSpecies] = useState<Species[]>([])
  const [existingShares, setExistingShares] = useState<Share[]>([])

  const [selectedOrthos, setSelectedOrthos] = useState<Set<string>>(new Set())
  const [selectedSpecies, setSelectedSpecies] = useState<Set<string>>(new Set())

  const [sharingOrtho, setSharingOrtho] = useState(false)
  const [copyingSpecies, setCopyingSpecies] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const lookupUser = async () => {
    if (!email.trim()) return
    setLookupLoading(true)
    setLookupError('')
    setTargetUser(null)

    try {
      const res = await authFetch(`/api/admin/users/lookup?email=${encodeURIComponent(email.trim())}`)
      if (!res.ok) {
        const data = await res.json()
        setLookupError(data.error || 'User not found')
        return
      }
      const user = await res.json()
      setTargetUser(user)
      // Load data once user is found
      await loadData(user.id)
    } catch {
      setLookupError('Failed to look up user')
    } finally {
      setLookupLoading(false)
    }
  }

  const loadData = async (userId: string) => {
    const [orthoRes, speciesRes, sharesRes] = await Promise.all([
      authFetch('/api/orthomosaic/list'),
      authFetch('/api/species'),
      authFetch(`/api/admin/shares?user_id=${userId}`),
    ])

    if (orthoRes.ok) {
      const data = await orthoRes.json()
      setOrthomosaics((data.orthomosaics || []).filter((o: Orthomosaic) => o.status === 'completed'))
    }
    if (speciesRes.ok) {
      const data = await speciesRes.json()
      setSpecies(data.species || data || [])
    }
    if (sharesRes.ok) {
      const data = await sharesRes.json()
      setExistingShares(data.shares || [])
    }
  }

  const sharedOrthoIds = new Set(existingShares.map(s => s.orthomosaic_id))

  const toggleOrtho = (id: string) => {
    setSelectedOrthos(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSpecies = (id: string) => {
    setSelectedSpecies(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shareOrthomosaics = async () => {
    if (!targetUser || selectedOrthos.size === 0) return
    setSharingOrtho(true)
    setSuccessMessage('')

    let shared = 0
    for (const orthoId of selectedOrthos) {
      const res = await authFetch('/api/admin/share-orthomosaic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orthomosaic_id: orthoId, user_id: targetUser.id }),
      })
      if (res.ok) shared++
    }

    setSuccessMessage(`Shared ${shared} orthomosaic${shared !== 1 ? 's' : ''} with ${targetUser.email}`)
    setSelectedOrthos(new Set())
    await loadData(targetUser.id)
    setSharingOrtho(false)
  }

  const unshareOrthomosaic = async (orthoId: string) => {
    if (!targetUser) return
    await authFetch('/api/admin/share-orthomosaic', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orthomosaic_id: orthoId, user_id: targetUser.id }),
    })
    await loadData(targetUser.id)
  }

  const copySpecies = async () => {
    if (!targetUser || selectedSpecies.size === 0) return
    setCopyingSpecies(true)
    setSuccessMessage('')

    const res = await authFetch('/api/admin/share-species', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ species_ids: Array.from(selectedSpecies), user_id: targetUser.id }),
    })

    if (res.ok) {
      const data = await res.json()
      setSuccessMessage(`Copied ${data.copied} species to ${targetUser.email}'s account`)
    }

    setSelectedSpecies(new Set())
    setCopyingSpecies(false)
  }

  const selectAllOrthos = () => {
    const unshared = orthomosaics.filter(o => !sharedOrthoIds.has(o.id))
    setSelectedOrthos(new Set(unshared.map(o => o.id)))
  }

  const selectAllSpecies = () => {
    setSelectedSpecies(new Set(species.map(s => s.id)))
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Share Data</h1>
          <p className="text-sm text-gray-500">Share orthomosaics and copy species lists to client accounts</p>
        </div>
      </div>

      {/* User Lookup */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Look up client by email</label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookupUser()}
            />
            <Button onClick={lookupUser} disabled={lookupLoading || !email.trim()}>
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              {!lookupLoading && 'Search'}
            </Button>
          </div>
          {lookupError && (
            <p className="text-sm text-red-600 mt-2">{lookupError}</p>
          )}
          {targetUser && (
            <div className="mt-3 flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800">Found</Badge>
              <span className="text-sm text-gray-700">{targetUser.email}</span>
              <span className="text-xs text-gray-400">({targetUser.id.slice(0, 8)}...)</span>
            </div>
          )}
        </CardContent>
      </Card>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center gap-2">
          <Check className="h-4 w-4" />
          {successMessage}
        </div>
      )}

      {targetUser && (
        <div className="space-y-6">
          {/* Share Orthomosaics */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Share2 className="h-5 w-5" />
                  Share Orthomosaics
                </h2>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllOrthos}>
                    Select All
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedOrthos.size === 0 || sharingOrtho}
                    onClick={shareOrthomosaics}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {sharingOrtho ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
                    Share Selected ({selectedOrthos.size})
                  </Button>
                </div>
              </div>

              {orthomosaics.length === 0 ? (
                <p className="text-sm text-gray-500">No completed orthomosaics available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orthomosaics.map(ortho => {
                      const alreadyShared = sharedOrthoIds.has(ortho.id)
                      return (
                        <TableRow key={ortho.id}>
                          <TableCell>
                            {alreadyShared ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-red-500 hover:text-red-700"
                                title="Remove share"
                                onClick={() => unshareOrthomosaic(ortho.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            ) : (
                              <input
                                type="checkbox"
                                checked={selectedOrthos.has(ortho.id)}
                                onChange={() => toggleOrtho(ortho.id)}
                                className="rounded border-gray-300"
                              />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {ortho.name}
                            {alreadyShared && (
                              <Badge className="ml-2 bg-blue-100 text-blue-800" variant="secondary">Shared</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {new Date(ortho.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-green-100 text-green-800">{ortho.status}</Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Copy Species */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Copy className="h-5 w-5" />
                  Copy Species to Client
                </h2>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllSpecies}>
                    Select All
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedSpecies.size === 0 || copyingSpecies}
                    onClick={copySpecies}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {copyingSpecies ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                    Copy Selected ({selectedSpecies.size})
                  </Button>
                </div>
              </div>

              {species.length === 0 ? (
                <p className="text-sm text-gray-500">No species in your account.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Scientific Name</TableHead>
                      <TableHead className="hidden md:table-cell">Category</TableHead>
                      <TableHead className="hidden md:table-cell">Container</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {species.map(sp => (
                      <TableRow key={sp.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedSpecies.has(sp.id)}
                            onChange={() => toggleSpecies(sp.id)}
                            className="rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{sp.name}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-gray-500 italic">
                          {sp.scientific_name || '-'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {sp.category || '-'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {sp.container_size || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <p className="text-xs text-gray-400 mt-3">
                Species are copied to the client's account. They can edit or delete their copies independently.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
