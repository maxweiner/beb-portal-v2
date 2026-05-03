'use client'

import { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback } from 'react'
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
  /** When max@bebllp.com is in "View As" mode, `user` is swapped
   *  to the impersonated target so role-gated UI surfaces render
   *  as that user. `impersonationActor` retains a reference to
   *  the real signed-in user (Max) so the switcher can still
   *  detect eligibility and render its Exit control. Null at all
   *  other times. */
  impersonationActor: User | null
}

const AppContext = createContext<AppContextType | null>(null)

const LIBERTY_DEFAULT_THEME: Theme = 'liberty'

function readLocal<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  return (localStorage.getItem(key) as T) || fallback
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [impersonationActor, setImpersonationActor] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [stores, setStoresState] = useState<Store[]>([])
  const [events, setEventsState] = useState<Event[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
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
        const [usersRes, storesRes, eventsRes, shipmentsRes] = await Promise.all([
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
      const cachedBrand = readLocal<Brand>('beb-brand', 'beb')

      // First reload uses the cached brand so we get something on screen
      // fast. As soon as we have the user record we re-check against
      // users.last_active_brand (the cross-device source of truth) and
      // re-fetch if it differs.
      const { users: loadedUsers } = await reloadRef.current(cachedBrand)
      if (!mounted) return

      // Case-insensitive primary-email match + alternate_emails match.
      // Google normalizes JWT emails to lowercase; existing user rows
      // may have mixed-case primary emails or list this email as an
      // alternate (e.g. work + personal alias).
      const lcEmail = email.toLowerCase()
      const matchesEmail = (u: typeof loadedUsers[number]) =>
        u.email.toLowerCase() === lcEmail ||
        (u.alternate_emails || []).some(a => (a || '').toLowerCase() === lcEmail)
      let userData = loadedUsers.find(matchesEmail)

      // First-time Google sign-in (no public.users row yet) — self-provision
      // a row with role='pending', active=false. The Pending Approval screen
      // surfaces them; an admin promotes via Admin Panel → Users & Roles.
      if (!userData) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token
          const res = await fetch('/api/auth/self-provision', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (res.ok) {
            const refetch = await reloadRef.current(cachedBrand)
            userData = refetch.users.find(matchesEmail)
          }
        } catch { /* fall through to bounce below */ }
      }

      // Bounce only if there's still no row, OR the user is inactive AND
      // not in the 'pending' state (deactivated accounts shouldn't see the
      // pending screen — they get the same blank-login bounce as before).
      if (!userData || (!userData.active && userData.role !== 'pending')) {
        setUserState(null)
        setLoading(false)
        return
      }

      // Resolve the brand we should actually be on:
      //   1. users.last_active_brand if set (cross-device truth)
      //   2. localStorage cache as fallback
      //   3. 'beb' default
      // Then enforce liberty access.
      const dbBrand = (userData as any).last_active_brand as Brand | null | undefined
      let effectiveBrand: Brand = (dbBrand === 'beb' || dbBrand === 'liberty') ? dbBrand : cachedBrand
      if (effectiveBrand === 'liberty' && !userData.liberty_access) effectiveBrand = 'beb'

      // Resync theme to match the resolved brand. Without this, a stale
      // `beb-theme` from a previous session can leave the app showing the
      // wrong colors after auth (e.g. cached theme=liberty-gold but
      // dbBrand=beb).
      const cachedTheme = readLocal<Theme>('beb-theme', 'original')
      let effectiveTheme: Theme = cachedTheme
      if (effectiveBrand === 'liberty' && !cachedTheme.startsWith('liberty')) {
        effectiveTheme = readLocal<Theme>('beb-liberty-theme', LIBERTY_DEFAULT_THEME)
      } else if (effectiveBrand === 'beb' && cachedTheme.startsWith('liberty')) {
        effectiveTheme = readLocal<Theme>('beb-beb-theme', 'original')
      }

      setUserState(userData)
      setBrandState(effectiveBrand)
      if (effectiveTheme !== themeRef.current) setThemeState(effectiveTheme)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('beb-brand', effectiveBrand)
        window.localStorage.setItem('beb-theme', effectiveTheme)
      }

      // If the signed-in actor is the lone impersonator, check
      // whether a "View As" session is active and swap `user` to
      // the target. Without this, Max would see admin-only nav /
      // settings cards even while impersonating a buyer because
      // the role gates read `user.role`. RLS already gates data
      // via the JWT claim — this just keeps the UI consistent.
      if (userData.email.toLowerCase() === 'max@bebllp.com') {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token
          const res = await fetch('/api/impersonation/status', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (res.ok) {
            const json = await res.json() as { active: boolean; session?: { target: { id: string } } }
            if (json.active && json.session) {
              const target = loadedUsers.find(u => u.id === json.session!.target.id)
              if (target && mounted) {
                setImpersonationActor(userData)
                setUserState(target)
              }
            } else if (mounted) {
              setImpersonationActor(null)
            }
          }
        } catch { /* fail closed: leave user as the real actor */ }
      }

      // Re-fetch if the resolved brand differs from what we hot-loaded with.
      if (effectiveBrand !== cachedBrand) {
        await reloadRef.current(effectiveBrand)
      }

      // First-ever-login backfill: if last_active_brand was null, write
      // the resolved brand back so future loads are deterministic.
      if (!dbBrand) {
        void fetch('/api/user/last-active-brand', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userData.id, brand: effectiveBrand }),
        }).catch(() => {})
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
        setImpersonationActor(null)
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
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
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

    // Persist to the user record so other devices pick up the change on
    // their next load. Fire-and-forget — never block the UI on this.
    const userId = user?.id
    if (userId) {
      void fetch('/api/user/last-active-brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, brand: b }),
      }).catch(() => {})
    }

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

  // Stable setter identities. Without useCallback, each AppProvider
  // render produced fresh function refs, which propagated into the
  // memoized ctxValue (because `events` changes triggered the memo
  // to re-run). Consumers like Events.tsx have
  //   const fetchEvents = useCallback(..., [brand, setContextEvents])
  // — so a churning setContextEvents identity invalidated their
  // fetchEvents and re-fired the mount effect every realtime tick,
  // creating a refetch loop after autosave. Stabilizing these
  // setters breaks the loop while still routing through the same
  // useState dispatchers.
  const setYear = useCallback((y: string) => setYearState(y), [])
  const setUser = useCallback((u: User | null) => setUserState(u), [])
  const setStores = useCallback((s: Store[]) => setStoresState(s), [])
  const setEvents = useCallback((e: Event[]) => setEventsState(e), [])

  // Brand wins over theme: a stale `liberty-*` theme paired with brand=beb
  // would render Liberty colors against a BEB session. The boot script in
  // app/layout.tsx must mirror this exactly.
  const themeClass = brand === 'liberty'
    ? (theme.startsWith('liberty') ? `theme-${theme}` : 'theme-liberty')
    : (theme && theme !== 'original' && !theme.startsWith('liberty') ? `theme-${theme}` : '')

  // Mirror the theme class onto <html> so it's consistent with the boot
  // script that ran before hydration. Removing whatever theme-* class was
  // there first keeps the cascade clean (additive .add() would let stale
  // classes shadow the new one).
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    Array.from(root.classList).forEach(c => {
      if (c.startsWith('theme-')) root.classList.remove(c)
    })
    if (themeClass) root.classList.add(themeClass)
  }, [themeClass])

  const ctxValue = useMemo<AppContextType>(() => ({
    user, users, stores, events, shipments,
    theme, year, loading, brand, connectionError,
    isSwitching, pendingBrand,
    setTheme, setYear, setBrand, reload, setUser,
    setStores, setEvents,
    dayEntryIntent, setDayEntryIntent,
    impersonationActor,
  }), [
    user, users, stores, events, shipments,
    theme, year, loading, brand, connectionError,
    isSwitching, pendingBrand,
    reload, dayEntryIntent,
    impersonationActor,
  ])

  // Theme class lives on <html> only (set by the boot script for the
  // first paint, kept in sync by the useEffect above). No wrapper div
  // needed — CSS variable cascade reaches every descendant from <html>.
  return (
    <AppContext.Provider value={ctxValue}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
