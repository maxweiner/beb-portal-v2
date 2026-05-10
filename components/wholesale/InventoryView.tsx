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
  WholesaleAuditLogEntry,
} from '@/types/wholesale'
import { fmtMoneyCents, dollarsToCents, centsToDollarsString, fmtDate, marginPct } from '@/lib/wholesale/format'
import { nextWholesaleNumber, prefixForCategory } from '@/lib/wholesale/numbers'
import { logAudit, diffFields } from '@/lib/wholesale/audit'
import { loadAdminLists } from '@/lib/wholesale/lists'

const PHOTO_BUCKET = 'wholesale-photos'
const DOC_BUCKET = 'wholesale-documents'
const SIGNED_URL_TTL = 60 * 60 // 1h

const STATUS_LABEL: Record<InventoryStatus, string> = {
  in_stock: 'In Stock', on_memo: 'On Memo', on_hold: 'On Hold',
  sold: 'Sold', returned: 'Returned', in_repair: 'In Repair', consigned_out: 'Consigned',
}
const STATUS_COLOR: Record<InventoryStatus, { bg: string; fg: string }> = {
  in_stock:      { bg: '#D1FAE5', fg: '#065F46' },
  on_memo:       { bg: '#FEF3C7', fg: '#92400E' },
  on_hold:       { bg: '#E0E7FF', fg: '#3730A3' },
  sold:          { bg: '#DBEAFE', fg: '#1E40AF' },
  returned:      { bg: '#F3F4F6', fg: '#374151' },
  in_repair:     { bg: '#FEE2E2', fg: '#991B1B' },
  consigned_out: { bg: '#FEF3C7', fg: '#78716C' },
}
const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  jewelry: 'Jewelry', watch: 'Watch', diamond: 'Diamond',
}

const LIST_KEYS = [
  'jewelry_type','metal_type','metal_color','metal_karat','diamond_shape','period_era',
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
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
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
    return items.filter(i => {
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false
      if (statusFilter !== 'all' && i.status !== statusFilter) return false
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
  }, [items, search, categoryFilter, statusFilter])

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
        <button onClick={() => setShowNewModal(true)} className="btn-primary btn-sm">+ New Item</button>
      </div>

      <div className="card" style={{ marginBottom: 10, padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search item #, description, serial, report #, designer…"
          style={{ flex: '1 1 240px', maxWidth: 360, fontSize: 12, padding: '6px 10px' }} />
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
                  {['', 'Item #', 'Cat', 'Description', 'Cost', 'Wholesale', 'Retail', 'Status', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)' }}>{h}</th>
                  ))}
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
                            {it.category === 'jewelry' ? '💍' : it.category === 'watch' ? '⌚' : '💎'}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{it.item_number}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--mist)', whiteSpace: 'nowrap' }}>{CATEGORY_LABEL[it.category]}</td>
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
      const [itemRes, photosRes, docsRes, auditRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', itemId).maybeSingle(),
        supabase.from('inventory_photos').select('*').eq('item_id', itemId).order('sort_order'),
        supabase.from('inventory_documents').select('*').eq('item_id', itemId).order('created_at', { ascending: false }),
        supabase.from('wholesale_audit_log').select('*')
          .eq('entity_type', 'inventory_item').eq('entity_id', itemId)
          .order('created_at', { ascending: false }).limit(50),
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
      setAudit((auditRes.data || []) as WholesaleAuditLogEntry[])
    } catch (e: any) { setErr(e?.message || 'Load failed') }
  }
  useEffect(() => { void reload() }, [itemId])

  if (!item) {
    return <Modal onClose={onClose} title="Loading…"><div>Loading…</div></Modal>
  }

  return (
    <Modal onClose={onClose} title={`${item.item_number} — ${CATEGORY_LABEL[item.category]}`} wide>
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
      {tab === 'edit' && (
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
      )}
      {tab === 'photos' && (
        <PhotosPanel
          itemId={item.id} brand={brand} photos={photos} actorId={actorId}
          actorEmail={actorEmail} onChanged={() => { void reload(); onChanged() }}
        />
      )}
      {tab === 'docs' && (
        <DocsPanel
          itemId={item.id} brand={brand} docs={docs} actorId={actorId}
          actorEmail={actorEmail} onChanged={() => { void reload(); onChanged() }}
        />
      )}
      {tab === 'history' && (
        <AuditTimeline entries={audit} />
      )}
    </Modal>
  )
}

