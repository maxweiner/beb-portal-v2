'use client'

// Mobile Customers tab. Wholesale dealer lookup — search by store
// name / contact / phone / email. Tap → detail with contact info +
// recent activity (memos / invoices). Create + edit ship in v2.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { WholesaleCustomer } from '@/types/wholesale'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function MobileCustomersView() {
  const { brand } = useApp()
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wholesale_customers')
        .select('*')
        .eq('brand', brand)
        .is('archived_at', null)
        .order('company_name', { ascending: true })
        .limit(2000)
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setCustomers((data || []) as WholesaleCustomer[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c => {
      const hay = [
        c.company_name,
        c.contact_name || '',
        c.phone || '',
        c.mobile_phone || '',
        c.email || '',
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [customers, search])

  const openCustomer = useMemo(
    () => customers.find(c => c.id === openId) || null,
    [customers, openId],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        type="search"
        inputMode="search"
        placeholder="Store / contact / phone / email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          padding: '10px 12px', fontSize: 15,
          border: '1px solid var(--pearl)', borderRadius: 8,
          background: '#fff', fontFamily: 'inherit',
        }}
      />

      <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {loading ? 'Loading…' : `${filtered.length} of ${customers.length} customers`}
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(c => (
          <button
            key={c.id}
            onClick={() => setOpenId(c.id)}
            style={{
              background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
              padding: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{c.company_name}</div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {c.contact_name && <span>{c.contact_name}</span>}
              {c.phone && <span>· {c.phone}</span>}
              {c.email && <span>· {c.email}</span>}
            </div>
            {c.credit_balance_cents > 0 && (
              <div style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 800, marginTop: 4 }}>
                Credit on file: {USD.format(c.credit_balance_cents / 100)}
              </div>
            )}
          </button>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
            {search ? 'No matches.' : 'No customers yet.'}
          </div>
        )}
      </div>

      {openCustomer && <MobileCustomerDetail customer={openCustomer} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function MobileCustomerDetail({ customer, onClose }: { customer: WholesaleCustomer; onClose: () => void }) {
  const [memos, setMemos] = useState<Array<{ id: string; memo_number: string; date_created: string; status: string }>>([])
  const [invoices, setInvoices] = useState<Array<{ id: string; invoice_number: string; invoice_date: string; total_due_cents: number; payment_status: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [mRes, iRes] = await Promise.all([
        supabase.from('wholesale_memos')
          .select('id, memo_number, date_created, status')
          .eq('customer_id', customer.id)
          .order('date_created', { ascending: false })
          .limit(20),
        supabase.from('wholesale_invoices')
          .select('id, invoice_number, invoice_date, total_due_cents, payment_status')
          .eq('customer_id', customer.id)
          .order('invoice_date', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      setMemos((mRes.data || []) as any)
      setInvoices((iRes.data || []) as any)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [customer.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 14px', borderBottom: '1px solid var(--pearl)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ink)', padding: 4 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.company_name}</div>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        {/* Contact block */}
        <div style={{ background: 'var(--cream2)', borderRadius: 10, padding: 12, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {customer.contact_name && <div style={{ fontSize: 13 }}><b>{customer.contact_name}</b></div>}
          {customer.phone && (
            <a href={`tel:${customer.phone}`} style={{ fontSize: 13, color: 'var(--green-dark)' }}>📞 {customer.phone}</a>
          )}
          {customer.mobile_phone && (
            <a href={`tel:${customer.mobile_phone}`} style={{ fontSize: 13, color: 'var(--green-dark)' }}>📱 {customer.mobile_phone}</a>
          )}
          {customer.email && (
            <a href={`mailto:${customer.email}`} style={{ fontSize: 13, color: 'var(--green-dark)' }}>✉️ {customer.email}</a>
          )}
          {customer.billing_address && (
            <div style={{ fontSize: 12, color: 'var(--ash)', whiteSpace: 'pre-wrap' }}>📍 {customer.billing_address}</div>
          )}
        </div>

        {/* Open memos */}
        <Section title={`Memos (${memos.length})`}>
          {loading ? <Loading /> : memos.length === 0 ? <Empty text="No memos." /> : (
            memos.map(m => (
              <RowItem key={m.id} primary={`#${m.memo_number}`} sub={m.date_created} pill={m.status} />
            ))
          )}
        </Section>

        {/* Invoices */}
        <Section title={`Invoices (${invoices.length})`}>
          {loading ? <Loading /> : invoices.length === 0 ? <Empty text="No invoices." /> : (
            invoices.map(i => (
              <RowItem
                key={i.id}
                primary={`#${i.invoice_number}`}
                sub={i.invoice_date}
                rightValue={USD.format(i.total_due_cents / 100)}
                pill={i.payment_status}
              />
            ))
          )}
        </Section>

        {customer.notes && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{customer.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  )
}

function RowItem({ primary, sub, rightValue, pill }: { primary: string; sub: string; rightValue?: string; pill?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
      padding: '8px 10px', background: 'var(--cream2)', borderRadius: 6,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{primary}</div>
        <div style={{ fontSize: 10, color: 'var(--mist)' }}>{sub}</div>
      </div>
      {rightValue && <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{rightValue}</span>}
      {pill && (
        <span style={{
          background: '#E5E7EB', color: '#374151',
          fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
          letterSpacing: '.02em', textTransform: 'uppercase',
        }}>{pill}</span>
      )}
    </div>
  )
}

function Loading() { return <div style={{ fontSize: 12, color: 'var(--mist)' }}>Loading…</div> }
function Empty({ text }: { text: string }) { return <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>{text}</div> }
