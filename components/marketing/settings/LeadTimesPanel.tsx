'use client'

// Lead-time configuration. Two settings rows:
//   - marketing_vdp_lead_days (default 14)
//   - marketing_postcard_lead_days (default 10)
//
// Used by Phase 3 to compute mail_by_date from event start_date, and
// by the at-risk indicator on the campaign list.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const KEYS = [
  { key: 'marketing_vdp_lead_days',      label: 'VDP',      hint: 'Mail-by date = event start − N days' },
  { key: 'marketing_postcard_lead_days', label: 'Postcard', hint: 'Mail-by date = event start − N days' },
]

export default function LeadTimesPanel() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('settings')
        .select('key, value')
        .in('key', KEYS.map(k => k.key))
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const k of KEYS) next[k.key] = ''
      for (const r of (data ?? []) as { key: string; value: string }[]) {
        next[r.key] = (r.value ?? '').toString().replace(/^"|"$/g, '')
      }
      setValues(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  async function save(key: string) {
    const raw = (values[key] || '').trim()
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      alert('Enter a number between 0 and 365.')
      return
    }
    setSaving(key)
    const { error } = await supabase.from('settings').upsert({ key, value: String(n) }, { onConflict: 'key' })
    setSaving(null)
    if (error) { alert('Failed: ' + error.message); return }
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1800)
  }

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading…</div>

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Lead Times</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Days before event start the campaign should be in the mail.
        Used to compute the mail-by date and the at-risk warning.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {KEYS.map(k => (
          <div key={k.key} style={{
            display: 'grid', gridTemplateColumns: '120px 100px 1fr auto', gap: 10,
            alignItems: 'center',
            padding: '10px 14px', border: '1px solid var(--pearl)', borderRadius: 8,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{k.label}</div>
            <input type="number" min={0} max={365} value={values[k.key] || ''}
              onChange={e => setValues(p => ({ ...p, [k.key]: e.target.value }))}
              style={{ fontSize: 13, textAlign: 'right' }} />
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>days · {k.hint}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-primary btn-sm" onClick={() => save(k.key)} disabled={saving === k.key}>
                {saving === k.key ? 'Saving…' : 'Save'}
              </button>
              {savedKey === k.key && <span style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 700 }}>✓</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
