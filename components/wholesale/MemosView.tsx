'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type {
  WholesaleMemo, WholesaleMemoLine, WholesaleCustomer, InventoryItem, MemoStatus, MemoLineStatus,
} from '@/types/wholesale'
import { fmtDate, fmtMoneyCents, dollarsToCents, centsToDollarsString, dollarsToWholeCents, centsToWholeDollarsString } from '@/lib/wholesale/format'
import { nextWholesaleNumber } from '@/lib/wholesale/numbers'
import { logAudit } from '@/lib/wholesale/audit'
import { Modal, Section, Row, Field, Select } from './InventoryView'
import Checkbox from '@/components/ui/Checkbox'
import { openWholesalePdf } from '@/lib/wholesale/openPdf'

const STATUS_LABEL: Record<MemoStatus, string> = {
  open: 'Open', closed_sold: 'Sold', closed_returned: 'Returned', closed_partial: 'Partial', overdue: 'Overdue',
}
const STATUS_COLOR: Record<MemoStatus, { bg: string; fg: string }> = {
  open:            { bg: '#FEF3C7', fg: '#92400E' },
  closed_sold:     { bg: '#DBEAFE', fg: '#1E40AF' },
  closed_returned: { bg: '#F3F4F6', fg: '#374151' },
  closed_partial:  { bg: '#FFEDD5', fg: '#9A3412' },
  overdue:         { bg: '#FEE2E2', fg: '#991B1B' },
}

