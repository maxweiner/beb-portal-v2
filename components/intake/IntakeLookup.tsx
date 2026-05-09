'use client'

/**
 * Buy form lookup tool (Phase 6).
 *
 * Standalone search across every intake ever logged. Filter by:
 *   • buy form #         (exact)
 *   • customer name      (fuzzy ILIKE on first / last)
 *   • phone              (digits only, normalized)
 *   • email              (exact, lowercased)
 *   • check #            (exact)
 *   • amount range       ($ min .. max)
 *   • date range         (scanned_at)
 *   • event              (dropdown of every event)
 *
 * Results show: store + event, form #, customer, $, check #, photos
 * gallery, "Open in worksheet" to edit.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventDisplayName } from '@/lib/eventName'
import IntakeWorksheet from './IntakeWorksheet'
import type { Event } from '@/types'

interface ResultRow {
  id: string
  event_id: string
  buyer_id: string
  buy_form_number: string | null
  check_number: string | null
  purchase_amount: number | null
  commission_bucket: 'rate_10' | 'rate_5' | 'rate_0' | 'store' | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  scanned_at: string
  license_photo_url: string | null
  back_photo_url: string | null
  invoice_photo_url: string | null
}

interface JewelryThumb { intake_id: string; photo_url: string }

const PAGE_SIZE = 30

export default function IntakeLookup() {
  const { events: ctxEvents, stores, brand, users } = useApp()
  const [events, setEvents] = useState<Event[]>(ctxEvents || [])
  const [results, setResults] = useState<ResultRow[]>([])
  const [jewelryByIntake, setJewelryByIntake] = useState<Map<string, JewelryThumb[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openWorksheetFor, setOpenWorksheetFor] = useState<{ row: ResultRow; ev: Event } | null>(null)

  // Filters
  const [formNumber, setFormNumber] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [checkNumber, setCheckNumber] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [eventId, setEventId] = useState('')

  useEffect(() => {
    // Refresh events list (full set, all years) so the dropdown is searchable.
    void (async () => {
      const { data } = await supabase.from('events').select('id, store_id, store_name, start_date, days, status').eq('brand', brand).order('start_date', { ascending: false }).limit(500)
      if (data) setEvents(data as any[])
    })()
  }, [brand])

  async function search() {
    setLoading(true)
    let q = supabase
      .from('customer_intakes')
      .select('id, event_id, buyer_id, buy_form_number, check_number, purchase_amount, commission_bucket, first_name, last_name, phone, email, scanned_at, license_photo_url, back_photo_url, invoice_photo_url')
      .order('scanned_at', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (formNumber.trim()) q = q.eq('buy_form_number', formNumber.trim())
    if (name.trim()) {
      const n = name.trim()
      q = q.or(`first_name.ilike.%${n}%,last_name.ilike.%${n}%`)
    }
    if (phone.trim()) {
      const digits = phone.replace(/\D/g, '')
      if (digits) q = q.ilike('phone', `%${digits}%`)
    }
    if (email.trim()) q = q.ilike('email', email.trim())
    if (checkNumber.trim()) q = q.eq('check_number', checkNumber.trim())
    const minN = amountMin ? Number(amountMin) : null
    const maxN = amountMax ? Number(amountMax) : null
    if (Number.isFinite(minN) && minN != null) q = q.gte('purchase_amount', minN)
    if (Number.isFinite(maxN) && maxN != null) q = q.lte('purchase_amount', maxN)
    if (dateFrom) q = q.gte('scanned_at', `${dateFrom}T00:00:00`)
    if (dateTo) q = q.lte('scanned_at', `${dateTo}T23:59:59.999`)
    if (eventId) q = q.eq('event_id', eventId)

    const { data, error } = await q
    if (error) {
      console.error('[lookup] failed', error)
      setLoading(false)
      return
    }
    const rows = (data || []) as ResultRow[]
    const trimmed = rows.slice(0, PAGE_SIZE)
    setResults(trimmed)
    setHasMore(rows.length > PAGE_SIZE)

    // Pull jewelry thumbs for the visible results.
    if (trimmed.length > 0) {
      const ids = trimmed.map(r => r.id)
      const { data: j } = await supabase
        .from('intake_photos')
        .select('intake_id, photo_url')
        .in('intake_id', ids)
        .order('sort_order')
      const m = new Map<string, JewelryThumb[]>()
      for (const p of (j || []) as JewelryThumb[]) {
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

  // Run an initial empty search on mount so the user sees recent intakes.
  useEffect(() => { void search() }, [])

  const eventsById = useMemo(() => new Map(events.map(e => [e.id, e])), [events])

  function reset() {
    setFormNumber(''); setName(''); setPhone(''); setEmail('')
    setCheckNumber(''); setAmountMin(''); setAmountMax('')
    setDateFrom(''); setDateTo(''); setEventId('')
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '0 0 4px' }}>
        🔎 Buy Form Lookup
      </h1>
      <div style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 16 }}>
        Search across every intake. Edit by tapping "Open in worksheet".
      </div>

      {/* Filters */}
      <div style={{ background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <Field label="Form #">
            <input value={formNumber} onChange={e => setFormNumber(e.target.value.replace(/\D/g, ''))} maxLength={5} inputMode="numeric" style={input} placeholder="00000" />
          </Field>
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} style={input} placeholder="John or Smith" />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" style={input} placeholder="any digits" />
          </Field>
          <Field label="Email">
            <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" style={input} placeholder="exact match" />
          </Field>
          <Field label="Check #">
            <input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} style={input} placeholder="exact" />
          </Field>
          <Field label="Amount $">
            <div style={{ display: 'flex', gap: 4 }}>
              <input value={amountMin} onChange={e => setAmountMin(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ ...input, flex: 1 }} placeholder="min" />
              <input value={amountMax} onChange={e => setAmountMax(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ ...input, flex: 1 }} placeholder="max" />
            </div>
          </Field>
          <Field label="From">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={input} />
          </Field>
          <Field label="To">
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={input} />
          </Field>
          <Field label="Event">
            <select value={eventId} onChange={e => setEventId(e.target.value)} style={{ ...input, padding: '7px 8px' }}>
              <option value="">All events</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {eventDisplayName(ev, stores)} — {ev.start_date}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={reset} style={secondaryBtn}>Reset</button>
          <button onClick={search} style={primaryBtn} disabled={loading}>
            {loading ? 'Searching…' : '🔎 Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>
        {results.length} result{results.length === 1 ? '' : 's'}{hasMore ? ' (showing first ' + PAGE_SIZE + ')' : ''}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!loading && results.length === 0 && (
          <div style={{
            background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
            padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 14,
          }}>No results. Adjust filters and try again.</div>
        )}
        {results.map(r => {
          const ev = eventsById.get(r.event_id)
          const buyer = users?.find(u => u.id === r.buyer_id)
          const expanded = expandedId === r.id
          const personSummary = (r.first_name || r.last_name)
            ? `${r.first_name || ''} ${r.last_name || ''}`.trim()
            : (r.phone || r.email || '— anonymous —')
          const dateOnly = r.scanned_at?.slice(0, 10) || ''
          const jewelry = jewelryByIntake.get(r.id) || []

          return (
            <div key={r.id} style={{
              background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10, overflow: 'hidden',
            }}>
              <button onClick={() => setExpandedId(prev => prev === r.id ? null : r.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={formChip}>{r.buy_form_number || '—'}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{personSummary}</span>
                  <span style={{ fontSize: 12, color: 'var(--mist)' }}>{ev ? eventDisplayName(ev, stores) : '?'}</span>
                  <span style={{ fontSize: 12, color: 'var(--mist)' }}>· {dateOnly}</span>
                  <span style={{ fontSize: 12, color: 'var(--mist)' }}>· {buyer?.name || '?'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>
                    {r.purchase_amount != null ? `$${r.purchase_amount.toFixed(0)}` : '—'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mist)' }}>
                    {r.commission_bucket === 'rate_10' ? '10%' :
                     r.commission_bucket === 'rate_5'  ? '5%'  :
                     r.commission_bucket === 'rate_0'  ? '0%'  :
                     r.commission_bucket === 'store'   ? 'Store' : '—'}
                  </span>
                  <span style={{
                    color: 'var(--mist)', fontSize: 11,
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s',
                  }}>▶</span>
                </div>
              </button>

              {expanded && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--cream2)', background: 'var(--cream)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 13 }}>
                    <div><b>Form #:</b> {r.buy_form_number || '—'}</div>
                    <div><b>Check #:</b> {r.check_number || '—'}</div>
                    <div><b>Amount:</b> {r.purchase_amount != null ? `$${r.purchase_amount.toFixed(2)}` : '—'}</div>
                    <div><b>Phone:</b> {r.phone || '—'}</div>
                    <div><b>Email:</b> {r.email || '—'}</div>
                    <div><b>Buyer:</b> {buyer?.name || '?'}</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginTop: 12 }}>
                    {r.license_photo_url && <Thumb url={r.license_photo_url} label="Front" />}
                    {r.back_photo_url && <Thumb url={r.back_photo_url} label="Back" />}
                    {r.invoice_photo_url && <Thumb url={r.invoice_photo_url} label="Invoice" />}
                    {jewelry.map(p => <Thumb key={p.photo_url} url={p.photo_url} label="Jewelry" />)}
                    {!r.license_photo_url && !r.back_photo_url && !r.invoice_photo_url && jewelry.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>No photos.</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    {ev ? (
                      <button onClick={() => setOpenWorksheetFor({ row: r, ev })} style={primaryBtn}>
                        ✏️ Open in worksheet
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>Event not in your context.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {openWorksheetFor && (
        <IntakeWorksheet
          eventId={openWorksheetFor.ev.id}
          storeId={openWorksheetFor.ev.store_id}
          eventStartDate={openWorksheetFor.ev.start_date}
          eventDisplayName={eventDisplayName(openWorksheetFor.ev, stores)}
          dateIso={openWorksheetFor.row.scanned_at.slice(0, 10)}
          onClose={() => setOpenWorksheetFor(null)}
        />
      )}
    </div>
  )
}

function Thumb({ url, label }: { url: string; label: string }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '1/1', background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </a>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.04em', padding: '3px 6px', textAlign: 'center',
      }}>{label}</div>
    </div>
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

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--pearl)', borderRadius: 6, background: '#fff', fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  background: 'var(--green)', color: '#fff', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontWeight: 800, fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
}
const secondaryBtn: React.CSSProperties = {
  background: '#fff', color: 'var(--ink)', border: '1px solid var(--pearl)',
  padding: '8px 14px', borderRadius: 6, fontWeight: 700, fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
}
const formChip: React.CSSProperties = {
  background: 'var(--cream)', border: '1px solid var(--pearl)',
  padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
}
