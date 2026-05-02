'use client'

// Settings card: edit the global default spiff amount applied
// when an appointment is marked purchased. Single-row config.

import { useEffect, useState } from 'react'
import { getSpiffConfig, setSpiffAmount, type SpiffConfig } from '@/lib/sales/spiffs'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export default function SpiffConfigPanel() {
  const [cfg, setCfg] = useState<SpiffConfig | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAmount, setDraftAmount] = useState('')
  const [draftActive, setDraftActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const c = await getSpiffConfig()
        if (cancelled) return
        setCfg(c)
        if (c) {
          setDraftAmount(String(c.default_amount_per_appointment_purchase))
          setDraftActive(c.is_active)
        }
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Failed to load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function save() {
    if (!cfg || saving) return
    const n = parseFloat(draftAmount)
    if (!Number.isFinite(n) || n < 0) { setError('Enter a non-negative amount.'); return }
    setSaving(true); setError(null)
    try {
      await setSpiffAmount(cfg.id, n, draftActive)
      setCfg({ ...cfg, default_amount_per_appointment_purchase: n, is_active: draftActive })
      setSavedTick(t => t + 1)
    } catch (err: any) {
      setError(err?.message || 'Could not save')
    }
    setSaving(false)
  }

  if (!loaded) return <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
  if (error && !cfg) return <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>{error}</div>
  if (!cfg) return <div style={{ color: 'var(--mist)', fontStyle: 'italic' }}>No spiff_config row found. (Phase 1 migration seeds one — re-run if missing.)</div>

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Default spiff per appointment purchase</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
            <input type="number" min={0} step="0.01" value={draftAmount}
              onChange={e => setDraftAmount(e.target.value)}
              style={{ paddingLeft: 22 }} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input id="spiff-active" type="checkbox" checked={draftActive}
            onChange={e => setDraftActive(e.target.checked)} />
          <label htmlFor="spiff-active" style={{ fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
            Spiffs active (uncheck to pause auto-creation site-wide)
          </label>
        </div>
      </div>

      {error && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving} className="btn-primary btn-sm">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedTick > 0 && !saving && (
          <span style={{ fontSize: 12, color: 'var(--green-dark)' }}>Saved · current amount {USD.format(cfg.default_amount_per_appointment_purchase)}</span>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mist)' }}>
        New "purchased" marks use this amount. Existing spiff rows aren't repriced retroactively.
      </div>
    </div>
  )
}