export default function MemosView() {
  const { user, brand } = useApp()
  const [memos, setMemos] = useState<(WholesaleMemo & { customer_name?: string; line_count?: number })[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | MemoStatus>('all')
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    if (!brand) return
    setErr(null)
    try {
      const { data: ms, error } = await supabase
        .from('wholesale_memos')
        .select('*, customer:wholesale_customers(company_name), lines:wholesale_memo_lines(id)')
        .eq('brand', brand).is('archived_at', null)
        .order('date_created', { ascending: false })
      if (error) throw new Error(error.message)
      setMemos((ms || []).map((m: any) => ({
        ...m, customer_name: m.customer?.company_name, line_count: m.lines?.length || 0,
      })))
    } catch (e: any) { setErr(e?.message || 'Failed'); setMemos([]) }
  }
  useEffect(() => { void reload() }, [brand])

  const filtered = useMemo(() => {
    if (!memos) return []
    return memos.filter(m => statusFilter === 'all' || m.status === statusFilter)
  }, [memos, statusFilter])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['all','open','overdue','closed_partial','closed_sold','closed_returned'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={statusFilter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>
              {f === 'all' ? 'All' : STATUS_LABEL[f as MemoStatus]}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New Memo</button>
      </div>
      {err && <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{err}</div>}
      {memos === null ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        : filtered.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No memos.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--cream2)' }}>
                {['Memo #','Customer','Date','Due','Lines','Status',''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(m => {
                  const sc = STATUS_COLOR[m.status]
                  const overdue = m.status === 'open' && m.due_date < new Date().toISOString().slice(0,10)
                  return (
                    <tr key={m.id} onClick={() => setOpenId(m.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{m.memo_number}</td>
                      <td style={{ padding: '8px 10px' }}>{m.customer_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--mist)' }}>{fmtDate(m.date_created)}</td>
                      <td style={{ padding: '8px 10px', color: overdue ? '#991B1B' : 'var(--mist)' }}>{fmtDate(m.due_date)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{m.line_count}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                          {STATUS_LABEL[m.status]}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>→</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      {showNew && <NewMemoModal brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setOpenId(id); void reload() }} />}
      {openId && <MemoDetailModal memoId={openId} brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </div>
  )
}

function NewMemoModal({
  brand, actorId, actorEmail, onClose, onCreated,
}: {
  brand: string; actorId: string | null; actorEmail: string | null
  onClose: () => void; onCreated: (id: string) => void
}) {
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([])
  const [customer_id, setCustomerId] = useState('')
  const [date_created, setDateCreated] = useState(new Date().toISOString().slice(0,10))
  const [due_date, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0,10)
  })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('wholesale_customers').select('*').eq('brand', brand).is('archived_at', null).order('company_name')
      .then(({ data }) => setCustomers((data || []) as WholesaleCustomer[]))
  }, [brand])

  async function create() {
    if (!customer_id) { setErr('Pick a customer'); return }
    setBusy(true); setErr(null)
    try {
      const memoNumber = await nextWholesaleNumber(brand, 'M')
      const { data, error } = await supabase.from('wholesale_memos').insert({
        brand, memo_number: memoNumber, customer_id, date_created, due_date,
        notes: notes.trim() || null, status: 'open', created_by: actorId, updated_by: actorId,
      }).select('id').single()
      if (error) throw new Error(error.message)
      await logAudit({ brand, entity_type: 'wholesale_memo', entity_id: (data as any).id, action: 'created', after: { memo_number: memoNumber, customer_id }, actor_id: actorId, actor_email: actorEmail })
      onCreated((data as any).id)
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  return (
    <Modal onClose={onClose} title="New Memo">
      <Row>
        <Field label="Customer *">
          <Select value={customer_id} onChange={setCustomerId}>
            <option value="">— pick a customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </Field>
        <Field label="Date created"><input type="date" value={date_created} onChange={e => setDateCreated(e.target.value)} /></Field>
        <Field label="Due date"><input type="date" value={due_date} onChange={e => setDueDate(e.target.value)} /></Field>
      </Row>
      <Field label="Notes (optional)"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
        <button onClick={create} disabled={busy} className="btn-primary btn-sm">{busy ? 'Creating…' : 'Create'}</button>
      </div>
    </Modal>
  )
}

function MemoDetailModal({
  memoId, brand, actorId, actorEmail, onClose, onChanged,
}: {
  memoId: string; brand: string; actorId: string | null; actorEmail: string | null
  onClose: () => void; onChanged: () => void
}) {
  const [memo, setMemo] = useState<WholesaleMemo | null>(null)
  const [customer, setCustomer] = useState<WholesaleCustomer | null>(null)
  const [lines, setLines] = useState<(WholesaleMemoLine & { item?: InventoryItem })[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)

  async function reload() {
    setErr(null)
    try {
      const [memoRes, linesRes] = await Promise.all([
        supabase.from('wholesale_memos').select('*, customer:wholesale_customers(*)').eq('id', memoId).maybeSingle(),
        supabase.from('wholesale_memo_lines').select('*, item:inventory_items(*)').eq('memo_id', memoId).order('created_at'),
      ])
      const m = memoRes.data as any
      setMemo(m); setCustomer(m?.customer || null)
      setLines((linesRes.data || []) as any[])
    } catch (e: any) { setErr(e?.message || 'Load failed') }
  }
  useEffect(() => { void reload() }, [memoId])

  async function addItem(item: InventoryItem) {
    setBusy(true); setErr(null)
    try {
      const memoPrice = item.wholesale_price_cents ?? 0
      const { data: line, error } = await supabase.from('wholesale_memo_lines').insert({
        memo_id: memoId, item_id: item.id, memo_price_cents: memoPrice, line_status: 'out',
      }).select('*').single()
      if (error) throw new Error(error.message)
      // Flip inventory status
      await supabase.from('inventory_items').update({
        status: 'on_memo', current_memo_id: memoId, updated_by: actorId,
      }).eq('id', item.id)
      await logAudit({ brand, entity_type: 'wholesale_memo_line', entity_id: (line as any).id, action: 'created', after: { item_id: item.id, memo_id: memoId }, actor_id: actorId, actor_email: actorEmail })
      await logAudit({ brand, entity_type: 'inventory_item', entity_id: item.id, action: 'status_changed', before: { status: item.status }, after: { status: 'on_memo' }, actor_id: actorId, actor_email: actorEmail })
      await reload(); onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function setLinePrice(line: WholesaleMemoLine, dollars: string) {
    // Memo prices are whole dollars only as of 2026-05-15.
    const cents = dollarsToWholeCents(dollars) ?? 0
    await supabase.from('wholesale_memo_lines').update({ memo_price_cents: cents }).eq('id', line.id)
    await reload(); onChanged()
  }
  async function returnLine(line: WholesaleMemoLine & { item?: InventoryItem }) {
    if (!confirm('Mark this line as returned? Inventory flips back to In Stock.')) return
    setBusy(true); setErr(null)
    try {
      await supabase.from('wholesale_memo_lines').update({
        line_status: 'returned', resolved_at: new Date().toISOString(),
      }).eq('id', line.id)
      await supabase.from('inventory_items').update({
        status: 'in_stock', current_memo_id: null, updated_by: actorId,
      }).eq('id', line.item_id)
      await logAudit({ brand, entity_type: 'wholesale_memo_line', entity_id: line.id, action: 'status_changed', after: { line_status: 'returned' }, actor_id: actorId, actor_email: actorEmail })
      await logAudit({ brand, entity_type: 'inventory_item', entity_id: line.item_id, action: 'status_changed', after: { status: 'in_stock' }, actor_id: actorId, actor_email: actorEmail })
      await maybeRecomputeMemoStatus()
      await reload(); onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function bulkReturn() {
    if (selected.size === 0 || !confirm(`Mark ${selected.size} line(s) as returned?`)) return
    setBusy(true); setErr(null)
    try {
      for (const lineId of Array.from(selected)) {
        const line = lines.find(l => l.id === lineId)
        if (!line || line.line_status !== 'out') continue
        await supabase.from('wholesale_memo_lines').update({ line_status: 'returned', resolved_at: new Date().toISOString() }).eq('id', line.id)
        await supabase.from('inventory_items').update({ status: 'in_stock', current_memo_id: null, updated_by: actorId }).eq('id', line.item_id)
      }
      await maybeRecomputeMemoStatus()
      setSelected(new Set())
      await reload(); onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function bulkConvertToInvoice() {
    if (selected.size === 0) return
    if (!customer) { setErr('No customer on this memo'); return }
    if (!confirm(`Convert ${selected.size} line(s) to a new invoice for ${customer.company_name}?`)) return
    setBusy(true); setErr(null)
    try {
      const invoiceNumber = await nextWholesaleNumber(brand, 'INV')
      const { data: inv, error: invErr } = await supabase.from('wholesale_invoices').insert({
        brand, invoice_number: invoiceNumber, customer_id: customer.id,
        invoice_date: new Date().toISOString().slice(0,10),
        payment_terms: customer.default_payment_terms,
        payment_status: 'unpaid',
        created_by: actorId, updated_by: actorId,
      }).select('id').single()
      if (invErr) throw new Error(invErr.message)
      let subtotal = 0
      for (const lineId of Array.from(selected)) {
        const line = lines.find(l => l.id === lineId)
        if (!line || line.line_status !== 'out' || !line.item) continue
        const sale = line.memo_price_cents
        const { data: invLine, error: invLineErr } = await supabase.from('wholesale_invoice_lines').insert({
          invoice_id: (inv as any).id,
          item_id: line.item_id,
          description: line.item.public_notes || line.item.item_number,
          sale_price_cents: sale,
          cost_cents_at_sale: line.item.cost_cents,
        }).select('id').single()
        if (invLineErr) throw new Error(invLineErr.message)
        subtotal += sale
        await supabase.from('wholesale_memo_lines').update({
          line_status: 'sold', resolved_at: new Date().toISOString(),
          invoice_line_id: (invLine as any).id,
        }).eq('id', line.id)
        await supabase.from('inventory_items').update({
          status: 'sold', sold_invoice_id: (inv as any).id, current_memo_id: null, updated_by: actorId,
        }).eq('id', line.item_id)
      }
      // Update invoice totals.
      await supabase.from('wholesale_invoices').update({
        subtotal_cents: subtotal, total_due_cents: subtotal,
      }).eq('id', (inv as any).id)
      await logAudit({ brand, entity_type: 'wholesale_invoice', entity_id: (inv as any).id, action: 'created', after: { invoice_number: invoiceNumber, from_memo: memoId, line_count: selected.size }, actor_id: actorId, actor_email: actorEmail })
      await logAudit({ brand, entity_type: 'wholesale_memo', entity_id: memoId, action: 'memo_converted', after: { invoice_id: (inv as any).id, line_count: selected.size }, actor_id: actorId, actor_email: actorEmail })
      await maybeRecomputeMemoStatus()
      setSelected(new Set())
      await reload(); onChanged()
      alert(`Created ${invoiceNumber} with ${selected.size} line(s).`)
    } catch (e: any) { setErr(e?.message || 'Convert failed') }
    setBusy(false)
  }
  async function maybeRecomputeMemoStatus() {
    const { data: cur } = await supabase.from('wholesale_memo_lines').select('line_status').eq('memo_id', memoId)
    const statuses = ((cur || []) as { line_status: MemoLineStatus }[]).map(r => r.line_status)
    if (statuses.length === 0) return
    let next: MemoStatus = 'open'
    const allSold = statuses.every(s => s === 'sold')
    const allReturned = statuses.every(s => s === 'returned')
    const anyOut = statuses.some(s => s === 'out')
    if (allSold) next = 'closed_sold'
    else if (allReturned) next = 'closed_returned'
    else if (!anyOut) next = 'closed_partial'
    else if (memo && memo.due_date < new Date().toISOString().slice(0,10)) next = 'overdue'
    else next = 'open'
    await supabase.from('wholesale_memos').update({ status: next }).eq('id', memoId)
  }

  if (!memo || !customer) {
    return <Modal onClose={onClose} title="Loading…"><div>Loading…</div></Modal>
  }

  const overdue = memo.status === 'open' && memo.due_date < new Date().toISOString().slice(0,10)
  const totalCents = lines.reduce((s, l) => s + l.memo_price_cents, 0)
  const outLines = lines.filter(l => l.line_status === 'out')

  return (
    <Modal onClose={onClose} title={`${memo.memo_number} — ${customer.company_name}`} wide>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div><b>Created:</b> {fmtDate(memo.date_created)}</div>
        <div style={{ color: overdue ? '#991B1B' : undefined }}><b>Due:</b> {fmtDate(memo.due_date)}{overdue && ' (overdue)'}</div>
        <div><b>Status:</b> {STATUS_LABEL[memo.status]}</div>
        <div style={{ flex: 1 }} />
        <div><b>Total:</b> {fmtMoneyCents(totalCents)} ({lines.length} lines)</div>
      </div>

      {/* Always-visible bulk action bar — keeps the page from jumping
          when the user toggles checkboxes. Buttons disable until at
          least one line is selected. */}
      <div className="card" style={{ padding: 8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--cream2)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: selected.size > 0 ? 'var(--ink)' : 'var(--mist)' }}>
          {selected.size > 0 ? `${selected.size} selected` : 'Select lines to act on'}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={bulkConvertToInvoice} disabled={busy || selected.size === 0} className="btn-primary btn-xs">→ Convert to invoice</button>
        <button onClick={bulkReturn} disabled={busy || selected.size === 0} className="btn-outline btn-xs">Mark returned</button>
        <button onClick={() => setSelected(new Set())} disabled={busy || selected.size === 0} className="btn-outline btn-xs">Cancel</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--cream2)' }}>
            <th style={{ padding: '6px 8px', width: 28 }}>
              <Checkbox
                checked={outLines.length > 0 && outLines.every(l => selected.has(l.id))}
                onChange={() => {
                  const all = outLines.every(l => selected.has(l.id))
                  setSelected(all ? new Set() : new Set(outLines.map(l => l.id)))
                }}
                size={16}
              />
            </th>
            {['Item #','Description','Memo price','Status',''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: 'var(--mist)' }}>No lines yet.</td></tr>
            ) : lines.map(l => {
              const isSelected = selected.has(l.id)
              const canSelect = l.line_status === 'out'
              return (
                <tr key={l.id} style={{ borderTop: '1px solid var(--pearl)', background: isSelected ? 'var(--cream2)' : undefined }}>
                  <td style={{ padding: '6px 8px' }}>
                    {canSelect && (
                      <Checkbox checked={isSelected} size={16} onChange={() => {
                        const next = new Set(selected)
                        if (next.has(l.id)) next.delete(l.id); else next.add(l.id)
                        setSelected(next)
                      }} />
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 700 }}>{l.item?.item_number || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{l.item?.public_notes || l.item?.jewelry_type || l.item?.watch_brand || l.item?.diamond_report_number || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {/* Whole dollars only (2026-05-15). */}
                    <input type="number" step="1" min="0" defaultValue={centsToWholeDollarsString(l.memo_price_cents)}
                      onBlur={e => setLinePrice(l, e.target.value)}
                      disabled={l.line_status !== 'out'}
                      style={{ width: 90, padding: '4px 6px', fontSize: 12 }} />
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {l.line_status === 'out' ? '📋 On Memo' : l.line_status === 'sold' ? '✓ Sold' : '↩ Returned'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {l.line_status === 'out' && (
                      <button onClick={() => returnLine(l)} disabled={busy} className="btn-outline btn-xs">Return</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button onClick={() => setShowAddItem(true)} disabled={busy} className="btn-outline btn-sm">+ Add inventory to memo</button>

      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginTop: 8 }}>{err}</div>}

      {showAddItem && (
        <AddItemPicker brand={brand} onClose={() => setShowAddItem(false)} onPick={(it) => { setShowAddItem(false); void addItem(it) }} />
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={() => openWholesalePdf(`/api/wholesale/memo/${memo.id}/pdf`)} className="btn-outline btn-sm">⇣ Memo PDF</button>
        <button onClick={onClose} className="btn-outline btn-sm">Close</button>
      </div>
    </Modal>
  )
}

function AddItemPicker({ brand, onClose, onPick }: { brand: string; onClose: () => void; onPick: (it: InventoryItem) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [search, setSearch] = useState('')
  useEffect(() => {
    void supabase.from('inventory_items').select('*')
      .eq('brand', brand).eq('status', 'in_stock').is('archived_at', null)
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setItems((data || []) as InventoryItem[]))
  }, [brand])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i => [i.item_number, i.public_notes, i.watch_brand, i.watch_model, i.diamond_report_number, i.jewelry_designer]
      .filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [items, search])
  return (
    <Modal onClose={onClose} title="Pick inventory to add">
      <input type="search" autoFocus value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search item #, description, serial, report #…" style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>No in-stock items.</div>
        ) : filtered.map(i => (
          <button key={i.id} onClick={() => onPick(i)} style={{
            textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pearl)',
            background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <div>
              <div style={{ fontWeight: 700 }}>{i.item_number}</div>
              <div style={{ fontSize: 11, color: 'var(--mist)' }}>{i.public_notes || i.watch_brand || i.diamond_report_number || i.jewelry_type || '—'}</div>
            </div>
            <div style={{ whiteSpace: 'nowrap' }}>{fmtMoneyCents(i.wholesale_price_cents)}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
