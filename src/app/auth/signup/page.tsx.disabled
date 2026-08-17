'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase/client'
import Image from 'next/image'
import { ArrowLeft, Mail, CheckCircle2, Loader2 } from 'lucide-react'

const PROPAGATION_METHODS = ['Containers', 'In-Field']

export default function SignUpPage() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acres, setAcres] = useState('')
  const [propagationMethods, setPropagationMethods] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)

  // Bot protection: honeypot field + timestamp
  const [honeypot, setHoneypot] = useState('')
  const loadTime = useRef(Date.now())

  const togglePropagation = (method: string) => {
    setPropagationMethods(prev =>
      prev.includes(method)
        ? prev.filter(m => m !== method)
        : [...prev, method]
    )
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Bot checks
    if (honeypot) return // Honeypot filled = bot
    if (Date.now() - loadTime.current < 3000) {
      setError('Please take a moment to fill out the form.')
      return
    }

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setError('Please fill in all required fields.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            address,
            acres: acres ? parseFloat(acres) : null,
            propagation_methods: propagationMethods,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (signUpError) throw signUpError

      // Update the profile with additional fields
      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email,
          display_name: `${firstName} ${lastName}`,
          first_name: firstName,
          last_name: lastName,
          address,
          acres: acres ? parseFloat(acres) : null,
          propagation_methods: propagationMethods,
        })
      }

      setShowConfirmation(true)
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up.')
    } finally {
      setLoading(false)
    }
  }

  if (showConfirmation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Mail className="w-10 h-10 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h2>
                <p className="text-gray-600">
                  We sent a confirmation link to:
                </p>
                <p className="font-medium text-gray-900 mt-2">{email}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <CheckCircle2 className="w-5 h-5 text-green-600 mb-2 mx-auto" />
                <p className="text-sm text-green-800">
                  Click the link in your email to activate your account.
                </p>
              </div>
              <div className="space-y-3 text-sm text-gray-600">
                <p>The email should arrive within a few minutes. Check your spam folder if needed.</p>
                <div className="pt-3 border-t">
                  <p className="mb-3">Didn't get it?</p>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      setLoading(true)
                      try {
                        const { error } = await supabase.auth.resend({ type: 'signup', email })
                        if (error) throw error
                        alert('Confirmation email resent!')
                      } catch {
                        alert('Error resending email. Please try again.')
                      } finally {
                        setLoading(false)
                      }
                    }}
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                    ) : (
                      'Resend confirmation email'
                    )}
                  </Button>
                </div>
              </div>
              <div className="pt-4">
                <Link href="/auth/signin">
                  <Button variant="ghost" className="w-full">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to sign in
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <Link href="/">
              <Image
                src="/images/plnt-logo.svg"
                alt="PLNT Logo"
                width={120}
                height={40}
                className="h-10 w-auto"
              />
            </Link>
          </div>
          <CardTitle className="text-2xl text-center">Create an account</CardTitle>
          <CardDescription className="text-center">
            Tell us about your operation to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSignUp} className="space-y-4">
            {/* Honeypot - hidden from humans */}
            <div className="absolute opacity-0 pointer-events-none" aria-hidden="true" tabIndex={-1}>
              <Input
                type="text"
                name="website_url"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                autoComplete="off"
                tabIndex={-1}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="firstName" className="text-sm font-medium">First Name *</label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lastName" className="text-sm font-medium">Last Name *</label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="address" className="text-sm font-medium">Address</label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, City, State"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">Email *</label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Password *</label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6+ characters"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm *</label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="acres" className="text-sm font-medium">How many acres is your property?</label>
              <Input
                id="acres"
                type="number"
                step="0.1"
                min="0"
                value={acres}
                onChange={(e) => setAcres(e.target.value)}
                placeholder="e.g. 150"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">How do you propagate your plants?</label>
              <p className="text-xs text-gray-500">Select all that apply</p>
              <div className="grid grid-cols-2 gap-3 mt-1">
                {PROPAGATION_METHODS.map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => togglePropagation(method)}
                    className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                      propagationMethods.includes(method)
                        ? 'bg-green-700 text-white border-green-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-green-700 hover:bg-green-800"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account...</>
              ) : (
                'Sign Up'
              )}
            </Button>

            <div className="text-center text-sm">
              <span className="text-gray-600">Already have an account? </span>
              <Link href="/auth/signin" className="text-green-700 hover:underline font-medium">
                Sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
