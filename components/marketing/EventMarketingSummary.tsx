'use client'

// Per-event Marketing summary panel. Mounted in Events.tsx in place of
// the old Ad Spend panel. Shows totals + by-type + by-method +
// cost-per-scan + cost-per-appointment + per-QR ROI for the event,
// plus a compact list of all payments.
//
// PR D will retire events.spend_vdp/newspaper/postcard once this is
// proven; for now we just show payments-driven numbers alongside the
// existing Ad Spend panel.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface PaymentRow {
  id: string
  amount: number
  paid_at: string
  vendor: string | null
  quantity: number | null
  invoice_number: string | null
  qr_code_id: string | null
  marketing_payment_types: { label: string | null } | null
  marketing_payment_methods: { label: string | null } | null
  qr_codes: { label: string | null } | null
}

interface QrAggRow { qr_code_id: string; label: string; spend: number; scans: number; appointments: number }

export default function EventMarketingSummary({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [apptCount, setApptCount] = useState(0)
  const [qrAgg, setQrAgg] = useState<QrAggRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [{ data: p }, { count: appts }] = await Promise.all([
        supabase.from('marketing_payments')
          .select(`
            id, amount, paid_at, vendor, quantity, invoice_number, qr_code_id,
            marketing_payment_types(label),
            marketing_payment_methods(label),
            qr_codes(label)
          `)
          .eq('event_id', eventId)
          .order('paid_at', { ascending: false }),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('event_id', eventId).eq('status', 'confirmed'),
      ])
      if (cancelled) return
      const pays = (p || []) as unknown as PaymentRow[]
      setPayments(pays)
      setApptCount(appts || 0)

      // Pull scans for the QRs linked to any of these payments. (Cost-per-
      // scan rolls up across all linked QRs.)
      const linkedQrIds = Array.from(new Set(pays.map(x => x.qr_code_id).filter(Boolean) as string[]))
      if (linkedQrIds.length === 0) { setScanCount(0); setQrAgg([]); setLoaded(true); return }
      const [{ data: scans }, { data: convAppts }] = await Promise.all([
        supabase.from('qr_scans').select('qr_code_id').in('qr_code_id', linkedQrIds),
        supabase.from('appointments').select('qr_code_id').eq('event_id', eventId).in('qr_code_id', linkedQrIds),
      ])
      if (cancelled) return
      setScanCount((scans || []).length)

      // Per-QR aggregation
      const spendByQr = new Map<string, number>()
      const labelByQr = new Map<string, string>()
      for (const pay of pays) {
        if (!pay.qr_code_id) continue
        spendByQr.set(pay.qr_code_id, (spendByQr.get(pay.qr_code_id) || 0) + pay.amount)
        labelByQr.set(pay.qr_code_id, pay.qr_codes?.label || '(unlabeled)')
      }
      const scanByQr = new Map<string, number>()
      for (const s of (scans || []) as { qr_code_id: string }[]) {
        scanByQr.set(s.qr_code_id, (scanByQr.get(s.qr_code_id) || 0) + 1)
      }
      const apptByQr = new Map<string, number>()
      for (const a of (convAppts || []) as { qr_code_id: string }[]) {
        apptByQr.set(a.qr_code_id, (apptByQr.get(a.qr_code_id) || 0) + 1)
      }
      const agg: QrAggRow[] = Array.from(spendByQr.keys()).map(qid => ({
        qr_code_id: qid,
        label: labelByQr.get(qid) || '(unlabeled)',
        spend: spendByQr.get(qid) || 0,
        scans: scanByQr.get(qid) || 0,
        appointments: apptByQr.get(qid) || 0,
      })).sort((a, b) => b.spend - a.spend)
      setQrAgg(agg)
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [eventId])

  const totalSpend = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const byType = aggregate(payments, p => p.marketing_payment_types?.label || '(no type)')
  const byMethod = aggregate(payments, p => p.marketing_payment_methods?.label || '(no method)')
  const costPerScan = scanCount > 0 ? totalSpend / scanCount : null
  const costPerAppt = apptCount > 0 ? totalSpend / apptCount : null

  const fmt$ = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const fmtDate = (iso: string) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="card-title">📊 Marketing</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 18 }}>×</button>
      </div>

      {!loaded ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : payments.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>
          No marketing payments recorded for this event yet. Add them in <strong>Marketing → Payments</strong>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Hero numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Stat label="Total spend" value={fmt$(totalSpend)} />
            <Stat label="Cost / scan" value={costPerScan != null ? fmt$(costPerScan) : '—'} hint={costPerScan != null ? `${scanCount} scans` : undefined} />
            <Stat label="Cost / appt" value={costPerAppt != null ? fmt$(costPerAppt) : '—'} hint={costPerAppt != null ? `${apptCount} appts` : undefined} />
            <Stat label="Payments" value={String(payments.length)} />
          </div>

          {/* By type / by method side-by-side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Breakdown title="By type" items={byType} totalSpend={totalSpend} />
            <Breakdown title="By method" items={byMethod} totalSpend={totalSpend} />
          </div>

          {/* Per-QR ROI */}
          {qrAgg.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Per-QR ROI</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--cream2)' }}>
                    <th style={th}>QR</th>
                    <th style={{ ...th, textAlign: 'right' }}>Spend</th>
                    <th style={{ ...th, textAlign: 'right' }}>Scans</th>
                    <th style={{ ...th, textAlign: 'right' }}>Appts</th>
                    <th style={{ ...th, textAlign: 'right' }}>$/scan</th>
                    <th style={{ ...th, textAlign: 'right' }}>$/appt</th>
                  </tr>
                </thead>
                <tbody>
                  {qrAgg.map(r => (
                    <tr key={r.qr_code_id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                      <td style={td}>{r.label}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(r.spend)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.scans}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.appointments}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.scans > 0 ? fmt$(r.spend / r.scans) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.appointments > 0 ? fmt$(r.spend / r.appointments) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Compact list of payments */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>All payments</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--cream2)' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Vendor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Method</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                    <td style={td}>{fmtDate(p.paid_at)}</td>
                    <td style={td}>{p.marketing_payment_types?.label || '—'}</td>
                    <td style={td}>{p.vendor || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(p.amount)}</td>
                    <td style={td}>{p.marketing_payment_methods?.label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function aggregate(payments: PaymentRow[], keyFn: (p: PaymentRow) => string): { label: string; total: number }[] {
  const m = new Map<string, number>()
  for (const p of payments) {
    const k = keyFn(p)
    m.set(k, (m.get(k) || 0) + (p.amount || 0))
  }
  return Array.from(m.entries()).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total)
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--cream2)', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function Breakdown({ title, items, totalSpend }: { title: string; items: { label: string; total: number }[]; totalSpend: number }) {
  const fmt$ = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(it => (
          <div key={it.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
            <span>{it.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {fmt$(it.total)}
              {totalSpend > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mist)', fontWeight: 600 }}>{Math.round(it.total / totalSpend * 100)}%</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }
const td: React.CSSProperties = { padding: '6px 8px', color: 'var(--ink)', whiteSpace: 'nowrap' }
