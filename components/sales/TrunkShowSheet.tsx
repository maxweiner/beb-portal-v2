'use client'

// Sheet-style view of trunk shows. Editable in-cell: store, dates,
// rep, VIP, and the five marketing milestones. Notes + status stay
// read-only here; click the row → detail page for those.
//
// Each milestone column is a checkbox + tiny date label. Toggling the
// checkbox auto-stamps:
//   off → on : *_at = today, *_by = current user
//   on  → off: *_at = null,  *_by = null  (audit-log captures the unset)
//
// Saves are immediate per cell — no debounce. Changes happen one cell
// at a time and we want quick feedback. Per-row status indicator is
// shown at the far right of each row.

import { useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  updateTrunkShow, createTrunkShow, effectiveStatus,
  TRUNK_SHOW_MILESTONES, type TrunkShowMilestoneKey,
} from '@/lib/sales/trunkShows'
import type { TrunkShow, TrunkShowStore, TrunkShowStatus, User } from '@/types'
import Checkbox from '@/components/ui/Checkbox'
import DatePicker from '@/components/ui/DatePicker'

type RowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const STATUS_LABEL: Record<TrunkShowStatus, string> = {
  reserved: 'Reserved', scheduled: 'Scheduled',
  in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<TrunkShowStatus, { bg: string; fg: string }> = {
  reserved:    { bg: '#FFFBEB', fg: '#92400E' },
  scheduled:   { bg: '#FEF3C7', fg: '#92400E' },
  in_progress: { bg: '#D1FAE5', fg: '#065F46' },
  completed:   { bg: '#DBEAFE', fg: '#1E40AF' },
  cancelled:   { bg: '#E5E7EB', fg: '#374151' },
}

const HEADER_STYLE = {
  padding: '8px 10px',
  fontWeight: 800,
  fontSize: 10,
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
  color: 'var(--mist)',
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
  borderBottom: '1px solid var(--pearl)',
  background: 'var(--cream2)',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
}
const CELL_STYLE = {
  padding: '6px 10px',
  borderTop: '1px solid var(--pearl)',
  verticalAlign: 'middle' as const,
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

interface SheetProps {
  shows: TrunkShow[]
  onChanged: () => void
  onOpen: (id: string) => void
}

export default function TrunkShowSheet({ shows, onChanged, onOpen }: SheetProps) {
  const { user, users, trunkShowStores } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner

  const repOptions = useMemo(
    () => users
      .filter(u => u.active !== false)
      .filter(u => (u as any).is_trunk_rep === true)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [users],
  )

  const activeStores = useMemo(
    () => trunkShowStores
      .filter(s => s.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [trunkShowStores],
  )

  return (
    <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={HEADER_STYLE}>Store</th>
            <th style={HEADER_STYLE}>Start</th>
            <th style={HEADER_STYLE}>End</th>
            <th style={HEADER_STYLE}>Rep</th>
            <th style={{ ...HEADER_STYLE, textAlign: 'center' }}>VIP</th>
            {TRUNK_SHOW_MILESTONES.map(m => (
              <th key={m.key} style={{ ...HEADER_STYLE, textAlign: 'center' }}>{m.label}</th>
            ))}
            <th style={HEADER_STYLE}>Notes</th>
            <th style={HEADER_STYLE}>Status</th>
            <th style={{ ...HEADER_STYLE, width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {shows.map(s => (
            <SheetRow
              key={s.id}
              show={s}
              users={users}
              repOptions={repOptions}
              stores={activeStores}
              currentUserId={user?.id || null}
              isAdmin={isAdmin}
              onChanged={onChanged}
              onOpen={onOpen}
            />
          ))}
          {isAdmin && (
            <AddRow
              repOptions={repOptions}
              stores={activeStores}
              onAdded={onChanged}
            />
          )}
        </tbody>
      </table>
    </div>
  )
}

function SheetRow({
  show, users, repOptions, stores, currentUserId, isAdmin, onChanged, onOpen,
}: {
  show: TrunkShow
  users: User[]
  repOptions: User[]
  stores: TrunkShowStore[]
  currentUserId: string | null
  isAdmin: boolean
  onChanged: () => void
  onOpen: (id: string) => void
}) {
  const [status, setStatus] = useState<RowSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Local optimistic copy so the cell reflects the click before round-trip.
  const [local, setLocal] = useState(show)

  async function save(patch: Partial<TrunkShow>) {
    setLocal(prev => ({ ...prev, ...patch }))
    setStatus('saving')
    setError(null)
    try {
      await updateTrunkShow(show.id, patch as any)
      setStatus('saved')
      onChanged()
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1500)
    } catch (err: any) {
      setStatus('error')
      setError(err?.message || 'Save failed')
      // Revert optimistic
      setLocal(show)
    }
  }

  function toggleMilestone(key: TrunkShowMilestoneKey, next: boolean) {
    const atKey = `${key}_at` as const
    const byKey = `${key}_by` as const
    const patch: any = {}
    if (next) {
      patch[atKey] = todayIso()
      patch[byKey] = currentUserId
    } else {
      patch[atKey] = null
      patch[byKey] = null
    }
    void save(patch)
  }

  const eff = effectiveStatus(local)
  const sc = STATUS_COLOR[eff]
  const repName = local.assigned_rep_id
    ? users.find(u => u.id === local.assigned_rep_id)?.name || '—'
    : '—'

  return (
    <tr style={{
      opacity: eff === 'cancelled' ? 0.55 : 1,
      background: eff === 'reserved' ? '#FFFBEB' : '#fff',
    }}>
      {/* Store */}
      <td style={{ ...CELL_STYLE, minWidth: 160 }}>
        {isAdmin ? (
          <select
            value={local.store_id}
            onChange={e => save({ store_id: e.target.value })}
            disabled={!isAdmin}
            style={cellSelectStyle}
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {!stores.find(s => s.id === local.store_id) && (
              <option value={local.store_id}>(unknown / archived)</option>
            )}
          </select>
        ) : (
          <span>{stores.find(s => s.id === local.store_id)?.name || '—'}</span>
        )}
      </td>

      {/* Start date */}
      <td style={{ ...CELL_STYLE, minWidth: 120 }}>
        {isAdmin ? (
          <DatePicker
            value={local.start_date}
            onChange={v => v && save({ start_date: v })}
          />
        ) : <span>{local.start_date}</span>}
      </td>

      {/* End date */}
      <td style={{ ...CELL_STYLE, minWidth: 120 }}>
        {isAdmin ? (
          <DatePicker
            value={local.end_date}
            onChange={v => v && save({ end_date: v })}
          />
        ) : <span>{local.end_date}</span>}
      </td>

      {/* Rep */}
      <td style={{ ...CELL_STYLE, minWidth: 140 }}>
        {isAdmin ? (
          <select
            value={local.assigned_rep_id || ''}
            onChange={e => save({ assigned_rep_id: e.target.value || null })}
            style={cellSelectStyle}
          >
            <option value="">— unassigned —</option>
            {repOptions.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        ) : <span>{repName}</span>}
      </td>

      {/* VIP */}
      <td style={{ ...CELL_STYLE, textAlign: 'center' }}>
        <Checkbox
          checked={!!local.vip_showing}
          onChange={v => save({ vip_showing: v })}
          disabled={!isAdmin}
        />
      </td>

      {/* Milestone columns */}
      {TRUNK_SHOW_MILESTONES.map(m => {
        const atKey = `${m.key}_at` as keyof TrunkShow
        const checked = !!(local as any)[atKey]
        return (
          <td key={m.key} style={{ ...CELL_STYLE, textAlign: 'center', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Checkbox
                checked={checked}
                onChange={v => toggleMilestone(m.key, v)}
                disabled={!isAdmin}
                size={18}
              />
              {checked && (
                <span style={{ fontSize: 10, color: 'var(--mist)' }}>
                  {fmtShortDate((local as any)[atKey])}
                </span>
              )}
            </div>
          </td>
        )
      })}

      {/* Notes */}
      <td
        style={{ ...CELL_STYLE, maxWidth: 220, cursor: 'pointer' }}
        onClick={() => onOpen(show.id)}
        title={local.notes || 'Open detail to edit notes'}
      >
        <span style={{
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', color: local.notes ? 'var(--ink)' : 'var(--mist)',
          fontStyle: local.notes ? 'normal' : 'italic',
        }}>
          {local.notes || '—'}
        </span>
      </td>

      {/* Status */}
      <td style={{ ...CELL_STYLE, whiteSpace: 'nowrap' }}>
        <span style={{
          background: sc.bg, color: sc.fg,
          padding: '2px 8px', borderRadius: 999,
          fontSize: 10, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '.04em',
        }}>{STATUS_LABEL[eff]}</span>
      </td>

      {/* Save indicator + open detail */}
      <td style={{ ...CELL_STYLE, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <SaveIndicator status={status} error={error} />
        <button
          onClick={() => onOpen(show.id)}
          className="btn-outline btn-xs"
          style={{ marginLeft: 6 }}
          title="Open detail"
        >→</button>
      </td>
    </tr>
  )
}

function AddRow({
  repOptions, stores, onAdded,
}: {
  repOptions: User[]
  stores: TrunkShowStore[]
  onAdded: () => void
}) {
  const [storeId, setStoreId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [repId, setRepId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid = !!storeId && !!startDate && !!endDate && startDate <= endDate

  async function submit() {
    if (!valid) return
    setBusy(true)
    setErr(null)
    try {
      await createTrunkShow({
        store_id: storeId,
        start_date: startDate,
        end_date: endDate,
        assigned_rep_id: repId || null,
        status: 'scheduled',
      })
      // Reset row
      setStoreId(''); setStartDate(''); setEndDate(''); setRepId('')
      onAdded()
    } catch (e: any) {
      setErr(e?.message || 'Failed to create')
    }
    setBusy(false)
  }

  return (
    <tr style={{ background: '#FAFAF7' }}>
      <td style={{ ...CELL_STYLE, minWidth: 160 }}>
        <select
          value={storeId}
          onChange={e => setStoreId(e.target.value)}
          style={cellSelectStyle}
        >
          <option value="">+ Pick store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 120 }}>
        <DatePicker value={startDate} onChange={v => {
          setStartDate(v)
          if (v && !endDate) setEndDate(v)
        }} />
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 120 }}>
        <DatePicker value={endDate} onChange={setEndDate} />
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 140 }}>
        <select
          value={repId}
          onChange={e => setRepId(e.target.value)}
          style={cellSelectStyle}
        >
          <option value="">— unassigned —</option>
          {repOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </td>
      {/* VIP + 5 milestones empty for new row */}
      <td style={CELL_STYLE} />
      {TRUNK_SHOW_MILESTONES.map(m => <td key={m.key} style={CELL_STYLE} />)}
      <td style={CELL_STYLE} />
      <td style={CELL_STYLE} />
      <td style={{ ...CELL_STYLE, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="btn-primary btn-xs"
          title={valid ? 'Add trunk show' : 'Pick store + start + end first'}
        >
          {busy ? '…' : '+ Add'}
        </button>
        {err && (
          <div style={{ color: '#991B1B', fontSize: 10, marginTop: 2 }}>{err}</div>
        )}
      </td>
    </tr>
  )
}

function SaveIndicator({ status, error }: { status: RowSaveStatus; error: string | null }) {
  if (status === 'idle') return null
  if (status === 'saving') return <span style={{ fontSize: 10, color: 'var(--mist)' }}>⟳</span>
  if (status === 'saved') return <span style={{ fontSize: 10, color: 'var(--green)' }}>✓</span>
  return <span style={{ fontSize: 10, color: '#ef4444' }} title={error || 'Save failed'}>⚠</span>
}

const cellSelectStyle = {
  fontSize: 12,
  padding: '4px 6px',
  border: '1px solid var(--pearl)',
  borderRadius: 4,
  background: '#fff',
  fontFamily: 'inherit',
  width: '100%',
  cursor: 'pointer',
} as const
