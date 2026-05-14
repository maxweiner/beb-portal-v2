'use client'

// Right-pane detail viewer for the white-sheet review pile.
//
// Renders:
//   - Left half: iframe pointed at a 30-min signed URL for the
//     per-page PDF. Browser-native rendering — no pdfjs-dist
//     dependency. iframe sandbox is omitted intentionally; we
//     trust the bucket contents (we wrote them via the splitter).
//   - Right half: every extracted field as an editable input.
//     Per-field confidence pill where available. Reason badges
//     at the top. Action buttons at the bottom.
//
// Actions:
//   - "Confirm & save" — POSTs /api/white-sheets/pages/confirm with
//     the operator-edited values. Writes the customer + flips the
//     page to auto_committed.
//   - "Promote to new buy row" — only when the page is flagged
//     'unmatched_form'. Opens an inline buyer-check create panel
//     pre-filled with the OCR values; on submit POSTs
//     /api/white-sheets/pages/promote-to-buy.
//   - "Mark as errored / skip" — flips status to 'errored' without
//     writing a customer; useful for scanner separator pages that
//     slipped through.
//
// On any successful action, calls onResolved(page_id) so the
// parent workspace can advance to the next page in the queue.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { WhiteSheetPage, WhiteSheetReviewReason, User } from '@/types'

interface Props {
  page: WhiteSheetPage
  buyer_check?: {
    id: string
    amount: number | null
    check_number: string | null
    buy_form_number: string | null
    day_number: number | null
    payment_type: string | null
    commission_rate: number | null
  } | null
  /** Workers assigned to this event — buyer dropdown options. */
  assignedWorkers: { id: string; name: string }[]
  /** Number of days the event has, for the day_number dropdown
   *  in the promote-to-buy form. */
  eventDayCount: number
  onResolved: (pageId: string) => void
}

/** Human labels for the review_reasons enum. Falling back to the
 *  raw key keeps the UI forward-compatible with new reasons added
 *  in later phases. */
const REASON_LABEL: Record<WhiteSheetReviewReason, { label: string; hue: string }> = {
  unmatched_form:        { label: 'Form # not entered',   hue: '#FB923C' },  // amber
  amount_mismatch:       { label: '$ disagrees',          hue: '#EF4444' },  // red
  check_mismatch:        { label: 'Check # disagrees',    hue: '#EF4444' },
  low_confidence_phone:  { label: 'Phone unclear',        hue: '#9CA3AF' },
  initials_ambiguous:    { label: 'Initials unclear',     hue: '#9CA3AF' },
  initials_pending:      { label: 'Pick a buyer',         hue: '#3B82F6' },
  errored:               { label: 'Errored',              hue: '#7C2D12' },
}

/** Read an OCR field's confidence out of the ocr_raw blob. The
 *  worker stores { value, confidence } pairs per the prompt spec
 *  in lib/white-sheets/ocr.ts. */
function ocrConfidence(ocrRaw: any, field: string): number | null {
  const v = ocrRaw?.[field]
  if (!v || typeof v !== 'object') return null
  return typeof v.confidence === 'number' ? v.confidence : null
}

/** Initial value for an editable input — operator overrides > OCR
 *  value > buy_row value > empty string. */
function initialFieldValue(ocrRaw: any, field: string, fallback: string | null = null): string {
  const overrides = ocrRaw?.operator_overrides || {}
  if (overrides[field] !== undefined && overrides[field] !== null) return String(overrides[field])
  const ocrVal = ocrRaw?.[field]?.value
  if (ocrVal !== undefined && ocrVal !== null) return String(ocrVal)
  return fallback ?? ''
}

