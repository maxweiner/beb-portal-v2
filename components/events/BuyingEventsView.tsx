'use client'

// Buying Events surface — tabbed Pre / During / Post lifecycle view
// with a top-of-page "View" chooser that lets the user opt back to
// the legacy all-in-one card list. Choice persists per user via
// localStorage.
//
// PR 1 (this file) is scaffolding only — the three phase tabs are
// stubs. PRs 2/3/4 fill them in (readiness checklist, live ops,
// post-event reconciliation).

import { useEffect, useState } from 'react'
import type { NavPage } from '@/app/page'
import { useApp } from '@/lib/context'
import Events from './Events'
import HubView from './HubView'
import PreEventTab from './PreEventTab'
import DuringEventTab from './DuringEventTab'
import PostEventTab from './PostEventTab'
import CreateEventModal from './CreateEventModal'

type ViewMode = 'hub' | 'new' | 'slim' | 'legacy'
type Phase = 'pre' | 'during' | 'post'

const STORAGE_KEY = 'beb-buying-events-view'

function isViewMode(v: unknown): v is ViewMode {
  return v === 'hub' || v === 'new' || v === 'slim' || v === 'legacy'
}

export default function BuyingEventsView({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner === true
  // Hub is the new default. localStorage / DB-prefs override only if the user
  // has explicitly switched away.
  const [view, setView] = useState<ViewMode>('hub')
  const [phase, setPhase] = useState<Phase>('pre')
  const [createMode, setCreateMode] = useState<'scheduled' | 'reserved' | null>(null)

  // Restore the user's preferred view on mount. DB pref (cross-device) wins
  // over localStorage; localStorage wins over the default.
  useEffect(() => {
    const dbPref = (user?.preferences as any)?.buying_events_view
    if (isViewMode(dbPref)) { setView(dbPref); return }
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isViewMode(saved)) setView(saved)
  }, [user?.preferences])

  function changeView(v: ViewMode) {
    setView(v)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, v)
    // Best-effort cross-device persist. RLS allows self-row update on users.
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

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
              ◆ Buying Events <span style={{ fontSize: 13, color: 'var(--mist)', fontWeight: 700 }}>· Hub</span>
            </h1>
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

        <HubView setNav={setNav} />

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
        {(['hub', 'new', 'slim', 'legacy'] as ViewMode[]).map(v => {
          const sel = view === v
          const label =
            v === 'hub'    ? '🎯 Hub' :
            v === 'new'    ? '✨ New' :
            v === 'slim'   ? '📃 Slim' :
                             '🗂 Legacy'
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

