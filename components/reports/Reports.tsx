'use client'

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

type View = 'grid' | 'morning-briefing'

export default function Reports() {
  const { user } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const [view, setView] = useState<View>('grid')

  if (!isSuperAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div className="font-bold" style={{ color: 'var(--ink)', fontSize: 16 }}>Superadmin only</div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
            Reports are currently restricted to superadmins.
          </div>
        </div>
      </div>
    )
  }

  if (view === 'morning-briefing') {
    return <MorningBriefingView onBack={() => setView('grid')} />
  }

  return <ReportsGrid onOpen={(v) => setView(v)} />
}

/* ──────────────────────── REPORTS GRID ──────────────────────── */

type TileDef = {
  id: View | null
  title: string
  description: string
  Icon: React.FC<{ size?: number; color?: string }>
  accent: string
  available: boolean
}

const TILES: TileDef[] = [
  {
    id: 'morning-briefing',
    title: 'Morning Briefing',
    description: "Daily recap email with yesterday's totals per event, weather, and an AI shoutout.",
    Icon: SunIcon, accent: '#F59E0B',
    available: true,
  },
  {
    id: null,
    title: 'End-of-Day Roundup',
    description: "Mirror of Morning Briefing fired at event close — today's final numbers per event.",
    Icon: MoonIcon, accent: '#6366F1',
    available: false,
  },
  {
    id: null,
    title: 'Weekly Summary',
    description: 'Monday recap covering last week’s events, totals, and standout buyers.',
    Icon: CalendarWeekIcon, accent: '#22C55E',
    available: false,
  },
  {
    id: null,
    title: 'Store Performance',
    description: 'Per-store historical breakdown — best days, lead sources, year-over-year trends.',
    Icon: BarChartIcon, accent: '#3B82F6',
    available: false,
  },
  {
    id: null,
    title: 'Event Recap PDF',
    description: "One-click download of a finished 3-day event's full report: per-day, per-buyer, totals.",
    Icon: DocumentIcon, accent: '#A855F7',
    available: false,
  },
]

