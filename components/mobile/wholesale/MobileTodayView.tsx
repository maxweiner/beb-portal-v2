'use client'

// Mobile Today tab — at-a-glance dashboard for the trade-show
// scenario. Three KPI cards per Q6 in the planning chat:
//
//   (a) Sales today        — invoices created today + $ total
//   (c) Today's memo activity — new memos + items returned today
//   (b) Items on memo right now — count + total cost, grouped by dealer
//
// Each card is tap-able and jumps to the relevant tab via the
// onJump callback (passed from MobileWholesale's bottom-nav state).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

interface Props {
  onJump: (tab: 'inventory' | 'memos' | 'invoices' | 'customers' | 'today') => void
}

interface TodayStats {
  sales_today_count: number
  sales_today_total_cents: number
  memos_opened_today: number
  memo_lines_returned_today: number
  memo_lines_converted_today: number
  open_memos_total_count: number
  open_memos_total_cost_cents: number
  open_memos_by_dealer: Array<{ dealer: string; lines: number; cost_cents: number }>
}

export default function MobileTodayView({ onJump }: Props) {
  const { brand } = useApp()
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // Today's window — local-day calendar boundary. Cheaper to
        // compute the ISO bounds client-side than wrestle with
        // timezone in SQL.
        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString()
        const todayStr = now.toISOString().slice(0, 10)

        const [salesRes, newMemosRes, returnedRes, openMemosRes] = await Promise.all([
          supabase
            .from('wholesale_invoices')
            .select('total_due_cents, created_at')
            .eq('brand', brand)
            .gte('created_at', startOfDay)
            .is('archived_at', null),
          supabase
            .from('wholesale_memos')
            .select('id, created_at')
            .eq('brand', brand)
            .gte('created_at', startOfDay)
            .is('archived_at', null),
          supabase
            .from('wholesale_memo_lines')
            .select('id, line_status, resolved_at, invoice_line_id')
            .gte('resolved_at', startOfDay)
            .not('resolved_at', 'is', null),
          supabase
            .from('wholesale_memos')
            .select(`
              id, status,
              customer:wholesale_customers(company_name),
              lines:wholesale_memo_lines(memo_price_cents, line_status)
            `)
            .eq('brand', brand)
            .eq('status', 'open')
            .is('archived_at', null),
        ])
        if (cancelled) return

        const salesRows = (salesRes.data || []) as Array<{ total_due_cents: number }>
        const newMemos  = newMemosRes.data || []
        const returned  = (returnedRes.data || []) as Array<{ line_status: string; invoice_line_id: string | null }>
        const openMemos = (openMemosRes.data || []) as any[]

        const sales_today_total_cents = salesRows.reduce((s, r) => s + (r.total_due_cents || 0), 0)
        // memo_line.line_status values: 'out' / 'returned' / 'sold'.
        const memo_lines_returned_today  = returned.filter(r => r.line_status === 'returned').length
        const memo_lines_converted_today = returned.filter(r => r.line_status === 'sold').length

        // Per-dealer rollup for the "items on memo right now" card.
        const byDealer = new Map<string, { lines: number; cost_cents: number }>()
        let openLinesCount = 0
        let openLinesCost = 0
        for (const m of openMemos) {
          const dealer = m.customer?.company_name || '(no customer)'
          const lines = (m.lines || []) as Array<{ memo_price_cents: number; line_status: string }>
          const out = lines.filter(l => l.line_status === 'out')
          if (out.length === 0) continue
          const cost = out.reduce((s, l) => s + (l.memo_price_cents || 0), 0)
          openLinesCount += out.length
          openLinesCost += cost
          const cur = byDealer.get(dealer) || { lines: 0, cost_cents: 0 }
          byDealer.set(dealer, { lines: cur.lines + out.length, cost_cents: cur.cost_cents + cost })
        }
        const open_memos_by_dealer = Array.from(byDealer.entries())
          .map(([dealer, v]) => ({ dealer, ...v }))
          .sort((a, b) => b.cost_cents - a.cost_cents)

        setStats({
          sales_today_count: salesRows.length,
          sales_today_total_cents,
          memos_opened_today: newMemos.length,
          memo_lines_returned_today,
          memo_lines_converted_today,
          open_memos_total_count: openLinesCount,
          open_memos_total_cost_cents: openLinesCost,
          open_memos_by_dealer,
        })
        setLoading(false)
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [brand])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      {/* Sales today */}
      <Card title="Sales today" icon="💵" onTap={() => onJump('invoices')}>
        {loading ? <Loading /> : !stats ? null : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--ink)' }}>{stats.sales_today_count}</span>
            <span style={{ fontSize: 13, color: 'var(--mist)' }}>invoice{stats.sales_today_count === 1 ? '' : 's'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 900, color: 'var(--green-dark)' }}>
              {USD.format(stats.sales_today_total_cents / 100)}
            </span>
          </div>
        )}
      </Card>

      {/* Today's memo activity */}
      <Card title="Today's memo activity" icon="📋" onTap={() => onJump('memos')}>
        {loading ? <Loading /> : !stats ? null : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <Mini label="Opened"    value={stats.memos_opened_today} />
            <Mini label="Returned"  value={stats.memo_lines_returned_today} />
            <Mini label="Converted" value={stats.memo_lines_converted_today} />
          </div>
        )}
      </Card>

      {/* Items on memo right now */}
      <Card title="On memo right now" icon="◐" onTap={() => onJump('memos')}>
        {loading ? <Loading /> : !stats ? null : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--ink)' }}>{stats.open_memos_total_count}</span>
              <span style={{ fontSize: 13, color: 'var(--mist)' }}>item{stats.open_memos_total_count === 1 ? '' : 's'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: '#92400E' }}>
                {USD.format(stats.open_memos_total_cost_cents / 100)} out
              </span>
            </div>
            {stats.open_memos_by_dealer.slice(0, 6).map(d => (
              <div key={d.dealer} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                padding: '6px 0',
                borderTop: '1px solid var(--cream2)',
                fontSize: 12,
              }}>
                <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.dealer}</span>
                <span style={{ color: 'var(--mist)' }}>{d.lines} item{d.lines === 1 ? '' : 's'}</span>
                <span style={{ fontWeight: 800, color: 'var(--ink)', minWidth: 64, textAlign: 'right' }}>{USD.format(d.cost_cents / 100)}</span>
              </div>
            ))}
            {stats.open_memos_by_dealer.length > 6 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', textAlign: 'center', marginTop: 6 }}>
                +{stats.open_memos_by_dealer.length - 6} more dealers
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

function Card({ title, icon, children, onTap }: { title: string; icon: string; children: React.ReactNode; onTap?: () => void }) {
  return (
    <div
      onClick={onTap}
      style={{
        background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
        padding: 14,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--cream2)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Loading() { return <div style={{ fontSize: 13, color: 'var(--mist)' }}>Loading…</div> }
