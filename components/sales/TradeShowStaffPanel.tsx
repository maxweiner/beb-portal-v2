'use client'

// Per-trade-show staff assignment grid. Rows = staffed users,
// columns = each date in the show's range. Checkboxes toggle
// which days that staffer is on the booth. New staffers picked
// from a dropdown of active non-buyer users; the unique
// constraint on (trade_show_id, user_id) prevents duplicates.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listStaff, addStaff, setAssignedDates, removeStaff,
  enumerateShowDates, fmtDayHeader,
  type TradeShowStaffer,
} from '@/lib/sales/tradeShowStaff'
import type { User } from '@/types'

interface Props {
  tradeShowId: string
  startDate: string
  endDate: string
  canWrite: boolean
}

export default function TradeShowStaffPanel({ tradeShowId, startDate, endDate, canWrite }: Props) {
  const { users } = useApp()
  const [rows, setRows] = useState<TradeShowStaffer[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [pickedUserId, setPickedUserId] = useState<string>('')

  const dates = useMemo(() => enumerateShowDates(startDate, endDate), [startDate, endDate])

  async function reload() {
    setError(null)
    try {
      setRows(await listStaff(tradeShowId))
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [tradeShowId])

  // Eligible staffers: active, not pending, not raw "buyer".
  // Includes admins, superadmins, sales reps, marketing, accounting,
  // and partners. Admin can pick from this list.
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const eligibleUsers = useMemo(() => users
    .filter(u => u.active !== false)
    .filter(u => u.role !== 'pending')
    .filter(u => u.role !== 'buyer' || u.is_partner)  // partners stay even if role=buyer
    .filter(u => !rows.some(r => r.user_id === u.id))  // exclude already-assigned
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [users, rows])

  async function toggleDate(row: TradeShowStaffer, iso: string) {
    if (!canWrite) return
    const has = row.assigned_dates.includes(iso)
    const next = has
      ? row.assigned_dates.filter(d => d !== iso)
      : [...row.assigned_dates, iso].sort()
    // Optimistic UI; revert on error.
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, assigned_dates: next } : r))
    try {
      await setAssignedDates(row.id, next)
    } catch (err: any) {
      alert(err?.message || 'Could not save')
      void reload()
    }
  }

  async function handleAdd() {
    if (!pickedUserId || !canWrite) return
    try {
      // Default: assign to ALL show dates. Quick path for the common
      // "this person is here the whole time" case; admin can untick
      // days afterwards.
      const created = await addStaff(tradeShowId, pickedUserId, dates)
      setRows(p => [...p, created])
      setPicking(false)
      setPickedUserId('')
    } catch (err: any) {
      setError(err?.message || 'Could not add')
    }
  }

  async function handleRemove(row: TradeShowStaffer) {
    if (!canWrite) return
    const u = usersById.get(row.user_id)
    if (!confirm(`Remove ${u?.name || 'this person'} from the staff list?`)) return
    try {
      await removeStaff(row.id)
      setRows(p => p.filter(r => r.id !== row.id))
    } catch (err: any) {
      alert(err?.message || 'Could not remove')
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>👥 Staff &amp; Schedule</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            Who's on the booth, on which days. Used for organizing + booth-appointment routing.
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : dates.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          Set the show's dates first — the day grid keys off start &amp; end date.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--cream2)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Staffer</th>
                {dates.map(iso => {
                  const h = fmtDayHeader(iso)
                  return (
                    <th key={iso} style={{
                      textAlign: 'center', padding: '6px 4px',
                      fontSize: 10, fontWeight: 800, color: 'var(--mist)',
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>
                      <div>{h.weekday}</div>
                      <div style={{ fontSize: 13, color: 'var(--ink)' }}>{h.day}</div>
                      <div style={{ fontSize: 9, opacity: 0.7 }}>{h.month}</div>
                    </th>
                  )
                })}
                {canWrite && <th style={{ width: 32 }} />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !picking && (
                <tr>
                  <td colSpan={dates.length + (canWrite ? 2 : 1)}
                    style={{ padding: 18, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>
                    No staff assigned yet.
                  </td>
                </tr>
              )}
              {rows.map(r => {
                const u = usersById.get(r.user_id)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--ink)' }}>
                      {u?.name || <span style={{ color: 'var(--mist)' }}>(removed user)</span>}
                      {u?.role && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'capitalize' }}>
                          · {u.role.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    {dates.map(iso => {
                      const checked = r.assigned_dates.includes(iso)
                      return (
                        <td key={iso} style={{ textAlign: 'center', padding: '4px' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canWrite}
                            onChange={() => toggleDate(r, iso)}
                            style={{ width: 18, height: 18, cursor: canWrite ? 'pointer' : 'default' }}
                          />
                        </td>
                      )
                    })}
                    {canWrite && (
                      <td style={{ textAlign: 'center', padding: '4px' }}>
                        <button onClick={() => handleRemove(r)}
                          aria-label="Remove staffer" title="Remove staffer"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 16 }}>×</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && dates.length > 0 && (
        picking ? (
          <div style={{
            marginTop: 12, padding: 12,
            background: 'var(--green-pale)', border: '1px dashed var(--green3)',
            borderRadius: 8,
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Add staffer
            </span>
            <select value={pickedUserId} onChange={e => setPickedUserId(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}>
              <option value="">Pick a person…</option>
              {eligibleUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name} · {u.role.replace('_', ' ')}</option>
              ))}
            </select>
            <button onClick={() => { setPicking(false); setPickedUserId('') }} className="btn-outline btn-sm">Cancel</button>
            <button onClick={handleAdd} disabled={!pickedUserId} className="btn-primary btn-sm">Add</button>
            <div style={{ width: '100%', fontSize: 11, color: 'var(--mist)' }}>
              Defaults to all {dates.length} day{dates.length === 1 ? '' : 's'} — untick days afterwards if they're partial.
            </div>
          </div>
        ) : (
          <button onClick={() => setPicking(true)} className="btn-outline btn-sm" style={{ marginTop: 12 }}>
            + Add staffer
          </button>
        )
      )}
    </div>
  )
}
