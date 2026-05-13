'use client'

// Inventory list + new-item flow + detail modal. Single wide
// inventory_items table; category picker drives which form fields
// appear. Photos + docs uploaded to Supabase Storage (bucket
// 'wholesale-photos' / 'wholesale-documents'); see docs/wholesale.md
// for bucket setup. Item numbers generated atomically via the
// next_wholesale_number RPC.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type {
  InventoryItem, InventoryCategory, InventoryStatus, DiamondLabType,
  WholesaleVendor, WholesaleCustomer, InventoryLocation, InventoryPhoto, InventoryDocument,
  InventoryItemStone, WholesaleAuditLogEntry,
} from '@/types/wholesale'
import { fmtMoneyCents, dollarsToCents, centsToDollarsString, fmtDate, fmtDateTime, marginPct } from '@/lib/wholesale/format'
import { nextWholesaleNumber, prefixForCategory } from '@/lib/wholesale/numbers'
import { logAudit, diffFields, fetchItemHistory } from '@/lib/wholesale/audit'
import { loadAdminLists } from '@/lib/wholesale/lists'
import Checkbox from '@/components/ui/Checkbox'
import InventorySheet from './InventorySheet'

const PHOTO_BUCKET = 'wholesale-photos'
const DOC_BUCKET = 'wholesale-documents'
const SIGNED_URL_TTL = 60 * 60 // 1h

const STATUS_LABEL: Record<InventoryStatus, string> = {
  in_stock: 'In Stock', on_memo: 'On Memo', on_hold: 'On Hold',
  sold: 'Sold', returned: 'Returned', in_repair: 'In Repair', consigned_out: 'Consigned',
  scrapped: 'Scrapped',
}
const STATUS_COLOR: Record<InventoryStatus, { bg: string; fg: string }> = {
  in_stock:      { bg: '#D1FAE5', fg: '#065F46' },
  on_memo:       { bg: '#FEF3C7', fg: '#92400E' },
  on_hold:       { bg: '#E0E7FF', fg: '#3730A3' },
  sold:          { bg: '#DBEAFE', fg: '#1E40AF' },
  returned:      { bg: '#F3F4F6', fg: '#374151' },
  in_repair:     { bg: '#FEE2E2', fg: '#991B1B' },
  consigned_out: { bg: '#FEF3C7', fg: '#78716C' },
  scrapped:      { bg: '#F3F4F6', fg: '#6B7280' },
}
const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  jewelry: 'Jewelry', watch: 'Watch', diamond: 'Diamond',
}

const LIST_KEYS = [
  'jewelry_type','metal_type','metal_color','metal_karat','diamond_shape','period_era',
  // 'stone_type' backs the jewelry multi-stone block (seeded with
  // Diamond/Ruby/Emerald/Sapphire/Aquamarine/Garnet; the "+ Add new"
  // option in the picker inserts into wholesale_admin_lists so the
  // new value shows up for every other item from then on).
  'stone_type',
  'watch_brand','watch_band_style','watch_movement','watch_case_material','watch_condition',
] as const

const withTimeout = <T,>(promise: PromiseLike<T>, ms = 15000): Promise<T> =>
  Promise.race([
    Promise.resolve(promise) as Promise<T>,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ])