export default function WhiteSheetPageDetail({
  page, buyer_check, assignedWorkers, eventDayCount, onResolved,
}: Props) {
  const ocrRaw: any = page.ocr_raw || {}
  const reasons: WhiteSheetReviewReason[] = page.review_reasons || []
  const isUnmatched = reasons.includes('unmatched_form')

  // ── Signed-URL fetch (30-min TTL) ────────────────────────────
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSignedUrl(null); setUrlError(null)
    async function fetchUrl() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error('Not authenticated')
        const res = await fetch('/api/white-sheets/pages/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ page_id: page.id }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || `${res.status}`)
        if (!cancelled) setSignedUrl(json.signed_url)
      } catch (e: any) {
        if (!cancelled) setUrlError(e?.message || 'Failed to load page preview')
      }
    }
    fetchUrl()
    return () => { cancelled = true }
  }, [page.id])

  // ── Editable field state ────────────────────────────────────
  // Reset whenever the selected page changes.
  const [firstName,  setFirstName]  = useState(() => initialFieldValue(ocrRaw, 'first_name'))
  const [lastName,   setLastName]   = useState(() => initialFieldValue(ocrRaw, 'last_name'))
  const [addr1,      setAddr1]      = useState(() => initialFieldValue(ocrRaw, 'address_line_1'))
  const [city,       setCity]       = useState(() => initialFieldValue(ocrRaw, 'city'))
  const [state,      setState]      = useState(() => initialFieldValue(ocrRaw, 'state'))
  const [zip,        setZip]        = useState(() => initialFieldValue(ocrRaw, 'zip'))
  const [phone,      setPhone]      = useState(() => initialFieldValue(ocrRaw, 'phone'))
  const [email,      setEmail]      = useState(() => initialFieldValue(ocrRaw, 'email'))
  const [dob,        setDob]        = useState(() => initialFieldValue(ocrRaw, 'date_of_birth'))
  const [idNumber,   setIdNumber]   = useState(() => initialFieldValue(ocrRaw, 'id_number',
    page.id_number_raw || ''))
  const [leadSource, setLeadSource] = useState(() => initialFieldValue(ocrRaw, 'lead_source'))
  const [leadOther,  setLeadOther]  = useState(() => initialFieldValue(ocrRaw, 'lead_source_other_text'))
  const [items,      setItems]      = useState(() => initialFieldValue(ocrRaw, 'items_description',
    page.items_raw || ''))
  const [buyForm,    setBuyForm]    = useState(() => initialFieldValue(ocrRaw, 'buy_form_number',
    page.buy_form_number_ocr || ''))
  const [checkNum,   setCheckNum]   = useState(() => initialFieldValue(ocrRaw, 'check_number',
    page.check_number_ocr || ''))
  const [amount,     setAmount]     = useState(() => initialFieldValue(ocrRaw, 'amount',
    page.amount_ocr != null ? String(page.amount_ocr) : ''))
  const [buyerUserId, setBuyerUserId] = useState<string>(page.buyer_user_id || '')

  // Promote-to-buy form state (only used when isUnmatched).
  const [showPromote, setShowPromote]   = useState(false)
  const [dayNumber, setDayNumber]       = useState<number>(1)
  const [paymentType, setPaymentType]   = useState<string>('check')
  const [commissionRate, setCommissionRate] = useState<number>(10)

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  function fieldsPayload() {
    return {
      first_name: firstName.trim() || null,
      last_name:  lastName.trim()  || null,
      address_line_1: addr1.trim() || null,
      city:  city.trim()  || null,
      state: state.trim().toUpperCase() || null,
      zip:   zip.trim()   || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      date_of_birth: dob.trim() || null,
      id_number: idNumber.trim() || null,
      lead_source: leadSource.trim() || null,
      lead_source_other_text: leadOther.trim() || null,
      items_description: items.trim() || null,
      buy_form_number: buyForm.trim() || null,
      check_number: checkNum.trim() || null,
      amount: amount ? Number(amount) : null,
      buyer_user_id: buyerUserId || null,
    }
  }

  async function doConfirm() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/white-sheets/pages/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ page_id: page.id, fields: fieldsPayload() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `${res.status}`)
      onResolved(page.id)
    } catch (e: any) {
      setError(e?.message || 'Confirm failed')
    } finally {
      setBusy(false)
    }
  }

  async function doPromote() {
    if (busy) return
    if (!buyForm.trim() || !checkNum.trim() || !amount) {
      setError('Buy form #, check #, and amount are required to create a buy row.')
      return
    }
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/white-sheets/pages/promote-to-buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          page_id: page.id,
          buy_row: {
            day_number: dayNumber,
            check_number: checkNum.trim(),
            buy_form_number: buyForm.trim(),
            amount: Number(amount),
            payment_type: paymentType,
            commission_rate: commissionRate,
          },
          fields: fieldsPayload(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `${res.status}`)
      onResolved(page.id)
    } catch (e: any) {
      setError(e?.message || 'Promote failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Layout ─────────────────────────────────────────────────
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,420px)',
      gap: 14, height: '100%',
    }}>
      {/* LEFT — PDF preview */}
      <div style={{
        background: '#fff', borderRadius: 10, overflow: 'hidden',
        border: '1px solid var(--pearl)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid var(--pearl)',
          fontSize: 11, color: 'var(--mist)', display: 'flex', justifyContent: 'space-between',
        }}>
          <span>Page {page.page_number} · upload {page.upload_id.slice(0, 8)}…</span>
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green-dark)', fontWeight: 700 }}>
              Open in new tab ↗
            </a>
          )}
        </div>
        <div style={{ flex: 1, background: '#f4f1ea' }}>
          {urlError && (
            <div style={{ padding: 20, color: '#991B1B', fontSize: 13 }}>⚠ {urlError}</div>
          )}
          {!signedUrl && !urlError && (
            <div style={{ padding: 20, color: 'var(--mist)', fontSize: 13 }}>Loading preview…</div>
          )}
          {signedUrl && (
            <iframe
              src={signedUrl}
              title={`White sheet page ${page.page_number}`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
          )}
        </div>
      </div>

      {/* RIGHT — fields + actions */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        overflow: 'auto', paddingRight: 4,
      }}>
        {/* Reason badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {reasons.map(r => {
            const meta = REASON_LABEL[r] || { label: r, hue: '#9CA3AF' }
            return (
              <span key={r} style={{
                background: meta.hue + '22', color: meta.hue,
                fontSize: 10, fontWeight: 800, letterSpacing: '.02em',
                padding: '3px 8px', borderRadius: 999,
              }}>{meta.label}</span>
            )
          })}
          {reasons.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--mist)' }}>No flags — confirm to commit.</span>
          )}
        </div>

        {/* Entered-vs-OCR comparison panel (only when matched) */}
        {buyer_check && (
          <div className="card" style={{ padding: 10, background: '#FAFAF6' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', marginBottom: 6 }}>
              Day-Entry row
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 12 }}>
              <KV label="Entered $" value={buyer_check.amount != null ? `$${Number(buyer_check.amount).toLocaleString()}` : '—'} />
              <KV label="OCR $"     value={page.amount_ocr != null ? `$${page.amount_ocr}` : '—'}
                  warn={reasons.includes('amount_mismatch')} />
              <KV label="Check #"   value={buyer_check.check_number || '—'}
                  warn={reasons.includes('check_mismatch')} />
            </div>
          </div>
        )}

        {/* Customer fields */}
        <Section title="Customer">
          <Row>
            <Field label="First name" value={firstName} onChange={setFirstName} conf={ocrConfidence(ocrRaw, 'first_name')} />
            <Field label="Last name"  value={lastName}  onChange={setLastName}  conf={ocrConfidence(ocrRaw, 'last_name')} />
          </Row>
          <Row>
            <Field label="Phone" value={phone} onChange={setPhone} conf={ocrConfidence(ocrRaw, 'phone')} />
            <Field label="Email" value={email} onChange={setEmail} conf={ocrConfidence(ocrRaw, 'email')} />
          </Row>
          <Field label="Address" value={addr1} onChange={setAddr1} conf={ocrConfidence(ocrRaw, 'address_line_1')} />
          <Row>
            <Field label="City"  value={city}  onChange={setCity}  conf={ocrConfidence(ocrRaw, 'city')} />
            <Field label="State" value={state} onChange={setState} conf={ocrConfidence(ocrRaw, 'state')} width={80} />
            <Field label="Zip"   value={zip}   onChange={setZip}   conf={ocrConfidence(ocrRaw, 'zip')}   width={100} />
          </Row>
          <Row>
            <Field label="DOB"      value={dob}      onChange={setDob}      conf={ocrConfidence(ocrRaw, 'date_of_birth')} placeholder="YYYY-MM-DD" />
            <Field label="ID/DL #"  value={idNumber} onChange={setIdNumber} conf={ocrConfidence(ocrRaw, 'id_number')} />
          </Row>
        </Section>

        <Section title="Lead source">
          <Row>
            <Field label="Source" value={leadSource} onChange={setLeadSource} conf={ocrConfidence(ocrRaw, 'lead_source')} />
            <Field label="Other text" value={leadOther} onChange={setLeadOther} conf={ocrConfidence(ocrRaw, 'lead_source_other_text')} />
          </Row>
        </Section>

        <Section title="Transaction (verifies Day-Entry row)">
          <Row>
            <Field label="Buy form #" value={buyForm}  onChange={setBuyForm}  conf={ocrConfidence(ocrRaw, 'buy_form_number')} width={130} />
            <Field label="Check #"    value={checkNum} onChange={setCheckNum} conf={ocrConfidence(ocrRaw, 'check_number')}    width={120} />
            <Field label="Amount $"   value={amount}   onChange={setAmount}   conf={ocrConfidence(ocrRaw, 'amount')}            width={120} placeholder="dollars" />
          </Row>
          <Field label="Items" value={items} onChange={setItems} conf={ocrConfidence(ocrRaw, 'items_description')} />
        </Section>

        <Section title="Buyer (initials)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {assignedWorkers.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--mist)' }}>No workers assigned to this event.</span>
            ) : assignedWorkers.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => setBuyerUserId(w.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  border: '1px solid', borderColor: buyerUserId === w.id ? 'var(--green)' : 'var(--pearl)',
                  background: buyerUserId === w.id ? 'var(--green-pale)' : '#fff',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >{w.name}</button>
            ))}
          </div>
        </Section>

        {/* Promote-to-buy expansion */}
        {isUnmatched && (
          <Section title="Promote to a new buy row">
            <p style={{ fontSize: 11, color: 'var(--mist)', margin: '0 0 8px' }}>
              The OCR'd buy form # {buyForm && <code>{buyForm}</code>} doesn't match any Day-Entry row for this event.
              Click below to create the buy row from the form's values — it will appear in Day Entry under the day you pick.
            </p>
            <Row>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)' }}>
                Day
                <select value={dayNumber} onChange={e => setDayNumber(Number(e.target.value))}
                  style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12 }}>
                  {Array.from({ length: Math.max(1, eventDayCount) }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>Day {d}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)' }}>
                Payment
                <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
                  style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12 }}>
                  <option value="check">check</option>
                  <option value="cash">cash</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ash)' }}>
                Commission
                <select value={commissionRate} onChange={e => setCommissionRate(Number(e.target.value))}
                  style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12 }}>
                  <option value={10}>10%</option>
                  <option value={5}>5%</option>
                  <option value={0}>0%</option>
                </select>
              </label>
            </Row>
            <button
              onClick={doPromote}
              disabled={busy}
              className="btn-primary btn-sm"
              style={{ marginTop: 8 }}
            >{busy ? 'Saving…' : '→ Create buy row + save customer'}</button>
          </Section>
        )}

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: '#FEE2E2', color: '#991B1B', fontSize: 12, fontWeight: 700,
          }}>⚠ {error}</div>
        )}

        {/* Bottom action bar — primary action depends on flags. */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {!isUnmatched && (
            <button
              onClick={doConfirm}
              disabled={busy}
              className="btn-primary"
              style={{ flex: 1 }}
            >{busy ? 'Saving…' : '✓ Confirm & save customer'}</button>
          )}
          {isUnmatched && !showPromote && (
            <button
              onClick={doConfirm}
              disabled={busy}
              className="btn-outline"
              style={{ flex: 1 }}
              title="Confirm without creating a buy row — just saves the customer record"
            >{busy ? 'Saving…' : '✓ Save customer only'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Small layout helpers (kept inline so the workspace + detail
// file count stays manageable for Phase 4).
// ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: 10,
      border: '1px solid var(--pearl)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'var(--ash)',
        textTransform: 'uppercase', letterSpacing: '.04em',
        marginBottom: 6,
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
}

function KV({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: warn ? '#991B1B' : 'var(--ink)' }}>{value}</div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  conf?: number | null
  width?: number
  placeholder?: string
}
function Field({ label, value, onChange, conf, width, placeholder }: FieldProps) {
  return (
    <label style={{ flex: width ? `0 0 ${width}px` : 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ash)' }}>{label}</span>
        {typeof conf === 'number' && (
          <span title={`OCR confidence: ${(conf * 100).toFixed(0)}%`}
            style={{
              fontSize: 9, fontWeight: 800,
              color: conf >= 0.8 ? '#1D6B44' : conf >= 0.5 ? '#A16207' : '#991B1B',
              background: conf >= 0.8 ? '#DCFCE7' : conf >= 0.5 ? '#FEF3C7' : '#FEE2E2',
              padding: '1px 4px', borderRadius: 3,
            }}>{(conf * 100).toFixed(0)}%</span>
        )}
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '4px 8px', fontSize: 12,
          fontFamily: 'inherit',
          border: '1px solid var(--pearl)', borderRadius: 6, background: '#fff',
        }}
      />
    </label>
  )
}
