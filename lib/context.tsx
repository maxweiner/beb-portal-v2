'use client'

import { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Store, Event, Shipment, Theme, Brand, AppState } from '@/types'

interface AppContextType extends AppState {
  setTheme: (t: Theme) => void
  setYear: (y: string) => void
  setBrand: (b: Brand) => void
  reload: (brand?: Brand) => Promise<void>
  setUser: (u: User | null) => void
  setStores: (stores: Store[]) => void
  setEvents: (events: Event[]) => void
  connectionError: boolean
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

const LIBERTY_DEFAULT_THEME: Theme = 'liberty'

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [stores, setStoresState] = useState<Store[]>([])
  const [events, setEventsState] = useState<Event[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [permissions, setPermissions] = useState<any>(null)
  const [theme, setThemeState] = useState<Theme>('original')
  const [year, setYearState] = useState(String(new Date().getFullYear()))
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState(false)
  const [brand, setBrandState] = useState<Brand>('beb')

  // ── CRITICAL: use refs to avoid stale closures in reload ──
  const brandRef = useRef(brand)
  brandRef.current = brand // update on every render, no useEffect needed

  const themeRef = useRef(theme)
  themeRef.current = theme

  // ── reload: fetches all data with fresh queries ──
  // Stored in a ref so it always has current brand without useCallback deps
  const reloadRef = useRef<(overrideBrand?: Brand) => Promise<void>>(async () => {})

  reloadRef.current = async (overrideBrand?: Brand) => {
    const currentBrand = overrideBrand || brandRef.current || 'beb'
    const MAX_RETRIES = 3
    const RETRY_DELAY = 2000

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const [usersRes, storesRes, eventsRes, shipmentsRes, permsRes] = await Promise.all([
          supabase.from('users').select('*').order('name'),
          supabase.from('stores').select('*').eq('brand', currentBrand).order('name'),
          supabase
            .from('events')
            .select('*, days:event_days(*), buyer_entries(*)')
            .eq('brand', currentBrand)
            .order('start_date', { ascending: false }),
          supabase
            .from('shipments')
            .select('*')
            .eq('brand', currentBrand)
            .order('ship_date', { ascending: false }),
          supabase.from('settings').select('value').eq('key', 'permissions').maybeSingle(),
        ])

        // Check if any critical query failed
        const hasError = usersRes.error || storesRes.error || eventsRes.error || shipmentsRes.error
        if (hasError && attempt < MAX_RETRIES) {
          console.warn(`reload attempt \${attempt} failed, retrying in \${RETRY_DELAY}ms...`)
          await new Promise(r => setTimeout(r, RETRY_DELAY))
          continue
        }

        // Apply data — only update if we got results (preserve existing on failure)
        if (usersRes.data && usersRes.data.length > 0) setUsers(usersRes.data)
        if (storesRes.data) setStoresState(storesRes.data)
        if (eventsRes.data) {
          setEventsState(eventsRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
        }
        if (shipmentsRes.data) setShipments(shipmentsRes.data)
        setPermissions(permsRes.data?.value || DEFAULT_PERMS)
        setConnectionError(false)
        return // success
      } catch (err) {
        console.error(`reload attempt \${attempt} error:`, err)
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY))
        } else {
          // All retries exhausted — flag connection error but keep existing data
          setConnectionError(true)
        }
      }
    }
  }

  // Stable function reference that delegates to the ref
  const reload = useMemo(() => {
    return (overrideBrand?: Brand) => reloadRef.current(overrideBrand)
  }, [])

  // Safety net — never show spinner for more than 5 seconds
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 15000)
    return () => clearTimeout(t)
  }, [])

  // Read saved preferences from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('beb-theme') as Theme || 'original'
    const savedBrand = localStorage.getItem('beb-brand') as Brand || 'beb'
    setThemeState(savedTheme)
    setBrandState(savedBrand)
  }, [])

  // ── Auth listener ──
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      if (!session) {
        setLoading(false)
        return
      }
      const email = session.user.email
      const { data: userData } = await supabase
        .from('users').select('*').eq('email', email).maybeSingle()
      if (!mounted) return
      if (!userData || !userData.active) {
        setUserState(null)
        setLoading(false)
        return
      }
      const savedBrand = localStorage.getItem('beb-brand') as Brand || 'beb'
      const effectiveBrand = savedBrand === 'liberty' && !userData.liberty_access ? 'beb' : savedBrand
      setUserState(userData)
      setBrandState(effectiveBrand)
      await reloadRef.current(effectiveBrand)
      setLoading(false)
    }).catch(() => {
      if (mounted) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        setUserState(null)
        setUsers([])
        setStoresState([])
        setEventsState([])
        setShipments([])
        setBrandState('beb')
        setLoading(false)
        return
      }
      if (event === 'SIGNED_IN' && session?.user?.email) {
        const { data: userData } = await supabase
          .from('users').select('*').eq('email', session.user.email).maybeSingle()
        if (userData?.active && mounted) {
          const savedBrand = localStorage.getItem('beb-brand') as Brand || 'beb'
          const effectiveBrand = savedBrand === 'liberty' && !userData.liberty_access ? 'beb' : savedBrand
          setUserState(userData)
          setBrandState(effectiveBrand)
          await reloadRef.current(effectiveBrand)
          setLoading(false)
        }
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // ── Theme setter ──
  const setTheme = (t: Theme) => {
    localStorage.setItem('beb-theme', t)
    setThemeState(t)
  }

  // ── Brand switcher with theme pairing ──
  const setBrand = (b: Brand) => {
    localStorage.setItem('beb-brand', b)
    const currentTheme = themeRef.current
    let newTheme = currentTheme

    if (b === 'liberty' && !currentTheme.startsWith('liberty')) {
      const savedLibertyTheme = localStorage.getItem('beb-liberty-theme') as Theme || LIBERTY_DEFAULT_THEME
      newTheme = savedLibertyTheme
      localStorage.setItem('beb-theme', newTheme)
    } else if (b === 'beb' && currentTheme.startsWith('liberty')) {
      const savedBebTheme = localStorage.getItem('beb-beb-theme') as Theme || 'original'
      newTheme = savedBebTheme
      localStorage.setItem('beb-theme', newTheme)
    }

    if (b === 'liberty') localStorage.setItem('beb-beb-theme', currentTheme)
    if (b === 'beb') localStorage.setItem('beb-liberty-theme', currentTheme)

    setBrandState(b)
    setThemeState(newTheme)
    reloadRef.current(b)
  }

  const setYear = (y: string) => setYearState(y)
  const setUser = (u: User | null) => setUserState(u)
  const setStores = (s: Store[]) => setStoresState(s)
  const setEvents = (e: Event[]) => setEventsState(e)

  const themeClass = brand === 'liberty'
    ? (theme.startsWith('liberty') ? `theme-${theme}` : 'theme-liberty')
    : (theme !== 'original' ? `theme-${theme}` : '')

  // ── CRITICAL: memoize the context value ──
  const ctxValue = useMemo<AppContextType>(() => ({
    user, users, stores, events, shipments, permissions,
    theme, year, loading, brand, connectionError,
    setTheme, setYear, setBrand, reload, setUser,
    setStores, setEvents,
  }), [
    user, users, stores, events, shipments, permissions,
    theme, year, loading, brand, connectionError,
    reload,
  ])

  return (
    <AppContext.Provider value={ctxValue}>
      <div className={themeClass}>
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