export default function InventoryView() {
  const { user, brand } = useApp()
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [vendors, setVendors] = useState<WholesaleVendor[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [primaryPhotoUrls, setPrimaryPhotoUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | InventoryCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | InventoryStatus>('in_stock')
  const [vendorFilter, setVendorFilter] = useState<string>('all')   // 'all' | wholesale_vendors.id
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  // Per-session sort. null = natural order (DB returned order). Click
  // a sortable header to cycle: none → asc → desc → none. Only four
  // columns are sortable; others stay unsortable (description, status,
  // etc. don't have a useful canonical order).
  const [sort, setSort] = useState<
    { field: 'item_number' | 'cost_cents' | 'wholesale_price_cents' | 'retail_price_cents'; dir: 'asc' | 'desc' } | null
  >(null)
  const cycleSort = (field: NonNullable<typeof sort>['field']) => {
    setSort(prev => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }
  const [showNewModal, setShowNewModal] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [view, setView] = useState<'list' | 'sheet'>('list')
  const [lists, setLists] = useState<Record<string, string[]>>({})

  const reloadRef = useRef<() => Promise<void>>(async () => {})
  reloadRef.current = async () => {
    if (!brand) return
    setError(null)
    try {
      const [itemsRes, vendorsRes, locationsRes, listsRes] = await Promise.all([
        withTimeout(
          supabase.from('inventory_items').select('*').eq('brand', brand)
            .is('archived_at', null).order('created_at', { ascending: false }),
        ),
        withTimeout(
          supabase.from('wholesale_vendors').select('*').eq('brand', brand)
            .is('archived_at', null).order('company_name'),
        ),
        withTimeout(
          supabase.from('inventory_locations').select('*').eq('brand', brand)
            .is('archived_at', null).eq('active', true).order('sort_order'),
        ),
        loadAdminLists(brand, [...LIST_KEYS]),
      ])
      setItems((itemsRes.data || []) as InventoryItem[])
      setVendors((vendorsRes.data || []) as WholesaleVendor[])
      setLocations((locationsRes.data || []) as InventoryLocation[])
      const activeLists: Record<string, string[]> = {}
      for (const k of LIST_KEYS) activeLists[k] = (listsRes[k] || []).filter(e => e.active).map(e => e.value)
      setLists(activeLists)

      // Pull primary photo URLs (signed) for thumbnails. Skip silently if
      // the bucket isn't set up yet.
      const ids = (itemsRes.data || []).map((it: any) => it.id)
      if (ids.length > 0) {
        const { data: photos } = await supabase.from('inventory_photos')
          .select('item_id, storage_path').eq('is_primary', true).in('item_id', ids)
        const paths = (photos || []).map((p: any) => p.storage_path)
        if (paths.length > 0) {
          const { data: signed } = await supabase.storage.from(PHOTO_BUCKET)
            .createSignedUrls(paths, SIGNED_URL_TTL)
          const byPath = new Map((signed || []).map((s: any) => [s.path, s.signedUrl]))
          const m: Record<string, string> = {}
          for (const p of (photos || []) as any[]) {
            const url = byPath.get(p.storage_path)
            if (url) m[p.item_id] = url
          }
          setPrimaryPhotoUrls(m)
        } else {
          setPrimaryPhotoUrls({})
        }
      } else {
        setPrimaryPhotoUrls({})
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
      setItems([])
    }
  }
  useEffect(() => { void reloadRef.current() }, [brand])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    const rows = items.filter(i => {
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false
      if (statusFilter !== 'all' && i.status !== statusFilter) return false
      if (vendorFilter !== 'all') {
        // '' or null vendor_id is the explicit "no vendor" group.
        const id = (i as any).vendor_id || ''
        if (vendorFilter === '__none__') { if (id) return false }
        else if (id !== vendorFilter) return false
      }
      if (q) {
        const blob = [
          i.item_number, i.public_notes, i.internal_notes,
          i.watch_brand, i.watch_model, i.watch_serial_number,
          i.diamond_report_number, i.jewelry_designer, i.jewelry_hallmarks,
          i.vendor_stock_number,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
    if (!sort) return rows
    // Sort copy — never mutate the source items array (React relies on
    // reference equality elsewhere). Nulls go to END regardless of dir
    // so empty-cost rows don't trip the operator scanning by price.
    const sorted = rows.slice()
    const { field, dir } = sort
    const sign = dir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      const av = (a as any)[field]
      const bv = (b as any)[field]
      const aMissing = av == null || av === ''
      const bMissing = bv == null || bv === ''
      if (aMissing && bMissing) return 0
      if (aMissing) return 1
      if (bMissing) return -1
      if (field === 'item_number') {
        return String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' }) * sign
      }
      return (Number(av) - Number(bv)) * sign
    })
    return sorted
  }, [items, search, categoryFilter, statusFilter, vendorFilter, sort])

  const counts = useMemo(() => {
    const by = { in_stock: 0, on_memo: 0, on_hold: 0, sold: 0 } as Record<string, number>
    for (const i of items || []) by[i.status] = (by[i.status] || 0) + 1
    return by
  }, [items])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tile label="In Stock" value={counts.in_stock || 0} active={statusFilter === 'in_stock'} onClick={() => setStatusFilter('in_stock')} bg="#D1FAE5" fg="#065F46" />
          <Tile label="On Memo"  value={counts.on_memo  || 0} active={statusFilter === 'on_memo'}  onClick={() => setStatusFilter('on_memo')}  bg="#FEF3C7" fg="#92400E" />
          <Tile label="On Hold"  value={counts.on_hold  || 0} active={statusFilter === 'on_hold'}  onClick={() => setStatusFilter('on_hold')}  bg="#E0E7FF" fg="#3730A3" />
          <Tile label="Sold"     value={counts.sold     || 0} active={statusFilter === 'sold'}     onClick={() => setStatusFilter('sold')}     bg="#DBEAFE" fg="#1E40AF" />
          <button onClick={() => setStatusFilter('all')}
            className={statusFilter === 'all' ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}>All</button>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 2, borderRadius: 6 }}>
          <button onClick={() => setView('list')}
            style={{ background: view === 'list' ? '#fff' : 'transparent', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
            title="List view">☰ List</button>
          <button onClick={() => setView('sheet')}
            style={{ background: view === 'sheet' ? '#fff' : 'transparent', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
            title="Sheet view (fast triage)">⊞ Sheet</button>
        </div>
        <button onClick={() => setShowBulkUpload(true)} className="btn-outline btn-sm">📸 Bulk photos</button>
        <button onClick={() => setShowNewModal(true)} className="btn-primary btn-sm">+ New Item</button>
      </div>

      <div className="card" style={{ marginBottom: 10, padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search item #, description, serial, report #, designer…"
          style={{ flex: '1 1 240px', maxWidth: 360, fontSize: 12, padding: '6px 10px' }} />
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          title="Filter by vendor"
          style={{ flex: '0 1 180px', fontSize: 12, padding: '6px 10px' }}
        >
          <option value="all">All vendors</option>
          <option value="__none__">— no vendor —</option>
          {vendors.map(v => (
            <option key={v.id} value={v.id}>{v.company_name}</option>
          ))}
        </select>
        {(['all','jewelry','watch','diamond'] as const).map(c => (
          <button key={c} onClick={() => setCategoryFilter(c)}
            className={categoryFilter === c ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>{c === 'all' ? 'All cats' : CATEGORY_LABEL[c as InventoryCategory]}</button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      {items === null ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
      ) : view === 'sheet' ? (
        <InventorySheet items={items} onChanged={() => void reloadRef.current()} />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {(items.length === 0) ? 'No inventory yet — click "+ New Item".' : 'Nothing matches the current filters.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--cream2)' }}>
                  {/* Item #, Cost, Wholesale, Retail are sortable —
                      click to cycle asc → desc → off. Other columns
                      have no useful canonical order so they render
                      as plain headers. */}
                  <SortableTh label="" />
                  <SortableTh label="Item #"    field="item_number"           sort={sort} onClick={cycleSort} />
                  <SortableTh label="Cat" />
                  <SortableTh label="Description" />
                  <SortableTh label="Cost"      field="cost_cents"            sort={sort} onClick={cycleSort} />
                  <SortableTh label="Wholesale" field="wholesale_price_cents" sort={sort} onClick={cycleSort} />
                  <SortableTh label="Retail"    field="retail_price_cents"    sort={sort} onClick={cycleSort} />
                  <SortableTh label="Status" />
                  <SortableTh label="" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const sc = STATUS_COLOR[it.status]
                  const photoUrl = primaryPhotoUrls[it.id]
                  return (
                    <tr key={it.id} onClick={() => setOpenItemId(it.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--pearl)' }}>
                      <td style={{ padding: '6px 10px', width: 50 }}>
                        {photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--pearl)' }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                            {it.category === 'jewelry' ? '💍' : it.category === 'watch' ? '⌚' : it.category === 'diamond' ? '💎' : '📦'}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{it.item_number}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--mist)', whiteSpace: 'nowrap' }}>{it.category ? CATEGORY_LABEL[it.category] : '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
                          {it.public_notes || (
                            it.category === 'watch' ? `${it.watch_brand || ''} ${it.watch_model || ''}`.trim() :
                            it.category === 'diamond' ? `${it.diamond_carat || ''}ct ${it.diamond_shape || ''} ${it.diamond_color || ''} ${it.diamond_clarity || ''}`.trim() :
                            it.jewelry_type || '—'
                          )}
                        </div>
                        {it.category === 'watch' && it.watch_serial_number && (
                          <div style={{ fontSize: 10, color: 'var(--mist)' }}>S/N: {it.watch_serial_number}</div>
                        )}
                        {it.category === 'diamond' && it.diamond_report_number && (
                          <div style={{ fontSize: 10, color: 'var(--mist)' }}>{it.diamond_lab_type}: {it.diamond_report_number}</div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtMoneyCents(it.cost_cents)}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtMoneyCents(it.wholesale_price_cents)}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtMoneyCents(it.retail_price_cents)}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {STATUS_LABEL[it.status]}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>→</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showBulkUpload && (
        <BulkPhotoUploadModal
          brand={brand!}
          actorId={user?.id || null}
          actorEmail={user?.email || null}
          onClose={() => setShowBulkUpload(false)}
          onChanged={() => void reloadRef.current()}
        />
      )}
      {showNewModal && (
        <NewItemModal
          brand={brand!}
          vendors={vendors}
          locations={locations}
          lists={lists}
          actorId={user?.id || null}
          actorEmail={user?.email || null}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); void reloadRef.current() }}
        />
      )}
      {openItemId && (
        <ItemDetailModal
          itemId={openItemId}
          brand={brand!}
          vendors={vendors}
          locations={locations}
          lists={lists}
          actorId={user?.id || null}
          actorEmail={user?.email || null}
          onClose={() => setOpenItemId(null)}
          onChanged={() => void reloadRef.current()}
        />
      )}
    </div>
  )
}

function Tile({ label, value, active, onClick, bg, fg }: {
  label: string; value: number; active: boolean; onClick: () => void; bg: string; fg: string
}) {
  return (
    <button onClick={onClick}
      style={{
        textAlign: 'left', padding: '8px 12px', borderRadius: 8,
        background: bg, border: active ? `2px solid ${fg}` : '1px solid var(--cream2)',
        cursor: 'pointer', fontFamily: 'inherit', minWidth: 86,
      }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: fg, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: fg }}>{value}</div>
    </button>
  )
}

/* ─────────────────────── bulk photo upload ───────────────────── */

/** Filename → item key parser. Accepts these (case-insensitive):
 *    J-1002.jpg / W-1002.jpg / D-1002.jpg / I-1002.jpg
 *    j1002.jpg, j1002b.jpg, j-1002-2.jpg, j 1002.jpg
 *    1002.jpg                  (prefix-less; matched across all items
 *                                with item_number ending in -1002)
 *  Returns { prefix?, num } or null when the name has no digits. */
function parsePhotoFilename(filename: string): { prefix: string | null; num: string } | null {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase()  // drop extension
  // Optional letter prefix, optional dash/space, then a run of digits.
  // Anything after the digits (-2, -a, b, _01, …) is treated as a
  // suffix and ignored.
  const m = base.match(/^([a-z])?[\s\-_]*(\d+)/)
  if (!m) return null
  return { prefix: m[1] ? m[1].toUpperCase() : null, num: m[2] }
}

interface BulkRowResult {
  file: File
  status: 'pending' | 'ok' | 'no_match' | 'ambiguous' | 'error'
  reason?: string
  item_number?: string
  is_primary?: boolean
}

function BulkPhotoUploadModal({
  brand, actorId, actorEmail, onClose, onChanged,
}: {
  brand: string
  actorId: string | null
  actorEmail: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [results, setResults] = useState<BulkRowResult[]>([])
  const [running, setRunning] = useState(false)

  async function processFile(file: File): Promise<BulkRowResult> {
    // Two-pass match: first try the canonical item_number (J-1002 etc.),
    // then fall back to vendor_stock_number for legacy codes like
    // "020-000028.jpg". Suffixes (-2, " (1)", trailing letter) are
    // stripped on the vendor-stock pass so multi-photo names still
    // match the same item.
    let item: { id: string; item_number: string } | null = null
    let lastReason = ''

    const parsed = parsePhotoFilename(file.name)
    if (parsed) {
      const { prefix, num } = parsed
      let q = supabase.from('inventory_items')
        .select('id, item_number')
        .eq('brand', brand).is('archived_at', null)
      if (prefix) q = q.eq('item_number', `${prefix}-${num}`)
      else        q = q.ilike('item_number', `%-${num}`)
      const { data, error: qErr } = await q.limit(5)
      if (qErr) return { file, status: 'error', reason: qErr.message }
      if (data && data.length === 1) item = data[0] as any
      else if (data && data.length > 1) {
        return { file, status: 'ambiguous', reason: `Multiple item_number matches: ${data.map((i: any) => i.item_number).join(', ')}` }
      } else {
        lastReason = `No item ${prefix ? `${prefix}-${num}` : `*-${num}`}`
      }
    }

    if (!item) {
      // vendor_stock_number fallback: try the filename as-is, then
      // try with disambiguator suffixes stripped.
      const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().trim()
      const candidates: string[] = [base]
      let cur = base
      for (let i = 0; i < 4; i++) {
        const next = cur
          .replace(/\s*\(\d+\)$/, '')   // " (1)"
          .replace(/[\-_]\d+$/, '')     // "-2", "_3"
          .replace(/[a-z]$/, '')        // trailing letter "b"
          .trim()
        if (next === cur || next.length === 0) break
        candidates.push(next)
        cur = next
      }
      for (const c of candidates) {
        const { data, error: qErr } = await supabase.from('inventory_items')
          .select('id, item_number')
          .eq('brand', brand).is('archived_at', null)
          .ilike('vendor_stock_number', c).limit(5)
        if (qErr) return { file, status: 'error', reason: qErr.message }
        if (data && data.length === 1) { item = data[0] as any; break }
        if (data && data.length > 1) {
          return { file, status: 'ambiguous', reason: `Multiple vendor_stock_number matches for "${c}": ${data.map((i: any) => i.item_number).join(', ')}` }
        }
      }
    }

    if (!item) {
      return { file, status: 'no_match', reason: lastReason || `No item or vendor_stock_number for ${file.name}` }
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${brand}/${item.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from('wholesale-photos').upload(path, file, {
      cacheControl: '3600', upsert: false,
    })
    if (upErr) return { file, status: 'error', reason: upErr.message }

    // Set primary only if the item has no primary photo yet.
    const { data: existingPrimary } = await supabase.from('inventory_photos')
      .select('id').eq('item_id', item.id).eq('is_primary', true).maybeSingle()
    const isPrimary = !existingPrimary

    const { error: insErr } = await supabase.from('inventory_photos').insert({
      brand, item_id: item.id, storage_path: path, is_primary: isPrimary, uploaded_by: actorId,
    })
    if (insErr) {
      // Roll back the storage object so we don't orphan it.
      await supabase.storage.from('wholesale-photos').remove([path])
      return { file, status: 'error', reason: insErr.message }
    }

    void logAudit({
      brand, entity_type: 'inventory_item', entity_id: item.id,
      action: 'photo_uploaded', after: { source: 'bulk_upload', filename: file.name },
      actor_id: actorId, actor_email: actorEmail,
    })

    return { file, status: 'ok', item_number: item.item_number, is_primary: isPrimary }
  }

  async function onPick(files: FileList) {
    const arr = Array.from(files)
    setResults(arr.map(file => ({ file, status: 'pending' })))
    setRunning(true)
    // Process in chunks of 4 to avoid hammering Storage.
    const CONC = 4
    let next = 0
    const work: BulkRowResult[] = arr.map(file => ({ file, status: 'pending' }))
    async function runOne(idx: number) {
      const r = await processFile(work[idx].file)
      work[idx] = r
      setResults([...work])
    }
    async function pump() {
      while (next < work.length) {
        const my = next++
        await runOne(my)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, work.length) }, () => pump()))
    setRunning(false)
    onChanged()
  }

  const counts = {
    ok: results.filter(r => r.status === 'ok').length,
    no_match: results.filter(r => r.status === 'no_match').length,
    ambiguous: results.filter(r => r.status === 'ambiguous').length,
    error: results.filter(r => r.status === 'error').length,
    pending: results.filter(r => r.status === 'pending').length,
  }

  return (
    <Modal onClose={onClose} title="Bulk upload photos" wide>
      <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--mist)' }}>
        Filenames match inventory by either <strong>item number</strong> (J-1002, j-1002-2, j1002b, 1002) or, as a fallback,{' '}
        <strong>vendor stock #</strong> (e.g. <code style={{ padding: '0 4px', background: 'var(--cream2)' }}>020-000028.jpg</code> matches the item with that vendor stock #).
        Suffixes like <code style={{ padding: '0 4px', background: 'var(--cream2)' }}>-2</code>,{' '}
        <code style={{ padding: '0 4px', background: 'var(--cream2)' }}>(1)</code>, or a trailing letter
        are stripped so multiple photos per item all match. The first photo per item is auto-flagged primary.
      </div>

      <label className="btn-primary btn-sm" style={{ cursor: running ? 'wait' : 'pointer', display: 'inline-block' }}>
        {running ? 'Uploading…' : '+ Pick photos'}
        <input type="file" accept="image/*" multiple disabled={running}
          onChange={e => { const f = e.target.files; if (f && f.length > 0) void onPick(f); e.currentTarget.value = '' }}
          style={{ display: 'none' }} />
      </label>

      {results.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 6 }}>
            {counts.ok} matched · {counts.ambiguous} ambiguous · {counts.no_match} no match ·{' '}
            {counts.error} errored{counts.pending > 0 ? ` · ${counts.pending} in flight` : ''}
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--pearl)', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--pearl)' : undefined }}>
                    <td style={{ padding: 6, width: 22 }}>
                      {r.status === 'ok' && '✓'}
                      {r.status === 'pending' && '⟳'}
                      {r.status === 'no_match' && '❓'}
                      {r.status === 'ambiguous' && '⚠'}
                      {r.status === 'error' && '✗'}
                    </td>
                    <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{r.file.name}</td>
                    <td style={{ padding: 6 }}>
                      {r.status === 'ok' && (
                        <>
                          <strong>{r.item_number}</strong>
                          {r.is_primary && <span style={{ marginLeft: 6, color: 'var(--green)', fontSize: 10 }}>★ PRIMARY</span>}
                        </>
                      )}
                      {r.status !== 'ok' && r.reason && <span style={{ color: 'var(--mist)' }}>{r.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onClose} className="btn-outline btn-sm">Done</button>
      </div>
    </Modal>
  )
}

/* ─────────────────────── new-item modal ─────────────────────── */

function NewItemModal({
  brand, vendors, locations, lists, actorId, actorEmail, onClose, onCreated,
}: {
  brand: string
  vendors: WholesaleVendor[]
  locations: InventoryLocation[]
  lists: Record<string, string[]>
  actorId: string | null
  actorEmail: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [category, setCategory] = useState<InventoryCategory | null>(null)
  return (
    <Modal onClose={onClose} title={category ? `New ${CATEGORY_LABEL[category]}` : 'New Item — pick a category'}>
      {!category ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {(['jewelry','watch','diamond'] as InventoryCategory[]).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              style={{
                padding: '24px 10px', borderRadius: 8, border: '1px solid var(--cream2)',
                background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
              }}>
              <div style={{ fontSize: 32 }}>{c === 'jewelry' ? '💍' : c === 'watch' ? '⌚' : '💎'}</div>
              <div style={{ fontWeight: 800 }}>{CATEGORY_LABEL[c]}</div>
            </button>
          ))}
        </div>
      ) : (
        <ItemForm
          mode="new"
          category={category}
          brand={brand}
          vendors={vendors}
          locations={locations}
          lists={lists}
          actorId={actorId}
          actorEmail={actorEmail}
          onSaved={onCreated}
          onCancel={() => setCategory(null)}
        />
      )}
    </Modal>
  )
}

/* ─────────────────────── item detail modal ─────────────────────── */

function ItemDetailModal({
  itemId, brand, vendors, locations, lists, actorId, actorEmail, onClose, onChanged,
}: {
  itemId: string
  brand: string
  vendors: WholesaleVendor[]
  locations: InventoryLocation[]
  lists: Record<string, string[]>
  actorId: string | null
  actorEmail: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [photos, setPhotos] = useState<(InventoryPhoto & { url?: string })[]>([])
  const [docs, setDocs] = useState<(InventoryDocument & { url?: string })[]>([])
  const [audit, setAudit] = useState<WholesaleAuditLogEntry[]>([])
  const [tab, setTab] = useState<'edit' | 'photos' | 'docs' | 'history'>('edit')
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    try {
      // History pulls from related entities too (memos, invoices, photos,
      // docs, payments) so the timeline tells the whole lifecycle of the
      // item — not just its own row edits. See fetchItemHistory().
      const [itemRes, photosRes, docsRes, auditRows] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', itemId).maybeSingle(),
        supabase.from('inventory_photos').select('*').eq('item_id', itemId).order('sort_order'),
        supabase.from('inventory_documents').select('*').eq('item_id', itemId).order('created_at', { ascending: false }),
        fetchItemHistory(itemId),
      ])
      const i = itemRes.data as InventoryItem | null
      setItem(i || null)

      const photoRows = (photosRes.data || []) as InventoryPhoto[]
      const docRows = (docsRes.data || []) as InventoryDocument[]
      const photoPaths = photoRows.map(p => p.storage_path)
      const docPaths   = docRows.map(d => d.storage_path)
      const [signedPhotos, signedDocs] = await Promise.all([
        photoPaths.length > 0 ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, SIGNED_URL_TTL) : { data: [] as any[] },
        docPaths.length > 0 ? supabase.storage.from(DOC_BUCKET).createSignedUrls(docPaths, SIGNED_URL_TTL) : { data: [] as any[] },
      ])
      const photoUrlByPath = new Map(((signedPhotos.data || []) as any[]).map(s => [s.path, s.signedUrl]))
      const docUrlByPath   = new Map(((signedDocs.data || []) as any[]).map(s => [s.path, s.signedUrl]))
      setPhotos(photoRows.map(p => ({ ...p, url: photoUrlByPath.get(p.storage_path) })))
      setDocs(docRows.map(d => ({ ...d, url: docUrlByPath.get(d.storage_path) })))
      setAudit(auditRows)
    } catch (e: any) { setErr(e?.message || 'Load failed') }
  }
  useEffect(() => { void reload() }, [itemId])

  if (!item) {
    return <Modal onClose={onClose} title="Loading…"><div>Loading…</div></Modal>
  }

  return (
    <Modal onClose={onClose} title={`Inventory Card · ${item.item_number} — ${item.category ? CATEGORY_LABEL[item.category] : '(uncategorized)'}`} wide>
      <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 4, borderRadius: 8, width: 'fit-content', marginBottom: 12 }}>
        {(['edit','photos','docs','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              padding: '4px 10px', border: 'none', borderRadius: 4,
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? 'var(--green-dark)' : 'var(--mist)',
              cursor: 'pointer',
            }}>
            {t === 'edit' ? 'Details' : t === 'photos' ? `Photos (${photos.length})` : t === 'docs' ? `Documents (${docs.length})` : 'History'}
          </button>
        ))}
      </div>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {/* All four panels stay mounted; we toggle visibility with display:
          none so switching tabs preserves form state + scroll position.
          The wrapper has a fixed height and each panel scrolls
          internally — that way the modal is the SAME size regardless
          of which tab is active, and each panel keeps its own scroll
          position when you flip back and forth. */}
      <div style={{ height: 'calc(92vh - 140px)' }}>
        <div style={{ display: tab === 'edit' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
          <ItemForm
            mode="edit"
            existing={item}
            category={item.category}
            brand={brand}
            vendors={vendors}
            locations={locations}
            lists={lists}
            actorId={actorId}
            actorEmail={actorEmail}
            onSaved={() => { void reload(); onChanged() }}
            onCancel={onClose}
          />
        </div>
        <div style={{ display: tab === 'photos' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
          <PhotosPanel
            itemId={item.id} brand={brand} photos={photos} actorId={actorId}
            actorEmail={actorEmail} onChanged={() => { void reload(); onChanged() }}
          />
        </div>
        <div style={{ display: tab === 'docs' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
          <DocsPanel
            itemId={item.id} brand={brand} docs={docs} actorId={actorId}
            actorEmail={actorEmail} onChanged={() => { void reload(); onChanged() }}
          />
        </div>
        <div style={{ display: tab === 'history' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
          <AuditTimeline entries={audit} />
        </div>
      </div>
    </Modal>
  )
}

/** Build the public description from the jewelry-form fields.
 *  Order: karat color metal period type, {N} diamonds {ct} ct,
 *  {dwt} dwt, designer, length, size {size}, hallmarks. Blank
 *  fields (and their literal labels) are skipped entirely.
 *  Designed to be re-runnable: clicking the button overwrites the
 *  current public_notes field. */
/** Pluralize a stone type for the auto-description. Seeded six get
 *  their proper plurals hardcoded; "Add new" customs get a simple "s"
 *  suffix — the user can edit the result post-Autofill if they want
 *  a non-standard plural (Topaz → Topazes, etc.). */
export function pluralizeStone(stone: string, count: number): string {
  if (count === 1) return stone
  switch (stone) {
    case 'Diamond':    return 'Diamonds'
    case 'Ruby':       return 'Rubies'
    case 'Emerald':    return 'Emeralds'
    case 'Sapphire':   return 'Sapphires'
    case 'Aquamarine': return 'Aquamarines'
    case 'Garnet':     return 'Garnets'
    default:           return stone + 's'
  }
}

/** Build the per-stone clauses used inside the Autofill description.
 *  Order rule: Diamond entries first (industry convention), then every
 *  other stone in user-added order. Each clause is "{N} {Pluralized}
 *  ~ {X} ct tw" with each piece optional — a stone with no count and
 *  no carat weight is skipped entirely. Exported so the appraisal PDF
 *  helper can share the same shape. */
export function stoneClauses(
  stones: Array<{ stone_type: string; count: string | number | null; total_ct: string | number | null; sort_order?: number }>,
): string[] {
  const trim = (v: any) => String(v ?? '').trim()
  // Stable sort: Diamond=0, others=1, ties broken by sort_order then
  // by original index so non-diamonds keep their user-added order.
  const indexed = stones.map((s, i) => ({ s, i }))
  indexed.sort((a, b) => {
    const ga = a.s.stone_type === 'Diamond' ? 0 : 1
    const gb = b.s.stone_type === 'Diamond' ? 0 : 1
    if (ga !== gb) return ga - gb
    const oa = a.s.sort_order ?? a.i
    const ob = b.s.sort_order ?? b.i
    return oa - ob
  })

  const clauses: string[] = []
  for (const { s } of indexed) {
    const countStr = trim(s.count)
    const ctStr    = trim(s.total_ct)
    if (!countStr && !ctStr) continue
    const pieces: string[] = []
    if (countStr) {
      const n = Number(countStr)
      const label = Number.isFinite(n) ? pluralizeStone(s.stone_type, n) : pluralizeStone(s.stone_type, 2)
      pieces.push(`${countStr} ${label}`)
    } else if (s.stone_type) {
      // Carat weight but no count — still mention the stone.
      pieces.push(pluralizeStone(s.stone_type, 2))
    }
    if (ctStr) pieces.push(`${ctStr} ct tw`)
    clauses.push(pieces.join(' ~ '))
  }
  return clauses
}

export function autoJewelryDescription(f: {
  karat?: string; color?: string; metal?: string
  period?: string; type?: string
  stones?: Array<{ stone_type: string; count: string | number | null; total_ct: string | number | null; sort_order?: number }>
  dwt?: string; designer?: string
  length?: string; size?: string; hallmarks?: string
}): string {
  const trim = (s?: string) => (s || '').trim()
  const parts: string[] = []

  // First clause: karat / color / metal / period / type — space-joined
  const head = [trim(f.karat), trim(f.color), trim(f.metal), trim(f.period), trim(f.type)]
    .filter(Boolean).join(' ')
  if (head) parts.push(head)

  // Stone clauses, Diamonds-first then user-added order (see
  // stoneClauses for details).
  for (const c of stoneClauses(f.stones || [])) parts.push(c)

  if (trim(f.dwt))       parts.push(`${trim(f.dwt)} dwt`)
  if (trim(f.designer))  parts.push(trim(f.designer))
  if (trim(f.length))    parts.push(trim(f.length))
  if (trim(f.size))      parts.push(`size ${trim(f.size)}`)
  if (trim(f.hallmarks)) parts.push(`"${trim(f.hallmarks)}"`)

  return parts.join(', ')
}

/* ─────────────────────── shared item form ─────────────────────── */

interface ItemFormProps {
  mode: 'new' | 'edit'
  category: InventoryCategory | null
  existing?: InventoryItem
  brand: string
  vendors: WholesaleVendor[]
  locations: InventoryLocation[]
  lists: Record<string, string[]>
  actorId: string | null
  actorEmail: string | null
  onSaved: () => void
  onCancel: () => void
}

function ItemForm({
  mode, category: initialCategory, existing, brand, vendors, locations, lists,
  actorId, actorEmail, onSaved, onCancel,
}: ItemFormProps) {
  // Category may be null on imported rows — let the user pick / change
  // it inside the form. New-item flow already forces a category up
  // front (NewItemModal); this tracks edits to it.
  const [category, setCategoryState] = useState<InventoryCategory | null>(initialCategory)
  // Prefill from existing if editing.
  const [vendor_id, setVendor]    = useState(existing?.vendor_id || '')
  const [vendor_stock_number, setVendorStock] = useState(existing?.vendor_stock_number || '')
  const [vendor_invoice_number, setVendorInvoice] = useState(existing?.vendor_invoice_number || '')
  // Items loaned INTO the company by a vendor — opposite of memo-out.
  // Independent of status: a memo-in item can still be on_hold or sold
  // (where 'sold' triggers the upstream payable to the vendor).
  const [memo_in, setMemoIn] = useState<boolean>(existing?.memo_in ?? false)
  const [location_id, setLocation] = useState(existing?.location_id || '')
  // "Date stocked" is auto-set to today on creation; not user-editable.
  // Existing items keep whatever's in the column (could be backfilled
  // from a trade-in's invoice date or imported data).
  const date_stocked = existing?.date_acquired || new Date().toISOString().slice(0, 10)
  const [cost, setCost]           = useState(centsToDollarsString(existing?.cost_cents ?? null))
  const [wholesale, setWholesale] = useState(centsToDollarsString(existing?.wholesale_price_cents ?? null))
  const [retail, setRetail]       = useState(centsToDollarsString(existing?.retail_price_cents ?? null))
  const [insurance, setInsurance] = useState(centsToDollarsString(existing?.insurance_value_cents ?? null))
  // The Edge ask price — Liberty's send-to-The-Edge dedicated price.
  // Empty = not ready to send (the Send-to-Edge view filters on this).
  const [edge, setEdge]           = useState(centsToDollarsString(existing?.edge_price_cents ?? null))
  const [public_notes, setPublic] = useState(existing?.public_notes || '')
  const [internal_notes, setInternal] = useState(existing?.internal_notes || '')
  const [status, setStatus]       = useState<InventoryStatus>(existing?.status || 'in_stock')
  const [gender, setGender]       = useState<'' | 'Female' | 'Male' | 'Unisex'>(existing?.gender || '')

  // jewelry
  const [jewelry_type, setJewType]       = useState(existing?.jewelry_type || '')
  const [metal_type, setMetalType]       = useState(existing?.jewelry_metal_type || '')
  const [metal_color, setMetalColor]     = useState(existing?.jewelry_metal_color || '')
  const [metal_karat, setKarat]          = useState(existing?.jewelry_metal_karat || '')
  const [metal_dwt, setDwt]              = useState(existing?.jewelry_metal_dwt != null ? String(existing.jewelry_metal_dwt) : '')
  // Jewelry stones — child rows in inventory_item_stones. The form
  // holds them as draft objects (count/total_ct as strings for input
  // controls); the save handler diffs against `existing` and applies
  // the smallest set of INSERT/UPDATE/DELETE statements. A row in the
  // draft list with id === null is a NEW stone (added in this session).
  // The StoneDraft shape lives at module level alongside StonesEditor.
  const [stones, setStones] = useState<StoneDraft[]>([])
  const [stonesLoaded, setStonesLoaded] = useState(false)
  // Tracks the ids we received from the server on load — anything in
  // this set that's NOT in the current `stones` array at save time
  // gets DELETEd. Adding a stone + removing it client-side before save
  // leaves no trace (its id was never in this set).
  const initialStoneIdsRef = useRef<Set<string>>(new Set())
  const [j_size, setJSize]               = useState(existing?.jewelry_size || '')
  const [j_length, setJLength]           = useState(existing?.jewelry_length || '')
  const [j_hallmarks, setJHallmarks]     = useState(existing?.jewelry_hallmarks || '')
  const [j_designer, setJDesigner]       = useState(existing?.jewelry_designer || '')
  const [j_period, setJPeriod]           = useState(existing?.jewelry_period || '')

  // watch
  const [watch_brand, setWBrand]         = useState(existing?.watch_brand || '')
  const [watch_model, setWModel]         = useState(existing?.watch_model || '')
  const [watch_serial, setWSerial]       = useState(existing?.watch_serial_number || '')
  const [watch_band, setWBand]           = useState(existing?.watch_band_style || '')
  const [watch_movement, setWMovement]   = useState(existing?.watch_movement_type || '')
  const [watch_year, setWYear]           = useState(existing?.watch_year != null ? String(existing.watch_year) : '')
  const [watch_condition, setWCondition] = useState(existing?.watch_condition || '')
  const [watch_box, setWBox]             = useState<'yes'|'no'|'partial'|''>(existing?.watch_box_papers || '')
  const [watch_case_mat, setWCaseMat]    = useState(existing?.watch_case_material || '')
  const [watch_case_size, setWCaseSize]  = useState(existing?.watch_case_size_mm != null ? String(existing.watch_case_size_mm) : '')
  const [watch_dial, setWDial]           = useState(existing?.watch_dial_color || '')
  const [watch_complications, setWComp]  = useState((existing?.watch_complications || []).join(', '))

  // diamond
  const [d_lab, setDLab]                 = useState<DiamondLabType | ''>(existing?.diamond_lab_type || '')
  const [d_report, setDReport]           = useState(existing?.diamond_report_number || '')
  const [d_shape, setDShape]             = useState(existing?.diamond_shape || '')
  const [d_carat, setDCarat]             = useState(existing?.diamond_carat != null ? String(existing.diamond_carat) : '')
  const [d_color, setDColor]             = useState(existing?.diamond_color || '')
  const [d_clarity, setDClarity]         = useState(existing?.diamond_clarity || '')
  const [d_cut, setDCut]                 = useState(existing?.diamond_cut || '')
  const [d_polish, setDPolish]           = useState(existing?.diamond_polish || '')
  const [d_symmetry, setDSymmetry]       = useState(existing?.diamond_symmetry || '')
  const [d_fluor, setDFluor]             = useState(existing?.diamond_fluorescence || '')
  const [d_meas, setDMeas]               = useState(existing?.diamond_measurements || '')
  const [d_depth, setDDepth]             = useState(existing?.diamond_depth_pct != null ? String(existing.diamond_depth_pct) : '')
  const [d_table, setDTable]             = useState(existing?.diamond_table_pct != null ? String(existing.diamond_table_pct) : '')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [rapnetLoading, setRapnetLoading] = useState(false)

  // Danger zone state — null when no confirm is open. Edit-only.
  const [dangerAction, setDangerAction] = useState<null | 'scrap' | 'delete'>(null)
  const [scrapReason, setScrapReason] = useState('')

  // Load existing stones for jewelry items being edited. New-item flow
  // starts with an empty array. Skipped quietly for non-jewelry items
  // since they don't render the stones section.
  useEffect(() => {
    let cancelled = false
    async function loadStones() {
      if (mode !== 'edit' || !existing?.id || category !== 'jewelry') {
        setStonesLoaded(true)
        return
      }
      const { data, error } = await supabase
        .from('inventory_item_stones')
        .select('*')
        .eq('item_id', existing.id)
        .order('sort_order', { ascending: true })
      if (cancelled) return
      if (error) {
        // Don't block the form — surface in the error banner and let
        // the user save other fields. The stones section will just
        // appear empty.
        setErr(`Couldn't load stones: ${error.message}`)
        setStonesLoaded(true)
        return
      }
      const rows = (data || []) as InventoryItemStone[]
      initialStoneIdsRef.current = new Set(rows.map(r => r.id))
      setStones(rows.map(r => ({
        id: r.id,
        stone_type: r.stone_type,
        shape: r.shape || '',
        count: r.count != null ? String(r.count) : '',
        total_ct: r.total_ct != null ? String(r.total_ct) : '',
        sort_order: r.sort_order,
      })))
      setStonesLoaded(true)
    }
    void loadStones()
    return () => { cancelled = true }
  }, [mode, existing?.id, category])

  const costCents = dollarsToCents(cost)
  const wholesaleCents = dollarsToCents(wholesale)
  const retailCents = dollarsToCents(retail)
  const edgeCents = dollarsToCents(edge)
  const wholesaleMargin = marginPct(costCents, wholesaleCents)
  const retailMargin    = marginPct(costCents, retailCents)
  const edgeMargin      = marginPct(costCents, edgeCents)
  const wholesaleBelowCost = costCents != null && wholesaleCents != null && wholesaleCents < costCents
  const retailBelowCost    = costCents != null && retailCents != null && retailCents < costCents
  const edgeBelowCost      = costCents != null && edgeCents != null && edgeCents < costCents

  async function rapnetLookup() {
    if (!d_report) { setErr('Enter a report number first'); return }
    setRapnetLoading(true); setErr(null)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token || ''
      const res = await fetch('/api/wholesale/diamond-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lab: d_lab || 'GIA', report_number: d_report }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Lookup failed')
      const d = json.diamond
      if (d?.shape)   setDShape(d.shape)
      if (d?.carat != null)   setDCarat(String(d.carat))
      if (d?.color)   setDColor(d.color)
      if (d?.clarity) setDClarity(d.clarity)
      if (d?.cut)     setDCut(d.cut)
      if (d?.polish)  setDPolish(d.polish)
      if (d?.symmetry) setDSymmetry(d.symmetry)
      if (d?.fluorescence) setDFluor(d.fluorescence)
      if (d?.measurements) setDMeas(d.measurements)
      if (d?.depth_pct != null) setDDepth(String(d.depth_pct))
      if (d?.table_pct != null) setDTable(String(d.table_pct))
      if (json.source === 'rapnet') alert('Populated from RapNet — verify before saving.')
      else if (json.source === 'gia_scrape') alert('Populated from GIA Report Check — verify before saving.')
      else alert('No automated source available — fill in manually.')
    } catch (e: any) {
      setErr(e?.message || 'Lookup failed')
    }
    setRapnetLoading(false)
  }

  async function save() {
    setBusy(true); setErr(null)
    try {
      // New items always have a category (NewItemModal picks first).
      // For edits, prefixForCategory is unused — keep the existing
      // item_number as-is even if the user changes category later.
      const itemNumber = mode === 'new'
        ? await nextWholesaleNumber(brand, prefixForCategory(category as InventoryCategory))
        : existing!.item_number

      const payload: any = {
        brand, category, item_number: itemNumber, status,
        cost_cents: dollarsToCents(cost),
        wholesale_price_cents: dollarsToCents(wholesale),
        retail_price_cents: dollarsToCents(retail),
        insurance_value_cents: dollarsToCents(insurance),
        edge_price_cents: dollarsToCents(edge),
        public_notes: public_notes.trim() || null,
        internal_notes: internal_notes.trim() || null,
        vendor_id: vendor_id || null,
        vendor_stock_number: vendor_stock_number.trim() || null,
        vendor_invoice_number: vendor_invoice_number.trim() || null,
        memo_in,
        location_id: location_id || null,
        date_acquired: date_stocked,
        gender: gender || null,
      }
      if (category === 'jewelry') {
        Object.assign(payload, {
          jewelry_type: jewelry_type || null,
          jewelry_metal_type: metal_type || null,
          jewelry_metal_color: metal_color || null,
          jewelry_metal_karat: metal_karat || null,
          jewelry_metal_dwt: metal_dwt ? Number(metal_dwt) : null,
          // Stones are saved as a separate child-table sync below,
          // not as flat columns. Old `jewelry_diamond_*` columns
          // were dropped in supabase-migration-jewelry-stones-table.sql.
          jewelry_size: j_size || null,
          jewelry_length: j_length || null,
          jewelry_hallmarks: j_hallmarks || null,
          jewelry_designer: j_designer || null,
          jewelry_period: j_period || null,
        })
      } else if (category === 'watch') {
        Object.assign(payload, {
          watch_brand: watch_brand || null,
          watch_model: watch_model || null,
          watch_serial_number: watch_serial || null,
          watch_band_style: watch_band || null,
          watch_movement_type: watch_movement || null,
          watch_year: watch_year ? Number(watch_year) : null,
          watch_condition: watch_condition || null,
          watch_box_papers: watch_box || null,
          watch_case_material: watch_case_mat || null,
          watch_case_size_mm: watch_case_size ? Number(watch_case_size) : null,
          watch_dial_color: watch_dial || null,
          watch_complications: watch_complications.trim()
            ? watch_complications.split(',').map(s => s.trim()).filter(Boolean)
            : null,
        })
      } else if (category === 'diamond') {
        Object.assign(payload, {
          diamond_lab_type: d_lab || null,
          diamond_report_number: d_report || null,
          diamond_shape: d_shape || null,
          diamond_carat: d_carat ? Number(d_carat) : null,
          diamond_color: d_color || null,
          diamond_clarity: d_clarity || null,
          diamond_cut: d_cut || null,
          diamond_polish: d_polish || null,
          diamond_symmetry: d_symmetry || null,
          diamond_fluorescence: d_fluor || null,
          diamond_measurements: d_meas || null,
          diamond_depth_pct: d_depth ? Number(d_depth) : null,
          diamond_table_pct: d_table ? Number(d_table) : null,
          diamond_data_source: existing?.diamond_data_source || 'manual',
        })
      }

      // Resolve the item id we'll attach stones to (insert returns
      // the new row's id; edit reuses the existing one).
      let savedItemId: string
      if (mode === 'new') {
        payload.created_by = actorId
        payload.updated_by = actorId
        const { data, error } = await supabase.from('inventory_items').insert(payload).select('*').single()
        if (error) throw new Error(error.message)
        savedItemId = (data as any).id
        await logAudit({
          brand, entity_type: 'inventory_item', entity_id: savedItemId,
          action: 'created', after: { item_number: itemNumber, category },
          actor_id: actorId, actor_email: actorEmail,
        })
      } else {
        payload.updated_by = actorId
        const { error } = await supabase.from('inventory_items').update(payload).eq('id', existing!.id)
        if (error) throw new Error(error.message)
        savedItemId = existing!.id
        const tracked = [
          'status','gender','cost_cents','wholesale_price_cents','retail_price_cents','insurance_value_cents',
          'edge_price_cents',
          'public_notes','internal_notes','vendor_id','vendor_stock_number','vendor_invoice_number','memo_in',
          'location_id','date_acquired',
        ]
        const diff = diffFields(existing as any, payload, tracked)
        if (diff) {
          const isCostEdit = diff.before.cost_cents !== undefined
          await logAudit({
            brand, entity_type: 'inventory_item', entity_id: existing!.id,
            action: isCostEdit ? 'cost_edited' : 'updated',
            before: diff.before, after: diff.after,
            actor_id: actorId, actor_email: actorEmail,
          })
        }
      }

      // Sync stones (jewelry only). Three-way diff against the
      // snapshot we captured on load: rows with id present + still
      // in the draft → UPDATE; rows in the draft with id === null →
      // INSERT; ids that were on the server but no longer in the
      // draft → DELETE. Cheap because stones-per-item is small
      // (handful at most). Run after the parent save so the FK to
      // inventory_items always resolves (new items got their id
      // back above; edits already had one).
      if (category === 'jewelry') {
        const presentIds = new Set(
          stones.filter(s => s.id != null).map(s => s.id as string),
        )
        const toDelete = Array.from(initialStoneIdsRef.current).filter(id => !presentIds.has(id))
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from('inventory_item_stones')
            .delete()
            .in('id', toDelete)
          if (delErr) throw new Error(`Stones delete failed: ${delErr.message}`)
        }

        // Re-stamp sort_order from the current array index so it
        // matches what the user sees on the screen, regardless of
        // any add/remove churn during editing.
        for (let i = 0; i < stones.length; i++) {
          const s = stones[i]
          const row = {
            item_id:    savedItemId,
            stone_type: s.stone_type,
            shape:      s.shape || null,
            count:      s.count    ? Number(s.count)    : null,
            total_ct:   s.total_ct ? Number(s.total_ct) : null,
            sort_order: i,
          }
          if (s.id) {
            const { error: upErr } = await supabase
              .from('inventory_item_stones')
              .update(row)
              .eq('id', s.id)
            if (upErr) throw new Error(`Stones update failed: ${upErr.message}`)
          } else {
            const { error: insErr } = await supabase
              .from('inventory_item_stones')
              .insert(row)
            if (insErr) throw new Error(`Stones insert failed: ${insErr.message}`)
          }
        }
      }

      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Save failed')
    }
    setBusy(false)
  }

  /** Mark the item scrapped — status flip + reason note. Visible in
   *  lists with a scrapped pill; excluded from in-stock counts and
   *  sellable filters automatically (status !== 'in_stock'). */
  async function handleScrap() {
    if (mode !== 'edit' || !existing) return
    const reason = scrapReason.trim()
    if (!reason) { setErr('A reason note is required when scrapping.'); return }
    setBusy(true); setErr(null)
    try {
      const patch = {
        status: 'scrapped' as any,
        scrap_reason: reason,
        scrapped_at: new Date().toISOString(),
        scrapped_by_user_id: actorId || null,
        updated_by: actorId,
      }
      const { error } = await supabase.from('inventory_items')
        .update(patch).eq('id', existing.id)
      if (error) throw new Error(error.message)
      await logAudit({
        brand: existing.brand,
        entity_type: 'inventory_item',
        entity_id: existing.id,
        action: 'scrapped',
        before: { status: existing.status, scrap_reason: null },
        after:  { status: 'scrapped',      scrap_reason: reason },
        actor_id: actorId, actor_email: actorEmail,
      })
      setDangerAction(null)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Scrap failed')
    }
    setBusy(false)
  }

  /** Soft-delete via archived_at. Item disappears from default lists
   *  but the row stays in the DB so an admin can recover by clearing
   *  archived_at via SQL. No hard DELETE. */
  async function handleDelete() {
    if (mode !== 'edit' || !existing) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('inventory_items')
        .update({ archived_at: new Date().toISOString(), updated_by: actorId })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
      await logAudit({
        brand: existing.brand,
        entity_type: 'inventory_item',
        entity_id: existing.id,
        action: 'archived',
        before: { archived_at: null },
        after:  { archived_at: 'now' },
        actor_id: actorId, actor_email: actorEmail,
      })
      setDangerAction(null)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Delete failed')
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Section title="Acquisition + status">
        <Row>
          <Field label="Vendor"><Select value={vendor_id} onChange={setVendor}>
            <option value="">— none —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
          </Select></Field>
          <Field label="Vendor stock #">
            <input type="text" value={vendor_stock_number} onChange={e => setVendorStock(e.target.value)} placeholder="Vendor's SKU" />
          </Field>
          <Field label="Vendor invoice #">
            <input type="text" value={vendor_invoice_number} onChange={e => setVendorInvoice(e.target.value)} placeholder="From vendor's invoice" />
          </Field>
          <Field label="Memo In">
            {/* True ⇒ item is on memo *into* the company (loaned by a
                vendor). Label trimmed so the checkbox fits on one line
                inside the standard 4-col Row grid — the field label
                already says MEMO IN so the inline copy doesn't need
                to re-explain. */}
            <div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingTop: 4 }}>
              <Checkbox checked={memo_in} onChange={setMemoIn} label="On memo from vendor" />
            </div>
          </Field>
          <Field label="Location">
            <LocationPicker
              value={location_id}
              locations={locations}
              brand={brand}
              onChange={setLocation}
              onAdded={(loc) => {
                // Push the new location into the parent's list so it
                // shows up immediately. Parent reloads in the background
                // via reloadRef but this avoids the race.
                ;(locations as InventoryLocation[]).push(loc)
                setLocation(loc.id)
              }}
            />
          </Field>
          <Field label="Status"><Select value={status} onChange={(v) => setStatus(v as InventoryStatus)}>
            <option value="in_stock">In Stock</option>
            <option value="on_hold">On Hold</option>
            <option value="in_repair">In Repair</option>
            <option value="consigned_out">Consigned Out</option>
          </Select></Field>
          <Field label="Category">
            <Select value={category || ''} onChange={(v) => setCategoryState((v || null) as InventoryCategory | null)}>
              <option value="">— uncategorized —</option>
              <option value="jewelry">Jewelry</option>
              <option value="watch">Watch</option>
              <option value="diamond">Diamond</option>
            </Select>
          </Field>
          <Field label="Gender"><Select value={gender} onChange={(v) => setGender(v as any)}>
            <option value="">—</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Unisex">Unisex</option>
          </Select></Field>
        </Row>
      </Section>

      <Section title="Pricing">
        <Row>
          <Field label="Cost ($)">
            <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} />
          </Field>
          <Field label={`Wholesale ($)${wholesaleMargin != null ? ` · ${wholesaleMargin.toFixed(0)}% margin` : ''}`} warn={wholesaleBelowCost}>
            <input type="number" step="0.01" value={wholesale} onChange={e => setWholesale(e.target.value)} />
            {wholesaleBelowCost && <Hint>⚠ Below cost</Hint>}
          </Field>
          <Field label={`Retail ($)${retailMargin != null ? ` · ${retailMargin.toFixed(0)}% margin` : ''}`} warn={retailBelowCost}>
            <input type="number" step="0.01" value={retail} onChange={e => setRetail(e.target.value)} />
            {retailBelowCost && <Hint>⚠ Below cost</Hint>}
          </Field>
          <Field label={`Edge ($)${edgeMargin != null ? ` · ${edgeMargin.toFixed(0)}% margin` : ''}`} warn={edgeBelowCost}>
            <input type="number" step="0.01" value={edge} onChange={e => setEdge(e.target.value)}
              placeholder="(blank = not for Edge)" />
            {edgeBelowCost && <Hint>⚠ Below cost</Hint>}
            {!edgeBelowCost && edge.trim() !== '' && (
              <div style={{ fontSize: 11, color: '#1D6B44', marginTop: 4 }}>Ready to send to The Edge</div>
            )}
          </Field>
          <Field label="Insurance value ($)">
            <input type="number" step="0.01" value={insurance} onChange={e => setInsurance(e.target.value)} />
          </Field>
        </Row>
      </Section>

      {category === 'jewelry' && (
        <Section title="Jewelry specifics">
          <Row>
            <Field label="Type"><DropdownSelect value={jewelry_type} options={lists.jewelry_type || []} onChange={setJewType} /></Field>
            <Field label="Metal type"><DropdownSelect value={metal_type} options={lists.metal_type || []} onChange={setMetalType} /></Field>
            <Field label="Metal color"><DropdownSelect value={metal_color} options={lists.metal_color || []} onChange={setMetalColor} /></Field>
            <Field label="Karat"><DropdownSelect value={metal_karat} options={lists.metal_karat || []} onChange={setKarat} /></Field>
            <Field label="DWT"><input type="number" step="0.01" value={metal_dwt} onChange={e => setDwt(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Period / era"><DropdownSelect value={j_period} options={lists.period_era || []} onChange={setJPeriod} /></Field>
            <Field label="Size"><input type="text" value={j_size} onChange={e => setJSize(e.target.value)} /></Field>
            <Field label="Length"><input type="text" value={j_length} onChange={e => setJLength(e.target.value)} /></Field>
            <Field label="Designer / maker"><input type="text" value={j_designer} onChange={e => setJDesigner(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Hallmarks"><input type="text" value={j_hallmarks} onChange={e => setJHallmarks(e.target.value)} /></Field>
          </Row>
          <StonesEditor
            stones={stones}
            onChange={setStones}
            stoneTypeOptions={lists.stone_type || []}
            shapeOptions={lists.diamond_shape || []}
            brand={brand}
            disabled={!stonesLoaded}
          />
        </Section>
      )}

      {category === 'watch' && (
        <Section title="Watch specifics">
          <Row>
            <Field label="Brand"><DropdownSelect value={watch_brand} options={lists.watch_brand || []} onChange={setWBrand} /></Field>
            <Field label="Model"><input type="text" value={watch_model} onChange={e => setWModel(e.target.value)} /></Field>
            <Field label="Serial #"><input type="text" value={watch_serial} onChange={e => setWSerial(e.target.value)} /></Field>
            <Field label="Year"><input type="number" value={watch_year} onChange={e => setWYear(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Movement"><DropdownSelect value={watch_movement} options={lists.watch_movement || []} onChange={setWMovement} /></Field>
            <Field label="Band"><DropdownSelect value={watch_band} options={lists.watch_band_style || []} onChange={setWBand} /></Field>
            <Field label="Case material"><DropdownSelect value={watch_case_mat} options={lists.watch_case_material || []} onChange={setWCaseMat} /></Field>
            <Field label="Case size (mm)"><input type="number" step="0.1" value={watch_case_size} onChange={e => setWCaseSize(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Dial color"><input type="text" value={watch_dial} onChange={e => setWDial(e.target.value)} /></Field>
            <Field label="Condition"><DropdownSelect value={watch_condition} options={lists.watch_condition || []} onChange={setWCondition} /></Field>
            <Field label="Box & papers"><Select value={watch_box} onChange={(v) => setWBox(v as any)}>
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="partial">Partial</option>
              <option value="no">No</option>
            </Select></Field>
            <Field label="Complications (comma-sep)">
              <input type="text" value={watch_complications} onChange={e => setWComp(e.target.value)} placeholder="Chronograph, GMT, Date" />
            </Field>
          </Row>
        </Section>
      )}

      {category === 'diamond' && (
        <Section title="Diamond specifics">
          <Row>
            <Field label="Lab"><Select value={d_lab} onChange={(v) => setDLab(v as DiamondLabType)}>
              <option value="">—</option>
              <option value="GIA">GIA</option>
              <option value="AGS">AGS</option>
              <option value="IGI">IGI</option>
              <option value="GCAL">GCAL</option>
              <option value="EGL">EGL</option>
              <option value="None">None</option>
            </Select></Field>
            <Field label="Report #">
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={d_report} onChange={e => setDReport(e.target.value)} style={{ flex: 1 }} />
                <button type="button" onClick={rapnetLookup} disabled={rapnetLoading || !d_report} className="btn-outline btn-xs">
                  {rapnetLoading ? '…' : 'Lookup'}
                </button>
              </div>
            </Field>
            <Field label="Shape"><DropdownSelect value={d_shape} options={lists.diamond_shape || []} onChange={setDShape} /></Field>
            <Field label="Carat"><input type="number" step="0.001" value={d_carat} onChange={e => setDCarat(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Color"><input type="text" value={d_color} onChange={e => setDColor(e.target.value)} placeholder="D-Z" /></Field>
            <Field label="Clarity"><input type="text" value={d_clarity} onChange={e => setDClarity(e.target.value)} placeholder="VVS1, SI2, …" /></Field>
            <Field label="Cut"><input type="text" value={d_cut} onChange={e => setDCut(e.target.value)} placeholder="Excellent, …" /></Field>
            <Field label="Polish"><input type="text" value={d_polish} onChange={e => setDPolish(e.target.value)} /></Field>
            <Field label="Symmetry"><input type="text" value={d_symmetry} onChange={e => setDSymmetry(e.target.value)} /></Field>
          </Row>
          <Row>
            <Field label="Fluorescence"><input type="text" value={d_fluor} onChange={e => setDFluor(e.target.value)} /></Field>
            <Field label="Measurements"><input type="text" value={d_meas} onChange={e => setDMeas(e.target.value)} placeholder="6.50 x 6.45 x 4.00 mm" /></Field>
            <Field label="Depth %"><input type="number" step="0.01" value={d_depth} onChange={e => setDDepth(e.target.value)} /></Field>
            <Field label="Table %"><input type="number" step="0.01" value={d_table} onChange={e => setDTable(e.target.value)} /></Field>
          </Row>
        </Section>
      )}

      <Section title="Item Description">
        <Field label="Public description (appears on memos/invoices/appraisals)">
          <textarea rows={2} value={public_notes} onChange={e => setPublic(e.target.value)} style={{ width: '100%' }} />
          {category === 'jewelry' && (
            <button type="button" onClick={() => setPublic(autoJewelryDescription({
              karat: metal_karat, color: metal_color, metal: metal_type,
              period: j_period, type: jewelry_type,
              stones: stones.map(s => ({
                stone_type: s.stone_type,
                count:      s.count,
                total_ct:   s.total_ct,
                sort_order: s.sort_order,
              })),
              dwt: metal_dwt, designer: j_designer, length: j_length,
              size: j_size, hallmarks: j_hallmarks,
            }))}
              className="btn-outline btn-xs" style={{ marginTop: 4 }}
              title="Build the description from the fields above (karat, color, metal, period, type, stones, dwt, designer, length, size, hallmarks). Blank fields are skipped. Diamond entries render first."
            >✨ Auto-fill from fields</button>
          )}
        </Field>
        <Field label="Internal notes (never on customer-facing docs)">
          <textarea rows={2} value={internal_notes} onChange={e => setInternal(e.target.value)} style={{ width: '100%' }} />
        </Field>
      </Section>

      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}

      {/* Danger zone — edit-only. Two destructive actions, both
          gated behind a confirm panel that opens inline above the
          save/cancel buttons. */}
      {mode === 'edit' && existing && (
        <div style={{
          marginTop: 8, padding: 12,
          border: '1px dashed #FCA5A5',
          background: '#FEF2F2',
          borderRadius: 8,
        }}>
          {dangerAction === null && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#991B1B' }}>Danger zone</div>
                <div style={{ fontSize: 11, color: '#7F1D1D', marginTop: 2 }}>
                  Scrap = item destroyed / written-off (kept in lists with a tag).
                  Delete = removed from views (recoverable by admin).
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setScrapReason(''); setErr(null); setDangerAction('scrap') }}
                  className="btn-outline btn-sm" style={{ color: '#92400E', borderColor: '#FCD34D' }}>
                  Mark as scrapped
                </button>
                <button onClick={() => { setErr(null); setDangerAction('delete') }}
                  className="btn-outline btn-sm" style={{ color: '#991B1B', borderColor: '#FCA5A5' }}>
                  Delete item
                </button>
              </div>
            </div>
          )}

          {dangerAction === 'scrap' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#92400E' }}>Mark this item as scrapped?</div>
              <div style={{ fontSize: 11, color: '#7F1D1D' }}>
                The item stays visible with a scrapped pill. Cost is preserved for accounting.
                It&apos;s excluded from in-stock counts and sellable filters (Edge, memos, invoices) automatically.
                A reason note is required.
              </div>
              <textarea
                rows={2}
                value={scrapReason}
                onChange={e => setScrapReason(e.target.value)}
                placeholder="e.g. Stone fell out during cleaning; ring destroyed."
                style={{ width: '100%', fontSize: 13, padding: 6 }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setDangerAction(null)} className="btn-outline btn-sm" disabled={busy}>Cancel</button>
                <button onClick={handleScrap} disabled={busy || !scrapReason.trim()} className="btn-primary btn-sm"
                  style={{ background: '#92400E' }}>
                  {busy ? 'Saving…' : 'Confirm scrap'}
                </button>
              </div>
            </div>
          )}

          {dangerAction === 'delete' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#991B1B' }}>Delete this item?</div>
              <div style={{ fontSize: 11, color: '#7F1D1D' }}>
                The item disappears from every default view. It&apos;s not hard-deleted —
                an admin can clear <code>archived_at</code> via SQL if you change your mind.
                If the item is real but destroyed, use <strong>Scrap</strong> instead so the
                accounting history stays attached.
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setDangerAction(null)} className="btn-outline btn-sm" disabled={busy}>Cancel</button>
                <button onClick={handleDelete} disabled={busy} className="btn-primary btn-sm"
                  style={{ background: '#991B1B' }}>
                  {busy ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-primary btn-sm">
          {busy ? 'Saving…' : (mode === 'new' ? 'Create item' : 'Save')}
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────── photos panel ─────────────────────── */

function PhotosPanel({
  itemId, brand, photos, actorId, actorEmail, onChanged,
}: {
  itemId: string
  brand: string
  photos: (InventoryPhoto & { url?: string })[]
  actorId: string | null
  actorEmail: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function upload(files: FileList) {
    setBusy(true); setErr(null)
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${brand}/${itemId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
          cacheControl: '3600', upsert: false,
        })
        if (upErr) throw new Error(upErr.message)
        const { error: insErr } = await supabase.from('inventory_photos').insert({
          brand, item_id: itemId, storage_path: path,
          is_primary: photos.length === 0,
          uploaded_by: actorId,
        })
        if (insErr) throw new Error(insErr.message)
      }
      await logAudit({
        brand, entity_type: 'inventory_item', entity_id: itemId,
        action: 'photo_uploaded', after: { count: files.length },
        actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Upload failed') }
    setBusy(false)
  }
  async function setPrimary(photoId: string) {
    setBusy(true); setErr(null)
    try {
      // Unset others, then set this one. Two statements because partial
      // unique index on is_primary blocks a same-tx flip.
      await supabase.from('inventory_photos').update({ is_primary: false })
        .eq('item_id', itemId).neq('id', photoId)
      await supabase.from('inventory_photos').update({ is_primary: true }).eq('id', photoId)
      await logAudit({
        brand, entity_type: 'inventory_item', entity_id: itemId,
        action: 'photo_set_primary', actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }
  async function remove(photo: InventoryPhoto) {
    if (!confirm('Delete this photo?')) return
    setBusy(true); setErr(null)
    try {
      await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path])
      await supabase.from('inventory_photos').delete().eq('id', photo.id)
      await logAudit({
        brand, entity_type: 'inventory_item', entity_id: itemId,
        action: 'photo_deleted', actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <label className="btn-primary btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
          {busy ? 'Uploading…' : '+ Upload photos'}
          <input type="file" accept="image/*" multiple disabled={busy}
            onChange={e => { const f = e.target.files; if (f && f.length > 0) void upload(f); e.currentTarget.value = '' }}
            style={{ display: 'none' }} />
        </label>
      </div>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {photos.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>No photos yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: 'relative', border: p.is_primary ? '2px solid var(--green)' : '1px solid var(--pearl)', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
              {p.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
              )}
              <div style={{ display: 'flex', gap: 4, padding: 4, justifyContent: 'space-between', alignItems: 'center' }}>
                {p.is_primary
                  ? <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 800 }}>★ PRIMARY</span>
                  : <button onClick={() => setPrimary(p.id)} disabled={busy} className="btn-outline btn-xs">Make primary</button>
                }
                <button onClick={() => remove(p)} disabled={busy} title="Delete"
                  style={{ background: 'transparent', border: 'none', color: 'var(--mist)', cursor: 'pointer' }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────── docs panel ─────────────────────── */

function DocsPanel({
  itemId, brand, docs, actorId, actorEmail, onChanged,
}: {
  itemId: string
  brand: string
  docs: (InventoryDocument & { url?: string })[]
  actorId: string | null
  actorEmail: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [docType, setDocType] = useState('lab_report')
  async function upload(files: FileList) {
    setBusy(true); setErr(null)
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop() || 'pdf'
        const path = `${brand}/${itemId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, file, {
          cacheControl: '3600', upsert: false,
        })
        if (upErr) throw new Error(upErr.message)
        const { error: insErr } = await supabase.from('inventory_documents').insert({
          brand, item_id: itemId, storage_path: path, filename: file.name, doc_type: docType,
          uploaded_by: actorId,
        })
        if (insErr) throw new Error(insErr.message)
      }
      await logAudit({
        brand, entity_type: 'inventory_item', entity_id: itemId,
        action: 'document_uploaded', after: { count: files.length, doc_type: docType },
        actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Upload failed') }
    setBusy(false)
  }
  async function remove(d: InventoryDocument) {
    if (!confirm(`Delete document "${d.filename || d.storage_path}"?`)) return
    setBusy(true); setErr(null)
    try {
      await supabase.storage.from(DOC_BUCKET).remove([d.storage_path])
      await supabase.from('inventory_documents').delete().eq('id', d.id)
      await logAudit({
        brand, entity_type: 'inventory_item', entity_id: itemId,
        action: 'document_deleted', actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
    } catch (e: any) { setErr(e?.message || 'Failed') }
    setBusy(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: 'var(--mist)' }}>Type</label>
        <Select value={docType} onChange={setDocType}>
          <option value="lab_report">Lab report</option>
          <option value="receipt">Receipt</option>
          <option value="provenance">Provenance</option>
          <option value="other">Other</option>
        </Select>
        <label className="btn-primary btn-sm" style={{ cursor: 'pointer' }}>
          {busy ? 'Uploading…' : '+ Upload document'}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" multiple disabled={busy}
            onChange={e => { const f = e.target.files; if (f && f.length > 0) void upload(f); e.currentTarget.value = '' }}
            style={{ display: 'none' }} />
        </label>
      </div>
      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {docs.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>No documents.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                <td style={{ padding: 6, color: 'var(--mist)', whiteSpace: 'nowrap' }}>{d.doc_type || '—'}</td>
                <td style={{ padding: 6 }}>{d.filename || d.storage_path}</td>
                <td style={{ padding: 6, color: 'var(--mist)' }}>{fmtDate(d.created_at)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="btn-outline btn-xs" style={{ marginRight: 4 }}>Open</a>}
                  <button onClick={() => remove(d)} disabled={busy} className="btn-outline btn-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ─────────────────────── audit timeline ─────────────────────── */

function AuditTimeline({ entries }: { entries: WholesaleAuditLogEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>No history yet.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(e => (
        <div key={e.id} style={{ display: 'flex', gap: 8, padding: 8, borderTop: '1px solid var(--pearl)' }}>
          <div style={{ minWidth: 150, color: 'var(--mist)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <EntityBadge entityType={e.entity_type} />
              <div style={{ fontWeight: 700 }}>{prettyAction(e.action)}</div>
            </div>
            {e.actor_email && <div style={{ fontSize: 11, color: 'var(--mist)' }}>by {e.actor_email}</div>}
            {renderDiff(e.before, e.after)}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Small pill that tells you which entity this audit row came from. We
 *  surface this because the timeline is now cross-entity — without the
 *  badge a generic "Created" or "Status changed" row is ambiguous
 *  (which memo? which invoice? a photo upload?). Colour-coded loosely
 *  by domain so the eye can scan a busy item. */
function EntityBadge({ entityType }: { entityType: string }) {
  const { label, bg, fg } = ENTITY_BADGE[entityType] || { label: entityType, bg: '#E5E7EB', fg: '#374151' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4, background: bg, color: fg, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

const ENTITY_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  inventory_item:            { label: 'Item',         bg: '#E0F2FE', fg: '#075985' },
  inventory_photo:           { label: 'Photo',        bg: '#FEF3C7', fg: '#92400E' },
  inventory_document:        { label: 'Document',     bg: '#FEF3C7', fg: '#92400E' },
  wholesale_memo:            { label: 'Memo',         bg: '#EDE9FE', fg: '#5B21B6' },
  wholesale_memo_line:       { label: 'Memo line',    bg: '#EDE9FE', fg: '#5B21B6' },
  wholesale_invoice:         { label: 'Invoice',      bg: '#DCFCE7', fg: '#166534' },
  wholesale_invoice_line:    { label: 'Invoice line', bg: '#DCFCE7', fg: '#166534' },
  wholesale_invoice_payment: { label: 'Payment',      bg: '#DCFCE7', fg: '#166534' },
}

function prettyAction(action: string): string {
  const map: Record<string, string> = {
    created: 'Created',
    updated: 'Updated',
    deleted: 'Deleted',
    archived: 'Archived',
    unarchived: 'Unarchived',
    status_changed: 'Status changed',
    cost_edited: 'Cost edited',
    memo_converted: 'Converted to invoice',
    scrapped: 'Scrapped',
    document_uploaded: 'Document uploaded',
    document_deleted: 'Document deleted',
    photo_uploaded: 'Photo uploaded',
    photo_deleted: 'Photo deleted',
    photo_set_primary: 'Primary photo set',
    payment_added: 'Payment added',
    payment_voided: 'Payment voided',
    tradein_created: 'Trade-in added',
  }
  return map[action] || action.replace(/_/g, ' ')
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  gender: 'Gender',
  cost_cents: 'Cost',
  wholesale_price_cents: 'Wholesale',
  retail_price_cents: 'Retail',
  edge_price_cents: 'Edge price',
  insurance_value_cents: 'Insurance value',
  public_notes: 'Public notes',
  internal_notes: 'Internal notes',
  vendor_id: 'Vendor',
  vendor_stock_number: 'Vendor stock #',
  vendor_invoice_number: 'Vendor invoice #',
  memo_in: 'Memo In',
  address: 'Address',
  billing_address: 'Billing address',
  shipping_address: 'Shipping address',
  location_id: 'Location',
  date_acquired: 'Date stocked',
  hold_for_customer_id: 'Held for',
  hold_expires_at: 'Hold expires',
  memo_id: 'Memo',
  invoice_id: 'Invoice',
  item_id: 'Item',
  customer_id: 'Customer',
  amount: 'Amount',
  count: 'Count',
  doc_type: 'Document type',
  line_count: 'Lines',
  invoice_number: 'Invoice #',
  memo_number: 'Memo #',
  item_number: 'Item #',
  category: 'Category',
  description: 'Description',
  method: 'Method',
  paid_on: 'Paid on',
  list_key: 'List',
  value: 'Value',
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtFieldValue(key: string, value: any): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'string' && /_cents$/.test(key)) return value
  if (typeof value === 'number' && key.endsWith('_cents')) {
    return '$' + (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderDiff(before: any, after: any): React.ReactNode {
  if (!before && !after) return null
  // status_changed and similar with before+after for the same fields → "X → Y"
  if (before && after) {
    const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]))
    const lines = keys.map(k => {
      const b = fmtFieldValue(k, before?.[k])
      const a = fmtFieldValue(k, after?.[k])
      if (b === a) return null
      return `${fieldLabel(k)}: ${b} → ${a}`
    }).filter(Boolean) as string[]
    if (lines.length === 0) return null
    return (
      <ul style={{ fontSize: 11, color: 'var(--ash)', margin: '4px 0 0', paddingLeft: 16 }}>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    )
  }
  // Only one side present (created / deleted style entries).
  const obj = after || before
  const isAfter = !!after
  const lines = Object.keys(obj || {}).map(k => `${fieldLabel(k)}: ${fmtFieldValue(k, obj[k])}`)
  if (lines.length === 0) return null
  return (
    <ul style={{ fontSize: 11, color: 'var(--ash)', margin: '4px 0 0', paddingLeft: 16 }}>
      {lines.map((l, i) => <li key={i}>{isAfter ? l : `(was) ${l}`}</li>)}
    </ul>
  )
}

/* ─────────────────────── sortable table header ─────────────────────── */
// Renders one <th>. If `field` is omitted, it's a plain non-clickable
// header (used for image / category / description / status / action
// columns where no canonical sort order makes sense). If `field` is
// given, the header becomes a button that calls onClick(field) and
// shows ▴ / ▾ when its field is the active sort.
type SortField = 'item_number' | 'cost_cents' | 'wholesale_price_cents' | 'retail_price_cents'
function SortableTh({
  label, field, sort, onClick, align,
}: {
  label: string
  field?: SortField
  sort?: { field: SortField; dir: 'asc' | 'desc' } | null
  onClick?: (f: SortField) => void
  align?: 'left' | 'right'
}) {
  const base: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: align === 'right' ? 'right' : 'left',
    fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '.04em', color: 'var(--mist)',
  }
  if (!field) return <th style={base}>{label}</th>
  const active = sort && sort.field === field
  const arrow = active ? (sort!.dir === 'asc' ? ' ▴' : ' ▾') : ''
  return (
    <th style={{ ...base, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: active ? 'var(--ink)' : 'var(--mist)' }}
      onClick={() => onClick?.(field)}
      title="Click to sort">
      {label}{arrow}
    </th>
  )
}

/* ─────────────────────── shared form bits ─────────────────────── */

export function Modal({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: wide ? 980 : 720, width: '100%', maxHeight: '92vh', overflow: 'auto', padding: 20, fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--mist)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: '1px solid var(--pearl)', borderRadius: 8, padding: 10 }}>
      <legend style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '0 6px' }}>{title}</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </fieldset>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>{children}</div>
}

export function Field({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="fl" style={{ color: warn ? '#92400E' : undefined }}>{label}</label>
      {children}
    </div>
  )
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#92400E', marginTop: 2 }}>{children}</div>
}

export function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  // Inherits globals.css default sizing so it lines up with sibling
  // <input> elements in the same row (was overriding padding/border
  // and rendering ~10px shorter).
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {children}
    </select>
  )
}

/** Location dropdown with an inline "+ Add new…" option. Prompts for
 *  a name, inserts into inventory_locations, then sets the new id as
 *  the selected value. Avoids a context-switch to the Admin Lists tab
 *  for the common case of adding a vault / safe / drawer on the fly. */
export function LocationPicker({
  value, locations, brand, onChange, onAdded,
}: {
  value: string
  locations: InventoryLocation[]
  brand: string
  onChange: (v: string) => void
  onAdded: (loc: InventoryLocation) => void
}) {
  async function handleSelect(v: string) {
    if (v !== '__new__') { onChange(v); return }
    const name = window.prompt('New location name (e.g., Vault A, Showcase 3)')
    if (!name || !name.trim()) return
    const sortOrder = (locations[locations.length - 1]?.sort_order ?? 0) + 1
    const { data, error } = await supabase.from('inventory_locations')
      .insert({ brand, name: name.trim(), sort_order: sortOrder, active: true })
      .select('*').single()
    if (error) { alert(`Could not add location: ${error.message}`); return }
    onAdded(data as InventoryLocation)
  }
  return (
    <Select value={value} onChange={handleSelect}>
      <option value="">— none —</option>
      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      <option value="__new__">+ Add new location…</option>
    </Select>
  )
}

export function DropdownSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  // Options come from admin lists (active only). Allow free-text override
  // for one-off values that haven't made it into the list yet.
  return (
    <Select value={value} onChange={onChange}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (custom)</option>}
    </Select>
  )
}

/* ──────────────────────── stones editor ───────────────────────── */

type StoneDraft = {
  id: string | null
  stone_type: string
  shape: string
  count: string
  total_ct: string
  sort_order: number
}

/** Multi-stone editor for the jewelry item form. Starts empty —
 *  user clicks "+ Add stone", picks a type from the managed
 *  stone_type list (or "+ Add new…" to extend that list), and
 *  Shape / Count / Carat tw fields appear inline for that row.
 *  Saves are coordinated by the parent (see the sync block in
 *  the save() handler of ItemForm); this component only edits
 *  the draft array. */
function StonesEditor({
  stones, onChange, stoneTypeOptions, shapeOptions, brand, disabled,
}: {
  stones: StoneDraft[]
  onChange: (next: StoneDraft[]) => void
  stoneTypeOptions: string[]
  shapeOptions: string[]
  brand: string
  disabled?: boolean
}) {
  // Inline picker visibility for the "+ Add stone" affordance. The
  // picker is just a dropdown with the seeded list + "+ Add new…"
  // at the bottom; selecting it prompts for a custom type name and
  // INSERTs into wholesale_admin_lists so other items see it too.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  async function addStone(type: string) {
    onChange([
      ...stones,
      {
        id: null,
        stone_type: type,
        shape: '',
        count: '',
        total_ct: '',
        sort_order: stones.length,
      },
    ])
    setPickerOpen(false)
  }

  async function promptAddNewType() {
    const raw = window.prompt('New stone type (e.g. Topaz, Opal, Tanzanite)')
    if (!raw) { setPickerOpen(false); return }
    const value = raw.trim()
    if (!value) { setPickerOpen(false); return }
    setAdding(true)
    try {
      // Persist to the managed list so future items see it. Idempotent
      // via the unique index (brand, list_key, value) — ON CONFLICT
      // DO NOTHING semantics via upsert with ignoreDuplicates.
      const { error } = await supabase
        .from('wholesale_admin_lists')
        .upsert(
          { brand, list_key: 'stone_type', value, active: true, sort_order: 999 },
          { onConflict: 'brand,list_key,value', ignoreDuplicates: true },
        )
      if (error) {
        // Don't block the add — fall through and stage the stone on
        // this item even if the list write failed. Most likely cause
        // is RLS; the user can fix permissions and the value still
        // appears on this item.
        // eslint-disable-next-line no-console
        console.warn('stone_type list insert failed:', error.message)
      }
      await addStone(value)
    } finally {
      setAdding(false)
    }
  }

  function patchStone(idx: number, patch: Partial<StoneDraft>) {
    onChange(stones.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  function removeStone(idx: number) {
    onChange(stones.filter((_, i) => i !== idx))
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Stones
        </div>
        <div style={{ flex: 1 }} />
        {!pickerOpen && (
          <button type="button" className="btn-outline btn-xs"
            disabled={disabled || adding}
            onClick={() => setPickerOpen(true)}>
            + Add stone
          </button>
        )}
        {pickerOpen && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Select
              value=""
              onChange={(v) => {
                if (v === '__add_new__') {
                  void promptAddNewType()
                } else if (v) {
                  void addStone(v)
                }
              }}
            >
              <option value="">— pick stone —</option>
              {stoneTypeOptions.map(o => <option key={o} value={o}>{o}</option>)}
              <option value="__add_new__">+ Add new…</option>
            </Select>
            <button type="button" className="btn-outline btn-xs"
              onClick={() => setPickerOpen(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {stones.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
          No stones. Click "+ Add stone" if this piece has any.
        </div>
      )}

      {stones.map((s, idx) => (
        <div key={s.id || `new-${idx}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 80px 100px 28px',
            gap: 6, alignItems: 'center', marginBottom: 6,
          }}>
          {/* Stone type — read-only label once added; to change type
              the user removes and re-adds. Keeps the picker simple. */}
          <div style={{
            padding: '6px 8px', background: 'var(--cream2)',
            border: '1px solid var(--pearl)', borderRadius: 4,
            fontSize: 13, fontWeight: 600,
          }}>
            {s.stone_type}
          </div>
          <DropdownSelect
            value={s.shape}
            options={shapeOptions}
            onChange={(v) => patchStone(idx, { shape: v })}
          />
          <input
            type="number" min={0} step={1}
            value={s.count}
            placeholder="Count"
            onChange={(e) => patchStone(idx, { count: e.target.value })}
          />
          <input
            type="number" min={0} step={0.001}
            value={s.total_ct}
            placeholder="ct tw"
            onChange={(e) => patchStone(idx, { total_ct: e.target.value })}
          />
          <button type="button"
            title="Remove this stone"
            onClick={() => removeStone(idx)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--mist)',
              cursor: 'pointer', fontSize: 18, padding: 0,
            }}>×</button>
        </div>
      ))}
    </div>
  )
}
