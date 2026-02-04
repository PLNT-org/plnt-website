'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [debugInfo, setDebugInfo] = useState('')

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Log the full URL for debugging
        console.log('Full URL:', window.location.href)
        console.log('Hash:', window.location.hash)
        console.log('Search:', window.location.search)

        // Check for OAuth callback (uses query params) or email confirmation (uses hash)
        const urlParams = new URLSearchParams(window.location.search)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))

        // Check for errors in either location
        const error = urlParams.get('error') || hashParams.get('error')
        const errorDescription = urlParams.get('error_description') || hashParams.get('error_description')

        if (error) {
          setStatus('error')
          setMessage(errorDescription || 'An error occurred during authentication')
          return
        }

        // For OAuth, Supabase handles the session automatically via the URL
        // We just need to check if a session was established
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError) {
          console.error('Session error:', sessionError)
          setStatus('error')
          setMessage('Failed to establish session. Please try signing in.')
          return
        }

        if (session) {
          // Session established (OAuth or email confirmation)
          setStatus('success')
          setMessage('Authentication successful! Redirecting to dashboard...')
          setTimeout(() => {
            router.push('/dashboard')
          }, 1000)
          return
        }

        // Check hash params for email confirmation tokens
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (accessToken && refreshToken) {
          // Set the session manually for email confirmation
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })

          if (setSessionError) {
            console.error('Set session error:', setSessionError)
            setStatus('error')
            setMessage('Failed to set session. Please try signing in.')
            return
          }

          setStatus('success')
          setMessage('Email confirmed successfully! Redirecting to dashboard...')
          setTimeout(() => {
            router.push('/dashboard')
          }, 1000)
          return
        }

        // No session and no tokens - might be a stale callback
        setStatus('success')
        setMessage('Please sign in to continue.')
        setTimeout(() => {
          router.push('/auth/signin')
        }, 2000)

      } catch (err) {
        console.error('Callback error:', err)
        setStatus('error')
        setMessage('An unexpected error occurred. Please try signing in.')
        setDebugInfo(`Error: ${err}`)
      }
    }

    handleAuthCallback()
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="text-center space-y-6">
            {status === 'loading' && (
              <>
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="w-10 h-10 text-gray-600 animate-spin" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirming Your Email</h2>
                  <p className="text-gray-600">Please wait while we verify your account...</p>
                  {/* Debug info - remove in production */}
                  <p className="text-xs text-gray-400 mt-2">{debugInfo}</p>
                </div>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Confirmed!</h2>
                  <p className="text-gray-600">{message}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    Welcome to PLNT! You can now access all features including:
                  </p>
                  <ul className="text-sm text-green-700 mt-2 space-y-1 text-left list-disc list-inside">
                    <li>Flight planning tools</li>
                    <li>Plot management</li>
                    <li>AI-powered plant counting</li>
                    <li>Analytics dashboard</li>
                  </ul>
                </div>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <XCircle className="w-10 h-10 text-red-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirmation Issue</h2>
                  <p className="text-gray-600">{message}</p>
                  {/* Debug info - remove in production */}
                  <p className="text-xs text-gray-400 mt-2">{debugInfo}</p>
                </div>
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">
                    You may need to sign in to access your account.
                  </p>
                  <div className="flex flex-col space-y-2">
                    <Link href="/auth/signin">
                      <Button className="w-full bg-green-700 hover:bg-green-800">
                        Go to Sign In
                      </Button>
                    </Link>
                    <Link href="/auth/signup">
                      <Button variant="outline" className="w-full">
                        Try Signing Up Again
                      </Button>
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}