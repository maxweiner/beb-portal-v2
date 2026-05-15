'use client'

// Mobile Inventory tab. Hero of the module.
//
// Layout:
//   [search input] [📷]
//   [filter chips: status, category]
//   [item count]
//   ...
//   [row] [row] [row] (compact, cost-forward)
//
// Row format — COST is the lead number (large, bold) because that's
// what the operator is reaching for at a wholesale trade show.
//   ┌────────────────────────────────────────────────────────────┐
//   │ [img]  Stock# 12345          $4,200          ◐ on memo    │
//   │        Vendor · 14k gold ring                  4 days out │
//   └────────────────────────────────────────────────────────────┘
//
// Tap → MobileInventoryDetail (read-only viewer with photos + specs).
//
// Scanner button uses the existing barcode-decoder lib. Stops at the
// camera capture step + reads any scanned digits straight into the
// search box (no tag-format infrastructure exists yet per ops, so a
// successful scan just types the value).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { InventoryItem, InventoryStatus, InventoryCategory } from '@/types/wholesale'
import MobileInventoryDetail from './MobileInventoryDetail'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const USD_CENTS = (cents: number | null) => cents == null ? '—' : USD.format(cents / 100)

const STATUS_PILL: Record<InventoryStatus, { bg: string; fg: string; label: string }> = {
  in_stock:      { bg: '#DCFCE7', fg: '#166534', label: 'in stock' },
  on_memo:       { bg: '#FEF3C7', fg: '#92400E', label: 'on memo' },
  on_hold:       { bg: '#F3E8FF', fg: '#6B21A8', label: 'on hold' },
  sold:          { bg: '#E0E7FF', fg: '#3730A3', label: 'sold' },
  returned:      { bg: '#FEE2E2', fg: '#991B1B', label: 'returned' },
  in_repair:     { bg: '#FED7AA', fg: '#9A3412', label: 'in repair' },
  consigned_out: { bg: '#E5E7EB', fg: '#374151', label: 'consigned' },
  scrapped:      { bg: '#FEE2E2', fg: '#7C2D12', label: 'scrapped' },
}

