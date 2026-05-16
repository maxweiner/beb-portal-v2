'use client'

// Buying Events surface — tabbed Pre / During / Post lifecycle view
// with a top-of-page "View" chooser that lets the user opt back to
// the legacy all-in-one card list. Choice persists per user via
// localStorage.
//
// PR 1 (this file) is scaffolding only — the three phase tabs are
// stubs. PRs 2/3/4 fill them in (readiness checklist, live ops,
// post-event reconciliation).

import { useEffect, useRef, useState } from 'react'
import type { NavPage } from '@/app/page'
import { useApp } from '@/lib/context'
import Events from './Events'
import HubView from './HubView'
import PreEventTab from './PreEventTab'
import DuringEventTab from './DuringEventTab'
import PostEventTab from './PostEventTab'
import CreateEventModal from './CreateEventModal'
import BuyingEventSheet from './BuyingEventSheet'
import FullscreenWorkspace from '@/components/ui/FullscreenWorkspace'

type ViewMode = 'hub' | 'new' | 'slim' | 'legacy' | 'sheet'
type Phase = 'pre' | 'during' | 'post'

const STORAGE_KEY = 'beb-buying-events-view'

function isViewMode(v: unknown): v is ViewMode {
  return v === 'hub' || v === 'new' || v === 'slim' || v === 'legacy' || v === 'sheet'
}

