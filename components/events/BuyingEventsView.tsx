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
import Events from './Events'

type ViewMode = 'new' | 'legacy'
type Phase = 'pre' | 'during' | 'post'

const STORAGE_KEY = 'beb-buying-events-view'

export default function BuyingEventsView({ setNav }: { setNav?: (n: NavPage) => void }) {
  const [view, setView] = useState<ViewMode>('new')
  const [phase, setPhase] = useState<Phase>('pre')

  // Restore the user's preferred view on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'new' || saved === 'legacy') setView(saved)
  }, [])

  function changeView(v: ViewMode) {
    setView(v)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, v)
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

  // New tabbed view.
  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <ViewChooser view={view} onChange={changeView} />

      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
        ◆ Buying Events
      </h1>
      <div style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 14 }}>
        Pre-event prep, live ops, and post-event close-out — switch with the tabs.
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

      {phase === 'pre'    && <PreEventStub />}
      {phase === 'during' && <DuringEventStub />}
      {phase === 'post'   && <PostEventStub />}
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
        {(['new', 'legacy'] as ViewMode[]).map(v => {
          const sel = view === v
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
              {v === 'new' ? '✨ New' : '🗂 Legacy'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── stubs ────────────────────────────────────────────────────
   Each phase tab will be filled in by PR 2 / 3 / 4. For PR 1 we
   render a placeholder so the structure is testable without
   blocking on the bigger build. */

function PreEventStub() {
  return (
    <PlaceholderCard
      title="📋 Pre-Event Readiness — coming next PR"
      lines={[
        'Will live here:',
        '• Readiness checklist with green / yellow / red gates per event',
        '• Buyer assignment + Buyers Needed editor + worker conflict popups',
        '• Travel readiness (each buyer has flight + hotel logged)',
        '• Marketing milestones (VDP / postcards / newspaper proofed + ordered)',
        '• Counter cards / in-store assets ordered + shipped',
        '• Booking system configured + tested',
        '• Staff briefed',
        '• Save the Date → Promote to Booked',
        '• "+ New Event" / "+ Save the Date" buttons',
      ]}
    />
  )
}

function DuringEventStub() {
  return (
    <PlaceholderCard
      title="📊 During Event — coming after Pre-Event"
      lines={[
        'Will live here:',
        '• One live event card per event currently in its date window (multiple at once if same week)',
        '• Today\'s customers / sales / close rate KPI tiles per event',
        '• Day-by-day spend cards (3-day grid)',
        '• "Open Day Entry" shortcut',
        '• Buyer panel (read-only Buyers Needed; "make lead" still active; conflict popup still active)',
        '• Today\'s appointments count',
        '• Total spend / commission running total',
      ]}
    />
  )
}

function PostEventStub() {
  return (
    <PlaceholderCard
      title="💰 Post-Event Reconciliation — last in the series"
      lines={[
        'Will live here:',
        '• Spiff queue (calculate + mark paid) — needs a new buying_event_spiffs table; design questions before PR 4',
        '• Expense report status per buyer (open / submitted / approved / paid)',
        '• "Re-send to accountant" button',
        '• Recap PDF generation',
        '• Debrief / post-mortem notes',
        '• Final spend totals',
        '• Archive / cancel options',
      ]}
    />
  )
}

function PlaceholderCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={{
      background: '#fff', border: '1px dashed var(--mist)',
      borderRadius: 10, padding: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>
        {title}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 13, color: 'var(--mist)', lineHeight: 1.6 }}>
          {l}
        </div>
      ))}
    </div>
  )
}