export default function MobileInventoryView() {
  const { brand } = useApp()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [thumbsById, setThumbsById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Status filter: 'active' folds available + on_memo + hold (the
  // three live statuses); operator can flip to a specific one. 'sold'
  // and 'archived' / 'scrapped' are opt-in to keep the default list
  // current-show-relevant.
  const [statusFilter, setStatusFilter] = useState<'active' | InventoryStatus>('active')
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  // Initial load. Pulls every brand-scoped item; mobile is small
  // enough that a per-tab query against the whole catalog is fine.
  // If your inventory ever exceeds ~5k items, paginate this.
  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error: err } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('brand', brand)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(2000)
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      const rows = (data || []) as InventoryItem[]
      setItems(rows)
      setLoading(false)

      // Thumbnail fetch — one primary photo per item. Best-effort;
      // missing photos render with a placeholder. Mirrors the
      // pattern in the desktop InventoryView (is_primary flag +
      // wholesale-photos bucket).
      const ids = rows.map(r => r.id)
      if (ids.length > 0) {
        const { data: photos } = await supabase
          .from('inventory_photos')
          .select('item_id, storage_path')
          .eq('is_primary', true)
          .in('item_id', ids)
        if (cancelled || !photos) return
        const pathByItem = new Map<string, string>()
        for (const p of photos as any[]) {
          if (p.item_id && p.storage_path) pathByItem.set(p.item_id, p.storage_path)
        }
        const paths = Array.from(pathByItem.values())
        if (paths.length === 0) return
        const { data: signed } = await supabase.storage
          .from('wholesale-photos')
          .createSignedUrls(paths, 60 * 60)
        if (cancelled) return
        const urlByPath = new Map<string, string>()
        for (const s of (signed || []) as any[]) {
          if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
        }
        const next: Record<string, string> = {}
        for (const [itemId, path] of pathByItem.entries()) {
          const u = urlByPath.get(path)
          if (u) next[itemId] = u
        }
        setThumbsById(next)
      }
    })()
    return () => { cancelled = true }
  }, [brand])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      // Status filter — 'active' = the live trio (in_stock /
      // on_memo / on_hold). 'archived_at IS NULL' is already in the
      // server query so we don't need to redo that here.
      if (statusFilter === 'active') {
        if (i.status !== 'in_stock' && i.status !== 'on_memo' && i.status !== 'on_hold') return false
      } else {
        if (i.status !== statusFilter) return false
      }
      if (q) {
        const hay = [
          i.item_number,
          i.vendor_stock_number || '',
          i.alternate_item_number || '',
          i.public_notes || '',
          i.jewelry_type || '',
          i.jewelry_designer || '',
          i.watch_brand || '',
          i.watch_model || '',
        ].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, search, statusFilter])

  // Scanner — opens the device camera. Currently a forward-looking
  // stub: tags aren't printed with barcodes / QR yet per ops, so a
  // successful capture just prompts the operator to type the stock #
  // below. Once tag printing ships, swap the alert for a barcode-
  // decoder call (lib/barcode-decoder.ts already handles
  // PDF417 / QR / Code128 on the desktop scanner path) and pipe
  // the decoded value into setSearch().
  async function launchScanner() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.setAttribute('capture', 'environment')
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0]
      if (!file) return
      // TODO(tag-printing): decode here once we settle on a tag format.
      // For now, focus the search input so the operator can type.
      alert('Camera scan captured. Tag-format decoding ships once we print scannable tags. Type the stock # below for now.')
    }
    input.click()
  }

  const openItem = useMemo(
    () => items.find(i => i.id === openItemId) || null,
    [items, openItemId],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Search + scanner */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="search"
          inputMode="search"
          placeholder="Stock # or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '10px 12px', fontSize: 15,
            border: '1px solid var(--pearl)', borderRadius: 8,
            background: '#fff', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={launchScanner}
          title="Scan barcode / QR"
          style={{
            background: 'var(--green-dark)', color: '#fff',
            border: 'none', borderRadius: 8,
            padding: '0 14px', fontSize: 20, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}
        >📷</button>
      </div>

      {/* Status chip filter */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {([
          ['active',   'Active'],
          ['in_stock', 'In stock'],
          ['on_memo',  'On memo'],
          ['on_hold',  'On hold'],
          ['sold',     'Sold'],
        ] as const).map(([key, label]) => {
          const sel = statusFilter === key
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key as any)}
              style={{
                background: sel ? 'var(--green-dark)' : '#fff',
                color: sel ? '#fff' : 'var(--ink)',
                border: '1px solid var(--pearl)',
                borderRadius: 999, padding: '5px 12px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                whiteSpace: 'nowrap', fontFamily: 'inherit',
              }}
            >{label}</button>
          )
        })}
      </div>

      {/* Count + load state */}
      <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {loading ? 'Loading…' : `${filtered.length} of ${items.length} items`}
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
      )}

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(item => {
          const pill = STATUS_PILL[item.status]
          const thumb = thumbsById[item.id]
          const vendorOrCategory = item.jewelry_type || item.watch_brand || item.category || '—'
          return (
            <button
              key={item.id}
              onClick={() => setOpenItemId(item.id)}
              style={{
                background: '#fff', border: '1px solid var(--pearl)', borderRadius: 10,
                padding: 8, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 10,
                textAlign: 'left', width: '100%',
              }}
            >
              {/* Thumbnail */}
              <div style={{
                width: 56, height: 56, flexShrink: 0,
                borderRadius: 8, overflow: 'hidden',
                background: 'var(--cream2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 24, color: 'var(--mist)' }}>💎</span>
                )}
              </div>

              {/* Body */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    #{item.item_number}
                  </div>
                  {/* COST — the lead number. Large + bold. */}
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', flexShrink: 0 }}>
                    {USD_CENTS(item.cost_cents)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                  <div style={{ fontSize: 11, color: 'var(--mist)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {vendorOrCategory}
                  </div>
                  <span style={{
                    background: pill.bg, color: pill.fg,
                    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                    letterSpacing: '.02em', textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>{pill.label}</span>
                </div>
              </div>
            </button>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
            {search ? 'No items match that search.' : 'No items in inventory yet.'}
          </div>
        )}
      </div>

      {/* Detail viewer modal */}
      {openItem && (
        <MobileInventoryDetail
          item={openItem}
          onClose={() => setOpenItemId(null)}
        />
      )}
    </div>
  )
}
