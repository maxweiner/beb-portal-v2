'use client'

// Top-bar search across the wholesale module. Hits items, customers,
// vendors, memos, invoices for the active brand. Type-ahead, grouped
// results. Click a result → jump to the right tab (parent passes
// onJump so the shell can switch tabs) and select it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

type Tab = 'inventory' | 'memos' | 'invoices' | 'customers' | 'vendors' | 'reports' | 'admin'

interface Hit {
  group: 'item' | 'customer' | 'vendor' | 'memo' | 'invoice'
  id: string
  primary: string
  secondary?: string
}

export default function GlobalSearch({ onJump }: { onJump: (t: Tab) => void }) {
  const { brand } = useApp()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q || q.trim().length < 2 || !brand) { setHits([]); return }
    if (debouncedRef.current) clearTimeout(debouncedRef.current)
    const term = q.trim()
    debouncedRef.current = setTimeout(async () => {
      const like = `%${term}%`
      try {
        const [items, customers, vendors, memos, invoices] = await Promise.all([
          supabase.from('inventory_items')
            .select('id, item_number, public_notes, watch_brand, watch_model, watch_serial_number, diamond_report_number, jewelry_designer')
            .eq('brand', brand).is('archived_at', null)
            .or([
              `item_number.ilike.${like}`,
              `public_notes.ilike.${like}`,
              `watch_brand.ilike.${like}`,
              `watch_model.ilike.${like}`,
              `watch_serial_number.ilike.${like}`,
              `diamond_report_number.ilike.${like}`,
              `jewelry_designer.ilike.${like}`,
            ].join(','))
            .limit(8),
          supabase.from('wholesale_customers').select('id, company_name, contact_name')
            .eq('brand', brand).is('archived_at', null)
            .or(`company_name.ilike.${like},contact_name.ilike.${like}`)
            .limit(5),
          supabase.from('wholesale_vendors').select('id, company_name, contact_name')
            .eq('brand', brand).is('archived_at', null)
            .or(`company_name.ilike.${like},contact_name.ilike.${like}`)
            .limit(5),
          supabase.from('wholesale_memos').select('id, memo_number, customer:wholesale_customers(company_name)')
            .eq('brand', brand).is('archived_at', null).ilike('memo_number', like).limit(5),
          supabase.from('wholesale_invoices').select('id, invoice_number, customer:wholesale_customers(company_name)')
            .eq('brand', brand).is('archived_at', null).ilike('invoice_number', like).limit(5),
        ])
        const next: Hit[] = []
        for (const i of (items.data || []) as any[]) next.push({
          group: 'item', id: i.id,
          primary: `${i.item_number} — ${i.public_notes || i.watch_brand || i.watch_model || i.diamond_report_number || ''}`.trim(),
        })
        for (const c of (customers.data || []) as any[]) next.push({
          group: 'customer', id: c.id, primary: c.company_name, secondary: c.contact_name || undefined,
        })
        for (const v of (vendors.data || []) as any[]) next.push({
          group: 'vendor', id: v.id, primary: v.company_name, secondary: v.contact_name || undefined,
        })
        for (const m of (memos.data || []) as any[]) next.push({
          group: 'memo', id: m.id,
          primary: m.memo_number, secondary: m.customer?.company_name,
        })
        for (const inv of (invoices.data || []) as any[]) next.push({
          group: 'invoice', id: inv.id,
          primary: inv.invoice_number, secondary: inv.customer?.company_name,
        })
        setHits(next)
      } catch { /* swallow — search shouldn't break the page */ }
    }, 200)
  }, [q, brand])

  const grouped = useMemo(() => {
    const out: Record<string, Hit[]> = {}
    for (const h of hits) {
      if (!out[h.group]) out[h.group] = []
      out[h.group].push(h)
    }
    return out
  }, [hits])

  function jump(h: Hit) {
    setOpen(false); setQ('')
    if (h.group === 'item')     onJump('inventory')
    if (h.group === 'customer') onJump('customers')
    if (h.group === 'vendor')   onJump('vendors')
    if (h.group === 'memo')     onJump('memos')
    if (h.group === 'invoice')  onJump('invoices')
    // Future: pass an "open this id" intent so the destination tab
    // auto-opens the detail modal. For now the user lands on the tab.
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="search"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="🔍 Search items, customers, vendors, memos…"
        style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--pearl)', borderRadius: 8, background: '#fff' }}
      />
      {open && q.trim().length >= 2 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
          background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8,
          maxHeight: 360, overflow: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.08)',
        }}>
          {hits.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--mist)', fontSize: 12 }}>No matches.</div>
          ) : (
            (['item','customer','vendor','memo','invoice'] as const).map(g => grouped[g] && grouped[g].length > 0 && (
              <div key={g}>
                <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--cream2)' }}>
                  {g === 'item' ? 'Inventory' : g === 'customer' ? 'Customers' : g === 'vendor' ? 'Vendors' : g === 'memo' ? 'Memos' : 'Invoices'}
                </div>
                {grouped[g].map(h => (
                  <button key={h.id} onMouseDown={() => jump(h)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 10px', border: 'none', borderTop: '1px solid var(--pearl)',
                      background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{h.primary}</div>
                    {h.secondary && <div style={{ fontSize: 11, color: 'var(--mist)' }}>{h.secondary}</div>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
