'use client'

// Admin-only state→rep territory grid. Lives in Settings.
// Each row = one US state (or DC / PR). Picking a rep upserts
// into sales_rep_territories; "—" clears the row. Reassignments
// take effect for newly-created leads only — existing leads keep
// their previously-assigned rep (per spec 5a).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listTerritories, setTerritory, clearTerritory, US_STATES,
  type TerritoryAssignment,
} from '@/lib/sales/territories'

const UNASSIGNED = '__unassigned__'

export default function SalesRepTerritoriesPanel() {
  const { user, users } = useApp()
  const [rows, setRows] = useState<TerritoryAssignment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  async function reload() {
    setError(null)
    try { setRows(await listTerritories()) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  // Pickable reps: sales_rep, plus admin / superadmin / partner
  // (admins occasionally take their own leads).
  const repOptions = useMemo(() => users
    .filter(u => u.active !== false)
    .filter(u => u.role === 'sales_rep' || u.role === 'admin' || u.role === 'superadmin' || u.is_partner)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [users])

  const byState = useMemo(() => {
    const m = new Map<string, TerritoryAssignment>()
    for (const r of rows) m.set(r.state, r)
    return m
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return US_STATES
    return US_STATES.filter(s =>
      s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    )
  }, [search])

  async function handleChange(stateCode: string, repId: string) {
    setError(null)
    try {
      if (repId === UNASSIGNED) {
        await clearTerritory(stateCode)
      } else {
        await setTerritory(stateCode, repId, user?.id || null)
      }
      await reload()
    } catch (err: any) {
      setError(err?.message || 'Could not save')
    }
  }

  // Per-rep tally so admin can see workload at a glance.
  const tally = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[r.rep_user_id] = (m[r.rep_user_id] || 0) + 1
    return m
  }, [rows])

  return (
    <div>
      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter states (e.g. NY, Texas)…"
          style={{ flex: 1, minWidth: 180 }}
        />
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          {rows.length} of {US_STATES.length} states assigned
        </span>
      </div>

      {/* Rep workload summary */}
      {repOptions.length > 0 && Object.keys(tally).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {repOptions.filter(r => tally[r.id] > 0).map(r => (
            <span key={r.id} style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
              background: 'var(--green-pale)', color: 'var(--green-dark)',
              border: '1px solid var(--green3)',
            }}>
              {r.name}: {tally[r.id]}
            </span>
          ))}
        </div>
      )}

      {!loaded ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 6,
        }}>
          {visible.map(s => {
            const current = byState.get(s.code)
            return (
              <div key={s.code}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 6,
                  background: current ? 'var(--cream)' : 'transparent',
                  border: '1px solid var(--cream2)',
                }}>
                <div style={{ width: 28, fontSize: 11, fontWeight: 800, color: 'var(--mist)' }}>{s.code}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </div>
                <select
                  value={current?.rep_user_id || UNASSIGNED}
                  onChange={e => handleChange(s.code, e.target.value)}
                  style={{ width: 'auto', minWidth: 110, fontSize: 12 }}
                >
                  <option value={UNASSIGNED}>—</option>
                  {repOptions.map(u => (
                    <option key={u.id} value={u.id}>{u.name?.split(' ')[0] || u.name}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mist)' }}>
        New leads with a state matching one of these rows are auto-assigned to that rep on creation.
        Reassignment here does NOT retroactively re-route existing leads (per spec).
      </div>
    </div>
  )
}
