'use client'

// Buying Events — Hub view ("View 1" from the mockups).
//
// Per-event hub card with phase-colored hero, KPI strip, and an
// action-launcher grid. Each launcher opens its function (modal or
// page nav). The user can hide non-essential launchers via the
// "✏️ Customize buttons" modal in the page header; the choice
// persists per-user via users.preferences.
//
// Locked-on launchers (always visible, never hideable):
//   day_entry, buyers, promote
//
// Data fetching mirrors PreEventTab so KPIs and gate counts match
// what the user sees on the existing New view.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventEndIso, formatEventRange } from '@/lib/eventDates'
import { eventDisplayName } from '@/lib/eventName'
import { eventSpend } from '@/lib/eventSpend'
import type { Event, EventPromotionalAssetOrder, Store } from '@/types'
import type { NavPage } from '@/app/page'
import {
  EventReadinessCard,
  BuyerPopover,
  type CampaignRow,
  type TravelRow,
  type TravelAckRow,
} from './PreEventTab'
import CancelEventModal from './CancelEventModal'
import EventNotesPanel from './EventNotesPanel'
import ManifestCaptureModal from '@/components/shipping/ManifestCaptureModal'
import { fetchManifestsForEvents } from '@/lib/shipping/manifests'
import IntakeCaptureFlow from '@/components/intake/IntakeCaptureFlow'
import IntakeWorksheet from '@/components/intake/IntakeWorksheet'
import WaitlistPanel from './WaitlistPanel'
import WhiteSheetUploadModal from '@/components/whitesheets/WhiteSheetUploadModal'
import WhiteSheetReviewPile from '@/components/whitesheets/WhiteSheetReviewPile'
import Checkbox from '@/components/ui/Checkbox'
import { CALENDAR_COLORS } from '@/lib/calendarColors'

// ── Launcher catalog ─────────────────────────────────────────
//
// `locked` keys are always shown (and the customize modal greys
// them out). `requires` controls per-event visibility (e.g. promote
// only on reserved). `adminOnly` hides for non-admins.
type LauncherKey =
  | 'day_entry' | 'buyers' | 'intake' | 'worksheet' | 'travel' | 'shipping'
  | 'manifest' | 'marketing' | 'appointments' | 'waitlist' | 'expenses'
  | 'brief' | 'notes' | 'assets' | 'checklist' | 'ad_spend' | 'promote' | 'cancel'
  | 'white_sheets'

interface LauncherDef {
  key: LauncherKey
  icon: string
  label: string
  sub?: string
  locked?: boolean
  adminOnly?: boolean
  /** When set, only renders when this predicate returns true. */
  showWhen?: (ctx: { reserved: boolean; live: boolean }) => boolean
}

const LAUNCHERS: LauncherDef[] = [
  { key: 'day_entry', icon: '📊', label: 'Day Entry',          locked: true,
    showWhen: ({ reserved }) => !reserved,
    sub: "Today's data" },
  { key: 'buyers',    icon: '👥', label: 'Buyers',             locked: true,
    sub: 'Assigned roster' },
  { key: 'intake',    icon: '🪪', label: 'Buy Intake',
    sub: 'Scan + log purchase',
    showWhen: ({ reserved }) => !reserved },
  { key: 'worksheet', icon: '📋', label: "Today's Worksheet",
    sub: 'Review + submit',
    showWhen: ({ reserved }) => !reserved },
  { key: 'promote',   icon: '✅', label: 'Promote to Booked',  adminOnly: true,
    showWhen: ({ reserved }) => reserved,
    sub: 'Reserved → Booked' },
  { key: 'travel',    icon: '✈️', label: 'Travel',
    sub: 'Flights, hotels, cars' },
  { key: 'shipping',  icon: '📦', label: 'Shipping',
    sub: 'Inbound + outbound' },
  { key: 'manifest',  icon: '🗃️', label: 'Manifest',
    sub: 'Upload box photos' },
  { key: 'white_sheets', icon: '📄', label: 'White Sheet Upload',
    sub: 'OCR scanned invoices' },
  { key: 'marketing', icon: '📣', label: 'Marketing',
    sub: 'VDP, postcards, comms' },
  { key: 'appointments', icon: '📅', label: 'Appointments',
    sub: 'Booked + waitlist' },
  { key: 'waitlist',  icon: '🕒', label: 'Waitlist',
    sub: 'Manage waitlist signups' },
  { key: 'expenses',  icon: '🧾', label: 'Expenses',
    sub: 'Submit / approve' },
  { key: 'assets',    icon: '🪧', label: 'Assets',
    sub: 'Signage, printables' },
  { key: 'brief',     icon: '🎓', label: 'Brief Staff', adminOnly: true,
    sub: 'Pre-event walkthrough' },
  { key: 'checklist', icon: '📋', label: 'Checklist',
    sub: 'All readiness gates' },
  { key: 'notes',     icon: '📝', label: 'Notes',
    sub: 'Lessons learned' },
  { key: 'ad_spend',  icon: '💰', label: 'Ad Spend',
    sub: 'Paid social spend' },
  { key: 'cancel',    icon: '🚫', label: 'Cancel', adminOnly: true,
    sub: 'Soft-cancel event' },
]