export default function BuyingEventsView({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user, events } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  // Lazy-init from localStorage so a returning user sees their
  // last-used view immediately (no hub flash). Fall back to the
  // Hub view for users with no preference saved at all — Hub has
  // been the modern entry point since the launcher rebuild, and
  // Legacy is being phased out (hidden from the view picker as of
  // 2026-05-15; route handler kept for ~30 days in case anyone
  // explicitly saved it).
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'hub'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isViewMode(saved) && saved !== 'sheet') return saved
    return 'hub'
  })
  const [phase, setPhase] = useState<Phase>('pre')
  const [createMode, setCreateMode] = useState<'scheduled' | 'reserved' | null>(null)
  // Fullscreen workspace for the Sheet view (sidebar covered).
  // Only the sheet view exposes the ⛶ trigger.
  const [sheetFullscreen, setSheetFullscreen] = useState(false)
  // Hub-only: customize-launchers modal open state. Lives here so the
  // trigger button can sit in the page header next to + New Event /
  // Save the Date instead of in HubView's secondary toolbar.
  const [hubCustomizeOpen, setHubCustomizeOpen] = useState(false)

  // Sync from DB pref (cross-device source of truth). Only fires when
  // the user's preferences object itself changes — NOT when local view
  // state flips, otherwise every click would snap back to the saved
  // pref. A ref guards the very first apply so subsequent clicks don't
  // get clobbered by stale pref reads.
  const dbPrefAppliedRef = useRef(false)
  useEffect(() => {
    if (dbPrefAppliedRef.current) return
    const dbPref = (user?.preferences as any)?.buying_events_view
    if (isViewMode(dbPref) && dbPref !== 'sheet') {
      setView(dbPref)
    }
    dbPrefAppliedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.preferences])

  function changeView(v: ViewMode) {
    setView(v)
    // Sheet is a peek/multi-edit view; don't make it the persisted last-used.
    // Most folks expect their working view (hub/new/slim/legacy) to come back
    // after a quick sheet excursion.
    if (v === 'sheet') return
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, v)
    if (user?.id) {
      void (async () => {
        const { supabase } = await import('@/lib/supabase')
        const nextPrefs = { ...(user.preferences || {}), buying_events_view: v }
        await supabase.from('users').update({ preferences: nextPrefs }).eq('id', user.id)
      })()
    }
  }

  // Hub view = per-event hub cards with launcher buttons (View 1 from mockups).
  if (view === 'hub') {
    return (
      <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <ViewChooser view={view} onChange={changeView} />

        {/* Page header — title + page-level actions on one row. The
            Customize / reorder button used to live inside HubView's
            secondary toolbar; we hoist it here so all three buttons
            ('+ New Event' / 'Save the Date' / 'Customize') share one
            row and the secondary toolbar (Upcoming / Past · Search)
            stays clean. Customize is visible to everyone (it's a
            personalization, not an admin action), so it sits OUTSIDE
            the isAdmin gate. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
              ◆ Buying Events <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· Hub</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {isAdmin && (
              <>
                <button onClick={() => setCreateMode('scheduled')} className="btn-primary btn-sm">+ New Event</button>
                <button onClick={() => setCreateMode('reserved')} className="btn-outline btn-sm" title="Tentative date — Save the Date">
                  📌 Save the Date
                </button>
              </>
            )}
            <button
              onClick={() => setHubCustomizeOpen(true)}
              className="btn-outline btn-sm"
              title="Show, hide, or drag-to-reorder the action-launcher buttons that appear on every event card. Saves to your account."
            >✏️ Customize / reorder</button>
          </div>
        </div>

        <HubView
          setNav={setNav}
          customizeOpen={hubCustomizeOpen}
          onCustomizeOpenChange={setHubCustomizeOpen}
        />

        {createMode && (
          <CreateEventModal mode={createMode} onClose={() => setCreateMode(null)} />
        )}
      </div>
    )
  }

  // Legacy view = the existing Events component, untouched.
  if (view === 'legacy') {
    return (
      <div>
        <ViewChooser view={view} onChange={changeView} />
        <Events setNav={setNav} />
      </div>
    )
  }

  // Sheet view = spreadsheet-style multi-event editor.
  if (view === 'sheet') {
    return (
      <div className="p-6" style={{ maxWidth: 1400, margin: '0 auto' }}>
        <ViewChooser view={view} onChange={changeView} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
              ◆ Buying Events <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· Sheet</span>
            </h1>
            <div style={{ color: 'var(--mist)', fontSize: 13 }}>
              Edit many events at once — readiness, buyers needed, store, dates.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setSheetFullscreen(true)}
              className="btn-outline btn-sm"
              title="Open the sheet in a fullscreen workspace (ESC to close)"
            >
              ⛶ Fullscreen
            </button>
            {isAdmin && (
              <button onClick={() => setCreateMode('reserved')} className="btn-outline btn-sm" title="Tentative date — Save the Date">
                📌 Save the Date
              </button>
            )}
          </div>
        </div>

        {/* Skip inline render when fullscreen open so BuyingEventSheet
            stays a single-instance mount. */}
        {sheetFullscreen ? null : <BuyingEventSheet events={events} />}

        {createMode && (
          <CreateEventModal mode={createMode} onClose={() => setCreateMode(null)} />
        )}

        {sheetFullscreen && (
          <FullscreenWorkspace
            title="◆ Buying Events · Sheet workspace"
            subtitle={`${events.length} event${events.length === 1 ? '' : 's'} · ESC to close`}
            onClose={() => setSheetFullscreen(false)}
          >
            <BuyingEventSheet events={events} />
          </FullscreenWorkspace>
        )}
      </div>
    )
  }

  // Slim view = Pre-Event only, single-line accordion rows. Skips
  // the Pre/During/Post pill bar — by design slim is a fast-scan
  // glance at upcoming events, with the full card one click away.
  if (view === 'slim') {
    return (
      <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <ViewChooser view={view} onChange={changeView} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
              ◆ Buying Events <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· Slim</span>
            </h1>
            <div style={{ color: 'var(--mist)', fontSize: 13 }}>
              Upcoming events at a glance — click any row for the full readiness card.
            </div>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => setCreateMode('scheduled')} className="btn-primary btn-sm">+ New Event</button>
              <button onClick={() => setCreateMode('reserved')} className="btn-outline btn-sm" title="Tentative date — Save the Date">
                📌 Save the Date
              </button>
            </div>
          )}
        </div>

        <PreEventTab setNav={setNav} slim />

        {createMode && (
          <CreateEventModal
            mode={createMode}
            onClose={() => setCreateMode(null)}
          />
        )}
      </div>
    )
  }

  // New tabbed view.
  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <ViewChooser view={view} onChange={changeView} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
            ◆ Buying Events
          </h1>
          <div style={{ color: 'var(--mist)', fontSize: 13 }}>
            Pre-event prep, live ops, and post-event close-out — switch with the tabs.
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setCreateMode('scheduled')} className="btn-primary btn-sm">+ New Event</button>
            <button onClick={() => setCreateMode('reserved')} className="btn-outline btn-sm" title="Tentative date — Save the Date">
              📌 Save the Date
            </button>
          </div>
        )}
      </div>

      {/* Pill tabs (matches Pattern D Style 1 from the mock) */}
      <div style={{
        display: 'flex', gap: 4,
        background: 'var(--cream2)', padding: 4, borderRadius: 10,
        width: 'fit-content', marginBottom: 18,
      }}>
        {([
          ['pre',    '📋 Pre-Event'],
          ['during', '📊 During Event'],
          ['post',   '💰 Post-Event'],
        ] as [Phase, string][]).map(([id, label]) => {
          const sel = phase === id
          return (
            <button key={id} onClick={() => setPhase(id)}
              style={{
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                padding: '8px 16px', border: 'none', borderRadius: 6,
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)',
                cursor: 'pointer',
                boxShadow: sel ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              }}>
              {label}
            </button>
          )
        })}
      </div>

      {phase === 'pre'    && <PreEventTab setNav={setNav} />}
      {phase === 'during' && <DuringEventTab setNav={setNav} />}
      {phase === 'post'   && <PostEventTab setNav={setNav} />}

      {createMode && (
        <CreateEventModal
          mode={createMode}
          onClose={() => setCreateMode(null)}
        />
      )}
    </div>
  )
}

function ViewChooser({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
      padding: '12px 24px 0', maxWidth: 1200, margin: '0 auto',
    }}>
      <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        View
      </span>
      <div style={{
        display: 'flex', gap: 2, background: 'var(--cream2)',
        padding: 2, borderRadius: 6,
      }}>
        {/* 'legacy' deliberately omitted — hidden 2026-05-15. The route
            handler in this file still serves it for any user whose saved
            preference is still 'legacy' (migration bumps them to 'hub')
            but it's no longer reachable from the picker. Re-add the
            chip here when / if Legacy comes back; or delete the route
            handler altogether after the ~30-day hold-out period. */}
        {(['hub', 'new', 'slim', 'sheet'] as ViewMode[]).map(v => {
          const sel = view === v
          const label =
            v === 'hub'    ? '🎯 Hub' :
            v === 'new'    ? '✨ New' :
            v === 'slim'   ? '📃 Slim' :
                             '⊞ Sheet'
          return (
            <button key={v} onClick={() => onChange(v)}
              style={{
                fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                padding: '4px 10px', border: 'none', borderRadius: 4,
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)',
                cursor: 'pointer',
                boxShadow: sel ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
                textTransform: 'capitalize',
              }}>
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

