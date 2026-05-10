'use client'

// Reports for the wholesale module. All brand-scoped, all CSV-
// exportable. Each report is a small card you can expand → table →
// download CSV. Computed on the fly via Supabase queries; small
// data volume for a 2-person shop, no need to pre-aggregate.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { InventoryItem, WholesaleInvoice, WholesaleInvoiceLine, WholesaleMemo } from '@/types/wholesale'
import { fmtMoneyCents, fmtDate } from '@/lib/wholesale/format'

type ReportId =
  | 'inventory_on_hand' | 'aging_inventory' | 'open_memos'
  | 'sales_by_period'   | 'profit_margin'   | 'customer_activity'
  | 'vendor_activity'   | 'ar_aging'        | 'sold_items_log'

const REPORTS: { id: ReportId; label: string; desc: string }[] = [
  { id: 'inventory_on_hand', label: 'Inventory on hand', desc: 'In-stock items with cost basis, by category + location.' },
  { id: 'aging_inventory',   label: 'Aging inventory',    desc: 'In-stock items bucketed by days since acquired.' },
  { id: 'open_memos',        label: 'Open memos',         desc: 'Active memos with days outstanding and overdue flag.' },
  { id: 'sales_by_period',   label: 'Sales by period',    desc: 'Invoices in a date range with totals.' },
  { id: 'profit_margin',     label: 'Profit margin',      desc: 'Sold items: cost, sale price, profit, margin %.' },
  { id: 'customer_activity', label: 'Customer activity',  desc: 'Purchases by customer over period.' },
  { id: 'vendor_activity',   label: 'Vendor activity',    desc: 'Purchases from vendor over period.' },
  { id: 'ar_aging',          label: 'AR aging',           desc: 'Unpaid / partial invoices by 0-30 / 31-60 / 61-90 / 90+ days.' },
  { id: 'sold_items_log',    label: 'Sold items log',     desc: 'Historical sales record.' },
]

export default function ReportsView() {
  const { brand } = useApp()
  const [open, setOpen] = useState<ReportId | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 8) + '01'
  const yearStart = today.slice(0, 4) + '-01-01'
  const [from, setFrom] = useState(yearStart)
  const [to,   setTo]   = useState(today)

  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>Date range</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: 'var(--mist)' }}>–</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
            className="card"
            style={{
              padding: 12, textAlign: 'left',
              border: open === r.id ? '2px solid var(--green)' : '1px solid var(--cream2)',
              cursor: 'pointer', background: '#fff', fontFamily: 'inherit',
            }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{r.label}</div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{r.desc}</div>
          </button>
        ))}
      </div>

      {open && brand && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <ReportPanel id={open} brand={brand} from={from} to={to} />
        </div>
      )}
    </div>
  )
}

