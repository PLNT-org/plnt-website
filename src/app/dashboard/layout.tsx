// app/dashboard/layout.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard, Map, Plane, Upload, BarChart3,
  Settings, Lock, Database, Brain, Mail, Share2
} from 'lucide-react'

export default function DashboardLayout({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const [userRole, setUserRole] = useState<string>('viewer')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    checkUserRole()
  }, [])

  const checkUserRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/auth/signin')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      setUserRole(profile?.role || 'viewer')
    } catch (error) {
      console.error('Error checking role:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
      </div>
    )
  }

  // ONLY show sidebar for admins
  if (userRole === 'admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Admin banner */}
        <div className="bg-red-600 text-white px-4 py-2 text-center text-sm">
          <Lock className="w-4 h-4 inline mr-2" />
          Admin Mode Active
        </div>

        <div className="flex">
          {/* Admin Sidebar */}
          <aside className="w-64 bg-white border-r min-h-screen p-4">
            <div className="space-y-6">
              {/* Regular Navigation */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Main</h3>
                <nav className="space-y-1">
                  <Link href="/dashboard">
                    <Button variant="ghost" className="w-full justify-start">
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      Dashboard
                    </Button>
                  </Link>
                  
                  <Link href="/dashboard/flight-planner">
                    <Button variant="ghost" className="w-full justify-start">
                      <Plane className="w-4 h-4 mr-2" />
                      Flight Planner
                    </Button>
                  </Link>
                  
                  <Link href="/dashboard/upload">
                    <Button variant="ghost" className="w-full justify-start">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload for Counting
                    </Button>
                  </Link>
                  
                  <Link href="/dashboard/analytics">
                    <Button variant="ghost" className="w-full justify-start">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Analytics
                    </Button>
                  </Link>
                </nav>
              </div>

              {/* Admin Tools */}
              <div>
                <h3 className="text-xs font-semibold text-red-600 uppercase mb-2">
                  Admin Tools
                </h3>
                <nav className="space-y-1">
                  <Link href="/dashboard/admin/upload-training">
                    <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50">
                      <Database className="w-4 h-4 mr-2" />
                      Upload Training Data
                    </Button>
                  </Link>
                  
                  <Link href="/dashboard/admin/annotate">
                    <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50">
                      <Brain className="w-4 h-4 mr-2" />
                      Annotate Images
                    </Button>
                  </Link>
                  
                  <Link href="/dashboard/admin/training-status">
                    <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50">
                      <Settings className="w-4 h-4 mr-2" />
                      Model Training
                    </Button>
                  </Link>

                  <Link href="/dashboard/admin/contacts">
                    <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50">
                         <Mail className="w-4 h-4 mr-2" />
                        Contact Submissions
                    </Button>
                 </Link>

                  <Link href="/dashboard/admin/share">
                    <Button variant="ghost" className="w-full justify-start text-red-600 hover:bg-red-50">
                      <Share2 className="w-4 h-4 mr-2" />
                      Share Data
                    </Button>
                  </Link>
                </nav>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>
    )
  }

  // For regular users - no sidebar, just render children
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}