// Avatar palette — rotated by index for stable per-buyer color.
const AVATAR_COLORS = ['#2A8A8A', '#1D6B44', '#3B82F6', '#C97A1F', '#7C3AED', '#0EA5E9', '#EC4899', '#84CC16']
function avatarColor(buyerId: string): string {
  let h = 0
  for (let i = 0; i < buyerId.length; i++) h = (h * 31 + buyerId.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Component ────────────────────────────────────────────────
export default function HubView({ setNav }: { setNav?: (n: NavPage) => void }) {
  const ctx = useApp()
  const { stores, user, brand, users, setTravelIntent, setDayEntryIntent, events: ctxEvents } = ctx

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  const canCancel = user?.role === 'superadmin' || user?.is_partner === true

  const [events, setEvents] = useState<Event[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [travel, setTravel] = useState<TravelRow[]>([])
  const [travelAcks, setTravelAcks] = useState<TravelAckRow[]>([])
  const [bookingConfigs, setBookingConfigs] = useState<{ store_id: string; day1_start: string | null }[]>([])
  const [assetOrders, setAssetOrders] = useState<EventPromotionalAssetOrder[]>([])
  const [loading, setLoading] = useState(true)

  // Modal state
  const [cancelEventId, setCancelEventId] = useState<string | null>(null)
  const [notesEventId, setNotesEventId] = useState<string | null>(null)
  const [manageEventId, setManageEventId] = useState<string | null>(null)
  const [buyerPickerEventId, setBuyerPickerEventId] = useState<string | null>(null)
  const [intakeEventId, setIntakeEventId] = useState<string | null>(null)
  const [worksheetEventId, setWorksheetEventId] = useState<string | null>(null)
  const [manifestEventId, setManifestEventId] = useState<string | null>(null)
  // Per-event waitlist modal. Tapping the new "Waitlist" launcher
  // opens a slim wrapper around <WaitlistPanel /> — saves the user
  // from having to drill into the event-detail During tab where it
  // historically lived.
  const [waitlistEventId, setWaitlistEventId] = useState<string | null>(null)
  const [whiteSheetEventId, setWhiteSheetEventId] = useState<string | null>(null)
  // Phase 4: when set, opens the review pile workspace for that
  // event. Distinct from whiteSheetEventId (which opens the upload
  // modal) so the operator can have the workspace up without an
  // active upload dialog.
  const [whiteSheetReviewEventId, setWhiteSheetReviewEventId] = useState<string | null>(null)
  /** Existing box labels for the event whose manifest modal is currently open.
   *  Lazily fetched so we can drive the "replace?" warning + preset pills. */
  const [manifestExistingLabels, setManifestExistingLabels] = useState<string[]>([])
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Upcoming (default) vs Past time-window toggle.
  const [window, setWindow] = useState<'upcoming' | 'past'>('upcoming')

  // Free-text search across store name, event name, and city. Helps
  // when the upcoming list runs long — operators can jump straight
  // to "sami" or "denver" instead of scrolling.
  const [search, setSearch] = useState('')

  // Per-user hidden-launchers list. Lives in users.preferences.buying_events_hub_hidden_launchers.
  // Initialized from the DB once on mount; thereafter, the local state is the
  // source of truth for this session. Saves write through to the DB. We
  // intentionally don't sync local state from `user.preferences` on every
  // re-render — AppContext can refetch users on focus/poll, which would
  // otherwise blow away an in-flight toggle before the round-trip completes.
  const initialHidden = useMemo<Set<LauncherKey>>(() => {
    const arr = (user?.preferences as any)?.buying_events_hub_hidden_launchers
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((k: string): k is LauncherKey =>
      LAUNCHERS.some(l => l.key === k && !l.locked)
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [hidden, setHidden] = useState<Set<LauncherKey>>(initialHidden)
  // Per-user launcher order. Lives in users.preferences.buying_events_hub_launcher_order
  // as a string[] of LauncherKey values. Keys NOT in the saved order get
  // appended in their default LAUNCHERS-array order so new launchers we add
  // later still appear without the user having to re-customize.
  const initialOrder = useMemo<LauncherKey[]>(() => {
    const saved = (user?.preferences as any)?.buying_events_hub_launcher_order
    const defaultOrder = LAUNCHERS.map(l => l.key)
    if (!Array.isArray(saved)) return defaultOrder
    const validSaved = saved.filter((k: string): k is LauncherKey =>
      LAUNCHERS.some(l => l.key === k)
    )
    const seen = new Set(validSaved)
    return [...validSaved, ...defaultOrder.filter(k => !seen.has(k))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [order, setOrder] = useState<LauncherKey[]>(initialOrder)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Authoritative LAUNCHERS list in the user's chosen order. Cards
  // render in this order; the customize modal lists rows in this
  // order too.
  const orderedLaunchers = useMemo<LauncherDef[]>(() => {
    const byKey = new Map(LAUNCHERS.map(l => [l.key, l]))
    return order.map(k => byKey.get(k)!).filter(Boolean)
  }, [order])

  // Fetch readiness data (mirrors PreEventTab).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const [evRes, campaignsRes, travelRes, ackRes, bookingRes, assetsRes] = await Promise.all([
        // Include event_days so eventSpend() + the Customers KPI +
        // the Day Entry launcher's "N/3 entered" sub-label have the
        // per-day data they need. Without this join `ev.days` stays
        // empty and every card reads $0 / 0 customers even when
        // buyers have entered data. Mirrors the canonical fetch shape
        // in lib/context.tsx + components/events/Events.tsx.
        supabase.from('events').select('*, days:event_days(*)').eq('brand', brand).order('start_date'),
        supabase.from('marketing_campaigns').select('event_id, flow_type, status, paid_at'),
        supabase.from('travel_reservations').select('event_id, buyer_id, type'),
        supabase.from('travel_acknowledgments').select('event_id, buyer_id, type'),
        supabase.from('booking_config').select('store_id, day1_start'),
        supabase.from('event_promotional_asset_orders').select('*'),
      ])
      if (cancelled) return
      if (evRes.data) setEvents(evRes.data.map((e: any) => ({ ...e, days: e.days || [] })))
      if (campaignsRes.data) setCampaigns(campaignsRes.data as CampaignRow[])
      if (travelRes.data) setTravel(travelRes.data as TravelRow[])
      if (ackRes.data) setTravelAcks(ackRes.data as TravelAckRow[])
      if (bookingRes.data) setBookingConfigs(bookingRes.data as any[])
      if (assetsRes.data) setAssetOrders(assetsRes.data as EventPromotionalAssetOrder[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  // Sync local events from the global app context whenever the context
  // changes. Context.reload() runs after every CreateEventModal insert
  // (and via a realtime subscription on the events table), so this hook
  // is how a freshly-created event lights up in the hub WITHOUT a
  // browser refresh. Keeping a local state copy (rather than reading
  // ctxEvents directly) preserves the existing optimistic-update sites
  // — e.g. promoteEvent / toggleBriefed use setEvents(es => ...) to
  // reflect the change instantly while realtime catches up in the
  // background.
  useEffect(() => {
    if (!ctxEvents) return
    // Brand-scope: context holds events for the active brand only, but
    // defensive-filter in case the brand swap is in flight.
    const scoped = ctxEvents.filter(e => !brand || (e as any).brand === brand)
    setEvents(scoped.map((e: any) => ({ ...e, days: e.days || [] })))
  }, [ctxEvents, brand])

  const visibleEvents = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const base = window === 'past'
      ? events
          .filter(e => e.status !== 'cancelled')
          .filter(e => !!e.start_date && eventEndIso(e.start_date) < todayIso)
          // Most recent first.
          .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
      : events
          .filter(e => e.status !== 'cancelled')
          .filter(e => !!e.start_date && eventEndIso(e.start_date) >= todayIso)
          .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))

    const q = search.trim().toLowerCase()
    if (!q) return base
    // Match against store name + city/state + the rendered event
    // display name. Lowercased substring — fast + forgiving.
    return base.filter(ev => {
      const store = stores.find(s => s.id === ev.store_id)
      const haystack = [
        eventDisplayName(ev, stores),
        store?.name,
        store?.city,
        store?.state,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [events, window, search, stores])

  const campaignsByEvent = useMemo(() => {
    const m = new Map<string, CampaignRow[]>()
    for (const c of campaigns) {
      const arr = m.get(c.event_id) || []; arr.push(c); m.set(c.event_id, arr)
    }
    return m
  }, [campaigns])

  const travelByEvent = useMemo(() => {
    const m = new Map<string, TravelRow[]>()
    for (const t of travel) {
      const arr = m.get(t.event_id) || []; arr.push(t); m.set(t.event_id, arr)
    }
    return m
  }, [travel])

  const acksByEvent = useMemo(() => {
    const m = new Map<string, TravelAckRow[]>()
    for (const a of travelAcks) {
      const arr = m.get(a.event_id) || []; arr.push(a); m.set(a.event_id, arr)
    }
    return m
  }, [travelAcks])

  async function saveHidden(next: Set<LauncherKey>) {
    // Optimistic local update — UI reflects the change immediately.
    setHidden(next)
    setSaveError(null)
    if (!user?.id) return
    const nextPrefs = { ...(user.preferences || {}), buying_events_hub_hidden_launchers: Array.from(next) }
    const { error, data, status } = await supabase
      .from('users')
      .update({ preferences: nextPrefs })
      .eq('id', user.id)
      .select('preferences')
    if (error) {
      console.error('[HubView] save hub launcher prefs failed', { status, error })
      setSaveError(error.message)
      return
    }
    if (!data || data.length === 0) {
      // RLS silently rejected the update (no rows matched the WITH CHECK).
      console.error('[HubView] save returned 0 rows — likely RLS rejection on users row', { userId: user.id })
      setSaveError('Settings could not be saved (permission denied)')
      return
    }
    // Don't call reload() here — that would refetch every user/store/event in
    // the app just to mirror a value we already have locally. Local state is
    // already correct; the next page load will read the persisted value.
  }

  function toggleHidden(key: LauncherKey) {
    const def = LAUNCHERS.find(l => l.key === key)
    if (!def || def.locked) return
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key); else next.add(key)
    void saveHidden(next)
  }

  // Persist the user's preferred launcher order. Same pattern as
  // saveHidden: optimistic local update, single users-row UPDATE
  // through RLS (which checks auth.uid() against the row), no
  // global reload() afterward.
  async function saveOrder(nextOrder: LauncherKey[]) {
    setOrder(nextOrder)
    setSaveError(null)
    if (!user?.id) return
    const nextPrefs = { ...(user.preferences || {}), buying_events_hub_launcher_order: nextOrder }
    const { error, data, status } = await supabase
      .from('users')
      .update({ preferences: nextPrefs })
      .eq('id', user.id)
      .select('preferences')
    if (error) {
      console.error('[HubView] save launcher order failed', { status, error })
      setSaveError(error.message)
      return
    }
    if (!data || data.length === 0) {
      console.error('[HubView] save returned 0 rows — likely RLS rejection on users row', { userId: user.id })
      setSaveError('Settings could not be saved (permission denied)')
      return
    }
  }

  async function promoteEvent(ev: Event) {
    if (!confirm(`Promote ${eventDisplayName(ev, stores)} from Reserved → Booked?`)) return
    const { error } = await supabase.from('events').update({ status: 'scheduled' }).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, status: 'scheduled' } : e))
  }

  async function toggleBriefed(ev: Event) {
    const briefed = !!(ev as any).staff_briefed_at
    const ok = briefed
      ? confirm(`Un-mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
      : confirm(`Mark staff as briefed for "${eventDisplayName(ev, stores)}"?`)
    if (!ok) return
    const update = briefed
      ? { staff_briefed_at: null, staff_briefed_by_user_id: null }
      : { staff_briefed_at: new Date().toISOString(), staff_briefed_by_user_id: user?.id || null }
    const { error } = await supabase.from('events').update(update).eq('id', ev.id)
    if (error) { alert(error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, ...update } as Event : e))
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading hub…</div>
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Upcoming / Past toggle */}
          <div style={{
            display: 'inline-flex', gap: 2, background: 'var(--cream2)',
            padding: 2, borderRadius: 6,
          }}>
            {(['upcoming', 'past'] as const).map(w => {
              const sel = window === w
              return (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  style={{
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                    padding: '5px 14px', border: 'none', borderRadius: 4,
                    background: sel ? '#fff' : 'transparent',
                    color: sel ? 'var(--green-dark)' : 'var(--mist)',
                    cursor: 'pointer',
                    boxShadow: sel ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
                    textTransform: 'capitalize',
                  }}>{w}</button>
              )
            })}
          </div>

          {/* Free-text search — store / event / city */}
          <div style={{ position: 'relative' }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search store, event, or city…"
              style={{
                fontFamily: 'inherit', fontSize: 12,
                padding: '5px 28px 5px 10px', minWidth: 240,
                border: '1px solid var(--cream2)', borderRadius: 6,
                background: '#fff', color: 'var(--ink)',
                outline: 'none',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute', right: 6, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', color: 'var(--mist)',
                  fontSize: 14, lineHeight: 1, padding: '2px 4px',
                }}
              >✕</button>
            )}
          </div>
        </div>
        <button
          onClick={() => setCustomizeOpen(true)}
          className="btn-outline btn-sm"
          title="Show or hide action-launcher buttons across every card"
        >✏️ Customize buttons</button>
      </div>

      {visibleEvents.length === 0 && (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 14,
        }}>
          {search.trim()
            ? `No ${window === 'past' ? 'past' : 'upcoming'} events match "${search.trim()}".`
            : window === 'past' ? 'No past buying events.' : 'No upcoming buying events.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 21 }}>
        {visibleEvents.map(ev => (
          <HubCard
            key={ev.id}
            ev={ev}
            stores={stores}
            campaigns={campaignsByEvent.get(ev.id) || []}
            travel={travelByEvent.get(ev.id) || []}
            acks={acksByEvent.get(ev.id) || []}
            isAdmin={isAdmin}
            canCancel={canCancel}
            hidden={hidden}
            orderedLaunchers={orderedLaunchers}
            onLauncher={(key) => {
              switch (key) {
                case 'day_entry': {
                  // Pick the most reasonable day to land on: today's day index
                  // when in-window, otherwise day 1.
                  const todayIso = new Date().toISOString().slice(0, 10)
                  let day = 1
                  if (ev.start_date) {
                    const start = new Date(ev.start_date + 'T12:00:00')
                    const today = new Date(todayIso + 'T12:00:00')
                    const diff = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
                    if (diff >= 0 && diff <= 2) day = diff + 1
                  }
                  setDayEntryIntent({ eventId: ev.id, day, mode: 'buyer' })
                  setNav?.('dayentry')
                  break
                }
                case 'buyers':    setBuyerPickerEventId(ev.id); break
                case 'intake':    setIntakeEventId(ev.id); break
                case 'worksheet': setWorksheetEventId(ev.id); break
                case 'travel':    setTravelIntent({ eventId: ev.id }); setNav?.('travel'); break
                case 'shipping':  setNav?.('shipping'); break
                case 'manifest': {
                  // Fire-and-forget — modal opens immediately with empty
                  // labels, then upgrades when the fetch returns.
                  setManifestEventId(ev.id)
                  setManifestExistingLabels([])
                  void fetchManifestsForEvents([ev.id]).then(rows => {
                    setManifestExistingLabels(rows.map((m: any) => m.box_label).filter(Boolean))
                  }).catch(() => { /* leave labels empty if fetch fails */ })
                  break
                }
                case 'white_sheets': setWhiteSheetEventId(ev.id); break
                case 'marketing': setNav?.('marketing'); break
                case 'appointments': setNav?.('appointments'); break
                case 'waitlist':  setWaitlistEventId(ev.id); break
                case 'expenses':  setNav?.('expenses'); break
                case 'brief':     void toggleBriefed(ev); break
                case 'notes':     setNotesEventId(ev.id); break
                case 'assets':    setManageEventId(ev.id); break
                case 'checklist': setManageEventId(ev.id); break
                case 'ad_spend':  setNav?.('marketing'); break
                case 'promote':   void promoteEvent(ev); break
                case 'cancel':    setCancelEventId(ev.id); break
              }
            }}
          />
        ))}
      </div>

      {cancelEventId && (
        <CancelEventModal
          eventId={cancelEventId}
          onClose={() => setCancelEventId(null)}
          onCancelled={() => setEvents(prev => prev.filter(e => e.id !== cancelEventId))}
        />
      )}

      {notesEventId && (() => {
        const ev = events.find(e => e.id === notesEventId)
        const store = stores.find(s => s.id === ev?.store_id)
        if (!ev) return null
        return (
          <EventNotesPanel
            event={ev}
            store={store}
            onClose={() => setNotesEventId(null)}
            onNotesChanged={() => { /* no local view depends on notes count yet */ }}
          />
        )
      })()}

      {manageEventId && (() => {
        const ev = events.find(e => e.id === manageEventId)
        if (!ev) return null
        return (
          <ManageEventModal
            ev={ev}
            stores={stores}
            allEvents={events}
            allUsers={users}
            isAdmin={isAdmin}
            canCancel={canCancel}
            currentUserId={user?.id}
            currentUserName={user?.name || null}
            campaigns={campaignsByEvent.get(ev.id) || []}
            travel={travelByEvent.get(ev.id) || []}
            travelAcks={acksByEvent.get(ev.id) || []}
            assetOrders={assetOrders.filter(o => o.event_id === ev.id)}
            bookingLive={bookingConfigs.some(b => b.store_id === ev.store_id && !!b.day1_start)}
            setNav={setNav}
            onClose={() => setManageEventId(null)}
            onPromoted={(id) => setEvents(es => es.map(e => e.id === id ? { ...e, status: 'scheduled' } : e))}
            onWorkersChange={(workers) => setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, workers } as Event : e))}
            onCancelClick={() => { setManageEventId(null); setCancelEventId(ev.id) }}
            onAssetsChange={(next) => setAssetOrders(prev => {
              const others = prev.filter(o => o.event_id !== ev.id)
              return [...others, ...next]
            })}
          />
        )
      })()}

      {intakeEventId && (
        <IntakeCaptureFlow
          eventId={intakeEventId}
          onClose={() => setIntakeEventId(null)}
          onSaved={() => setIntakeEventId(null)}
        />
      )}

      {worksheetEventId && (() => {
        const ev = events.find(e => e.id === worksheetEventId)
        if (!ev) return null
        return (
          <IntakeWorksheet
            eventId={ev.id}
            storeId={ev.store_id}
            eventStartDate={ev.start_date}
            eventDisplayName={eventDisplayName(ev, stores)}
            onClose={() => setWorksheetEventId(null)}
          />
        )
      })()}

      {manifestEventId && (() => {
        const ev = events.find(e => e.id === manifestEventId)
        if (!ev) return null
        return (
          <ManifestCaptureModal
            boxId={ev.id}
            boxLabel={eventDisplayName(ev, stores)}
            existingBoxLabels={manifestExistingLabels}
            onClose={() => { setManifestEventId(null); setManifestExistingLabels([]) }}
            onUploaded={() => { setManifestEventId(null); setManifestExistingLabels([]) }}
          />
        )
      })()}

      {/* White Sheet Review Pile (Phase 4). Per-event full-screen
          workspace for operators to confirm OCR'd customer fields,
          promote unmatched pages to new buy rows, etc. Opens from
          the upload modal's "X pages need review" link. */}
      {whiteSheetReviewEventId && (() => {
        const ev = events.find(e => e.id === whiteSheetReviewEventId)
        if (!ev) return null
        return (
          <WhiteSheetReviewPile
            event={ev}
            onClose={() => setWhiteSheetReviewEventId(null)}
          />
        )
      })()}

      {/* White Sheet Upload (Phase 2). Drops a PDF, kicks off the
          background splitter. Live counter + review pile live in
          later phases. */}
      {whiteSheetEventId && (() => {
        const ev = events.find(e => e.id === whiteSheetEventId)
        if (!ev) return null
        return (
          <WhiteSheetUploadModal
            eventId={ev.id}
            brand={brand}
            onClose={() => setWhiteSheetEventId(null)}
            onSubmitted={() => { /* Phase 6 wires the live counter; no-op for now */ }}
            onOpenReviewPile={() => {
              setWhiteSheetEventId(null)
              setWhiteSheetReviewEventId(ev.id)
            }}
          />
        )
      })()}

      {/* Waitlist quick-access modal. Just wraps <WaitlistPanel />
          in a sized dialog so the launcher one-clicks straight to
          the per-event waitlist; the panel itself is identical to
          what renders inside the During Event tab. */}
      {waitlistEventId && (() => {
        const ev = events.find(e => e.id === waitlistEventId)
        if (!ev) return null
        return (
          <div
            onClick={() => setWaitlistEventId(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: 12,
                maxWidth: 720, width: '100%',
                maxHeight: '92vh', overflow: 'auto', padding: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 900 }}>
                  🕒 Waitlist <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· {eventDisplayName(ev, stores)}</span>
                </h2>
                <button onClick={() => setWaitlistEventId(null)}
                  style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--mist)' }}>×</button>
              </div>
              <WaitlistPanel ev={ev} />
            </div>
          </div>
        )
      })()}

      {buyerPickerEventId && (() => {
        const ev = events.find(e => e.id === buyerPickerEventId)
        if (!ev) return null
        const workers = (ev.workers || []).filter((w: any) => !w.deleted)
        return (
          <BuyerPickerModal
            event={ev}
            stores={stores}
            workers={workers}
            allUsers={users as any}
            isAdmin={isAdmin}
            onClose={() => setBuyerPickerEventId(null)}
            onChange={(next) => setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, workers: next } as Event : e))}
          />
        )
      })()}

      {customizeOpen && (
        <CustomizeModal
          hidden={hidden}
          order={order}
          onToggle={toggleHidden}
          onReorder={saveOrder}
          onClose={() => setCustomizeOpen(false)}
          saveError={saveError}
        />
      )}
    </div>
  )
}

// ── Hub card ─────────────────────────────────────────────────

function HubCard({
  ev, stores, campaigns, travel, acks,
  isAdmin, canCancel, hidden, orderedLaunchers, onLauncher,
}: {
  ev: Event
  stores: Store[]
  campaigns: CampaignRow[]
  travel: TravelRow[]
  acks: TravelAckRow[]
  isAdmin: boolean
  canCancel: boolean
  hidden: Set<LauncherKey>
  orderedLaunchers: LauncherDef[]
  onLauncher: (k: LauncherKey) => void
}) {
  const store = stores.find(s => s.id === ev.store_id)
  const display = eventDisplayName(ev, stores)
  const reserved = ev.status === 'reserved'
  const range = ev.start_date ? formatEventRange(ev.start_date) : ''

  const todayIso = new Date().toISOString().slice(0, 10)
  const startIso = ev.start_date || ''
  const endIso = ev.start_date ? eventEndIso(ev.start_date) : ''
  const live = !reserved && startIso <= todayIso && endIso >= todayIso
  const soon = !reserved && !live && startIso > todayIso &&
    (new Date(startIso).getTime() - new Date(todayIso).getTime()) <= 7 * 86_400_000
  const past = !reserved && !live && endIso !== '' && endIso < todayIso

  // Phase tag for hero
  const phase: 'live' | 'soon' | 'upcoming' | 'reserved' | 'past' =
    reserved ? 'reserved' : past ? 'past' : live ? 'live' : soon ? 'soon' : 'upcoming'

  const heroBg =
    phase === 'live'      ? 'linear-gradient(160deg, #1E40AF 0%, #38BDF8 100%)' :
    phase === 'soon'      ? 'linear-gradient(160deg, #1E40AF 0%, #38BDF8 100%)' :
    phase === 'reserved'  ? 'linear-gradient(160deg, #92400E 0%, #D97706 100%)' :
    phase === 'past'      ? 'linear-gradient(160deg, #1F2937 0%, #6B7280 100%)' :
                            'linear-gradient(160deg, #14532D 0%, #1D6B44 100%)'

  const daysSinceEnd = past && endIso ? daysBetween(endIso, todayIso) : 0
  const phasePill =
    phase === 'live'     ? `Live · Day ${dayIndex(startIso, todayIso) + 1}` :
    phase === 'soon'     ? `In ${daysBetween(todayIso, startIso)} day${daysBetween(todayIso, startIso) === 1 ? '' : 's'}` :
    phase === 'reserved' ? 'Save the Date' :
    phase === 'past'     ? (daysSinceEnd === 0 ? 'Just ended' : `Ended ${daysSinceEnd}d ago`) :
                           `In ${daysBetween(todayIso, startIso)} days`

  // KPIs
  const days = ev.days || []
  const spent = eventSpend(ev)
  const customers = days.reduce((s, d: any) => s + (d.customers || 0), 0)
  const workers = (ev.workers || []).filter((w: any) => !w.deleted)
  const buyersNeeded = ev.buyers_needed ?? null

  // Open gates count — quick approximation matching PreEventTab semantics:
  //   buyers short, travel rows missing, marketing flows not done, brief not done.
  const buyersShort = buyersNeeded != null ? Math.max(0, buyersNeeded - workers.length) : 0
  const travelMissing = workers.reduce((acc, w) => {
    const has = (kind: string) => travel.some(t => t.buyer_id === w.id && t.type === kind)
              || acks.some(a => a.buyer_id === w.id && (a.type === `self_${kind}` || a.type === `no_${kind}`))
    return acc + (has('flight') && has('hotel') ? 0 : 1)
  }, 0)
  const marketingMissing = (() => {
    const flows: Array<'vdp' | 'postcard' | 'newspaper'> = ['vdp', 'postcard', 'newspaper']
    return flows.filter(f => !campaigns.some(c => c.flow_type === f && c.status === 'done')).length
  })()
  const briefMissing = !((ev as any).staff_briefed_at) && !reserved ? 1 : 0
  const openGates = buyersShort + travelMissing + marketingMissing + briefMissing

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${reserved ? CALENDAR_COLORS.buying.main : 'var(--cream2)'}`,
      borderStyle: reserved ? 'dashed' : 'solid',
      borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Hero — 15% shorter than original (padding + line gaps tightened) */}
      <div style={{ padding: '12px 22px', background: heroBg, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', lineHeight: 1.2 }}>
              {reserved && <span aria-hidden>📌</span>}
              {display}
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 99,
                background: 'rgba(255,255,255,.2)', fontSize: 11, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '.04em',
              }}>{phasePill}</span>
            </div>
            <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 12.5, marginTop: 2 }}>
              {store?.city}{store?.state ? `, ${store.state}` : ''} · 📅 {range}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        borderBottom: '1px solid var(--cream2)', background: 'var(--cream)',
      }}>
        <Kpi label="Spent" value={fmtMoney(spent)} good={spent > 0} />
        <Kpi label="Customers" value={String(customers)} />
        <Kpi
          label="Buyers"
          value={`${workers.length}${buyersNeeded != null ? `/${buyersNeeded}` : ''}`}
          warn={buyersNeeded != null && workers.length < buyersNeeded}
        />
        <Kpi
          label={openGates > 0 ? '⚠ Open gates' : 'Status'}
          value={openGates > 0 ? String(openGates) : (reserved ? '📌 Reserved' : 'Ready')}
          warn={openGates > 0}
          good={openGates === 0 && !reserved}
        />
      </div>

      {/* Launcher grid — order comes from the user's customized
          launcher order. Cards still hide based on the `hidden` set
          and per-launcher gates (adminOnly / showWhen / canCancel). */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8, padding: 14, background: '#fff',
      }}>
        {orderedLaunchers.map(def => {
          if (hidden.has(def.key) && !def.locked) return null
          if (def.adminOnly && !isAdmin) return null
          if (def.key === 'cancel' && !canCancel) return null
          if (def.showWhen && !def.showWhen({ reserved, live })) return null
          return (
            <Launcher
              key={def.key}
              def={def}
              ev={ev}
              workers={workers}
              campaigns={campaigns}
              travel={travel}
              acks={acks}
              briefed={!!(ev as any).staff_briefed_at}
              onClick={() => onLauncher(def.key)}
            />
          )
        })}
      </div>
    </div>
  )
}

