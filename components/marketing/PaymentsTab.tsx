'use client'

// New Payments tab for the Marketing page. Lists marketing_payments
// rows scoped to the active brand's stores, with filters / totals /
// CSV / +Add / edit / delete. Replaces the old per-channel
// events.spend_* amounts (still kept in the DB for now; retired in
// PR C alongside the Ad Spend panel in Events).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface PaymentRow {
  id: string
  store_id: string
  event_id: string
  type_id: string | null
  vendor: string | null
  amount: number
  incurred_at: string
  paid_at: string | null
  payment_method_id: string | null
  quantity: number | null
  invoice_number: string | null
  notes: string | null
  qr_code_id: string | null
  created_at: string
  updated_at: string
  // joined
  events?: { store_name: string | null; start_date: string | null } | null
  marketing_payment_types?: { label: string | null } | null
  marketing_payment_methods?: { label: string | null; active: boolean } | null
  qr_codes?: { label: string | null } | null
}

interface LookupRow { id: string; label: string; active: boolean; sort_order: number }

type DatePreset = 'this_year' | 'last_30' | 'last_90' | 'this_event' | 'all'
type PaidStatusFilter = 'all' | 'paid' | 'unpaid'

export default function PaymentsTab() {
  const { user, brand, stores, events } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const brandStoreIds = useMemo(() => new Set(stores.filter((s: any) => s.brand === brand).map((s: any) => s.id)), [stores, brand])
  const brandEvents = useMemo(() => events.filter(ev => brandStoreIds.has(ev.store_id)), [events, brandStoreIds])

  const [rows, setRows] = useState<PaymentRow[]>([])
  const [methods, setMethods] = useState<LookupRow[]>([])
  const [types, setTypes] = useState<LookupRow[]>([])
  const [loaded, setLoaded] = useState(false)

  // Filters
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [methodFilter, setMethodFilter] = useState<Set<string>>(new Set())
  const [vendorSearch, setVendorSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DatePreset>('this_year')
  const [paidFilter, setPaidFilter] = useState<PaidStatusFilter>('all')

  // Sort
  const [sortKey, setSortKey] = useState<string>('incurred_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Edit / new modal
  const [editing, setEditing] = useState<PaymentRow | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    if (brandStoreIds.size === 0) {
      setRows([]); setLoaded(true); return
    }
    const [{ data: payments }, { data: m }, { data: t }] = await Promise.all([
      supabase.from('marketing_payments')
        .select(`
          *,
          events(store_name, start_date),
          marketing_payment_types(label),
          marketing_payment_methods(label, active),
          qr_codes(label)
        `)
        .in('store_id', Array.from(brandStoreIds))
        .order('incurred_at', { ascending: false })
        .limit(5000),
      supabase.from('marketing_payment_methods').select('id, label, active, sort_order').order('sort_order'),
      supabase.from('marketing_payment_types').select('id, label, active, sort_order').order('sort_order'),
    ])
    setRows((payments || []) as PaymentRow[])
    setMethods((m || []) as LookupRow[])
    setTypes((t || []) as LookupRow[])
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [brand])

  // Filtering
  const inDateRange = (p: PaymentRow): boolean => {
    if (dateFilter === 'all') return true
    const today = new Date(); today.setHours(0,0,0,0)
    const d = new Date(p.incurred_at + 'T00:00:00')
    if (dateFilter === 'this_year') return d.getFullYear() === today.getFullYear()
    if (dateFilter === 'last_30') {
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 30)
      return d >= cutoff
    }
    if (dateFilter === 'last_90') {
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 90)
      return d >= cutoff
    }
    if (dateFilter === 'this_event') {
      // payments tied to events that are running today (3-day window)
      const ev = brandEvents.find(e => e.id === p.event_id)
      if (!ev) return false
      const start = new Date(ev.start_date + 'T00:00:00')
      const end = new Date(start); end.setDate(end.getDate() + 2); end.setHours(23,59,59)
      return today >= start && today <= end
    }
    return true
  }

  const filtered = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase()
    return rows.filter(p => {
      if (eventFilter !== 'all' && p.event_id !== eventFilter) return false
      if (typeFilter.size > 0 && !typeFilter.has(p.type_id || '')) return false
      if (methodFilter.size > 0 && !methodFilter.has(p.payment_method_id || '')) return false
      if (q && !(p.vendor || '').toLowerCase().includes(q)) return false
      if (paidFilter === 'paid' && !p.paid_at) return false
      if (paidFilter === 'unpaid' && p.paid_at) return false
      if (!inDateRange(p)) return false
      return true
    })
  }, [rows, eventFilter, typeFilter, methodFilter, vendorSearch, dateFilter, paidFilter, brandEvents])

  // Sort
  const sorted = useMemo(() => {
    const getCell = (p: PaymentRow, k: string) => {
      switch (k) {
        case 'incurred_at': return p.incurred_at
        case 'paid_at': return p.paid_at || '' // unpaid sort to the bottom on desc
        case 'event': return p.events?.store_name || ''
        case 'type': return p.marketing_payment_types?.label || ''
        case 'vendor': return p.vendor || ''
        case 'amount': return p.amount
        case 'method': return p.marketing_payment_methods?.label || ''
        case 'quantity': return p.quantity ?? -1
        case 'cpp': return p.quantity && p.quantity > 0 ? p.amount / p.quantity : -1
        case 'qr': return p.qr_codes?.label || ''
        case 'invoice': return p.invoice_number || ''
        default: return ''
      }
    }
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = getCell(a, sortKey)
      const bv = getCell(b, sortKey)
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const totals = useMemo(() => ({
    count: sorted.length,
    sum: sorted.reduce((s, p) => s + (p.amount || 0), 0),
    unpaidSum: sorted.reduce((s, p) => s + (p.paid_at ? 0 : (p.amount || 0)), 0),
    unpaidCount: sorted.reduce((s, p) => s + (p.paid_at ? 0 : 1), 0),
  }), [sorted])

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'amount' || k === 'incurred_at' || k === 'paid_at' ? 'desc' : 'asc') }
  }
  function toggleSet(set: Set<string>, val: string, setter: (s: Set<string>) => void) {
    const n = new Set(set)
    if (n.has(val)) n.delete(val); else n.add(val)
    setter(n)
  }

  const fmt$ = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const fmtDate = (iso: string) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  function exportCsv() {
    const headers = ['Date incurred','Date paid','Status','Event','Type','Vendor','Amount','Payment method','Quantity','Cost per piece','Linked QR','Invoice #','Notes']
    const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`
    const lines = [headers.map(escape).join(',')]
    for (const p of sorted) {
      const cpp = p.quantity && p.quantity > 0 ? (p.amount / p.quantity).toFixed(2) : ''
      lines.push([
        p.incurred_at,
        p.paid_at || '',
        p.paid_at ? 'Paid' : 'Unpaid',
        p.events?.store_name || '',
        p.marketing_payment_types?.label || '',
        p.vendor || '',
        String(p.amount),
        p.marketing_payment_methods?.label || '',
        p.quantity != null ? String(p.quantity) : '',
        cpp,
        p.qr_codes?.label || '',
        p.invoice_number || '',
        p.notes || '',
      ].map(escape).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marketing_payments_${brand}_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!isAdmin) {
    return (
      <div className="card text-center" style={{ padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div className="font-bold" style={{ color: 'var(--ink)' }}>Admins only</div>
      </div>
    )
  }

  if (creating || editing) {
    return (
      <PaymentForm
        existing={editing}
        events={brandEvents}
        types={types.filter(t => t.active)}
        methods={methods.filter(m => m.active)}
        userId={user?.id}
        onCancel={() => { setCreating(false); setEditing(null) }}
        onSaved={() => { setCreating(false); setEditing(null); reload() }}
      />
    )
  }

  const headers: { key: string; label: string; align?: 'right' }[] = [
    { key: 'incurred_at', label: 'Incurred' },
    { key: 'paid_at', label: 'Paid' },
    { key: 'event', label: 'Event' },
    { key: 'type', label: 'Type' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'method', label: 'Method' },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'cpp', label: 'CPP', align: 'right' },
    { key: 'qr', label: 'QR' },
    { key: 'invoice', label: 'Inv #' },
  ]

  return (
    <div className="p-6" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Marketing payments</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} disabled={sorted.length === 0} className="btn-outline btn-sm">⤓ CSV</button>
          <button onClick={() => setCreating(true)} className="btn-primary btn-sm">+ Add payment</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(180px,1fr) minmax(180px,1fr) minmax(180px,1fr) auto', gap: 10 }}>
          <div>
            <label className="fl">Event</label>
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value)} style={{ width: '100%' }}>
              <option value="all">All events</option>
              {brandEvents.sort((a, b) => b.start_date.localeCompare(a.start_date)).map(ev => (
                <option key={ev.id} value={ev.id}>{ev.store_name} · {fmtDate(ev.start_date)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fl">Type</label>
            <ChipFilter items={types.filter(t => t.active)} selected={typeFilter} onToggle={v => toggleSet(typeFilter, v, setTypeFilter)} />
          </div>
          <div>
            <label className="fl">Payment method</label>
            <ChipFilter items={methods.filter(m => m.active)} selected={methodFilter} onToggle={v => toggleSet(methodFilter, v, setMethodFilter)} />
          </div>
          <div>
            <label className="fl">Vendor</label>
            <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} placeholder="Search…" />
          </div>
          <div>
            <label className="fl">Date</label>
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value as DatePreset)}>
              <option value="this_year">This year</option>
              <option value="last_30">Last 30 days</option>
              <option value="last_90">Last 90 days</option>
              <option value="this_event">This event</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
          <span className="fl" style={{ marginBottom: 0 }}>Status</span>
          {(['all', 'paid', 'unpaid'] as PaidStatusFilter[]).map(s => {
            const sel = paidFilter === s
            return (
              <button key={s} onClick={() => setPaidFilter(s)}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--pearl)',
                  background: sel ? 'var(--green-pale)' : 'white',
                  color: sel ? 'var(--green-dark)' : 'var(--mist)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                }}>{s}</button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
                {headers.map(h => (
                  <th key={h.key}
                    onClick={() => toggleSort(h.key)}
                    style={{ padding: '10px 12px', textAlign: h.align || 'left', fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {h.label}
                    {sortKey === h.key && <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
                <th style={{ padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr><td colSpan={12} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                  {rows.length === 0 ? 'No payments yet. Click + Add payment to record one.' : 'No payments match the current filters.'}
                </td></tr>
              ) : sorted.map(p => {
                const cpp = p.quantity && p.quantity > 0 ? p.amount / p.quantity : null
                const archivedMethod = p.marketing_payment_methods && p.marketing_payment_methods.active === false
                const unpaid = !p.paid_at
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--cream2)', background: unpaid ? 'var(--cream)' : undefined }}>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(p.incurred_at)}</td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      {p.paid_at ? fmtDate(p.paid_at) : (
                        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--red)', background: 'var(--red-pale)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Unpaid</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{p.events?.store_name || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{p.marketing_payment_types?.label || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{p.vendor || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{fmt$(p.amount)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {p.marketing_payment_methods?.label || (unpaid ? <span style={{ color: 'var(--mist)', fontStyle: 'italic' }}>—</span> : '—')}
                      {archivedMethod && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--mist)', background: 'var(--cream2)', padding: '1px 5px', borderRadius: 3 }}>archived</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--mist)' }}>{p.quantity ?? '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--mist)' }}>{cpp != null ? `$${cpp.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--mist)' }}>{p.qr_codes?.label || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--mist)', fontFamily: 'monospace', fontSize: 12 }}>{p.invoice_number || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(p)} className="btn-outline btn-sm">{unpaid ? 'Mark paid / Edit' : 'Edit'}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--cream)', fontWeight: 800 }}>
                  <td colSpan={5} style={{ padding: '10px 12px' }}>
                    {totals.count} cost{totals.count === 1 ? '' : 's'}
                    {totals.unpaidCount > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>
                        ({totals.unpaidCount} unpaid · {fmt$(totals.unpaidSum)})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmt$(totals.sum)}</td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

