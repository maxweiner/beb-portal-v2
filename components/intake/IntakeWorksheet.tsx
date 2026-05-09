'use client'

/**
 * End-of-day intake worksheet (Phase 4 + 7 + 8).
 *
 * Scoped to one event + one day. Lists every intake logged that day,
 * lets the buyer expand a row to edit fields + manage photos, and
 * submits the totals to that day's Day Entry row.
 *
 * - Edits write through `intake_audit_log` and respect the 3-day lock.
 * - Save also re-runs customer dedup (Phase 7) so a row that was missing
 *   a customer when first saved gets one once the buyer fills in the name.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { uploadIntakePhoto } from '@/lib/intake/photoUpload'
import { canEditIntake, diffFields, writeIntakeAudit } from '@/lib/intake/auditLog'
import { dedupAndUpsertCustomer } from '@/lib/intake/customerDedup'
import {
  aggregateIntakes, dayNumberFor, submitWorksheetToDayEntry,
  type IntakeRollupRow,
} from '@/lib/intake/dayentry'

interface Props {
  eventId: string
  storeId: string
  eventStartDate: string | null
  eventDisplayName: string
  onClose: () => void
}

interface IntakeRow {
  id: string
  buyer_id: string
  buy_form_number: string | null
  check_number: string | null
  purchase_amount: number | null
  commission_pct: number | null
  commission_bucket: 'rate_10' | 'rate_5' | 'rate_0' | 'store' | null
  intake_kind: 'check_in' | 'purchase' | 'check_in_then_purchase'
  customer_id: string | null
  phone: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  middle_name: string | null
  date_of_birth: string | null
  license_number: string | null
  license_state: string | null
  address_line1: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  license_photo_url: string | null
  back_photo_url: string | null
  invoice_photo_url: string | null
  processing_state: 'processing' | 'parsed' | 'parse_failed'
  parse_error_message: string | null
  submitted_to_day_entry_at: string | null
  scanned_at: string
  created_at: string
}

type JewelryRow = { id: string; intake_id: string; photo_url: string; sort_order: number }

const COMMISSION_OPTIONS: Array<{ key: 'rate_10' | 'rate_5' | 'rate_0' | 'store'; label: string; pct: number | null }> = [
  { key: 'rate_10', label: '10%',  pct: 10 },
  { key: 'rate_5',  label: '5%',   pct: 5 },
  { key: 'rate_0',  label: '0%',   pct: 0 },
  { key: 'store',   label: 'Store', pct: null },
]
const MAX_JEWELRY = 5

export default function IntakeWorksheet({
  eventId, storeId, eventStartDate, eventDisplayName, onClose,
}: Props) {
  const { user, users } = useApp()
  const [intakes, setIntakes] = useState<IntakeRow[]>([])
  const [jewelryByIntake, setJewelryByIntake] = useState<Map<string, JewelryRow[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('mine')
  const [submitting, setSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayStartIso = `${todayIso}T00:00:00`
  const todayEndIso = `${todayIso}T23:59:59.999`

  async function fetchAll() {
    setLoading(true)
    const { data: rows, error } = await supabase
      .from('customer_intakes')
      .select('id, buyer_id, buy_form_number, check_number, purchase_amount, commission_pct, commission_bucket, intake_kind, customer_id, phone, email, first_name, last_name, middle_name, date_of_birth, license_number, license_state, address_line1, address_city, address_state, address_zip, license_photo_url, back_photo_url, invoice_photo_url, processing_state, parse_error_message, submitted_to_day_entry_at, scanned_at, created_at')
      .eq('event_id', eventId)
      .gte('scanned_at', todayStartIso)
      .lte('scanned_at', todayEndIso)
      .order('scanned_at', { ascending: false })
    if (error) {
      console.error('[worksheet] fetch failed', error)
      setLoading(false)
      return
    }
    const list = (rows || []) as IntakeRow[]
    setIntakes(list)

    if (list.length > 0) {
      const ids = list.map(r => r.id)
      const { data: photos } = await supabase
        .from('intake_photos')
        .select('id, intake_id, photo_url, sort_order')
        .in('intake_id', ids)
        .order('sort_order')
      const m = new Map<string, JewelryRow[]>()
      for (const p of (photos || []) as JewelryRow[]) {
        const arr = m.get(p.intake_id) || []
        arr.push(p)
        m.set(p.intake_id, arr)
      }
      setJewelryByIntake(m)
    } else {
      setJewelryByIntake(new Map())
    }

    setLoading(false)
  }

  useEffect(() => { void fetchAll() }, [eventId, todayIso])

  const visible = useMemo(() => {
    if (filter === 'mine' && user?.id) return intakes.filter(r => r.buyer_id === user.id)
    return intakes
  }, [intakes, filter, user?.id])

  const totals = useMemo(() => aggregateIntakes(visible.map(r => ({
    id: r.id, customer_id: r.customer_id, intake_kind: r.intake_kind,
    purchase_amount: r.purchase_amount, commission_bucket: r.commission_bucket,
  }) as IntakeRollupRow)), [visible])

  const anyProcessing = useMemo(
    () => visible.some(r => r.processing_state === 'processing'),
    [visible]
  )

  async function handleSubmitDayEntry() {
    setSubmitMessage(null)
    setSubmitting(true)
    const dayNum = dayNumberFor({ start_date: eventStartDate }, todayIso)
    if (!dayNum) {
      setSubmitMessage('Today is outside this event\'s 3-day window — cannot submit.')
      setSubmitting(false)
      return
    }
    const result = await submitWorksheetToDayEntry({
      eventId,
      dayNumber: dayNum,
      totals,
      intakeIds: visible.map(r => r.id),
    })
    setSubmitting(false)
    if (result.ok) {
      setSubmitMessage(`✅ Submitted Day ${dayNum}: ${totals.customers} customers, $${totals.dollars10.toFixed(2)} @ 10%`)
      void fetchAll()
    } else {
      setSubmitMessage(`⚠ ${result.error}`)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--cream2)',
      display: 'flex', flexDirection: 'column', zIndex: 1900,
    }}>
      <div style={{
        padding: '12px 16px', background: '#fff', borderBottom: '1px solid var(--pearl)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>📋 Today's intakes</div>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>{eventDisplayName} · {todayIso}</div>
        </div>
        <button onClick={onClose} style={closeBtn}>Close ×</button>
      </div>

      {/* Totals strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        background: '#fff', borderBottom: '1px solid var(--pearl)',
      }}>
        <Tot label="Customers" value={String(totals.customers)} />
        <Tot label="Purchases" value={String(totals.purchases)} />
        <Tot label="@ 10%" value={`$${totals.dollars10.toFixed(0)}`} />
        <Tot label="@ 5%" value={`$${totals.dollars5.toFixed(0)}`} />
        <Tot label="@ 0%" value={`$${totals.dollars0.toFixed(0)}`} />
        <Tot label="Store" value={`$${totals.storePurchases.toFixed(0)}`} />
      </div>

      {/* Filter + submit */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 16px', background: '#fff',
        alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        borderBottom: '1px solid var(--pearl)',
      }}>
        <div style={{ display: 'inline-flex', gap: 2, background: 'var(--cream2)', padding: 2, borderRadius: 6 }}>
          {(['mine', 'all'] as const).map(f => {
            const sel = filter === f
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                padding: '5px 14px', border: 'none', borderRadius: 4,
                background: sel ? '#fff' : 'transparent',
                color: sel ? 'var(--green-dark)' : 'var(--mist)', cursor: 'pointer',
                boxShadow: sel ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}>{f === 'mine' ? 'My intakes' : 'All buyers'}</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {submitMessage && (
            <span style={{ fontSize: 12, color: submitMessage.startsWith('⚠') ? '#B22234' : 'var(--green-dark)' }}>
              {submitMessage}
            </span>
          )}
          <button
            onClick={handleSubmitDayEntry}
            disabled={anyProcessing || submitting || visible.length === 0}
            title={anyProcessing ? 'Wait for all rows to finish processing' : ''}
            style={{
              ...primaryBtn,
              opacity: (anyProcessing || submitting || visible.length === 0) ? 0.45 : 1,
              cursor: (anyProcessing || submitting || visible.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : '📊 Submit to Day Entry'}
          </button>
        </div>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && <div style={empty}>Loading…</div>}
        {!loading && visible.length === 0 && <div style={empty}>No intakes today yet.</div>}
        {!loading && visible.map(r => {
          const buyer = users?.find(u => u.id === r.buyer_id)
          const expanded = expandedId === r.id
          return (
            <IntakeRowCard
              key={r.id}
              row={r}
              buyerName={buyer?.name || '?'}
              jewelry={jewelryByIntake.get(r.id) || []}
              expanded={expanded}
              onToggle={() => setExpandedId(prev => prev === r.id ? null : r.id)}
              storeId={storeId}
              eventId={eventId}
              currentUser={user}
              onChanged={fetchAll}
            />
          )
        })}
      </div>
    </div>
  )
}

function Tot({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRight: '1px solid var(--cream2)' }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ── Per-row card with expandable edit panel ───────────────────

function IntakeRowCard({
  row, buyerName, jewelry, expanded, onToggle, storeId, eventId, currentUser, onChanged,
}: {
  row: IntakeRow
  buyerName: string
  jewelry: JewelryRow[]
  expanded: boolean
  onToggle: () => void
  storeId: string
  eventId: string
  currentUser: ReturnType<typeof useApp>['user']
  onChanged: () => void
}) {
  const editPerm = canEditIntake(currentUser as any, row.created_at)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editable fields (initialized from row, reset when row changes)
  const [buyFormNumber, setBuyFormNumber] = useState(row.buy_form_number || '')
  const [checkNumber, setCheckNumber] = useState(row.check_number || '')
  const [amount, setAmount] = useState(row.purchase_amount != null ? String(row.purchase_amount) : '')
  const [commission, setCommission] = useState<'rate_10' | 'rate_5' | 'rate_0' | 'store'>(row.commission_bucket || 'rate_10')
  const [phone, setPhone] = useState(row.phone || '')
  const [email, setEmail] = useState(row.email || '')
  useEffect(() => {
    setBuyFormNumber(row.buy_form_number || '')
    setCheckNumber(row.check_number || '')
    setAmount(row.purchase_amount != null ? String(row.purchase_amount) : '')
    setCommission(row.commission_bucket || 'rate_10')
    setPhone(row.phone || '')
    setEmail(row.email || '')
  }, [row.id, row.buy_form_number, row.check_number, row.purchase_amount, row.commission_bucket, row.phone, row.email])

  async function save() {
    setError(null)
    if (!editPerm.canEdit) { setError(editPerm.reason); return }
    setSaving(true)

    // If form # changed, double-check global uniqueness.
    if (buyFormNumber !== (row.buy_form_number || '')) {
      if (buyFormNumber && !/^\d{5}$/.test(buyFormNumber)) {
        setError('Form # must be 5 digits.'); setSaving(false); return
      }
      if (buyFormNumber) {
        const { data: dup } = await supabase
          .from('customer_intakes')
          .select('id')
          .eq('buy_form_number', buyFormNumber)
          .neq('id', row.id)
          .limit(1)
          .maybeSingle()
        if (dup?.id) {
          setError(`Form #${buyFormNumber} already used elsewhere.`); setSaving(false); return
        }
      }
    }

    const opt = COMMISSION_OPTIONS.find(o => o.key === commission)!
    const newAmount = amount ? Number(amount) : null
    if (newAmount != null && (!Number.isFinite(newAmount) || newAmount < 0)) {
      setError('Amount must be a non-negative number.'); setSaving(false); return
    }

    const before = {
      buy_form_number: row.buy_form_number,
      check_number: row.check_number,
      purchase_amount: row.purchase_amount,
      commission_pct: row.commission_pct,
      commission_bucket: row.commission_bucket,
      phone: row.phone,
      email: row.email,
    }
    const after = {
      buy_form_number: buyFormNumber || null,
      check_number: checkNumber || null,
      purchase_amount: newAmount,
      commission_pct: opt.pct,
      commission_bucket: commission,
      phone: phone || null,
      email: email || null,
    }

    const { error: updErr } = await supabase
      .from('customer_intakes')
      .update(after)
      .eq('id', row.id)
    if (updErr) { setError(updErr.message); setSaving(false); return }

    // Phase 7 — re-run dedup if we now have enough info to find/create a customer.
    if (!row.customer_id && (after.phone || after.email || row.first_name || row.last_name || row.license_number)) {
      const customerId = await dedupAndUpsertCustomer({
        storeId,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: after.phone,
        email: after.email,
        licenseNumber: row.license_number,
        licenseState: row.license_state,
        dateOfBirth: row.date_of_birth,
        addressLine1: row.address_line1,
        addressCity: row.address_city,
        addressState: row.address_state,
        addressZip: row.address_zip,
      })
      if (customerId) {
        await supabase.from('customer_intakes').update({ customer_id: customerId }).eq('id', row.id)
      }
    }

    // Phase 8 — audit log.
    const changes = diffFields(before as any, after as any)
    if (Object.keys(changes).length > 0) {
      await writeIntakeAudit({
        intakeId: row.id,
        actorUserId: currentUser?.id || null,
        action: 'update',
        changedFields: changes,
      })
    }

    setSaving(false)
    onChanged()
  }

  async function removeJewelryPhoto(photoId: string) {
    if (!editPerm.canEdit) { setError(editPerm.reason); return }
    if (!confirm('Remove this jewelry photo?')) return
    const { error: delErr } = await supabase.from('intake_photos').delete().eq('id', photoId)
    if (delErr) { setError(delErr.message); return }
    await writeIntakeAudit({
      intakeId: row.id, actorUserId: currentUser?.id || null, action: 'update',
      changedFields: { jewelry_photo: ['present', 'removed'] },
    })
    onChanged()
  }

  async function addJewelryPhoto(file: File) {
    if (!editPerm.canEdit) { setError(editPerm.reason); return }
    if (jewelry.length >= MAX_JEWELRY) { setError(`Max ${MAX_JEWELRY} jewelry photos.`); return }
    setSaving(true)
    try {
      const url = await uploadIntakePhoto(file, {
        eventId, intakeId: row.id, kind: 'jewelry', index: jewelry.length + 1,
      })
      const { error: insErr } = await supabase.from('intake_photos').insert({
        intake_id: row.id, photo_url: url, sort_order: jewelry.length,
      })
      if (insErr) { setError(insErr.message); return }
      await writeIntakeAudit({
        intakeId: row.id, actorUserId: currentUser?.id || null, action: 'update',
        changedFields: { jewelry_photo: ['none', 'added'] },
      })
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Upload failed.')
    } finally {
      setSaving(false)
    }
  }

  async function replaceSinglePhoto(kind: 'front' | 'back' | 'invoice', file: File) {
    if (!editPerm.canEdit) { setError(editPerm.reason); return }
    setSaving(true)
    try {
      const url = await uploadIntakePhoto(file, { eventId, intakeId: row.id, kind })
      const fieldByKind: Record<string, string> = {
        front: 'license_photo_url',
        back: 'back_photo_url',
        invoice: 'invoice_photo_url',
      }
      const field = fieldByKind[kind]
      const before = (row as any)[field]
      const { error: updErr } = await supabase
        .from('customer_intakes')
        .update({ [field]: url })
        .eq('id', row.id)
      if (updErr) { setError(updErr.message); return }
      await writeIntakeAudit({
        intakeId: row.id, actorUserId: currentUser?.id || null, action: 'update',
        changedFields: { [field]: [before ? 'present' : 'none', 'replaced'] },
      })
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Replace failed.')
    } finally {
      setSaving(false)
    }
  }

  const personSummary =
    (row.first_name || row.last_name)
      ? `${row.first_name || ''} ${row.last_name || ''}`.trim()
      : (row.phone || row.email || '— anonymous —')

  const submitted = !!row.submitted_to_day_entry_at

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
      marginBottom: 8, overflow: 'hidden',
    }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'transparent', border: 'none',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <span style={{
            background: 'var(--cream)', border: '1px solid var(--pearl)',
            padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
          }}>
            {row.buy_form_number || '—'}
          </span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{personSummary}</span>
          <span style={{ fontSize: 12, color: 'var(--mist)' }}>· {buyerName}</span>
          {row.processing_state === 'processing' && (
            <span style={badgeProcessing}>⏳ processing</span>
          )}
          {row.processing_state === 'parse_failed' && (
            <span style={badgeFailed} title={row.parse_error_message || ''}>⚠ failed</span>
          )}
          {submitted && <span style={badgeSubmitted}>✓ submitted</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>
            {row.purchase_amount != null ? `$${row.purchase_amount.toFixed(0)}` : '—'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--mist)' }}>
            {row.commission_bucket === 'rate_10' ? '10%' :
             row.commission_bucket === 'rate_5'  ? '5%'  :
             row.commission_bucket === 'rate_0'  ? '0%'  :
             row.commission_bucket === 'store'   ? 'Store' : '—'}
          </span>
          <span style={{
            color: 'var(--mist)', fontSize: 11,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s',
          }}>▶</span>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--cream2)', background: 'var(--cream)' }}>
          {error && <div style={errBanner}>⚠ {error}</div>}
          {!editPerm.canEdit && editPerm.reason && (
            <div style={infoBanner}>🔒 {editPerm.reason}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label="Buy form #">
              <input value={buyFormNumber} onChange={e => setBuyFormNumber(e.target.value.replace(/\D/g, ''))} maxLength={5} disabled={!editPerm.canEdit} style={input} inputMode="numeric" />
            </Field>
            <Field label="Amount $">
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} disabled={!editPerm.canEdit} style={input} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Check #">
              <input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} disabled={!editPerm.canEdit} style={input} inputMode="numeric" />
            </Field>
            <Field label="Phone">
              <input value={phone} onChange={e => setPhone(e.target.value)} disabled={!editPerm.canEdit} style={input} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input value={email} onChange={e => setEmail(e.target.value)} disabled={!editPerm.canEdit} style={input} inputMode="email" />
            </Field>
            <Field label="Commission">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {COMMISSION_OPTIONS.map(o => {
                  const sel = commission === o.key
                  return (
                    <button key={o.key} onClick={() => setCommission(o.key)} disabled={!editPerm.canEdit} style={{
                      padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: sel ? 'var(--green)' : '#fff',
                      color: sel ? '#fff' : 'var(--ink)',
                      border: `1px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
                      cursor: editPerm.canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                    }}>{o.label}</button>
                  )
                })}
              </div>
            </Field>
          </div>

          {(row.first_name || row.last_name || row.license_number) && (
            <div style={{
              marginTop: 12, padding: '8px 10px', background: '#fff',
              border: '1px solid var(--pearl)', borderRadius: 6, fontSize: 12,
            }}>
              <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Parsed from license</div>
              <div>{[row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ')}</div>
              <div style={{ color: 'var(--mist)' }}>
                DL {row.license_number || '?'} · {row.license_state || '?'} · DOB {row.date_of_birth || '?'}
              </div>
            </div>
          )}

          {/* Photos */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Photos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              <PhotoSlot label="Front" url={row.license_photo_url} canEdit={editPerm.canEdit} onReplace={f => replaceSinglePhoto('front', f)} />
              <PhotoSlot label="Back" url={row.back_photo_url} canEdit={editPerm.canEdit} onReplace={f => replaceSinglePhoto('back', f)} />
              <PhotoSlot label="Invoice" url={row.invoice_photo_url} canEdit={editPerm.canEdit} onReplace={f => replaceSinglePhoto('invoice', f)} />
              {jewelry.map(j => (
                <PhotoSlot key={j.id} label="Jewelry" url={j.photo_url} canEdit={editPerm.canEdit} onRemove={() => removeJewelryPhoto(j.id)} />
              ))}
              {jewelry.length < MAX_JEWELRY && editPerm.canEdit && (
                <AddPhotoSlot onPick={addJewelryPhoto} />
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={save} disabled={!editPerm.canEdit || saving} style={{
              ...primaryBtn, opacity: (editPerm.canEdit && !saving) ? 1 : 0.45,
              cursor: (editPerm.canEdit && !saving) ? 'pointer' : 'not-allowed',
            }}>
              {saving ? 'Saving…' : '💾 Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoSlot({
  label, url, canEdit, onReplace, onRemove,
}: {
  label: string
  url: string | null
  canEdit: boolean
  onReplace?: (f: File) => void
  onRemove?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div style={{
      position: 'relative', aspectRatio: '1/1', background: '#fff',
      border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden',
    }}>
      {url ? (
        <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: 'var(--mist)', fontSize: 12,
        }}>
          {label} — none
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,.6)', color: '#fff',
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
        padding: '3px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{label}</span>
        {canEdit && onReplace && (
          <>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) onReplace(f)
                if (inputRef.current) inputRef.current.value = ''
              }}
            />
            <button onClick={() => inputRef.current?.click()} style={iconBtn}>↻</button>
          </>
        )}
        {canEdit && onRemove && (
          <button onClick={onRemove} style={iconBtn}>×</button>
        )}
      </div>
    </div>
  )
}

function AddPhotoSlot({ onPick }: { onPick: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <button onClick={() => inputRef.current?.click()} style={{
        aspectRatio: '1/1', background: 'rgba(0,0,0,.04)',
        border: '1px dashed var(--pearl)', borderRadius: 8,
        color: 'var(--mist)', fontSize: 28, cursor: 'pointer', fontFamily: 'inherit',
      }}>+</button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const closeBtn: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--pearl)', padding: '6px 12px',
  borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  background: 'var(--green)', color: '#fff', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontWeight: 800, fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
}
const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--pearl)', borderRadius: 6, background: '#fff',
  fontFamily: 'inherit',
}
const empty: React.CSSProperties = {
  textAlign: 'center', padding: 32, color: 'var(--mist)', fontSize: 14,
}
const errBanner: React.CSSProperties = {
  background: '#FEF2F2', color: '#B22234', padding: '8px 10px',
  borderRadius: 6, fontSize: 12, fontWeight: 700, marginBottom: 10,
}
const infoBanner: React.CSSProperties = {
  background: 'var(--cream2)', color: 'var(--ash)', padding: '8px 10px',
  borderRadius: 6, fontSize: 12, fontWeight: 700, marginBottom: 10,
}
const badgeProcessing: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
  background: '#FEF3C7', color: '#92400E', textTransform: 'uppercase', letterSpacing: '.04em',
}
const badgeFailed: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
  background: '#FEE2E2', color: '#991B1B', textTransform: 'uppercase', letterSpacing: '.04em',
  cursor: 'help',
}
const badgeSubmitted: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
  background: 'var(--green-pale)', color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.04em',
}
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#fff',
  fontSize: 14, cursor: 'pointer', padding: '0 4px', fontFamily: 'inherit',
}