function Kpi({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid var(--cream2)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)' }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 900, marginTop: 2,
        color: warn ? '#92400e' : good ? 'var(--green-dark)' : 'var(--ink)',
      }}>{value}</div>
    </div>
  )
}

function Launcher({
  def, ev, workers, campaigns, travel, acks, briefed, onClick,
}: {
  def: LauncherDef
  ev: Event
  workers: { id: string; name: string }[]
  campaigns: CampaignRow[]
  travel: TravelRow[]
  acks: TravelAckRow[]
  briefed: boolean
  onClick: () => void
}) {
  // Per-launcher subtitle / inline content
  let subRender: React.ReactNode = def.sub
  let primary = def.key === 'promote'
  let danger = def.key === 'cancel'

  if (def.key === 'buyers') {
    subRender = workers.length === 0
      ? <small style={{ display: 'block', fontSize: 10, color: 'var(--mist)', fontWeight: 600, marginTop: 2 }}>No buyers yet</small>
      : <span style={{ display: 'inline-flex', alignItems: 'center', marginTop: 4 }}>
          {workers.slice(0, 5).map((w, i) => (
            <span
              key={w.id}
              title={w.name}
              style={{
                width: 20, height: 20, borderRadius: '50%',
                background: avatarColor(w.id), color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 800, border: '1.5px solid #fff',
                marginLeft: i === 0 ? 0 : -7,
                boxShadow: '0 0 0 1px rgba(0,0,0,.05)',
              }}
            >{initials(w.name)}</span>
          ))}
          {workers.length > 5 && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
              +{workers.length - 5}
            </span>
          )}
        </span>
  } else if (def.key === 'travel') {
    const covered = workers.filter(w => {
      const has = (k: string) => travel.some(t => t.buyer_id === w.id && t.type === k)
        || acks.some(a => a.buyer_id === w.id && (a.type === `self_${k}` || a.type === `no_${k}`))
      return has('flight') && has('hotel')
    }).length
    subRender = workers.length === 0 ? '—' : `${covered}/${workers.length} covered`
  } else if (def.key === 'marketing') {
    const done = (['vdp', 'postcard', 'newspaper'] as const)
      .filter(f => campaigns.some(c => c.flow_type === f && c.status === 'done')).length
    subRender = `${done}/3 done`
  } else if (def.key === 'brief') {
    subRender = briefed ? '✓ Briefed' : 'Not briefed yet'
  } else if (def.key === 'day_entry') {
    const enteredDays = (ev.days || []).filter((d: any) => d.entered_at).length
    subRender = enteredDays === 0 ? "Today's data" : `${enteredDays}/${(ev.days || []).length || 3} entered`
  }

  const sub = typeof subRender === 'string'
    ? <small style={{ display: 'block', fontSize: 10, color: 'var(--mist)', fontWeight: 600, marginTop: 2 }}>{subRender}</small>
    : subRender

  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? 'var(--green-pale)' : 'var(--cream)',
        border: `1px solid ${primary ? 'var(--green3)' : 'var(--pearl)'}`,
        borderRadius: 8, padding: '12px 14px', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
        color: primary ? 'var(--green-dark)' : danger ? '#B22234' : 'var(--ink)',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{def.icon}</span>
      <span>
        {def.label}
        {sub}
      </span>
    </button>
  )
}