/** Build the public description from the jewelry-form fields.
 *  Order: karat color metal period type, {N} diamonds {ct} ct,
 *  {dwt} dwt, designer, length, size {size}, hallmarks. Blank
 *  fields (and their literal labels) are skipped entirely.
 *  Designed to be re-runnable: clicking the button overwrites the
 *  current public_notes field. */
export function autoJewelryDescription(f: {
  karat?: string; color?: string; metal?: string
  period?: string; type?: string
  diamond_count?: string; total_ct?: string
  dwt?: string; designer?: string
  length?: string; size?: string; hallmarks?: string
}): string {
  const trim = (s?: string) => (s || '').trim()
  const parts: string[] = []

  // First clause: karat / color / metal / period / type — space-joined
  const head = [trim(f.karat), trim(f.color), trim(f.metal), trim(f.period), trim(f.type)]
    .filter(Boolean).join(' ')
  if (head) parts.push(head)

  // Diamonds clause: "{N} Diamonds ~ {X} ct tw" — each piece optional
  const dPieces: string[] = []
  if (trim(f.diamond_count)) dPieces.push(`${trim(f.diamond_count)} Diamonds`)
  if (trim(f.total_ct))      dPieces.push(`${trim(f.total_ct)} ct tw`)
  if (dPieces.length > 0) parts.push(dPieces.join(' ~ '))

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
  category: InventoryCategory
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
  mode, category, existing, brand, vendors, locations, lists,
  actorId, actorEmail, onSaved, onCancel,
}: ItemFormProps) {
  // Prefill from existing if editing.
  const [vendor_id, setVendor]    = useState(existing?.vendor_id || '')
  const [vendor_stock_number, setVendorStock] = useState(existing?.vendor_stock_number || '')
  const [location_id, setLocation] = useState(existing?.location_id || '')
  // "Date stocked" is auto-set to today on creation; not user-editable.
  // Existing items keep whatever's in the column (could be backfilled
  // from a trade-in's invoice date or imported data).
  const date_stocked = existing?.date_acquired || new Date().toISOString().slice(0, 10)
  const [cost, setCost]           = useState(centsToDollarsString(existing?.cost_cents ?? null))
  const [wholesale, setWholesale] = useState(centsToDollarsString(existing?.wholesale_price_cents ?? null))
  const [retail, setRetail]       = useState(centsToDollarsString(existing?.retail_price_cents ?? null))
  const [insurance, setInsurance] = useState(centsToDollarsString(existing?.insurance_value_cents ?? null))
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
  const [d_count, setDCount]             = useState(existing?.jewelry_diamond_count != null ? String(existing.jewelry_diamond_count) : '')
  const [d_total, setDTotal]             = useState(existing?.jewelry_diamond_total_ct != null ? String(existing.jewelry_diamond_total_ct) : '')
  const [d_shape_jew, setDShapeJew]      = useState(existing?.jewelry_diamond_shape || '')
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

  const costCents = dollarsToCents(cost)
  const wholesaleCents = dollarsToCents(wholesale)
  const retailCents = dollarsToCents(retail)
  const wholesaleMargin = marginPct(costCents, wholesaleCents)
  const retailMargin    = marginPct(costCents, retailCents)
  const wholesaleBelowCost = costCents != null && wholesaleCents != null && wholesaleCents < costCents
  const retailBelowCost    = costCents != null && retailCents != null && retailCents < costCents

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
      const itemNumber = mode === 'new'
        ? await nextWholesaleNumber(brand, prefixForCategory(category))
        : existing!.item_number

      const payload: any = {
        brand, category, item_number: itemNumber, status,
        cost_cents: dollarsToCents(cost),
        wholesale_price_cents: dollarsToCents(wholesale),
        retail_price_cents: dollarsToCents(retail),
        insurance_value_cents: dollarsToCents(insurance),
        public_notes: public_notes.trim() || null,
        internal_notes: internal_notes.trim() || null,
        vendor_id: vendor_id || null,
        vendor_stock_number: vendor_stock_number.trim() || null,
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
          jewelry_diamond_count: d_count ? Number(d_count) : null,
          jewelry_diamond_total_ct: d_total ? Number(d_total) : null,
          jewelry_diamond_shape: d_shape_jew || null,
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

      if (mode === 'new') {
        payload.created_by = actorId
        payload.updated_by = actorId
        const { data, error } = await supabase.from('inventory_items').insert(payload).select('*').single()
        if (error) throw new Error(error.message)
        await logAudit({
          brand, entity_type: 'inventory_item', entity_id: (data as any).id,
          action: 'created', after: { item_number: itemNumber, category },
          actor_id: actorId, actor_email: actorEmail,
        })
      } else {
        payload.updated_by = actorId
        const { error } = await supabase.from('inventory_items').update(payload).eq('id', existing!.id)
        if (error) throw new Error(error.message)
        const tracked = [
          'status','gender','cost_cents','wholesale_price_cents','retail_price_cents','insurance_value_cents',
          'public_notes','internal_notes','vendor_id','vendor_stock_number','location_id','date_acquired',
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
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Save failed')
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
            <Field label="Diamond count"><input type="number" value={d_count} onChange={e => setDCount(e.target.value)} /></Field>
            <Field label="Total ct"><input type="number" step="0.001" value={d_total} onChange={e => setDTotal(e.target.value)} /></Field>
            <Field label="Diamond shape"><DropdownSelect value={d_shape_jew} options={lists.diamond_shape || []} onChange={setDShapeJew} /></Field>
            <Field label="Period / era"><DropdownSelect value={j_period} options={lists.period_era || []} onChange={setJPeriod} /></Field>
          </Row>
          <Row>
            <Field label="Size"><input type="text" value={j_size} onChange={e => setJSize(e.target.value)} /></Field>
            <Field label="Length"><input type="text" value={j_length} onChange={e => setJLength(e.target.value)} /></Field>
            <Field label="Designer / maker"><input type="text" value={j_designer} onChange={e => setJDesigner(e.target.value)} /></Field>
            <Field label="Hallmarks"><input type="text" value={j_hallmarks} onChange={e => setJHallmarks(e.target.value)} /></Field>
          </Row>
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
              diamond_count: d_count, total_ct: d_total,
              dwt: metal_dwt, designer: j_designer, length: j_length,
              size: j_size, hallmarks: j_hallmarks,
            }))}
              className="btn-outline btn-xs" style={{ marginTop: 4 }}
              title="Build the description from the fields above (karat, color, metal, period, type, diamonds, dwt, designer, length, size, hallmarks). Blank fields are skipped."
            >✨ Auto-fill from fields</button>
          )}
        </Field>
        <Field label="Internal notes (never on customer-facing docs)">
          <textarea rows={2} value={internal_notes} onChange={e => setInternal(e.target.value)} style={{ width: '100%' }} />
        </Field>
      </Section>

      {err && <div style={{ padding: 8, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>{err}</div>}

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
          <div style={{ minWidth: 110, color: 'var(--mist)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{prettyAction(e.action)}</div>
            {e.actor_email && <div style={{ fontSize: 11, color: 'var(--mist)' }}>by {e.actor_email}</div>}
            {renderDiff(e.before, e.after)}
          </div>
        </div>
      ))}
    </div>
  )
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
    document_uploaded: 'Document uploaded',
    document_deleted: 'Document deleted',
    photo_uploaded: 'Photo uploaded',
    photo_deleted: 'Photo deleted',
    photo_set_primary: 'Primary photo set',
    payment_added: 'Payment added',
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
  insurance_value_cents: 'Insurance value',
  public_notes: 'Public notes',
  internal_notes: 'Internal notes',
  vendor_id: 'Vendor',
  vendor_stock_number: 'Vendor stock #',
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
