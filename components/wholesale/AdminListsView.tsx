'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { WholesaleAdminListEntry } from '@/types/wholesale'
import { logAudit } from '@/lib/wholesale/audit'

const KNOWN_LISTS: { key: string; label: string }[] = [
  { key: 'jewelry_type',        label: 'Jewelry types' },
  { key: 'metal_type',          label: 'Metal types' },
  { key: 'metal_color',         label: 'Metal colors' },
  { key: 'metal_karat',         label: 'Metal karats' },
  { key: 'diamond_shape',       label: 'Diamond shapes' },
  { key: 'period_era',          label: 'Period / era' },
  { key: 'watch_brand',         label: 'Watch brands' },
  { key: 'watch_band_style',    label: 'Watch band styles' },
  { key: 'watch_movement',      label: 'Watch movements' },
  { key: 'watch_case_material', label: 'Watch case materials' },
  { key: 'watch_condition',     label: 'Watch conditions' },
  { key: 'payment_terms',       label: 'Payment terms' },
  { key: 'payment_method',      label: 'Payment methods' },
]

export default function AdminListsView() {
  const { user, brand } = useApp()
  const isAllowed = user?.role === 'superadmin' || user?.is_partner === true
  const [active, setActive] = useState(KNOWN_LISTS[0].key)
  const [entries, setEntries] = useState<WholesaleAdminListEntry[]>([])
  const [newValue, setNewValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [locations, setLocations] = useState<{ id: string; name: string; active: boolean; sort_order: number }[]>([])
  const [showLocations, setShowLocations] = useState(false)
  const [newLocation, setNewLocation] = useState('')

  async function reload() {
    if (!brand) return
    setErr(null)
    try {
      const { data, error } = await supabase.from('wholesale_admin_lists')
        .select('*').eq('brand', brand).eq('list_key', active)
        .order('sort_order')
      if (error) throw new Error(error.message)
      setEntries((data || []) as WholesaleAdminListEntry[])

      const { data: locs } = await supabase.from('inventory_locations')
        .select('id, name, active, sort_order').eq('brand', brand).is('archived_at', null)
        .order('sort_order')
      setLocations((locs || []) as any[])
    } catch (e: any) { setErr(e?.message || 'Failed') }
  }
  useEffect(() => { void reload() }, [brand, active])

  async function addValue() {
    const v = newValue.trim()
    if (!v) return
    setBusy(true); setErr(null)
    try {
      const sortOrder = (entries[entries.length - 1]?.sort_order ?? 0) + 1
      const { data, error } = await supabase.from('wholesale_admin_lists').insert({
        brand, list_key: active, value: v, sort_order: sortOrder, active: true,
        created_by: user?.id || null, updated_by: user?.id || null,
      }).select('*').single()
      if (error) throw new Error(error.message)
      await logAudit({
        brand: brand!, entity_type: 'inventory_location', entity_id: (data as any).id,
        action: 'created', after: { list_key: active, value: v },
        actor_id: user?.id || null, actor_email: user?.email || null,
      })
      setNewValue('')
      await reload()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function toggleActive(e: WholesaleAdminListEntry) {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('wholesale_admin_lists')
        .update({ active: !e.active, updated_by: user?.id || null }).eq('id', e.id)
      if (error) throw new Error(error.message)
      await reload()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function rename(e: WholesaleAdminListEntry) {
    const next = prompt('Rename:', e.value)
    if (!next || next === e.value) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('wholesale_admin_lists')
        .update({ value: next.trim(), updated_by: user?.id || null }).eq('id', e.id)
      if (error) throw new Error(error.message)
      await reload()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function move(e: WholesaleAdminListEntry, dir: -1 | 1) {
    const idx = entries.findIndex(x => x.id === e.id)
    const target = entries[idx + dir]
    if (!target) return
    setBusy(true)
    try {
      await Promise.all([
        supabase.from('wholesale_admin_lists').update({ sort_order: target.sort_order }).eq('id', e.id),
        supabase.from('wholesale_admin_lists').update({ sort_order: e.sort_order }).eq('id', target.id),
      ])
      await reload()
    } catch (err: any) { setErr(err?.message || 'Failed') }
    setBusy(false)
  }

  async function addLocation() {
    const v = newLocation.trim()
    if (!v) return
    setBusy(true); setErr(null)
    try {
      const sortOrder = (locations[locations.length - 1]?.sort_order ?? 0) + 1
      const { error } = await supabase.from('inventory_locations').insert({
        brand, name: v, sort_order: sortOrder, active: true,
      })
      if (error) throw new Error(error.message)
      setNewLocation('')
      await reload()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  if (!isAllowed) {
    return <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
      Admin lists are superadmin / partner only.
    </div>
  }

  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KNOWN_LISTS.map(l => (
          <button key={l.key} onClick={() => { setActive(l.key); setShowLocations(false) }}
            className={(!showLocations && active === l.key) ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>
            {l.label}
          </button>
        ))}
        <button onClick={() => setShowLocations(true)}
          className={showLocations ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>
          📍 Locations
        </button>
      </div>

      {err && <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{err}</div>}

      {showLocations ? (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input type="text" value={newLocation} onChange={e => setNewLocation(e.target.value)}
              placeholder="New location (e.g., Vault A)" style={{ flex: 1, padding: 6 }} />
            <button onClick={addLocation} disabled={busy} className="btn-primary btn-sm">+ Add</button>
          </div>
          {locations.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--mist)', textAlign: 'center' }}>No locations.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {locations.map(l => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: 6, fontWeight: 700 }}>{l.name}</td>
                    <td style={{ padding: 6 }}>
                      {l.active ? <span style={{ color: 'var(--green)' }}>active</span> : <span style={{ color: 'var(--mist)' }}>inactive</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)}
              placeholder="New value" style={{ flex: 1, padding: 6 }} />
            <button onClick={addValue} disabled={busy} className="btn-primary btn-sm">+ Add</button>
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--mist)', textAlign: 'center' }}>No values yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                    <td style={{ padding: 6, width: 60, color: 'var(--mist)' }}>
                      {i > 0 && <button onClick={() => move(e, -1)} disabled={busy} className="btn-outline btn-xs">↑</button>}
                      {i < entries.length - 1 && <button onClick={() => move(e, 1)} disabled={busy} className="btn-outline btn-xs" style={{ marginLeft: 2 }}>↓</button>}
                    </td>
                    <td style={{ padding: 6, fontWeight: 700, opacity: e.active ? 1 : 0.5 }}>{e.value}</td>
                    <td style={{ padding: 6 }}>
                      {e.active
                        ? <span style={{ color: 'var(--green)' }}>active</span>
                        : <span style={{ color: 'var(--mist)' }}>inactive</span>}
                    </td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      <button onClick={() => rename(e)} disabled={busy} className="btn-outline btn-xs">Rename</button>
                      <button onClick={() => toggleActive(e)} disabled={busy} className="btn-outline btn-xs" style={{ marginLeft: 4 }}>
                        {e.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
            Deactivated values stay on existing records but won't appear in new-record dropdowns.
          </div>
        </div>
      )}
    </div>
  )
}
