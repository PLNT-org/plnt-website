'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { authFetch } from '@/lib/auth/auth-fetch'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Save, MapPin, LogOut } from 'lucide-react'
import dynamic from 'next/dynamic'

const OrthomosaicMap = dynamic(() => import('@/components/orthomosaic-map'), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-gray-100 rounded-lg flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  ),
})

interface ProfileData {
  display_name: string
  email: string
  phone: string
  address: string
  company_name: string
}

export default function ProfilePage() {
  const { user, userProfile, isDemo, signOut } = useAuth()
  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    email: '',
    phone: '',
    address: '',
    company_name: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [plantCount, setPlantCount] = useState<number>(0)
  const [latestOrtho, setLatestOrtho] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userProfile) {
      setProfile({
        display_name: (userProfile as any).display_name || '',
        email: (userProfile as any).email || user?.email || '',
        phone: (userProfile as any).phone || '',
        address: (userProfile as any).address || '',
        company_name: (userProfile as any).company_name || '',
      })
    }
    loadStats()
  }, [userProfile])

  const loadStats = async () => {
    if (isDemo) {
      setPlantCount(14847)
      setLoading(false)
      return
    }

    try {
      // Get total plant count
      const { count } = await supabase
        .from('plant_labels')
        .select('*', { count: 'exact', head: true })
        .eq('source', 'ai')

      setPlantCount(count || 0)

      // Get latest orthomosaic
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const listRes = await authFetch('/api/orthomosaic/list', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (listRes.ok) {
          const { orthomosaics } = await listRes.json()
          const completed = (orthomosaics || []).filter((o: any) => o.status === 'completed' && o.bounds)
          if (completed.length > 0) {
            setLatestOrtho(completed[0])
          }
        }
      }
    } catch (err) {
      console.error('Error loading profile stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setSaved(false)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: profile.display_name,
          phone: profile.phone,
          address: profile.address,
          company_name: profile.company_name,
        })
        .eq('id', user.id)

      if (error) {
        console.error('Error saving profile:', error)
        alert('Failed to save profile')
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error('Error saving profile:', err)
    } finally {
      setSaving(false)
    }
  }

  const firstName = profile.display_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const capitalizedFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-700" />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Hi, {capitalizedFirst}</h1>
      <p className="text-gray-500 mb-8">Manage your profile and account details.</p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Name</label>
              <Input
                value={profile.display_name}
                onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Email</label>
              <Input value={profile.email} disabled className="bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Phone</label>
              <Input
                value={profile.phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
                  let formatted = ''
                  if (digits.length > 0) formatted += '(' + digits.slice(0, 3)
                  if (digits.length >= 3) formatted += ') '
                  if (digits.length > 3) formatted += digits.slice(3, 6)
                  if (digits.length >= 6) formatted += '-'
                  if (digits.length > 6) formatted += digits.slice(6, 10)
                  setProfile({ ...profile, phone: formatted })
                }}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Address</label>
              <Input
                value={profile.address}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                placeholder="123 Main St, City, State"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Company</label>
              <Input
                value={profile.company_name}
                onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
                placeholder="Your company"
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-green-700 hover:bg-green-800 text-white"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {saved ? 'Saved' : 'Save Changes'}
            </Button>

            <div className="pt-4 border-t mt-4">
              <Button
                variant="outline"
                onClick={() => signOut()}
                className="w-full text-gray-500 hover:text-red-600 hover:border-red-300"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats + Map */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-4">
                <p className="text-4xl font-bold text-green-700">{plantCount.toLocaleString()}</p>
                <p className="text-gray-500 mt-1">plants counted</p>
              </div>
            </CardContent>
          </Card>

          {latestOrtho && latestOrtho.bounds && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-green-700" />
                  Latest Survey
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] rounded-lg overflow-hidden">
                  <OrthomosaicMap
                    orthomosaic={latestOrtho}
                    labels={[]}
                    arucoMarkers={[]}
                    plots={[]}
                    onLabelClick={() => {}}
                    isDemo={isDemo}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  {latestOrtho.name || 'Orthomosaic'} — {new Date(latestOrtho.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          )}

          {!latestOrtho && (
            <Card>
              <CardContent className="py-8 text-center">
                <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500">No surveys yet</p>
                <p className="text-sm text-gray-400">Your latest survey map will appear here.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