function ReportPanel({ id, brand, from, to }: { id: ReportId; brand: string; from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [columns, setColumns] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void (async () => {
      try {
        const result = await runReport(id, brand, from, to)
        if (cancelled) return
        setRows(result.rows)
        setColumns(result.columns)
      } catch (e: any) { setError(e?.message || 'Failed') }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [id, brand, from, to])

  function exportCsv() {
    const lines = [columns.join(',')]
    for (const r of rows) {
      lines.push(columns.map(c => csvEscape(r[c])).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${id}-${brand}-${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800 }}>{REPORTS.find(r => r.id === id)?.label}</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--mist)' }}>{rows.length} rows</span>
          <button onClick={exportCsv} className="btn-outline btn-sm" disabled={rows.length === 0}>⬇ CSV</button>
        </div>
      </div>
      {error && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 20, color: 'var(--mist)', textAlign: 'center' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 20, color: 'var(--mist)', textAlign: 'center' }}>No rows.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                {columns.map(c => <th key={c} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--pearl)' }}>
                  {columns.map(c => <td key={c} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{r[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function csvEscape(v: any): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

interface ReportResult { columns: string[]; rows: any[] }

async function runReport(id: ReportId, brand: string, from: string, to: string): Promise<ReportResult> {
  if (id === 'inventory_on_hand') {
    const { data } = await supabase.from('inventory_items')
      .select('item_number, category, public_notes, cost_cents, wholesale_price_cents, retail_price_cents, location:inventory_locations(name)')
      .eq('brand', brand).eq('status', 'in_stock').is('archived_at', null).order('category').order('item_number')
    return {
      columns: ['Item','Category','Description','Cost','Wholesale','Retail','Location'],
      rows: ((data || []) as any[]).map(r => ({
        Item: r.item_number, Category: r.category, Description: r.public_notes || '',
        Cost: fmtMoneyCents(r.cost_cents), Wholesale: fmtMoneyCents(r.wholesale_price_cents), Retail: fmtMoneyCents(r.retail_price_cents),
        Location: r.location?.name || '',
      })),
    }
  }
  if (id === 'aging_inventory') {
    const { data } = await supabase.from('inventory_items')
      .select('item_number, category, public_notes, cost_cents, date_acquired, created_at')
      .eq('brand', brand).eq('status', 'in_stock').is('archived_at', null)
    const out = ((data || []) as any[]).map(r => {
      const acq = r.date_acquired || r.created_at
      const days = Math.floor((Date.now() - new Date(acq).getTime()) / 86400000)
      const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 180 ? '91-180' : '180+'
      return {
        Item: r.item_number, Category: r.category, Description: r.public_notes || '',
        Cost: fmtMoneyCents(r.cost_cents), Acquired: fmtDate(acq), Days: days, Bucket: bucket,
      }
    }).sort((a, b) => b.Days - a.Days)
    return { columns: ['Item','Category','Description','Cost','Acquired','Days','Bucket'], rows: out }
  }
  if (id === 'open_memos') {
    const { data } = await supabase.from('wholesale_memos')
      .select('memo_number, date_created, due_date, status, customer:wholesale_customers(company_name)')
      .eq('brand', brand).is('archived_at', null).in('status', ['open','overdue','closed_partial'])
      .order('date_created', { ascending: false })
    const today = new Date().toISOString().slice(0,10)
    return {
      columns: ['Memo','Customer','Created','Due','Days out','Status'],
      rows: ((data || []) as any[]).map(r => ({
        Memo: r.memo_number,
        Customer: r.customer?.company_name || '',
        Created: fmtDate(r.date_created),
        Due: fmtDate(r.due_date),
        'Days out': Math.floor((Date.now() - new Date(r.date_created + 'T12:00:00').getTime()) / 86400000),
        Status: r.due_date < today ? 'overdue' : r.status,
      })),
    }
  }
  if (id === 'sales_by_period') {
    const { data } = await supabase.from('wholesale_invoices')
      .select('invoice_number, invoice_date, total_due_cents, paid_cents, customer:wholesale_customers(company_name)')
      .eq('brand', brand).is('archived_at', null).gte('invoice_date', from).lte('invoice_date', to)
      .order('invoice_date', { ascending: false })
    return {
      columns: ['Invoice','Date','Customer','Total','Paid','Balance'],
      rows: ((data || []) as any[]).map(r => ({
        Invoice: r.invoice_number, Date: fmtDate(r.invoice_date),
        Customer: r.customer?.company_name || '',
        Total: fmtMoneyCents(r.total_due_cents), Paid: fmtMoneyCents(r.paid_cents),
        Balance: fmtMoneyCents(r.total_due_cents - r.paid_cents),
      })),
    }
  }
  if (id === 'profit_margin') {
    const { data } = await supabase.from('wholesale_invoice_lines')
      .select(`
        sale_price_cents, cost_cents_at_sale,
        item:inventory_items(item_number, category, public_notes),
        invoice:wholesale_invoices(invoice_number, invoice_date, brand, archived_at)
      `)
    const filtered = ((data || []) as any[]).filter(r =>
      r.invoice?.brand === brand && !r.invoice?.archived_at
      && r.invoice.invoice_date >= from && r.invoice.invoice_date <= to,
    )
    return {
      columns: ['Invoice','Date','Item','Description','Sale','Cost','Profit','Margin %'],
      rows: filtered.map(r => {
        const profit = (r.sale_price_cents || 0) - (r.cost_cents_at_sale || 0)
        const marginPct = r.sale_price_cents > 0 ? (profit / r.sale_price_cents) * 100 : 0
        return {
          Invoice: r.invoice?.invoice_number,
          Date: fmtDate(r.invoice?.invoice_date),
          Item: r.item?.item_number || '',
          Description: r.item?.public_notes || '',
          Sale: fmtMoneyCents(r.sale_price_cents),
          Cost: fmtMoneyCents(r.cost_cents_at_sale),
          Profit: fmtMoneyCents(profit),
          'Margin %': marginPct.toFixed(1),
        }
      }),
    }
  }
  if (id === 'customer_activity') {
    const { data } = await supabase.from('wholesale_invoices')
      .select('invoice_date, total_due_cents, customer:wholesale_customers(id, company_name)')
      .eq('brand', brand).is('archived_at', null).gte('invoice_date', from).lte('invoice_date', to)
    const by: Record<string, { name: string; count: number; total: number }> = {}
    for (const r of (data || []) as any[]) {
      const k = r.customer?.id || 'unknown'
      if (!by[k]) by[k] = { name: r.customer?.company_name || '—', count: 0, total: 0 }
      by[k].count += 1
      by[k].total += r.total_due_cents || 0
    }
    return {
      columns: ['Customer','Invoices','Total'],
      rows: Object.values(by).sort((a, b) => b.total - a.total).map(r => ({
        Customer: r.name, Invoices: r.count, Total: fmtMoneyCents(r.total),
      })),
    }
  }
  if (id === 'vendor_activity') {
    const { data } = await supabase.from('inventory_items')
      .select('cost_cents, date_acquired, vendor:wholesale_vendors(id, company_name)')
      .eq('brand', brand).is('archived_at', null)
      .gte('date_acquired', from).lte('date_acquired', to)
    const by: Record<string, { name: string; count: number; total: number }> = {}
    for (const r of (data || []) as any[]) {
      const k = r.vendor?.id || 'unknown'
      if (!by[k]) by[k] = { name: r.vendor?.company_name || '—', count: 0, total: 0 }
      by[k].count += 1
      by[k].total += r.cost_cents || 0
    }
    return {
      columns: ['Vendor','Items','Cost'],
      rows: Object.values(by).sort((a, b) => b.total - a.total).map(r => ({
        Vendor: r.name, Items: r.count, Cost: fmtMoneyCents(r.total),
      })),
    }
  }
  if (id === 'ar_aging') {
    const { data } = await supabase.from('wholesale_invoices')
      .select('invoice_number, invoice_date, total_due_cents, paid_cents, customer:wholesale_customers(company_name)')
      .eq('brand', brand).is('archived_at', null).in('payment_status', ['unpaid','partial'])
    return {
      columns: ['Invoice','Customer','Date','Days','Bucket','Balance'],
      rows: ((data || []) as any[]).map(r => {
        const days = Math.floor((Date.now() - new Date(r.invoice_date + 'T12:00:00').getTime()) / 86400000)
        const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
        return {
          Invoice: r.invoice_number,
          Customer: r.customer?.company_name || '',
          Date: fmtDate(r.invoice_date),
          Days: days,
          Bucket: bucket,
          Balance: fmtMoneyCents(r.total_due_cents - r.paid_cents),
        }
      }).sort((a, b) => b.Days - a.Days),
    }
  }
  // sold_items_log
  const { data } = await supabase.from('inventory_items')
    .select(`
      item_number, category, public_notes, cost_cents,
      sold_invoice:wholesale_invoices(invoice_number, invoice_date, customer:wholesale_customers(company_name))
    `)
    .eq('brand', brand).eq('status', 'sold').is('archived_at', null)
  const filtered = ((data || []) as any[]).filter(r =>
    r.sold_invoice && r.sold_invoice.invoice_date >= from && r.sold_invoice.invoice_date <= to,
  )
  return {
    columns: ['Item','Category','Description','Cost','Invoice','Customer','Date'],
    rows: filtered.map(r => ({
      Item: r.item_number, Category: r.category, Description: r.public_notes || '',
      Cost: fmtMoneyCents(r.cost_cents),
      Invoice: r.sold_invoice?.invoice_number,
      Customer: r.sold_invoice?.customer?.company_name || '',
      Date: fmtDate(r.sold_invoice?.invoice_date),
    })),
  }
}
