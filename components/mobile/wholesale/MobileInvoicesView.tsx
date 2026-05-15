'use client'

// Mobile Invoices tab. v1 = read-only list of recent invoices +
// drill-in for line detail. Create flow ships in v2 once we
// settle on the collapsed-full-fidelity field set discussed in
// Q4 of the planning chat (single line item = fast path; multi-
// line / tax / shipping / payment terms expand on demand).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { WholesaleInvoice } from '@/types/wholesale'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const PAYMENT_PILL: Record<string, { bg: string; fg: string }> = {
  unpaid:  { bg: '#FEE2E2', fg: '#991B1B' },
  partial: { bg: '#FEF3C7', fg: '#92400E' },
  paid:    { bg: '#DCFCE7', fg: '#166534' },
}

interface InvoiceRow extends WholesaleInvoice {
  customer: { company_name: string | null } | null
}

export default function MobileInvoicesView() {
  const { brand } = useApp()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wholesale_invoices')
        .select(`
          *,
          customer:wholesale_customers(company_name)
        `)
        .eq('brand', brand)
        .is('archived_at', null)
        .order('invoice_date', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setRows((data || []) as InvoiceRow[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  const openRow = useMemo(
    () => rows.find(r => r.id === openId) || null,
    [rows, openId],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {loading ? 'Loading…' : `Last ${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => {
          const pill = PAYMENT_PILL[r.payment_status] || PAYMENT_PILL.unpaid
          const remaining = r.total_due_cents - r.paid_cents
          return (
            <button
              key={r.id}
              onClick={() => setOpenId(r.id)}
              style={{
                background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
                padding: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
                  {r.customer?.company_name || '(no customer)'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>
                  {USD.format(r.total_due_cents / 100)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--mist)' }}>
                <span>#{r.invoice_number} · {r.invoice_date}</span>
                <span style={{
                  background: pill.bg, color: pill.fg,
                  fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                  letterSpacing: '.02em', textTransform: 'uppercase',
                }}>
                  {r.payment_status}
                  {r.payment_status === 'partial' && remaining > 0 && <> · {USD.format(remaining / 100)} owed</>}
                </span>
              </div>
            </button>
          )
        })}

        {!loading && rows.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
            No invoices yet.
          </div>
        )}
      </div>

      {openRow && <MobileInvoiceDetail invoice={openRow} onClose={() => setOpenId(null)} />}

      <div style={{ padding: '16px 0 4px', color: 'var(--mist)', fontSize: 11, textAlign: 'center' }}>
        Create new invoice ships in v2 — use desktop for now.
      </div>
    </div>
  )
}

function MobileInvoiceDetail({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const [lines, setLines] = useState<Array<{ id: string; item_number: string | null; description: string | null; sale_price_cents: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('wholesale_invoice_lines')
        .select('id, sale_price_cents, description, item:inventory_items(item_number)')
        .eq('invoice_id', invoice.id)
      if (cancelled) return
      setLines((data || []).map((l: any) => ({
        id: l.id,
        item_number: l.item?.item_number || null,
        description: l.description,
        sale_price_cents: l.sale_price_cents,
      })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [invoice.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 14px', borderBottom: '1px solid var(--pearl)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ink)', padding: 4 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Invoice #{invoice.invoice_number}</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)' }}>{invoice.customer?.company_name || '—'}</div>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
          <Stat label="Subtotal" value={USD.format(invoice.subtotal_cents / 100)} />
          {invoice.tradein_credit_cents > 0 && <Stat label="Trade-in" value={`-${USD.format(invoice.tradein_credit_cents / 100)}`} />}
          <Stat label="Total" value={USD.format(invoice.total_due_cents / 100)} accent />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
          <span>{invoice.invoice_date}</span>
          {invoice.payment_terms && <span>{invoice.payment_terms}</span>}
        </div>

        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
          Lines ({lines.length})
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--mist)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lines.map(l => (
              <div key={l.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '8px 10px', background: 'var(--cream2)', borderRadius: 6,
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {l.item_number ? `#${l.item_number}` : (l.description || '—')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{USD.format(l.sale_price_cents / 100)}</span>
              </div>
            ))}
          </div>
        )}

        {invoice.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'var(--green-pale)' : 'var(--cream2)',
      border: accent ? '1px solid var(--green)' : '1px solid var(--pearl)',
      borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: accent ? 16 : 14, fontWeight: 900, color: accent ? 'var(--green-dark)' : 'var(--ink)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
