'use client'

// Mobile Memos tab. v1 = read-only list of open memos with drill-in
// to a detail panel that shows the lines + customer + days out.
// Actions (Convert to Invoice / Mark Returned / Create New Memo)
// land in v2 once the mobile invoice + customer flows are solid.
//
// Trade-show flow: operator opens this tab to answer "who has what
// out from us right now?" and "what's that customer holding?"

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { WholesaleMemo, WholesaleCustomer } from '@/types/wholesale'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function daysBetween(iso: string): number {
  const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00' : ''))
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

interface MemoRow extends WholesaleMemo {
  customer: { company_name: string | null } | null
  lines_count: number
  total_cents: number
}

export default function MobileMemosView() {
  const { brand } = useApp()
  const [memos, setMemos] = useState<MemoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openMemoId, setOpenMemoId] = useState<string | null>(null)

  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      // Pull open memos + customer + line totals in one trip via
      // PostgREST joins. Status='open' is the only one we surface
      // on mobile; closed memos stay desktop.
      const { data, error: err } = await supabase
        .from('wholesale_memos')
        .select(`
          *,
          customer:wholesale_customers(company_name),
          lines:wholesale_memo_lines(memo_price_cents, line_status)
        `)
        .eq('brand', brand)
        .eq('status', 'open')
        .is('archived_at', null)
        .order('date_created', { ascending: false })
        .limit(500)
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      const rows: MemoRow[] = (data || []).map((m: any) => {
        // Memo line statuses are 'out' / 'returned' / 'sold' —
        // we count the still-out lines as the "open" total.
        const lines = (m.lines || []) as { memo_price_cents: number; line_status: string }[]
        const out = lines.filter(l => l.line_status === 'out')
        return {
          ...m,
          customer: m.customer || null,
          lines_count: out.length,
          total_cents: out.reduce((s, l) => s + (l.memo_price_cents || 0), 0),
        }
      })
      setMemos(rows)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  const openMemo = useMemo(
    () => memos.find(m => m.id === openMemoId) || null,
    [memos, openMemoId],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {loading ? 'Loading…' : `${memos.length} open memo${memos.length === 1 ? '' : 's'}`}
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {memos.map(m => {
          const days = daysBetween(m.date_created)
          const dueDays = daysBetween(m.due_date)
          const overdue = new Date(m.due_date + 'T12:00:00').getTime() < Date.now()
          return (
            <button
              key={m.id}
              onClick={() => setOpenMemoId(m.id)}
              style={{
                background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
                padding: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
                  {m.customer?.company_name || '(no customer)'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>
                  {USD.format(m.total_cents / 100)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--mist)' }}>
                <span>
                  #{m.memo_number} · {m.lines_count} item{m.lines_count === 1 ? '' : 's'} · out {days}d
                </span>
                <span style={{
                  background: overdue ? '#FEE2E2' : '#FEF3C7',
                  color:      overdue ? '#991B1B' : '#92400E',
                  fontSize: 10, fontWeight: 800,
                  padding: '2px 6px', borderRadius: 4,
                  letterSpacing: '.02em',
                }}>
                  {overdue ? `${dueDays}d overdue` : `due in ${dueDays}d`}
                </span>
              </div>
            </button>
          )
        })}

        {!loading && memos.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
            No open memos. 🎉
          </div>
        )}
      </div>

      {/* Tiny detail panel — bottom sheet style. Lists the memo's
          line items (item # + memo price) so the operator can see
          what's actually out. */}
      {openMemo && <MobileMemoDetail memo={openMemo} onClose={() => setOpenMemoId(null)} />}

      <div style={{ padding: '16px 0 4px', color: 'var(--mist)', fontSize: 11, textAlign: 'center' }}>
        Create new + actions ship in v2 — use desktop for now.
      </div>
    </div>
  )
}

function MobileMemoDetail({ memo, onClose }: { memo: MemoRow; onClose: () => void }) {
  const [lines, setLines] = useState<Array<{ id: string; item_number: string; memo_price_cents: number; line_status: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('wholesale_memo_lines')
        .select('id, memo_price_cents, line_status, item:inventory_items(item_number)')
        .eq('memo_id', memo.id)
        .order('created_at', { ascending: true })
      if (cancelled) return
      setLines((data || []).map((l: any) => ({
        id: l.id,
        item_number: l.item?.item_number || '—',
        memo_price_cents: l.memo_price_cents,
        line_status: l.line_status,
      })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [memo.id])

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
          <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Memo #{memo.memo_number}</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)' }}>{memo.customer?.company_name || '—'}</div>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
          <span>Issued {memo.date_created}</span>
          <span>Due {memo.due_date}</span>
        </div>

        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
          Items on memo ({lines.length})
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
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>#{l.item_number}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{USD.format(l.memo_price_cents / 100)}</span>
              </div>
            ))}
          </div>
        )}

        {memo.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{memo.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}
