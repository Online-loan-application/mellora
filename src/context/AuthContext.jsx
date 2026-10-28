import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return null
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      setProfile(null)
      setProfileError(error.message)
      return null
    }
    setProfileError('')
    setProfile(data)
    return data
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      if (active) setLoading(false)
    }
    initialize()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user) {
        setProfile(null)
        setProfileError('')
        setLoading(false)
        return
      }
      window.setTimeout(() => {
        if (active) loadProfile(nextSession.user.id)
      }, 0)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? 'member',
    loading,
    profileError,
    refreshProfile: () => loadProfile(session?.user?.id),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, fullName) => supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/#/auth/callback`,
      },
    }),
    sendMagicLink: (email) => supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/#/auth/callback` },
    }),
    signOut: () => supabase.auth.signOut({ scope: 'local' }),
  }), [session, profile, loading, profileError, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