// ── Customize-buttons modal ──────────────────────────────────

function CustomizeModal({
  hidden, order, onToggle, onReorder, onClose, saveError,
}: {
  hidden: Set<LauncherKey>
  order: LauncherKey[]
  onToggle: (k: LauncherKey) => void
  onReorder: (next: LauncherKey[]) => void
  onClose: () => void
  saveError: string | null
}) {
  const byKey = useMemo(() => new Map(LAUNCHERS.map(l => [l.key, l])), [])
  const items = useMemo<LauncherDef[]>(
    () => order.map(k => byKey.get(k)!).filter(Boolean),
    [order, byKey],
  )

  // Native HTML5 drag-and-drop — vertical list, single source / target
  // pattern. dragIndex tracks the row being moved; overIndex highlights
  // the drop target. On drop we splice + commit. Locked launchers (Day
  // Entry / Buyers / Promote) ARE reorderable — locked refers to
  // visibility, not position.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  function handleDrop(targetIdx: number) {
    if (dragIndex == null || dragIndex === targetIdx) {
      setDragIndex(null); setOverIndex(null); return
    }
    const next = [...order]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIdx, 0, moved)
    setDragIndex(null); setOverIndex(null)
    onReorder(next)
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, zIndex: 1000,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--cream2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>✏️ Customize launcher buttons</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 22, color: 'var(--mist)', cursor: 'pointer' }} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '18px 22px' }}>
          <p style={{ color: 'var(--ash)', fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>
            Drag <span style={{ color: 'var(--ash)', fontWeight: 700 }}>⠿</span> to reorder.
            Tick the box to show or hide. Settings save to your account, so they stay the same on every device.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((l, idx) => {
              const isVisible = !(hidden.has(l.key) && !l.locked)
              const isDragging = dragIndex === idx
              const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx
              return (
                <div
                  key={l.key}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(idx)
                    // Required for Firefox compatibility.
                    e.dataTransfer.effectAllowed = 'move'
                    try { e.dataTransfer.setData('text/plain', l.key) } catch {}
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (overIndex !== idx) setOverIndex(idx)
                  }}
                  onDragLeave={() => {
                    if (overIndex === idx) setOverIndex(null)
                  }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(idx) }}
                  onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', background: 'var(--cream)',
                    border: isDropTarget
                      ? '1px solid var(--green-dark)'
                      : '1px solid var(--pearl)',
                    boxShadow: isDropTarget
                      ? '0 0 0 3px rgba(29,107,68,.18)'
                      : 'none',
                    borderRadius: 8,
                    opacity: isDragging ? 0.45 : 1,
                    transition: 'box-shadow .12s ease, border-color .12s ease, opacity .12s ease',
                  }}
                >
                  {/* Drag handle. Cursor: grab. The whole row is
                      draggable but the handle is the obvious affordance. */}
                  <span
                    title="Drag to reorder"
                    aria-hidden
                    style={{
                      cursor: 'grab', userSelect: 'none',
                      fontSize: 16, color: 'var(--mist)',
                      padding: '0 2px', lineHeight: 1,
                    }}
                  >⠿</span>
                  <Checkbox
                    checked={isVisible}
                    disabled={l.locked}
                    onChange={() => !l.locked && onToggle(l.key)}
                    labelStyle={{ flex: 1, gap: 12, cursor: l.locked ? 'not-allowed' : 'pointer', opacity: l.locked ? 0.55 : 1 }}
                    label={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                        <span style={{ fontSize: 18 }}>{l.icon}</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontWeight: 800, fontSize: 13 }}>{l.label}</span>
                          {l.sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--mist)' }}>{l.sub}</span>}
                        </span>
                      </span>
                    }
                  />
                  {l.locked && (
                    <span style={{
                      fontSize: 10, background: 'var(--cream2)', color: 'var(--ash)',
                      padding: '2px 7px', borderRadius: 99, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>🔒 Always</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {saveError && (
          <div style={{
            padding: '10px 22px', background: '#FEF2F2', color: '#B22234',
            fontSize: 12, fontWeight: 700, borderTop: '1px solid #fecdd3',
          }}>
            ⚠ {saveError}
          </div>
        )}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--cream2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--mist)' }}>
            {(() => {
              const hiddenCount = Array.from(hidden).filter(k => !byKey.get(k)?.locked).length
              return hiddenCount === 0 ? 'All buttons visible' : `${hiddenCount} button${hiddenCount === 1 ? '' : 's'} hidden`
            })()}
          </span>
          <button onClick={onClose} className="btn-primary btn-sm">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Buyer picker modal (wraps BuyerPopover in panel mode) ────

function BuyerPickerModal({
  event, stores, workers, allUsers, isAdmin, onClose, onChange,
}: {
  event: Event
  stores: Store[]
  workers: { id: string; name: string }[]
  allUsers: { id: string; name: string }[] | undefined
  isAdmin: boolean
  onClose: () => void
  onChange: (next: { id: string; name: string }[]) => void
}) {
  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const display = eventDisplayName(event, stores)
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 20, zIndex: 1000, overflow: 'auto',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%',
        marginTop: 40, boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--cream2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>👥 Buyers</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 1 }}>{display}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 0, fontSize: 22, color: 'var(--mist)', cursor: 'pointer',
          }} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <BuyerPopover
            eventId={event.id}
            workers={workers}
            allUsers={allUsers as any}
            isAdmin={isAdmin}
            onClose={onClose}
            onChange={onChange}
            presentation="panel"
          />
        </div>
      </div>
    </div>
  )
}

