'use client'

import { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Store, Event, Shipment, Theme, Brand, AppState } from '@/types'

export type DayEntryIntent = {
  eventId: string
  day: number
  mode?: 'buyer' | 'combined'
} | null

interface AppContextType extends AppState {
  setTheme: (t: Theme) => void
  setYear: (y: string) => void
  setBrand: (b: Brand) => void
  reload: (brand?: Brand) => Promise<void>
  setUser: (u: User | null) => void
  setStores: (stores: Store[]) => void
  setEvents: (events: Event[]) => void
  dayEntryIntent: DayEntryIntent
  setDayEntryIntent: (i: DayEntryIntent) => void
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
  const [dayEntryIntent, setDayEntryIntent] = useState<DayEntryIntent>(null)

  // Brand-switch coordination. While a switch is in flight, the committed
  // brand/theme stay on the OLD store so colors don't change until the new
  // store's data is loaded. The overlay reads pendingBrand for its label.
  const [isSwitching, setIsSwitching] = useState(false)
  const [pendingBrand, setPendingBrand] = useState<Brand | null>(null)
  const switchIdRef = useRef(0)

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

  // ── Supabase Realtime: live-refresh shared state when any of the
  // watched tables change so every signed-in session stays in sync
  // without manual reloads. reloadRef is used (not `reload`) to avoid
  // stale closures and to keep this effect stable across renders —
  // the subscription is torn down + rebuilt only when the user changes
  // (login / logout).
  useEffect(() => {
    if (!user?.id) return
    const TABLES = [
      'event_days', 'buyer_entries', 'buyer_checks',
      'events', 'stores', 'users', 'shipments',
    ] as const

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { reloadRef.current() }, 500)
    }

    // Chain .on() for every table onto a single channel.
    let channelBuilder: any = supabase.channel(`db-realtime-${user.id}`)
    for (const table of TABLES) {
      channelBuilder = channelBuilder.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleReload,
      )
    }
    const channel = channelBuilder.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Connected — listening for changes')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn(`[Realtime] ${status} — supabase-js will auto-reconnect`)
      }
    })

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const setTheme = (t: Theme) => {
    localStorage.setItem('beb-theme', t)
    setThemeState(t)
  }

  const setBrand = (b: Brand) => {
    // No-op if already on this brand (and not currently switching to it).
    if (b === brandRef.current && !isSwitching) return

    // Compute the next theme up front so the commit is atomic, but DON'T
    // apply it yet — the new theme/brand only commit after data lands.
    const currentTheme = themeRef.current
    let newTheme = currentTheme
    if (b === 'liberty' && !currentTheme.startsWith('liberty')) {
      newTheme = (localStorage.getItem('beb-liberty-theme') as Theme) || LIBERTY_DEFAULT_THEME
    } else if (b === 'beb' && currentTheme.startsWith('liberty')) {
      newTheme = (localStorage.getItem('beb-beb-theme') as Theme) || 'original'
    }
    if (b === 'liberty') localStorage.setItem('beb-beb-theme', currentTheme)
    if (b === 'beb') localStorage.setItem('beb-liberty-theme', currentTheme)

    // Begin a switch. switchId guards against rapid back-and-forth — only
    // the latest switch is allowed to commit.
    switchIdRef.current += 1
    const myId = switchIdRef.current
    setIsSwitching(true)
    setPendingBrand(b)

    const dataPromise = reloadRef.current(b)
    const minSpinnerPromise = new Promise<void>(r => setTimeout(r, 1500))
    // Safety net: if the data fetch hangs > 10s, bail out anyway so we
    // don't trap the user in the spinner forever.
    const timeoutPromise = new Promise<void>(r => setTimeout(r, 10000))

    Promise.race([
      Promise.all([dataPromise, minSpinnerPromise]).then(() => 'ok' as const),
      timeoutPromise.then(() => 'timeout' as const),
    ]).then(() => {
      // A newer switch superseded us — drop this commit silently.
      if (myId !== switchIdRef.current) return
      localStorage.setItem('beb-brand', b)
      localStorage.setItem('beb-theme', newTheme)
      // Atomic commit (React 18 batches). The custom event lets app/page.tsx
      // reset its local nav state in the same render cycle.
      setBrandState(b)
      setThemeState(newTheme)
      setIsSwitching(false)
      setPendingBrand(null)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('beb:brand-switched', { detail: { brand: b } }))
      }
    })
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
    isSwitching, pendingBrand,
    setTheme, setYear, setBrand, reload, setUser,
    setStores, setEvents,
    dayEntryIntent, setDayEntryIntent,
  }), [
    user, users, stores, events, shipments, permissions,
    theme, year, loading, brand, connectionError,
    isSwitching, pendingBrand,
    reload, dayEntryIntent,
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
