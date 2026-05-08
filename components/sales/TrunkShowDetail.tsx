'use client'

// Trunk Show detail page. Phase 10: store / dates / rep / status
// / notes editable; per-day open + close hours grid. Later phases
// add special requests, customer appointment slots, and spiffs.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import Checkbox from '@/components/ui/Checkbox'
import {
  getTrunkShow, updateTrunkShow, softDeleteTrunkShow,
  listHours, setHoursForDate, reconcileHours,
  enumerateDates, effectiveStatus,
} from '@/lib/sales/trunkShows'
import type { TrunkShow, TrunkShowHours, TrunkShowStatus } from '@/types'
import SpecialRequestsPanel from './SpecialRequestsPanel'
import TrunkShowAppointmentsPanel from './TrunkShowAppointmentsPanel'
import SpiffsPanel from './SpiffsPanel'
import TrunkShowCommsSection from './TrunkShowCommsSection'
import CommsLogPanel from '@/components/communications/CommsLogPanel'
import TrunkShowChecklistSection from './TrunkShowChecklistSection'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'

interface Props {
  trunkShowId: string
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
  setNav?: (n: import('@/app/page').NavPage) => void
}

export default function TrunkShowDetail({ trunkShowId, onBack, onChanged, onDeleted, setNav }: Props) {
  const { user, trunkShowStores, users } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [show, setShow] = useState<TrunkShow | null>(null)
  const [hours, setHours] = useState<TrunkShowHours[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    store_id: '', start_date: '', end_date: '',
    assigned_rep_id: '', status: 'scheduled' as TrunkShowStatus, notes: '',
    vip_showing: false,
    confirmation_letter_sent_at: '' as string,
    postcards_email_sent_at: '' as string,
    postcards_ordered_at: '' as string,
    proofed_at: '' as string,
    final_files_sent_at: '' as string,
    post_event_questionnaire_sent_at: '' as string,
  })

  // Trunk rep pool only — admins, partners, and other roles are NOT
  // implicitly trunk reps. To appear here, a user must have the
  // is_trunk_rep flag toggled in Admin → Users.
  const repOptions = useMemo(() => users
    .filter(u => u.active !== false)
    .filter(u => (u as any).is_trunk_rep === true)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [users])

  const canMutate = isAdmin || (show && user?.id === show.assigned_rep_id)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await getTrunkShow(trunkShowId)
        if (cancelled) return
        if (!row) { setError('Trunk show not found.'); setLoaded(true); return }
        setShow(row)
        setDraft({
          store_id: row.store_id,
          start_date: row.start_date,
          end_date: row.end_date,
          assigned_rep_id: row.assigned_rep_id || '',
          status: row.status,
          notes: row.notes || '',
          vip_showing: !!row.vip_showing,
          confirmation_letter_sent_at: row.confirmation_letter_sent_at || '',
          postcards_email_sent_at:     row.postcards_email_sent_at     || '',
          postcards_ordered_at:        row.postcards_ordered_at        || '',
          proofed_at:                  row.proofed_at                  || '',
          final_files_sent_at:         row.final_files_sent_at         || '',
          post_event_questionnaire_sent_at: row.post_event_questionnaire_sent_at || '',
        })
        const hrs = await listHours(trunkShowId)
        if (cancelled) return
        setHours(hrs)
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Failed to load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [trunkShowId])

  // Save show fields. Reconcile hours rows when start/end change.
  const status = useAutosave(
    draft,
    async (d) => {
      if (!show || !canMutate) return
      const datesChanged = d.start_date !== show.start_date || d.end_date !== show.end_date
      const repChanged = d.assigned_rep_id !== show.assigned_rep_id
      // Hard block: if the rep is being changed (or dates moved), the
      // new rep can't already be on a Reserved trunk show whose dates
      // overlap. Surface as an alert + revert local draft.
      if ((repChanged || datesChanged) && d.assigned_rep_id) {
        const { data: conflicts } = await supabase.from('trunk_shows')
          .select('id, start_date, end_date')
          .eq('assigned_rep_id', d.assigned_rep_id)
          .eq('status', 'reserved')
          .neq('id', show.id)
          .lte('start_date', d.end_date)
          .gte('end_date', d.start_date)
          .is('deleted_at', null)
        if (conflicts && conflicts.length > 0) {
          const c = conflicts[0]
          const repName = users.find(u => u.id === d.assigned_rep_id)?.name || 'this rep'
          alert(`${repName} is already on a Reserved trunk show ${c.start_date}–${c.end_date}. Revert this change or resolve that show first.`)
          // Roll back the rep field locally so the UI doesn't lie.
          setDraft(p => ({ ...p, assigned_rep_id: show.assigned_rep_id || '' }))
          return
        }
      }
      await updateTrunkShow(show.id, {
        store_id: d.store_id,
        start_date: d.start_date,
        end_date:   d.end_date,
        assigned_rep_id: d.assigned_rep_id,
        status: d.status,
        notes: d.notes,
        vip_showing: d.vip_showing,
        confirmation_letter_sent_at:      d.confirmation_letter_sent_at      || null,
        postcards_email_sent_at:          d.postcards_email_sent_at          || null,
        postcards_ordered_at:             d.postcards_ordered_at             || null,
        proofed_at:                       d.proofed_at                       || null,
        final_files_sent_at:              d.final_files_sent_at              || null,
        post_event_questionnaire_sent_at: d.post_event_questionnaire_sent_at || null,
      })
      if (datesChanged) {
        await reconcileHours(show.id, d.start_date, d.end_date)
        const hrs = await listHours(show.id)
        setHours(hrs)
        setShow({ ...show, start_date: d.start_date, end_date: d.end_date })
      }
      onChanged()
    },
    { delay: 800, enabled: loaded && !!show && !!draft.store_id && !!draft.start_date
                          && !!draft.end_date && !!draft.assigned_rep_id && !!canMutate },
  )

  async function handleHoursChange(date: string, openTime: string, closeTime: string) {
    if (!show || !canMutate) return
    if (closeTime <= openTime) return
    setHours(prev => prev.map(h => h.show_date === date ? { ...h, open_time: openTime, close_time: closeTime } : h))
    try {
      await setHoursForDate(show.id, date, openTime, closeTime)
    } catch (err: any) {
      alert(err?.message || 'Could not save hours')
    }
  }

  async function handleDelete() {
    if (!show || !isAdmin) return
    if (!confirm(`Delete trunk show at ${trunkShowStores.find(s => s.id === show.store_id)?.name || 'store'}?`)) return
    try { await softDeleteTrunkShow(show.id); onDeleted() }
    catch (err: any) { alert(err?.message || 'Could not delete') }
  }

  // Promote a Reserved trunk show → scheduled. Allowed for admins
  // and the assigned rep on this show. The verify-worker-list (B2)
  // happens via the confirm dialog naming the rep explicitly.
  async function handlePromote() {
    if (!show) return
    const canPromote = isAdmin || user?.id === show.assigned_rep_id
    if (!canPromote) { alert('Only an admin or the assigned rep can promote this trunk show.'); return }
    const repName = users.find(u => u.id === show.assigned_rep_id)?.name || '(unassigned)'
    if (!confirm(`Promote to Booked?\n\nAssigned rep: ${repName}\n\nThis confirms the trunk show is going forward.`)) return
    try {
      await updateTrunkShow(show.id, { status: 'scheduled' })
      setShow({ ...show, status: 'scheduled' })
      setDraft(p => ({ ...p, status: 'scheduled' }))
      onChanged()
    } catch (err: any) { alert(err?.message || 'Could not promote') }
  }

  // Cancel — keep visible with a strikethrough, or hard-delete via
  // the existing Delete button. Only shown for Reserved (Q6).
  async function handleCancelKeep() {
    if (!show || !isAdmin) return
    if (!confirm('Cancel this trunk show but keep it visible (with a strikethrough)?')) return
    try {
      await updateTrunkShow(show.id, { status: 'cancelled' })
      setShow({ ...show, status: 'cancelled' })
      setDraft(p => ({ ...p, status: 'cancelled' }))
      onChanged()
    } catch (err: any) { alert(err?.message || 'Could not cancel') }
  }

  if (!loaded) return <div className="p-6 text-center" style={{ color: 'var(--mist)' }}>Loading…</div>
  if (error || !show) return (
    <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onBack} className="btn-outline btn-sm" style={{ marginBottom: 14 }}>← Trunk Shows</button>
      <div className="card" style={{ padding: 20, color: '#991B1B', background: '#FEE2E2' }}>{error || 'Not found'}</div>
    </div>
  )

  const store = trunkShowStores.find(s => s.id === show.store_id)
  const eff = effectiveStatus({ ...show, status: draft.status })

  return (
    <div className="p-6" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn-outline btn-sm">← Trunk Shows</button>
        <div style={{ flex: 1 }} />
        <AutosaveIndicator status={status} />
        {show.status === 'reserved' && (isAdmin || user?.id === show.assigned_rep_id) && (
          <button onClick={handlePromote} className="btn-primary btn-sm" title="Confirm this trunk show is going forward">
            ✅ Promote to Booked
          </button>
        )}
        {show.status === 'reserved' && isAdmin && (
          <button onClick={handleCancelKeep} className="btn-outline btn-sm">Cancel (keep visible)</button>
        )}
        {isAdmin && (
          <button onClick={handleDelete} className="btn-outline btn-sm" style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{store?.name || '(unknown store)'}</h1>
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '.04em',
            background: 'var(--green-pale)', color: 'var(--green-dark)',
            border: '1px solid var(--green3)',
          }}>
            {eff.replace('_', ' ')}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Store" required>
            <select value={draft.store_id} onChange={e => setDraft(p => ({ ...p, store_id: e.target.value }))} disabled={!canMutate}>
              {trunkShowStores.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}, ${s.state}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Assigned rep" required>
            <select value={draft.assigned_rep_id} onChange={e => setDraft(p => ({ ...p, assigned_rep_id: e.target.value }))} disabled={!canMutate}>
              {repOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Start date" required>
            <DatePicker value={draft.start_date} onChange={v => setDraft(p => ({ ...p, start_date: v }))} disabled={!canMutate} />
          </Field>
          <Field label="End date" required>
            <DatePicker value={draft.end_date} onChange={v => setDraft(p => ({ ...p, end_date: v }))} disabled={!canMutate} />
          </Field>
          <Field label="Status">
            <select value={draft.status} onChange={e => setDraft(p => ({ ...p, status: e.target.value as TrunkShowStatus }))} disabled={!canMutate}>
              <option value="reserved">📌 Reserved</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={draft.notes} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} disabled={!canMutate} />
        </Field>
      </div>

      {/* Per-day hours */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>🕒 Hours</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
          One row per show date. Defaults to 10am – 5pm; edit any row to adjust that day.
        </div>
        {hours.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>
            Set start &amp; end dates to populate the hours grid.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hours.map(h => (
              <HoursRow key={h.id} h={h} canWrite={!!canMutate} onChange={handleHoursChange} />
            ))}
          </div>
        )}
      </div>

      {/* Marketing checklist — milestones from the legacy spreadsheet */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>📬 Marketing Checklist</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
          Track the show prep workflow. Pick a date when each milestone is done; clear to mark not done.
        </div>
        <div style={{ marginBottom: 12 }}>
          <Checkbox
            checked={!!draft.vip_showing}
            disabled={!canMutate}
            onChange={(next) => setDraft(p => ({ ...p, vip_showing: next }))}
            label={<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>⭐ VIP Showing</span>}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {([
            ['Confirmation Letter Sent',     'confirmation_letter_sent_at'],
            ['Postcards Email Sent',         'postcards_email_sent_at'],
            ['Postcards Ordered',            'postcards_ordered_at'],
            ['Proofed',                      'proofed_at'],
            ['Final Files Sent',             'final_files_sent_at'],
            ['Post-Event Questionnaire Sent', 'post_event_questionnaire_sent_at'],
          ] as const).map(([label, key]) => (
            <Field key={key} label={label}>
              <DatePicker
                value={(draft as any)[key] || ''}
                onChange={v => setDraft(p => ({ ...p, [key]: v } as any))}
                disabled={!canMutate}
              />
            </Field>
          ))}
        </div>
      </div>

      {/* Special requests — Phase 11 */}
      <SpecialRequestsPanel trunkShowId={show.id} canWrite={!!canMutate} />

      {/* Trunk customer bookings — Phase 12 */}
      <TrunkShowAppointmentsPanel
        trunkShowId={show.id}
        hours={hours}
        canWrite={!!canMutate}
        store={trunkShowStores.find(s => s.id === show.store_id) as any || null}
      />

      {/* Spiffs — Phase 13 */}
      <SpiffsPanel trunkShowId={show.id} canMarkPaid={isAdmin} />

      {/* Pre-event checklist — Trunk Comms phase 10 */}
      <TrunkShowChecklistSection trunkShowId={show.id} setNav={setNav} />

      {/* Communications log — sent, scheduled, cancelled, failed in
          one unified panel with inline cancel/reschedule actions. */}
      <CommsLogPanel trunkShowId={show.id} />

      {/* Legacy comms section — kept for the View PDF / View email /
          Resend actions which CommsLogPanel doesn't surface yet. */}
      <TrunkShowCommsSection trunkShowId={show.id} setNav={setNav} />
    </div>
  )
}

function HoursRow({ h, canWrite, onChange }: {
  h: TrunkShowHours
  canWrite: boolean
  onChange: (date: string, openTime: string, closeTime: string) => void
}) {
  const [open, setOpen] = useState(h.open_time.slice(0, 5))
  const [close, setClose] = useState(h.close_time.slice(0, 5))
  const fmtDay = new Date(h.show_date + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 12px', background: 'var(--cream)', borderRadius: 6,
    }}>
      <div style={{ minWidth: 200, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtDay}</div>
      <TimePicker value={open}
        onChange={v => { setOpen(v); onChange(h.show_date, v, close) }}
        disabled={!canWrite} style={{ width: 200 }} />
      <span style={{ color: 'var(--mist)' }}>–</span>
      <TimePicker value={close}
        onChange={v => { setClose(v); onChange(h.show_date, open, v) }}
        disabled={!canWrite} style={{ width: 200 }} />
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <label className="fl">{label}{required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}</label>
      {children}
    </div>
  )
}