// ── Manage-event modal (full readiness card) ─────────────────

function ManageEventModal(props: {
  ev: Event
  stores: Store[]
  allEvents: Event[]
  allUsers: { id: string; name: string }[] | undefined
  isAdmin: boolean
  canCancel: boolean
  currentUserId: string | undefined
  currentUserName: string | null
  campaigns: CampaignRow[]
  travel: TravelRow[]
  travelAcks: TravelAckRow[]
  assetOrders: EventPromotionalAssetOrder[]
  bookingLive: boolean
  setNav?: (n: NavPage) => void
  onClose: () => void
  onPromoted: (id: string) => void
  onWorkersChange: (workers: { id: string; name: string }[]) => void
  onCancelClick: () => void
  onAssetsChange: (next: EventPromotionalAssetOrder[]) => void
}) {
  const { ev, onClose } = props
  const [assetEditorOpen, setAssetEditorOpen] = useState(false)
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 20, zIndex: 999, overflow: 'auto',
      }}
    >
      <div style={{
        background: 'var(--cream)', borderRadius: 14, maxWidth: 880, width: '100%',
        marginTop: 20, marginBottom: 20, padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={onClose} style={{
            background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
            fontFamily: 'inherit',
          }}>Close ×</button>
        </div>
        <EventReadinessCard
          ev={ev}
          campaigns={props.campaigns}
          travel={props.travel}
          travelAcks={props.travelAcks}
          assetOrders={props.assetOrders}
          bookingLive={props.bookingLive}
          lastLesson={null}
          allEvents={props.allEvents}
          stores={props.stores}
          isAdmin={props.isAdmin}
          canCancel={props.canCancel}
          currentUserId={props.currentUserId}
          currentUserName={props.currentUserName}
          setNav={props.setNav}
          onOpenTravel={() => { /* outer Travel intent already wired from launcher */ }}
          onPromoted={props.onPromoted}
          onAssetEdit={() => setAssetEditorOpen(true)}
          onMarkBriefed={async () => { /* mirrored via supabase from PreEventTab — no-op here */ }}
          onSetOverride={async () => { /* PreEventTab semantics; intentionally no-op in modal */ }}
          onCarriedForward={() => { /* notes carry-forward only matters in PreEventTab */ }}
          onCancelClick={props.onCancelClick}
          allUsers={props.allUsers as any}
          onWorkersChange={props.onWorkersChange}
        />
      </div>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────

function dayIndex(startIso: string, todayIso: string): number {
  if (!startIso) return 0
  const start = new Date(startIso + 'T12:00:00').getTime()
  const today = new Date(todayIso + 'T12:00:00').getTime()
  return Math.max(0, Math.min(2, Math.floor((today - start) / 86_400_000)))
}
function daysBetween(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T12:00:00').getTime()
  const t = new Date(toIso + 'T12:00:00').getTime()
  return Math.max(0, Math.round((t - f) / 86_400_000))
}
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
