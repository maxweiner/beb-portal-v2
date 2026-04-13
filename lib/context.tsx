'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Store, Event, Shipment, Theme, AppState } from '@/types'

interface AppContextType extends AppState {
  setTheme: (t: Theme) => void
  setYear: (y: string) => void
  reload: () => Promise<void>
  setUser: (u: User | null) => void
}

const AppContext = createContext<AppContextType | null>(null)

const DEFAULT_PERMS = {
  dashboard:  { buyer: true,  admin: true },
  calendar:   { buyer: true,  admin: true },
  events:     { buyer: true,  admin: true },
  dayentry:   { buyer: true,  admin: true },
  shipping:   { buyer: true,  admin: true },
  reports:    { buyer: true,  admin: true },
  stores:     { buyer: false, admin: true },
  historical: { buyer: false, admin: true },
  admin:      { buyer: false, admin: true },
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    user: null,
    users: [],
    stores: [],
    events: [],
    shipments: [],
    permissions: null,
    theme: 'original',
    year: String(new Date().getFullYear()),
    loading: true,
  })

  const reload = useCallback(async () => {
    console.log('[Context] reload called', new Date().toISOString())
    try {
      const [usersRes, storesRes, eventsRes, shipmentsRes, permsRes] = await Promise.all([
        supabase.from('users').select('*').order('name'),
        supabase.from('stores').select('*').order('name'),
        supabase.from('events').select('*, days:event_days(*)').order('start_date', { ascending: false }),
        supabase.from('shipments').select('*').order('ship_date', { ascending: false }),
        supabase.from('settings').select('value').eq('key', 'permissions').maybeSingle(),
      ])
      setState(prev => ({
        ...prev,
        users: usersRes.data || [],
        stores: storesRes.data || [],
        events: (eventsRes.data || []).map((e: any) => ({ ...e, days: e.days || [] })),
        shipments: shipmentsRes.data || [],
        permissions: permsRes.data?.value || DEFAULT_PERMS,
        loading: false,
      }))
    } catch (err) {
      console.error('reload error:', err)
    }
  }, [])

  // Safety net — never show spinner for more than 5 seconds
  useEffect(() => {
    const t = setTimeout(() => {
      setState(prev => prev.loading ? { ...prev, loading: false } : prev)
    }, 5000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    const saved = localStorage.getItem('beb-theme') as Theme || 'original'
    setState(prev => ({ ...prev, theme: saved }))
  }, [])

  // Auth listener
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return

      if (!session) {
        setState(prev => ({ ...prev, loading: false }))
        return
      }

      const email = session.user.email
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle()

      if (!mounted) return

      if (!userData || !userData.active) {
        setState(prev => ({ ...prev, user: null, loading: false }))
        return
      }

      setState(prev => ({ ...prev, user: userData, loading: false }))
      reload()
    }).catch(() => {
      if (mounted) setState(prev => ({ ...prev, loading: false }))
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] event:', event)
      if (!mounted) return
      // Only react to explicit sign in/out — ignore TOKEN_REFRESHED to prevent reload loops
      if (event === 'SIGNED_OUT') {
        setState(prev => ({ ...prev, user: null, users: [], stores: [], events: [], shipments: [], loading: false }))
        return
      }
      if (event === 'SIGNED_IN' && session?.user?.email) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('email', session.user.email)
          .maybeSingle()
        if (userData?.active && mounted) {
          setState(prev => ({ ...prev, user: userData, loading: false }))
          reload()
        }
      }
      // Ignore TOKEN_REFRESHED, USER_UPDATED, etc.
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [reload])

  const setTheme = (t: Theme) => {
    localStorage.setItem('beb-theme', t)
    setState(prev => ({ ...prev, theme: t }))
  }

  const setYear = (y: string) => setState(prev => ({ ...prev, year: y }))
  const setUser = (u: User | null) => setState(prev => ({ ...prev, user: u }))

  return (
    <AppContext.Provider value={{ ...state, setTheme, setYear, reload, setUser }}>
      <div className={state.theme !== 'original' ? `theme-${state.theme}` : ''}>
        {children}
      </div>
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export { DEFAULT_PERMS }
