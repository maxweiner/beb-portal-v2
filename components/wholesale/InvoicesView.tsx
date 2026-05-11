'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type {
  WholesaleInvoice, WholesaleInvoiceLine, WholesaleInvoicePayment,
  WholesaleInvoiceTradeinLine, WholesaleCustomer, InventoryItem,
  InvoicePaymentStatus, InventoryCategory,
} from '@/types/wholesale'
import { fmtDate, fmtMoneyCents, dollarsToCents, centsToDollarsString } from '@/lib/wholesale/format'
import { nextWholesaleNumber, prefixForCategory } from '@/lib/wholesale/numbers'
import { logAudit } from '@/lib/wholesale/audit'
import { loadAdminList } from '@/lib/wholesale/lists'
import { Modal, Section, Row, Field, Select } from './InventoryView'
import { openWholesalePdf } from '@/lib/wholesale/openPdf'

const STATUS_LABEL: Record<InvoicePaymentStatus, string> = {
  unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid',
}
const STATUS_COLOR: Record<InvoicePaymentStatus, { bg: string; fg: string }> = {
  unpaid:  { bg: '#FEE2E2', fg: '#991B1B' },
  partial: { bg: '#FEF3C7', fg: '#92400E' },
  paid:    { bg: '#D1FAE5', fg: '#065F46' },
}