function ChipFilter({ items, selected, onToggle }: {
  items: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map(it => {
        const sel = selected.has(it.id)
        return (
          <button key={it.id} onClick={() => onToggle(it.id)}
            style={{
              padding: '4px 8px', borderRadius: 6, border: '1px solid var(--pearl)',
              background: sel ? 'var(--green-pale)' : 'white',
              color: sel ? 'var(--green-dark)' : 'var(--mist)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{it.label}</button>
        )
      })}
      {selected.size > 0 && (
        <button onClick={() => items.forEach(i => selected.has(i.id) && onToggle(i.id))}
          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--mist)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          clear
        </button>
      )}
    </div>
  )
}

/* ── Add / Edit Payment form ── */

function PaymentForm({ existing, events, types, methods, userId, onCancel, onSaved }: {
  existing: PaymentRow | null
  events: any[]
  types: LookupRow[]
  methods: LookupRow[]
  userId?: string
  onCancel: () => void
  onSaved: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [eventId, setEventId] = useState(existing?.event_id || (events[0]?.id || ''))
  const [typeId, setTypeId] = useState(existing?.type_id || (types[0]?.id || ''))
  const [vendor, setVendor] = useState(existing?.vendor || '')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [incurredAt, setIncurredAt] = useState(existing?.incurred_at || today)
  const [markPaid, setMarkPaid] = useState(!!existing?.paid_at)
  const [paidAt, setPaidAt] = useState(existing?.paid_at || today)
  const [methodId, setMethodId] = useState(existing?.payment_method_id || (methods.find(m => m.label !== 'Legacy / Unknown')?.id || methods[0]?.id || ''))
  const [quantity, setQuantity] = useState(existing?.quantity != null ? String(existing.quantity) : '')
  const [invoice, setInvoice] = useState(existing?.invoice_number || '')
  const [qrCodeId, setQrCodeId] = useState(existing?.qr_code_id || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [qrOptions, setQrOptions] = useState<{ id: string; label: string }[]>([])

  // Load QR options for the picked event's store
  useEffect(() => {
    const ev = events.find(e => e.id === eventId)
    if (!ev) { setQrOptions([]); return }
    supabase.from('qr_codes')
      .select('id, label')
      .eq('store_id', ev.store_id)
      .is('deleted_at', null)
      .eq('active', true)
      .order('label')
      .then(({ data }) => setQrOptions((data || []) as any[]))
  }, [eventId, events])

  const amountNum = Number(amount) || 0
  const qtyNum = quantity ? Number(quantity) : null
  const cpp = qtyNum && qtyNum > 0 ? amountNum / qtyNum : null
  const fmt$ = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  const canSave = !!eventId && !!typeId && !!vendor.trim() && amountNum > 0 && !!incurredAt && !saving
    && (!markPaid || (!!paidAt && !!methodId))

  async function save() {
    if (!canSave) return
    setSaving(true)
    const ev = events.find(e => e.id === eventId)
    const payload: any = {
      event_id: eventId,
      store_id: ev?.store_id,
      type_id: typeId,
      vendor: vendor.trim(),
      amount: amountNum,
      incurred_at: incurredAt,
      paid_at: markPaid ? paidAt : null,
      payment_method_id: markPaid ? methodId : null,
      quantity: qtyNum,
      invoice_number: invoice.trim() || null,
      notes: notes.trim() || null,
      qr_code_id: qrCodeId || null,
      updated_at: new Date().toISOString(),
    }
    let res
    if (existing) {
      res = await supabase.from('marketing_payments').update(payload).eq('id', existing.id)
    } else {
      payload.created_by = userId
      res = await supabase.from('marketing_payments').insert(payload)
    }
    setSaving(false)
    if (res.error) { alert('Save failed: ' + res.error.message); return }
    onSaved()
  }

  async function remove() {
    if (!existing) return
    if (!confirm(`Delete this ${fmt$(existing.amount)} payment to ${existing.vendor || '(no vendor)'}? This cannot be undone.`)) return
    setDeleting(true)
    const { error } = await supabase.from('marketing_payments').delete().eq('id', existing.id)
    setDeleting(false)
    if (error) { alert('Delete failed: ' + error.message); return }
    onSaved()
  }

  const fmtDate = (iso: string) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}>
        ← Back to payments
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', margin: '4px 0 16px' }}>
        {existing ? 'Edit payment' : 'Add payment'}
      </h1>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label className="fl">Event *</label>
          <select value={eventId} onChange={e => setEventId(e.target.value)}>
            {events.sort((a, b) => b.start_date.localeCompare(a.start_date)).map(ev => (
              <option key={ev.id} value={ev.id}>{ev.store_name} · {fmtDate(ev.start_date)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="fl">Type *</label>
          <select value={typeId} onChange={e => setTypeId(e.target.value)}>
            {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="fl">Vendor *</label>
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. PrintCo, Philadelphia Inquirer" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="fl">Amount *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                style={{ paddingLeft: 18, width: '100%' }} />
            </div>
          </div>
          <div className="field">
            <label className="fl">Date incurred *</label>
            <input type="date" value={incurredAt} onChange={e => setIncurredAt(e.target.value)} />
          </div>
          <div className="field">
            <label className="fl">Quantity</label>
            <input type="number" min={0} value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="—" />
          </div>
        </div>
        {cpp != null && (
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: -4 }}>
            Cost per piece: <strong style={{ color: 'var(--green-dark)' }}>${cpp.toFixed(2)}</strong>
          </div>
        )}
        <div className="field">
          <label className="fl">Invoice #</label>
          <input value={invoice} onChange={e => setInvoice(e.target.value)} />
        </div>
        <div className="field">
          <label className="fl">Linked QR code (optional)</label>
          <select value={qrCodeId} onChange={e => setQrCodeId(e.target.value)}>
            <option value="">— none —</option>
            {qrOptions.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="fl">Notes</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 14, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer' }}>
            <input type="checkbox" checked={markPaid} onChange={e => setMarkPaid(e.target.checked)} />
            Mark as paid
          </label>
          {markPaid ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
              <div className="field">
                <label className="fl">Date paid *</label>
                <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
              </div>
              <div className="field">
                <label className="fl">Payment method *</label>
                <select value={methodId} onChange={e => setMethodId(e.target.value)}>
                  {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 6 }}>
              Unchecked = unpaid. Check this box (now or later) to record when the cost is paid.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div>
            {existing && (
              <button onClick={remove} disabled={deleting} className="btn-danger btn-sm">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
            <button onClick={save} disabled={!canSave} className="btn-primary btn-sm">
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
