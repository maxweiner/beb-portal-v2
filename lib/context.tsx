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

function readLocal<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  return (localStorage.getItem(key) as T) || fallback
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [stores, setStoresState] = useState<Store[]>([])
  const [events, setEventsState] = useState<Event[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [permissions, setPermissions] = useState<any>(null)
  const [theme, setThemeState] = useState<Theme>(() => readLocal('beb-theme', 'original'))
  const [year, setYearState] = useState(String(new Date().getFullYear()))
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState(false)
  const [brand, setBrandState] = useState<Brand>(() => readLocal('beb-brand', 'beb'))

  const brandRef = useRef(brand); brandRef.current = brand
  const themeRef = useRef(theme); themeRef.current = theme

  // reload returns the fetched users so callers can find the current user
  // without an extra single-row query (saves one round-trip on login).
  const reloadRef = useRef<(overrideBrand?: Brand) => Promise<{ users: User[] }>>(async () => ({ users: [] }))

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

        const hasError = usersRes.error || storesRes.error || eventsRes.error || shipmentsRes.error
        if (hasError && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY))
          continue
        }

        const nextUsers = usersRes.data && usersRes.data.length > 0 ? usersRes.data : []
        if (nextUsers.length > 0) setUsers(nextUsers)
        if (storesRes.data) setStoresState(storesRes.data)
        if (eventsRes.data) {
          setEventsState(eventsRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
        }
        if (shipmentsRes.data) setShipments(shipmentsRes.data)
        setPermissions(permsRes.data?.value || DEFAULT_PERMS)
        setConnectionError(false)
        return { users: nextUsers }
      } catch (err) {
        console.error('reload error:', err)
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY))
        } else {
          setConnectionError(true)
        }
      }
    }
    return { users: [] }
  }

  const reload = useMemo(
    () => async (overrideBrand?: Brand) => { await reloadRef.current(overrideBrand) },
    []
  )

  // Safety net — never show spinner more than 15s
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 15000)
    return () => clearTimeout(t)
  }, [])

  // Auth — initial session + subsequent sign-in / sign-out
  useEffect(() => {
    let mounted = true
    let initialized = false

    // Dedupe: getSession() and onAuthStateChange('SIGNED_IN') can both fire
    // on page load when a session is restored from storage. Only handle once.
    const handleSession = async (email: string) => {
      if (!mounted || initialized) return
      initialized = true
      const savedBrand = readLocal<Brand>('beb-brand', 'beb')

      // Single parallel load: fetches everything (users + stores + events + ...)
      // for the user's preferred brand. We find the current user in the returned
      // users list — no separate .eq('email', ...) query needed.
      const { users: loadedUsers } = await reloadRef.current(savedBrand)
      if (!mounted) return

      const userData = loadedUsers.find(u => u.email === email)
      if (!userData || !userData.active) {
        setUserState(null)
        setLoading(false)
        return
      }

      // If saved brand is liberty but user lacks access, fall back to beb and re-fetch.
      const effectiveBrand: Brand = savedBrand === 'liberty' && !userData.liberty_access ? 'beb' : savedBrand
      setUserState(userData)
      setBrandState(effectiveBrand)
      if (effectiveBrand !== savedBrand) {
        await reloadRef.current(effectiveBrand)
      }
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (!session?.user?.email) { setLoading(false); return }
      handleSession(session.user.email)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        initialized = false
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
        handleSession(session.user.email)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const setTheme = (t: Theme) => {
    localStorage.setItem('beb-theme', t)
    setThemeState(t)
  }

  const setBrand = (b: Brand) => {
    localStorage.setItem('beb-brand', b)
    const currentTheme = themeRef.current
    let newTheme = currentTheme

    if (b === 'liberty' && !currentTheme.startsWith('liberty')) {
      newTheme = (localStorage.getItem('beb-liberty-theme') as Theme) || LIBERTY_DEFAULT_THEME
      localStorage.setItem('beb-theme', newTheme)
    } else if (b === 'beb' && currentTheme.startsWith('liberty')) {
      newTheme = (localStorage.getItem('beb-beb-theme') as Theme) || 'original'
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