function agingBucket(invoice_date: string, payment_terms: string | null): string {
  const days = Math.floor((Date.now() - new Date(invoice_date + 'T12:00:00').getTime()) / 86400000)
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

export default function InvoicesView() {
  const { user, brand } = useApp()
  const [invoices, setInvoices] = useState<(WholesaleInvoice & { customer_name?: string })[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | InvoicePaymentStatus>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    if (!brand) return
    setErr(null)
    try {
      const { data, error } = await supabase
        .from('wholesale_invoices')
        .select('*, customer:wholesale_customers(company_name)')
        .eq('brand', brand).is('archived_at', null)
        .order('invoice_date', { ascending: false })
      if (error) throw new Error(error.message)
      setInvoices((data || []).map((i: any) => ({ ...i, customer_name: i.customer?.company_name })))
    } catch (e: any) { setErr(e?.message || 'Failed'); setInvoices([]) }
  }
  useEffect(() => { void reload() }, [brand])

  const filtered = useMemo(() => {
    if (!invoices) return []
    return invoices.filter(i => statusFilter === 'all' || i.payment_status === statusFilter)
  }, [invoices, statusFilter])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['all','unpaid','partial','paid'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={statusFilter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
              style={{ textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-sm">+ New Invoice</button>
      </div>
      {err && <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{err}</div>}
      {invoices === null ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
        : filtered.length === 0 ? <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>No invoices.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--cream2)' }}>
                {['Invoice #','Customer','Date','Aging','Total','Paid','Balance','Status',''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(inv => {
                  const sc = STATUS_COLOR[inv.payment_status]
                  const balance = (inv.total_due_cents || 0) - (inv.paid_cents || 0)
                  const aging = agingBucket(inv.invoice_date, inv.payment_terms)
                  return (
                    <tr key={inv.id} onClick={() => setOpenId(inv.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{inv.invoice_number}</td>
                      <td style={{ padding: '8px 10px' }}>{inv.customer_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--mist)' }}>{fmtDate(inv.invoice_date)}</td>
                      <td style={{ padding: '8px 10px', color: aging === '90+' ? '#991B1B' : 'var(--mist)' }}>{aging} d</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtMoneyCents(inv.total_due_cents)}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtMoneyCents(inv.paid_cents)}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 700 }}>{fmtMoneyCents(balance)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                          {STATUS_LABEL[inv.payment_status]}
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

      {showNew && <NewInvoiceModal brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setOpenId(id); void reload() }} />}
      {openId && <InvoiceDetailModal invoiceId={openId} brand={brand!} actorId={user?.id || null} actorEmail={user?.email || null}
        onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </div>
  )
}

function NewInvoiceModal({
  brand, actorId, actorEmail, onClose, onCreated,
}: {
  brand: string; actorId: string | null; actorEmail: string | null
  onClose: () => void; onCreated: (id: string) => void
}) {
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([])
  const [paymentTerms, setPaymentTerms] = useState<string[]>([])
  const [customer_id, setCustomerId] = useState('')
  const [invoice_date, setInvoiceDate] = useState(new Date().toISOString().slice(0,10))
  const [payment_terms, setTerms] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      supabase.from('wholesale_customers').select('*').eq('brand', brand).is('archived_at', null).order('company_name'),
      loadAdminList(brand, 'payment_terms'),
    ]).then(([cRes, terms]) => {
      setCustomers((cRes.data || []) as WholesaleCustomer[])
      setPaymentTerms(terms)
    })
  }, [brand])

  // Default payment_terms from customer.
  useEffect(() => {
    if (!customer_id) return
    const c = customers.find(c => c.id === customer_id)
    if (c?.default_payment_terms) setTerms(c.default_payment_terms)
  }, [customer_id, customers])

  async function create() {
    if (!customer_id) { setErr('Pick a customer'); return }
    setBusy(true); setErr(null)
    try {
      const invoiceNumber = await nextWholesaleNumber(brand, 'INV')
      const { data, error } = await supabase.from('wholesale_invoices').insert({
        brand, invoice_number: invoiceNumber, customer_id,
        invoice_date, payment_terms: payment_terms || null, payment_status: 'unpaid',
        created_by: actorId, updated_by: actorId,
      }).select('id').single()
      if (error) throw new Error(error.message)
      await logAudit({ brand, entity_type: 'wholesale_invoice', entity_id: (data as any).id, action: 'created', after: { invoice_number: invoiceNumber, customer_id }, actor_id: actorId, actor_email: actorEmail })
      onCreated((data as any).id)
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  return (
    <Modal onClose={onClose} title="New Invoice">
      <Row>
        <Field label="Customer *">
          <Select value={customer_id} onChange={setCustomerId}>
            <option value="">— pick a customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </Field>
        <Field label="Invoice date"><input type="date" value={invoice_date} onChange={e => setInvoiceDate(e.target.value)} /></Field>
        <Field label="Payment terms">
          <Select value={payment_terms} onChange={setTerms}>
            <option value="">—</option>
            {paymentTerms.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
      </Row>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
        <button onClick={create} disabled={busy} className="btn-primary btn-sm">{busy ? 'Creating…' : 'Create'}</button>
      </div>
    </Modal>
  )
}

function InvoiceDetailModal({
  invoiceId, brand, actorId, actorEmail, onClose, onChanged,
}: {
  invoiceId: string; brand: string; actorId: string | null; actorEmail: string | null
  onClose: () => void; onChanged: () => void
}) {
  const [invoice, setInvoice] = useState<WholesaleInvoice | null>(null)
  const [customer, setCustomer] = useState<WholesaleCustomer | null>(null)
  const [lines, setLines] = useState<(WholesaleInvoiceLine & { item?: InventoryItem })[]>([])
  const [tradeins, setTradeins] = useState<WholesaleInvoiceTradeinLine[]>([])
  const [payments, setPayments] = useState<WholesaleInvoicePayment[]>([])
  const [paymentMethods, setPaymentMethods] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAddLine, setShowAddLine] = useState(false)
  const [showAddPayment, setShowAddPayment] = useState(false)
  const [showAddTradein, setShowAddTradein] = useState(false)

  async function reload() {
    setErr(null)
    try {
      const [invRes, linesRes, tradeinsRes, paymentsRes, methods] = await Promise.all([
        supabase.from('wholesale_invoices').select('*, customer:wholesale_customers(*)').eq('id', invoiceId).maybeSingle(),
        supabase.from('wholesale_invoice_lines').select('*, item:inventory_items(*)').eq('invoice_id', invoiceId).order('created_at'),
        supabase.from('wholesale_invoice_tradein_lines').select('*').eq('invoice_id', invoiceId).order('created_at'),
        supabase.from('wholesale_invoice_payments').select('*').eq('invoice_id', invoiceId).order('paid_on', { ascending: false }),
        loadAdminList(brand, 'payment_method'),
      ])
      const inv = invRes.data as any
      setInvoice(inv); setCustomer(inv?.customer || null)
      setLines((linesRes.data || []) as any[])
      setTradeins((tradeinsRes.data || []) as WholesaleInvoiceTradeinLine[])
      setPayments((paymentsRes.data || []) as WholesaleInvoicePayment[])
      setPaymentMethods(methods)
    } catch (e: any) { setErr(e?.message || 'Failed') }
  }
  useEffect(() => { void reload() }, [invoiceId])

  async function recomputeTotals() {
    const subtotal = lines.reduce((s, l) => s + l.sale_price_cents, 0)
    const tradeinCredit = tradeins.reduce((s, t) => s + t.agreed_price_cents, 0)
    const total = Math.max(0, subtotal - tradeinCredit)
    const paid = payments.reduce((s, p) => s + p.amount_cents, 0)
    const status: InvoicePaymentStatus = paid <= 0 ? 'unpaid' : paid < total ? 'partial' : 'paid'
    await supabase.from('wholesale_invoices').update({
      subtotal_cents: subtotal, tradein_credit_cents: tradeinCredit,
      total_due_cents: total, paid_cents: paid, payment_status: status,
    }).eq('id', invoiceId)
  }

  async function addLine(item: InventoryItem) {
    setBusy(true); setErr(null)
    try {
      const sale = item.wholesale_price_cents ?? 0
      const { data: line, error } = await supabase.from('wholesale_invoice_lines').insert({
        invoice_id: invoiceId, item_id: item.id,
        description: item.public_notes || item.item_number,
        sale_price_cents: sale,
        cost_cents_at_sale: item.cost_cents,
      }).select('*').single()
      if (error) throw new Error(error.message)
      await supabase.from('inventory_items').update({
        status: 'sold', sold_invoice_id: invoiceId, current_memo_id: null, updated_by: actorId,
      }).eq('id', item.id)
      await logAudit({ brand, entity_type: 'inventory_item', entity_id: item.id, action: 'status_changed', after: { status: 'sold', invoice_id: invoiceId }, actor_id: actorId, actor_email: actorEmail })
      await reload(); await recomputeTotals(); onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function setLineSalePrice(line: WholesaleInvoiceLine, dollars: string) {
    const cents = dollarsToCents(dollars) ?? 0
    await supabase.from('wholesale_invoice_lines').update({ sale_price_cents: cents }).eq('id', line.id)
    await reload(); await recomputeTotals(); onChanged()
  }
  async function removeLine(line: WholesaleInvoiceLine) {
    if (!confirm('Remove this line? Inventory flips back to In Stock.')) return
    setBusy(true); setErr(null)
    try {
      await supabase.from('wholesale_invoice_lines').delete().eq('id', line.id)
      await supabase.from('inventory_items').update({
        status: 'in_stock', sold_invoice_id: null, updated_by: actorId,
      }).eq('id', line.item_id)
      await logAudit({ brand, entity_type: 'wholesale_invoice_line', entity_id: line.id, action: 'deleted', actor_id: actorId, actor_email: actorEmail })
      await reload(); await recomputeTotals(); onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  async function addPayment(amount: number, method: string, paid_on: string, reference: string, notes: string) {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('wholesale_invoice_payments').insert({
        invoice_id: invoiceId, brand, amount_cents: amount,
        method: method || null, paid_on, reference: reference || null, notes: notes || null,
        created_by: actorId,
      })
      if (error) throw new Error(error.message)
      await logAudit({ brand, entity_type: 'wholesale_invoice_payment', entity_id: invoiceId, action: 'payment_added', after: { amount, method, paid_on }, actor_id: actorId, actor_email: actorEmail })
      await reload(); await recomputeTotals(); onChanged()
      setShowAddPayment(false)
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  async function addTradein(description: string, dollars: string, category: InventoryCategory) {
    setBusy(true); setErr(null)
    try {
      if (!customer) throw new Error('No customer')
      const cents = dollarsToCents(dollars) ?? 0
      // 1. Spawn a new inventory_items row with this customer linked as "vendor"
      //    (cost = the agreed trade-in price).
      // We need a wholesale_vendors row for the customer-as-vendor; create
      // one on the fly if it doesn't exist.
      let { data: existingVendor } = await supabase.from('wholesale_vendors')
        .select('id').eq('brand', brand).eq('company_name', customer.company_name).is('archived_at', null).maybeSingle()
      let vendorId: string
      if (existingVendor) {
        vendorId = (existingVendor as any).id
      } else {
        // Carry both addresses across when spawning the vendor from a
        // trade-in customer. Falls back to legacy `address` for old
        // customer rows that pre-date the bill/ship split.
        const billing  = (customer as any).billing_address  ?? customer.address ?? null
        const shipping = (customer as any).shipping_address ?? customer.address ?? null
        const { data: newVendor, error: vErr } = await supabase.from('wholesale_vendors').insert({
          brand, company_name: customer.company_name,
          contact_name: customer.contact_name, phone: customer.phone, email: customer.email,
          address: billing,
          billing_address: billing,
          shipping_address: shipping,
          notes: 'Auto-created from trade-in',
          created_by: actorId, updated_by: actorId,
        }).select('id').single()
        if (vErr) throw new Error(vErr.message)
        vendorId = (newVendor as any).id
      }
      const itemNumber = await nextWholesaleNumber(brand, prefixForCategory(category))
      const { data: item, error: itErr } = await supabase.from('inventory_items').insert({
        brand, category, item_number: itemNumber, status: 'in_stock',
        cost_cents: cents, vendor_id: vendorId,
        public_notes: description,
        date_acquired: invoice?.invoice_date || new Date().toISOString().slice(0,10),
        created_by: actorId, updated_by: actorId,
      }).select('id').single()
      if (itErr) throw new Error(itErr.message)
      const { error: tlErr } = await supabase.from('wholesale_invoice_tradein_lines').insert({
        invoice_id: invoiceId, description, agreed_price_cents: cents, category,
        spawned_item_id: (item as any).id,
      })
      if (tlErr) throw new Error(tlErr.message)
      await logAudit({ brand, entity_type: 'wholesale_invoice_tradein_line', entity_id: invoiceId, action: 'tradein_created', after: { description, amount: cents, item_number: itemNumber }, actor_id: actorId, actor_email: actorEmail })
      await reload(); await recomputeTotals(); onChanged()
      setShowAddTradein(false)
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  if (!invoice || !customer) {
    return <Modal onClose={onClose} title="Loading…"><div>Loading…</div></Modal>
  }
  const balance = (invoice.total_due_cents || 0) - (invoice.paid_cents || 0)

  return (
    <Modal onClose={onClose} title={`${invoice.invoice_number} — ${customer.company_name}`} wide>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
        <div><b>Invoice date:</b> {fmtDate(invoice.invoice_date)}</div>
        <div><b>Terms:</b> {invoice.payment_terms || '—'}</div>
        <div style={{ flex: 1 }} />
        <div><b>Subtotal:</b> {fmtMoneyCents(invoice.subtotal_cents)}</div>
        {invoice.tradein_credit_cents > 0 && <div><b>Trade-in credit:</b> {fmtMoneyCents(-invoice.tradein_credit_cents)}</div>}
        <div><b>Total:</b> {fmtMoneyCents(invoice.total_due_cents)}</div>
        <div><b>Paid:</b> {fmtMoneyCents(invoice.paid_cents)}</div>
        <div style={{ fontWeight: 800 }}><b>Balance:</b> {fmtMoneyCents(balance)}</div>
      </div>

      <Section title={`Lines (${lines.length})`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--cream2)' }}>
            {['Item #','Description','Sale price',''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 10, textAlign: 'center', color: 'var(--mist)' }}>No lines yet.</td></tr>
            ) : lines.map(l => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{l.item?.item_number || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{l.description}</td>
                <td style={{ padding: '6px 8px' }}>
                  <input type="number" step="0.01" defaultValue={centsToDollarsString(l.sale_price_cents)}
                    onBlur={e => setLineSalePrice(l, e.target.value)}
                    style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button onClick={() => removeLine(l)} disabled={busy} className="btn-outline btn-xs">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button onClick={() => setShowAddLine(true)} className="btn-outline btn-sm">+ Add line</button></div>
      </Section>

      <Section title={`Trade-ins (${tradeins.length})`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--cream2)' }}>
            {['Description','Cat','Agreed price','Inventory #'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {tradeins.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 10, textAlign: 'center', color: 'var(--mist)' }}>No trade-ins.</td></tr>
            ) : tradeins.map(t => (
              <tr key={t.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                <td style={{ padding: '6px 8px' }}>{t.description}</td>
                <td style={{ padding: '6px 8px', color: 'var(--mist)' }}>{t.category}</td>
                <td style={{ padding: '6px 8px' }}>{fmtMoneyCents(t.agreed_price_cents)}</td>
                <td style={{ padding: '6px 8px', color: 'var(--mist)' }}>{t.spawned_item_id ? '✓ created' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button onClick={() => setShowAddTradein(true)} className="btn-outline btn-sm">+ Add trade-in</button></div>
      </Section>

      <Section title={`Payments (${payments.length})`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--cream2)' }}>
            {['Date','Amount','Method','Ref','Notes'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 10, textAlign: 'center', color: 'var(--mist)' }}>No payments.</td></tr>
            ) : payments.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                <td style={{ padding: '6px 8px' }}>{fmtDate(p.paid_on)}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{fmtMoneyCents(p.amount_cents)}</td>
                <td style={{ padding: '6px 8px' }}>{p.method || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{p.reference || '—'}</td>
                <td style={{ padding: '6px 8px', color: 'var(--mist)' }}>{p.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button onClick={() => setShowAddPayment(true)} className="btn-outline btn-sm">+ Record payment</button></div>
      </Section>

      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={() => openWholesalePdf(`/api/wholesale/invoice/${invoice.id}/pdf`)} className="btn-outline btn-sm">⇣ Invoice PDF</button>
        <button onClick={onClose} className="btn-outline btn-sm">Close</button>
      </div>

      {showAddLine && (
        <AddInventoryLinePicker brand={brand} onClose={() => setShowAddLine(false)} onPick={(it) => { setShowAddLine(false); void addLine(it) }} />
      )}
      {showAddPayment && (
        <AddPaymentModal methods={paymentMethods} balance={balance}
          onClose={() => setShowAddPayment(false)} onAdd={addPayment} />
      )}
      {showAddTradein && (
        <AddTradeinModal onClose={() => setShowAddTradein(false)} onAdd={addTradein} />
      )}
    </Modal>
  )
}

function AddInventoryLinePicker({ brand, onClose, onPick }: { brand: string; onClose: () => void; onPick: (it: InventoryItem) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [search, setSearch] = useState('')
  useEffect(() => {
    void supabase.from('inventory_items').select('*').eq('brand', brand)
      .in('status', ['in_stock','on_memo','on_hold'])
      .is('archived_at', null).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setItems((data || []) as InventoryItem[]))
  }, [brand])
  const filtered = items.filter(i => {
    const q = search.trim().toLowerCase(); if (!q) return true
    return [i.item_number, i.public_notes, i.watch_brand, i.watch_serial_number, i.diamond_report_number].filter(Boolean).join(' ').toLowerCase().includes(q)
  })
  return (
    <Modal onClose={onClose} title="Pick inventory">
      <input type="search" autoFocus value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search…" style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(i => (
          <button key={i.id} onClick={() => onPick(i)} style={{
            textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pearl)',
            background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: 700 }}>{i.item_number} <span style={{ fontSize: 10, color: 'var(--mist)' }}>{i.status}</span></div>
              <div style={{ fontSize: 11, color: 'var(--mist)' }}>{i.public_notes || i.watch_brand || i.diamond_report_number || '—'}</div>
            </div>
            <div style={{ whiteSpace: 'nowrap' }}>{fmtMoneyCents(i.wholesale_price_cents)}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function AddPaymentModal({ methods, balance, onClose, onAdd }: {
  methods: string[]
  balance: number
  onClose: () => void
  onAdd: (amount: number, method: string, paid_on: string, reference: string, notes: string) => Promise<void>
}) {
  const [amount, setAmount] = useState((balance / 100).toFixed(2))
  const [method, setMethod] = useState(methods[0] || '')
  const [paid_on, setPaidOn] = useState(new Date().toISOString().slice(0,10))
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function submit() {
    const cents = dollarsToCents(amount) ?? 0
    if (cents <= 0) { setErr('Amount must be positive'); return }
    setBusy(true)
    try { await onAdd(cents, method, paid_on, reference, notes) }
    catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  return (
    <Modal onClose={onClose} title="Record payment">
      <Row>
        <Field label="Amount ($)"><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Date"><input type="date" value={paid_on} onChange={e => setPaidOn(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onChange={setMethod}>
            <option value="">—</option>
            {methods.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Reference"><input type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="check #, wire conf., …" /></Field>
      </Row>
      <Field label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
        <button onClick={submit} disabled={busy} className="btn-primary btn-sm">{busy ? 'Saving…' : 'Add payment'}</button>
      </div>
    </Modal>
  )
}

function AddTradeinModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (description: string, dollars: string, category: InventoryCategory) => Promise<void>
}) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<InventoryCategory>('jewelry')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function submit() {
    if (!description.trim() || !amount) { setErr('Description + amount required'); return }
    setBusy(true)
    try { await onAdd(description.trim(), amount, category) }
    catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  return (
    <Modal onClose={onClose} title="Add trade-in">
      <Row>
        <Field label="Category">
          <Select value={category} onChange={(v) => setCategory(v as InventoryCategory)}>
            <option value="jewelry">Jewelry</option>
            <option value="watch">Watch</option>
            <option value="diamond">Diamond</option>
          </Select>
        </Field>
        <Field label="Agreed price ($)">
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
        </Field>
      </Row>
      <Field label="Description">
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%' }}
          placeholder="What is the customer trading in? (becomes the item's public notes)" />
      </Field>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
        On save: a new inventory item is created (status In Stock, cost = agreed price, vendor = this customer).
      </div>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
        <button onClick={submit} disabled={busy} className="btn-primary btn-sm">{busy ? 'Saving…' : 'Add trade-in'}</button>
      </div>
    </Modal>
  )
}
