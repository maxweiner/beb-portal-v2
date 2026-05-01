'use client'

// Admin tab for managing the customer tag master list and tuning
// the engagement-scoring thresholds. Both pieces are admin-only;
// non-admins never reach this code path because Customers.tsx
// renders the "admin only" stub.
//
// Tag CRUD writes directly via supabase-js (RLS gates writes to
// admin/superadmin per Phase 1).
//
// Engagement settings live in the existing `settings` table
// (key=value JSONB) — same pattern as accountant_email,
// irs_mileage_rate, etc.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CustomerTagDefinition } from '@/lib/customers/types'

const PRESET_COLORS = [
  '#1D6B44', '#155538', '#3B82F6', '#8B5CF6',
  '#C9A84C', '#D97706', '#DC2626', '#10B981',
  '#475569', '#92400E', '#7C2D12', '#0EA5E9',
]

export default function TagsAndEngagement() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <TagDefinitions />
      <EngagementSettings />
    </div>
  )
}

/* ── Tag definitions admin ───────────────────────────────── */
function TagDefinitions() {
  const [tags, setTags] = useState<CustomerTagDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // New tag form
  const [newTag, setNewTag] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])

  async function reload() {
    setLoading(true); setError(null)
    let q = supabase.from('customer_tag_definitions').select('*').order('tag')
    if (!showArchived) q = q.eq('is_archived', false)
    const { data, error: err } = await q
    if (err) setError(err.message)
    else setTags((data ?? []) as CustomerTagDefinition[])
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [showArchived])

  async function createTag() {
    const tag = newTag.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!tag) { setError('Tag name required (letters/digits/underscores only).'); return }
    setBusyId('__create__'); setError(null)
    const { error: err } = await supabase.from('customer_tag_definitions').insert({
      tag, description: newDesc.trim() || null, color: newColor,
    })
    setBusyId(null)
    if (err) { setError(`Create failed: ${err.message}`); return }
    setNewTag(''); setNewDesc(''); setNewColor(PRESET_COLORS[0]); setCreating(false)
    reload()
  }

  async function patchTag(id: string, patch: Partial<CustomerTagDefinition>) {
    setBusyId(id); setError(null)
    const { error: err } = await supabase.from('customer_tag_definitions').update(patch).eq('id', id)
    setBusyId(null)
    if (err) { setError(err.message); return }
    reload()
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div className="card-title" style={{ margin: 0 }}>🏷️ Tag Definitions</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-outline btn-xs" onClick={() => setShowArchived(s => !s)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <button className="btn-primary btn-xs" onClick={() => setCreating(true)} disabled={creating}>
            + New tag
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
        Master list of tags that can be applied to customer records. Archive to hide from the picker without deleting historical assignments.
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, marginBottom: 10,
        }}>{error}</div>
      )}

      {creating && (
        <div style={{
          background: 'var(--cream2)', borderRadius: 8, padding: 12, marginBottom: 12,
          display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, alignItems: 'end',
        }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Tag (snake_case)</label>
            <input value={newTag} onChange={e => setNewTag(e.target.value.toLowerCase())} placeholder="ops_priority" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What does this tag mean?" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="fl">Color</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewColor(c)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: c, cursor: 'pointer',
                    border: newColor === c ? '3px solid var(--ink)' : '2px solid var(--pearl)',
                    padding: 0,
                  }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1' }}>
            <button className="btn-primary btn-sm" onClick={createTag} disabled={busyId === '__create__' || !newTag.trim()}>
              {busyId === '__create__' ? 'Creating…' : 'Create tag'}
            </button>
            <button className="btn-outline btn-sm" onClick={() => { setCreating(false); setNewTag(''); setNewDesc('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--mist)', fontSize: 13, padding: 12 }}>Loading…</div>
      ) : tags.length === 0 ? (
        <div style={{ color: 'var(--mist)', fontSize: 13, padding: 12, textAlign: 'center' }}>
          {showArchived ? 'No archived tags.' : 'No active tags. Click "+ New tag" to add one.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tags.map(t => {
            const busy = busyId === t.id
            return (
              <div key={t.id} style={{
                display: 'grid', gridTemplateColumns: '32px 1fr auto auto auto', gap: 10,
                alignItems: 'center', padding: '8px 10px',
                background: t.is_archived ? 'var(--cream2)' : '#fff',
                border: '1px solid var(--pearl)', borderRadius: 6,
                opacity: t.is_archived ? 0.6 : 1,
              }}>
                <div title={t.color} style={{ width: 24, height: 24, borderRadius: 4, background: t.color, border: '1px solid rgba(0,0,0,.1)' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t.tag}</div>
                  {t.description && <div style={{ fontSize: 11, color: 'var(--mist)' }}>{t.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {PRESET_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => patchTag(t.id, { color: c })}
                      title={c}
                      disabled={busy}
                      style={{
                        width: 16, height: 16, borderRadius: 3, padding: 0,
                        background: c, cursor: busy ? 'wait' : 'pointer',
                        border: t.color === c ? '2px solid var(--ink)' : '1px solid var(--pearl)',
                      }} />
                  ))}
                </div>
                <button className="btn-outline btn-xs" disabled={busy}
                  onClick={() => patchTag(t.id, { is_archived: !t.is_archived })}>
                  {t.is_archived ? 'Unarchive' : 'Archive'}
                </button>
                <span aria-hidden style={{ fontSize: 10, color: 'var(--mist)' }}>{t.is_archived ? 'archived' : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Engagement settings + manual recompute ──────────────── */
function EngagementSettings() {
  const [activeDays, setActiveDays] = useState<string>('365')
  const [lapsedDays, setLapsedDays] = useState<string>('730')
  const [vipThreshold, setVipThreshold] = useState<string>('5')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ rows_updated: number } | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('settings').select('key, value')
      .in('key', [
        'customers.engagement.active_days',
        'customers.engagement.lapsed_days',
        'customers.engagement.vip_threshold',
      ])
    const map = new Map<string, any>()
    for (const r of (data ?? []) as { key: string; value: any }[]) map.set(r.key, r.value)
    const num = (k: string, d: number): string => {
      const v = map.get(k)
      if (typeof v === 'number') return String(v)
      if (typeof v === 'string') return v.replace(/^"|"$/g, '') || String(d)
      return String(d)
    }
    setActiveDays(num('customers.engagement.active_days', 365))
    setLapsedDays(num('customers.engagement.lapsed_days', 730))
    setVipThreshold(num('customers.engagement.vip_threshold', 5))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function save() {
    setBusy(true); setError(null)
    const ad = parseInt(activeDays, 10)
    const ld = parseInt(lapsedDays, 10)
    const vt = parseInt(vipThreshold, 10)
    if (![ad, ld, vt].every(n => Number.isFinite(n) && n > 0)) {
      setBusy(false); setError('All three values must be positive integers.'); return
    }
    if (ld <= ad) {
      setBusy(false); setError('Lapsed days must be greater than active days.'); return
    }
    const { error: err } = await supabase.from('settings').upsert([
      { key: 'customers.engagement.active_days',   value: JSON.stringify(ad) },
      { key: 'customers.engagement.lapsed_days',   value: JSON.stringify(ld) },
      { key: 'customers.engagement.vip_threshold', value: JSON.stringify(vt) },
    ])
    setBusy(false)
    if (err) { setError(err.message); return }
  }

  async function recomputeNow() {
    setRecomputing(true); setError(null); setLastResult(null)
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    try {
      const res = await fetch('/api/customers/recompute-engagement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setRecomputing(false); return }
      setLastResult({ rows_updated: json.rows_updated || 0 })
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setRecomputing(false)
  }

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading settings…</div>

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-title">⚙️ Engagement Scoring</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12, lineHeight: 1.5 }}>
        Daily cron recomputes <code>engagement_tier</code> for every non-deleted customer using these thresholds. <strong>VIP</strong> = vip_override flag OR lifetime appointment count ≥ threshold. <strong>Active</strong> = appointment within active_days. <strong>Lapsed</strong> = between active and lapsed boundaries. <strong>Cold</strong> = beyond lapsed_days OR no appointments at all.
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, marginBottom: 10,
        }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">Active threshold (days)</label>
          <input type="number" min={1} value={activeDays} onChange={e => setActiveDays(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">Lapsed threshold (days)</label>
          <input type="number" min={1} value={lapsedDays} onChange={e => setLapsedDays(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="fl">VIP appointment count</label>
          <input type="number" min={1} value={vipThreshold} onChange={e => setVipThreshold(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save thresholds'}
        </button>
        <button className="btn-outline btn-sm" onClick={recomputeNow} disabled={recomputing}>
          {recomputing ? 'Recomputing…' : '↻ Recompute now'}
        </button>
        {lastResult && (
          <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>
            ✓ Updated {lastResult.rows_updated} customer{lastResult.rows_updated === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--mist)', marginLeft: 'auto' }}>
          Daily cron runs at 4:23 AM server time.
        </span>
      </div>
    </div>
  )
}
