'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { isAllowedEmail, ACCESS_DENIED_MESSAGE } from '@/lib/auth/allowlist'
import type { User, Session } from '@supabase/supabase-js'

interface UserProfile {
  id: string
  email: string
  display_name?: string
  company_name?: string
  role?: string
}

interface AuthContextType {
  user: User | null
  session: Session | null
  userProfile: UserProfile | null
  loading: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  isDemo: boolean
  setIsDemo: (value: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemoState] = useState(false)
  const router = useRouter()

  // Initialize demo mode from localStorage on mount
  useEffect(() => {
    const storedDemoMode = localStorage.getItem('isDemoMode') === 'true'
    setIsDemoState(storedDemoMode)
  }, [])

  // Custom setIsDemo that also updates localStorage
  const setIsDemo = (value: boolean) => {
    setIsDemoState(value)
    if (value) {
      localStorage.setItem('isDemoMode', 'true')
    } else {
      localStorage.removeItem('isDemoMode')
    }
  }

  // Fetch user profile
  const fetchUserProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (!error && data) {
        setUserProfile(data)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
    }
  }

  // Reject any session whose email isn't on the allowlist (e.g. a Google
  // sign-in, or an account created before the allowlist existed).
  const rejectIfNotAllowed = async (currentSession: Session | null) => {
    if (!currentSession?.user || isAllowedEmail(currentSession.user.email)) return false
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setUserProfile(null)
    return true
  }

  useEffect(() => {
    // If in demo mode, just set loading to false and return
    if (isDemo) {
      setLoading(false)
      return
    }

    let authSubscription: any = null;

    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session: currentSession }, error }) => {
      if (error) {
        console.error('Session error:', error)
        // Clear any invalid tokens
        if (error.message && error.message.includes('Invalid Refresh Token')) {
          // Clear all Supabase-related items from localStorage
          Object.keys(localStorage).forEach(key => {
            if (key.startsWith('supabase')) {
              localStorage.removeItem(key)
            }
          })
          setUser(null)
          setSession(null)
          setUserProfile(null)
        }
      } else {
        rejectIfNotAllowed(currentSession ?? null).then((rejected) => {
          if (rejected) return
          setUser(currentSession?.user ?? null)
          setSession(currentSession ?? null)
          // Fetch profile if user exists
          if (currentSession?.user) {
            fetchUserProfile(currentSession.user.id)
          }
        })
      }
      setLoading(false)
    })

    // Listen for changes on auth state (sign in, sign out, etc.)
    const { data } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (currentSession?.user && !isAllowedEmail(currentSession.user.email)) {
        rejectIfNotAllowed(currentSession)
        return
      }
      setUser(currentSession?.user ?? null)
      setSession(currentSession ?? null)
      if (currentSession?.user) {
        fetchUserProfile(currentSession.user.id)
      } else {
        setUserProfile(null)
      }
    })
    
    authSubscription = data.subscription

    return () => {
      if (authSubscription) {
        authSubscription.unsubscribe()
      }
    }
  }, [isDemo]) // Add isDemo as dependency

  const signIn = async (email: string, password: string) => {
    if (!isAllowedEmail(email)) throw new Error(ACCESS_DENIED_MESSAGE)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Belt and suspenders: the session's own email must also be approved.
    const { data: { session: newSession } } = await supabase.auth.getSession()
    if (!isAllowedEmail(newSession?.user?.email)) {
      await supabase.auth.signOut()
      throw new Error(ACCESS_DENIED_MESSAGE)
    }

    localStorage.removeItem('isDemoMode')
    setIsDemo(false)
    router.push('/dashboard')
  }

  // Self-serve sign up is disabled — accounts are provisioned by PLNT.
  const signUp = async (_email: string, _password: string) => {
    throw new Error('Sign up is disabled. Contact porter@plnt.net for access.')
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
    localStorage.removeItem('isDemoMode')
    setIsDemo(false)
  }

  const signOut = async () => {
    // Only sign out from Supabase if there's a real user
    if (user) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    
    // Clear demo mode on sign out
    setIsDemo(false)
    setUserProfile(null)
    router.push('/')
  }

  const isAdmin = userProfile?.role === 'admin'

  return (
    <AuthContext.Provider value={{
      user,
      session,
      userProfile,
      loading,
      isAdmin,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      isDemo,
      setIsDemo
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}