function ReportsGrid({ onOpen }: { onOpen: (v: View) => void }) {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div style={{ marginBottom: 20 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Reports</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Generate and send reports. More types are on the way.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {TILES.map((t, i) => {
          const clickable = t.available && t.id
          return (
            <button key={i}
              onClick={clickable ? () => onOpen(t.id!) : undefined}
              disabled={!clickable}
              style={{
                background: '#fff',
                border: `1px solid var(--pearl)`,
                borderRadius: 14,
                padding: 18,
                textAlign: 'left',
                cursor: clickable ? 'pointer' : 'not-allowed',
                opacity: clickable ? 1 : 0.55,
                display: 'flex', flexDirection: 'column', gap: 10,
                position: 'relative',
                transition: 'transform .12s ease, box-shadow .12s ease',
                boxShadow: clickable ? '0 2px 8px rgba(0,0,0,.04)' : 'none',
                minWidth: 0,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                if (!clickable) return
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = `0 8px 18px ${t.accent}22`
              }}
              onMouseLeave={e => {
                if (!clickable) return
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)'
              }}>
              {!t.available && (
                <span style={{
                  position: 'absolute', top: 12, right: 12,
                  fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
                  padding: '3px 8px', borderRadius: 99,
                  background: 'var(--cream2)', color: 'var(--mist)',
                }}>COMING SOON</span>
              )}
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: `${t.accent}1F`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: t.accent, flexShrink: 0,
              }}>
                <t.Icon size={24} color={t.accent} />
              </div>
              <div style={{ width: '100%', minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', wordBreak: 'break-word' }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, lineHeight: 1.4, wordBreak: 'break-word' }}>{t.description}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ──────────────────── MORNING BRIEFING SUB-VIEW ──────────────────── */

function MorningBriefingView({ onBack }: { onBack: () => void }) {
  const { users } = useApp()
  const [cfg, setCfg] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'email').maybeSingle()
      .then(({ data }) => {
        const v = data?.value || {}
        setCfg(v)
        setSelected(new Set(v.defaultRecipients || []))
        setLoading(false)
      })
  }, [])

  const activeUsers = (users || []).filter(u => u.active !== false)
  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelected(new Set(activeUsers.map(u => u.id)))
  const clearAll = () => setSelected(new Set())

  const saveDefaults = async () => {
    setSavingDefaults(true)
    const nextCfg = { ...cfg, defaultRecipients: Array.from(selected) }
    await supabase.from('settings').upsert({ key: 'email', value: nextCfg, updated_at: new Date().toISOString() })
    setCfg(nextCfg)
    setSavingDefaults(false)
    alert(`Saved ${selected.size} default recipient${selected.size === 1 ? '' : 's'}.`)
  }

  const sendBriefing = async () => {
    if (selected.size === 0) { alert('Select at least one recipient.'); return }
    setSending(true)
    try {
      const r = await fetch('/api/morning-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: Array.from(selected) }),
      })
      const d = await r.json()
      if (d.ok && d.skipped) alert(`ℹ ${d.skipped}`)
      else if (d.ok) alert(`✅ Morning briefing sent to ${d.sent} recipient${d.sent === 1 ? '' : 's'}.`)
      else if (d.errors) alert(`⚠ Sent with issues:\n\n${d.errors.join('\n')}`)
      else alert(`❌ ${d.error || 'Failed to send'}`)
    } finally {
      setSending(false)
    }
  }

  const keysConfigured = !!(cfg.apiKey && cfg.weatherApiKey && cfg.anthropicApiKey && cfg.fromEmail)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'var(--green)',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        padding: '4px 0', marginBottom: 10,
      }}>← Back to Reports</button>

      <div style={{ marginBottom: 18 }}>
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Morning Briefing</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Daily recap email with yesterday's totals per event, weather per city, and an AI-generated shoutout.
        </div>
      </div>

      {!keysConfigured && (
        <div className="card" style={{
          background: 'var(--amber-pale)', border: '1px solid var(--amber)',
          padding: '12px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <div style={{ fontSize: 13, color: '#92400E', flex: 1 }}>
            Email, weather, or Anthropic keys aren’t configured.
            Finish setup in <strong>Admin Panel → Email Settings</strong> first.
          </div>
        </div>
      )}

      {loading ? (
        <div className="card text-sm" style={{ color: 'var(--mist)' }}>Loading…</div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Recipients</div>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                {selected.size} of {activeUsers.length} selected
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={selectAll} className="btn-outline btn-xs">Select all</button>
              <button onClick={clearAll} className="btn-outline btn-xs">Clear</button>
            </div>
          </div>

          <div style={{
            maxHeight: 320, overflowY: 'auto',
            border: '1px solid var(--pearl)', borderRadius: 8,
            background: 'var(--cream2)',
          }}>
            {activeUsers.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--mist)' }}>No active users.</div>
            ) : activeUsers.map(u => {
              const checked = selected.has(u.id)
              return (
                <label key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--pearl)',
                  cursor: 'pointer',
                  background: checked ? 'var(--green-pale)' : 'transparent',
                  position: 'relative',
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(u.id)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                  <div aria-hidden="true" style={{
                    width: 22, height: 22, flexShrink: 0, borderRadius: 5,
                    border: `2px solid ${checked ? 'var(--green)' : 'var(--pearl)'}`,
                    background: checked ? 'var(--green)' : '#FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#FFFFFF', fontSize: 14, fontWeight: 900, lineHeight: 1,
                    transition: 'all .15s ease',
                  }}>{checked ? '✓' : ''}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{u.name || u.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--mist)' }}>{u.email}</div>
                  </div>
                </label>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={saveDefaults} disabled={savingDefaults}
              className="py-2.5 rounded-lg text-sm font-bold border"
              style={{ flex: 1 }}>
              {savingDefaults ? 'Saving…' : 'Save as defaults'}
            </button>
            <button onClick={sendBriefing}
              disabled={sending || selected.size === 0 || !keysConfigured}
              className="btn-primary"
              style={{ flex: 1 }}>
              {sending ? 'Sending…' : `Send briefing (${selected.size})`}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8, fontStyle: 'italic' }}>
            Tip: save this selection as your defaults so you can just hit Send next time.
          </div>
        </div>
      )}
    </div>
  )
}

/* ──────────────────── Icons ──────────────────── */

function SunIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}
function MoonIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A8 8 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" />
    </svg>
  )
}
function CalendarWeekIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}
function BarChartIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21V9M9 21V5M15 21v-9M21 21v-6" />
      <path d="M3 21h18" />
    </svg>
  )
}
function DocumentIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}
