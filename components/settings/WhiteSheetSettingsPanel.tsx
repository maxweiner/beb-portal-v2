'use client'

// Settings → 📄 White Sheet Upload
//
// Two pieces:
//   1. Per-brand "Review every page" toggle. When ON, the OCR
//      worker forces every page into the review pile regardless
//      of the 5-check auto-commit result. Useful for stress-
//      testing a new model version or for a brand that prefers
//      every page get an operator eyeball during a rollout.
//
//   2. Per-brand 30-day stats card. Surfaces:
//        - upload count
//        - pages processed
//        - auto-commit rate (% of pages that skipped the review pile)
//        - average $ cost per upload
//      Gives a glance-able health read on the pipeline.
//
// Auth: gated upstream in Settings.tsx (admin / superadmin /
// partner). The PATCH route enforces the same.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

interface BrandStats {
  uploads: number
  completed_uploads: number
  pages_total: number
  pages_auto_committed: number
  pages_in_review: number
  pages_errored: number
  auto_commit_rate: number | null
  avg_cost_cents: number | null
  total_cost_cents: number
}

interface SettingsResponse {
  toggle: Record<string, boolean>
  stats: Record<string, BrandStats>
  window_days: number
}

const BRANDS: Array<{ key: 'beb' | 'liberty'; label: string }> = [
  { key: 'beb',     label: 'BEB (Beneficial Estate Buyers)' },
  { key: 'liberty', label: 'Liberty Estate Buyers' },
]

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(0)}%`
}
function usd(cents: number | null): string {
  if (cents === null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export default function WhiteSheetSettingsPanel() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingBrand, setSavingBrand] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/white-sheets/settings', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `${res.status}`)
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => { load() }, [])

  async function setToggle(brand: 'beb' | 'liberty', value: boolean) {
    if (savingBrand) return
    setSavingBrand(brand); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/white-sheets/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand, value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `${res.status}`)
      // Optimistically update the local cache rather than reload —
      // saves a round trip and feels snappier when toggling.
      setData(prev => prev ? { ...prev, toggle: json.toggle } : prev)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSavingBrand(null)
    }
  }

  if (!loaded) {
    return <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
  }
  if (error && !data) {
    return <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>{error}</div>
  }
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--ash)',
          textTransform: 'uppercase', letterSpacing: '.04em',
          marginBottom: 6,
        }}>Per-brand toggles</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BRANDS.map(b => {
            const checked = !!data.toggle[b.key]
            const saving = savingBrand === b.key
            return (
              <div key={b.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fff', border: '1px solid var(--pearl)',
                borderRadius: 8, padding: '10px 12px',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{b.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 1 }}>
                    {checked
                      ? 'Every page routes to review pile regardless of 5-check result.'
                      : 'Auto-commit clean pages, only flag ambiguous ones.'}
                  </div>
                </div>
                <Checkbox
                  checked={checked}
                  onChange={v => setToggle(b.key, v)}
                  disabled={saving}
                  label={<span style={{ fontSize: 12, color: 'var(--mist)' }}>
                    {saving ? 'Saving…' : 'Review every page'}
                  </span>}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--ash)',
          textTransform: 'uppercase', letterSpacing: '.04em',
          marginBottom: 6,
        }}>Last {data.window_days} days</div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
        }}>
          {BRANDS.map(b => {
            const s = data.stats[b.key]
            if (!s) return null
            return (
              <div key={b.key} style={{
                background: '#fff', border: '1px solid var(--pearl)',
                borderRadius: 8, padding: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>
                  {b.label}
                </div>
                {s.uploads === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                    No uploads in the last {data.window_days} days.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Stat label="Uploads"    value={String(s.uploads)} sub={s.completed_uploads === s.uploads ? 'all complete' : `${s.completed_uploads}/${s.uploads} complete`} />
                    <Stat label="Pages"      value={String(s.pages_total)} sub={s.pages_in_review > 0 ? `${s.pages_in_review} in review` : 'all settled'} />
                    <Stat label="Auto-commit" value={pct(s.auto_commit_rate)}
                          accent={s.auto_commit_rate !== null ? (s.auto_commit_rate >= 0.7 ? '#1D6B44' : s.auto_commit_rate >= 0.4 ? '#A16207' : '#991B1B') : undefined} />
                    <Stat label="Avg / upload" value={usd(s.avg_cost_cents)} sub={`$${(s.total_cost_cents / 100).toFixed(2)} total`} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--mist)', lineHeight: 1.5 }}>
        Auto-commit rate counts pages that skipped the review pile (form #, $, check #, phone parse, and buyer-initials classifier
        all cleared). Average cost is total Anthropic Vision spend ÷ upload count over the window.
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: accent || 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
