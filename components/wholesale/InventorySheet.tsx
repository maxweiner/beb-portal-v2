'use client'

// Sheet view of inventory — fast triage with a column picker so you
// can show only what you need to see. Per-cell autosave; brand-keyed
// localStorage remembers your column selection across sessions.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type {
  InventoryItem, InventoryCategory, InventoryStatus,
  WholesaleVendor, InventoryLocation,
} from '@/types/wholesale'
import { fmtMoneyCents, fmtDate, dollarsToCents, centsToDollarsString, dollarsToWholeCents, centsToWholeDollarsString } from '@/lib/wholesale/format'
import { logAudit } from '@/lib/wholesale/audit'
import { loadAdminLists } from '@/lib/wholesale/lists'
import Checkbox from '@/components/ui/Checkbox'
import { Modal } from './InventoryView'

type RowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const STATUS_OPTIONS: { value: InventoryStatus; label: string }[] = [
  { value: 'in_stock',     label: 'In Stock' },
  { value: 'on_hold',      label: 'On Hold' },
  { value: 'on_memo',      label: 'On Memo' },
  { value: 'sold',         label: 'Sold' },
  { value: 'returned',     label: 'Returned' },
  { value: 'in_repair',    label: 'In Repair' },
  { value: 'consigned_out',label: 'Consigned' },
  { value: 'scrapped',     label: 'Scrapped' },
]

// Column registry. Each entry knows how to render a cell + how to
// patch the underlying inventory_items row when the cell changes.
type Patch = Partial<InventoryItem>
type RenderArgs = {
  item: InventoryItem
  save: (patch: Patch, isCostEdit?: boolean) => void
  vendors: WholesaleVendor[]
  locations: InventoryLocation[]
  lists: Record<string, string[]>
}

interface ColumnDef {
  id: string
  label: string
  group: 'core' | 'pricing' | 'jewelry' | 'watch' | 'diamond' | 'meta'
  defaultOn: boolean
  // Some columns are display-only (e.g. Item # is the canonical id; not editable here).
  render: (args: RenderArgs) => React.ReactNode
  width?: number
}

const ALL_COLUMNS: ColumnDef[] = [
  // CORE
  {
    id: 'item_number', label: 'Item #', group: 'core', defaultOn: true, width: 90,
    render: ({ item }) => <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{item.item_number}</span>,
  },
  {
    id: 'vendor_stock_number', label: 'Vendor stock #', group: 'core', defaultOn: true, width: 130,
    render: ({ item, save }) => (
      <input type="text" defaultValue={item.vendor_stock_number || ''}
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== (item.vendor_stock_number || null)) save({ vendor_stock_number: v as any })
        }}
        style={cellInput(120)} />
    ),
  },
  {
    id: 'vendor_invoice_number', label: 'Vendor invoice #', group: 'core', defaultOn: false, width: 140,
    render: ({ item, save }) => (
      <input type="text" defaultValue={item.vendor_invoice_number || ''}
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== (item.vendor_invoice_number || null)) save({ vendor_invoice_number: v as any })
        }}
        style={cellInput(130)} />
    ),
  },
  {
    // Memo-IN: item loaned to us by a vendor. Off by default; users
    // can flip it on from the column picker when reviewing consigned
    // stock. Uses the shared Checkbox component (raw inputs would
    // stretch full-width via globals.css and look broken in the cell).
    id: 'memo_in', label: 'Memo In', group: 'core', defaultOn: false, width: 80,
    render: ({ item, save }) => (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Checkbox
          checked={!!item.memo_in}
          size={16}
          onChange={(next) => save({ memo_in: next as any })}
        />
      </div>
    ),
  },
  {
    id: 'alternate_item_number', label: 'Alt #', group: 'core', defaultOn: false, width: 110,
    render: ({ item, save }) => (
      <input type="text" defaultValue={item.alternate_item_number || ''}
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== (item.alternate_item_number || null)) save({ alternate_item_number: v as any })
        }}
        style={cellInput(100)} />
    ),
  },
  {
    id: 'public_notes', label: 'Description', group: 'core', defaultOn: true, width: 280,
    render: ({ item, save }) => (
      <input type="text" defaultValue={item.public_notes || ''}
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== (item.public_notes || null)) save({ public_notes: v as any })
        }}
        style={{ ...cellInput(260), width: '100%' }} />
    ),
  },
  {
    id: 'category', label: 'Category', group: 'core', defaultOn: true, width: 110,
    render: ({ item, save }) => (
      <select value={item.category || ''} onChange={e => save({ category: (e.target.value || null) as any })}
        style={{
          ...cellInput(110),
          borderColor: item.category == null ? '#D97706' : 'var(--pearl)',
          background:  item.category == null ? '#FFFBEB' : '#fff',
        }}>
        <option value="">— pick —</option>
        <option value="jewelry">Jewelry</option>
        <option value="watch">Watch</option>
        <option value="diamond">Diamond</option>
      </select>
    ),
  },
  {
    id: 'status', label: 'Status', group: 'core', defaultOn: true, width: 110,
    render: ({ item, save }) => (
      <select value={item.status} onChange={e => save({ status: e.target.value as InventoryStatus })}
        style={cellInput(110)}>
        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    ),
  },
  {
    id: 'gender', label: 'Gender', group: 'core', defaultOn: false, width: 100,
    render: ({ item, save }) => (
      <select value={item.gender || ''} onChange={e => save({ gender: (e.target.value || null) as any })}
        style={cellInput(100)}>
        <option value="">—</option>
        <option value="Female">Female</option>
        <option value="Male">Male</option>
        <option value="Unisex">Unisex</option>
      </select>
    ),
  },
  {
    id: 'vendor_id', label: 'Vendor', group: 'core', defaultOn: false, width: 160,
    render: ({ item, save, vendors }) => (
      <select value={item.vendor_id || ''} onChange={e => save({ vendor_id: (e.target.value || null) as any })}
        style={cellInput(150)}>
        <option value="">— none —</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
      </select>
    ),
  },
  {
    id: 'location_id', label: 'Location', group: 'core', defaultOn: false, width: 140,
    render: ({ item, save, locations }) => (
      <select value={item.location_id || ''} onChange={e => save({ location_id: (e.target.value || null) as any })}
        style={cellInput(140)}>
        <option value="">— none —</option>
        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    ),
  },
  // PRICING
  {
    // Cost is whole dollars only — no cents — by spec (2026-05-15).
    // Uses centsToWholeDollarsString + dollarsToWholeCents so any
    // decimal the operator types in gets rounded on save.
    id: 'cost_cents', label: 'Cost ($)', group: 'pricing', defaultOn: true, width: 90,
    render: ({ item, save }) => (
      <input type="text" inputMode="numeric" defaultValue={centsToWholeDollarsString(item.cost_cents)}
        placeholder="—"
        onBlur={e => {
          const cents = e.target.value.trim() === '' ? null : dollarsToWholeCents(e.target.value)
          if (cents !== (item.cost_cents ?? null)) save({ cost_cents: cents as any }, true)
        }}
        style={{ ...cellInput(80), textAlign: 'right' }} />
    ),
  },
  {
    // Whole dollars only (2026-05-15) — see lib/wholesale/format.ts.
    id: 'wholesale_price_cents', label: 'Wholesale ($)', group: 'pricing', defaultOn: false, width: 100,
    render: ({ item, save }) => (
      <input type="text" inputMode="numeric" defaultValue={centsToWholeDollarsString(item.wholesale_price_cents)}
        placeholder="—"
        onBlur={e => {
          const cents = e.target.value.trim() === '' ? null : dollarsToWholeCents(e.target.value)
          if (cents !== (item.wholesale_price_cents ?? null)) save({ wholesale_price_cents: cents as any })
        }}
        style={{ ...cellInput(90), textAlign: 'right' }} />
    ),
  },
  {
    id: 'retail_price_cents', label: 'Retail ($)', group: 'pricing', defaultOn: true, width: 100,
    render: ({ item, save }) => (
      <input type="text" inputMode="numeric" defaultValue={centsToWholeDollarsString(item.retail_price_cents)}
        placeholder="—"
        onBlur={e => {
          const cents = e.target.value.trim() === '' ? null : dollarsToWholeCents(e.target.value)
          if (cents !== (item.retail_price_cents ?? null)) save({ retail_price_cents: cents as any })
        }}
        style={{ ...cellInput(90), textAlign: 'right' }} />
    ),
  },
  {
    // The Edge ask price — Liberty-only feature. Setting a value here
    // marks the item as ready to send via the Send-to-Edge view. NULL
    // means "not ready". Background tint flags items that would lose
    // money (Edge < cost) so the buyer catches accidental underprices.
    id: 'edge_price_cents', label: 'Edge ($)', group: 'pricing', defaultOn: true, width: 100,
    render: ({ item, save }) => {
      const cost = item.cost_cents ?? null
      const edge = item.edge_price_cents ?? null
      const tint =
        edge == null ? undefined
        : (cost != null && edge < cost) ? '#fee2e2'        // under cost — red
        : (cost != null && edge < cost * 1.1) ? '#fef3c7'  // thin margin — amber
        : '#dcfce7'                                         // healthy — green
      return (
        <input type="text" inputMode="numeric" defaultValue={centsToWholeDollarsString(item.edge_price_cents)}
          placeholder="—"
          onBlur={e => {
            const cents = e.target.value.trim() === '' ? null : dollarsToWholeCents(e.target.value)
            if (cents !== (item.edge_price_cents ?? null)) save({ edge_price_cents: cents as any })
          }}
          style={{ ...cellInput(90), textAlign: 'right', background: tint }} />
      )
    },
  },
  {
    id: 'insurance_value_cents', label: 'Insurance', group: 'pricing', defaultOn: false, width: 100,
    render: ({ item, save }) => (
      <input type="text" inputMode="decimal" defaultValue={centsToDollarsString(item.insurance_value_cents)}
        placeholder="—"
        onBlur={e => {
          const cents = e.target.value.trim() === '' ? null : dollarsToCents(e.target.value)
          if (cents !== (item.insurance_value_cents ?? null)) save({ insurance_value_cents: cents as any })
        }}
        style={{ ...cellInput(90), textAlign: 'right' }} />
    ),
  },
  // JEWELRY
  ...textCol('jewelry_metal_karat',     'Karat',         'jewelry', 80),
  ...textCol('jewelry_metal_type',      'Metal',         'jewelry', 90),
  ...textCol('jewelry_metal_color',     'Metal color',   'jewelry', 110),
  ...numCol ('jewelry_metal_dwt',       'DWT',           'jewelry', 80),
  // Note: stones for jewelry items now live in the inventory_item_stones
  // child table and can't be edited inline in this spreadsheet view.
  // Open the item's detail modal → Jewelry specifics → Stones section.
  ...textCol('jewelry_period',          'Period / era',  'jewelry', 120),
  ...textCol('jewelry_designer',        'Designer',      'jewelry', 130),
  ...textCol('jewelry_size',            'Size',          'jewelry', 80),
  ...textCol('jewelry_length',          'Length',        'jewelry', 90),
  ...textCol('jewelry_hallmarks',       'Hallmarks',     'jewelry', 130),
  // WATCH
  ...textCol('watch_brand',         'Watch brand',  'watch', 130),
  ...textCol('watch_model',         'Model',        'watch', 130),
  ...textCol('watch_serial_number', 'Serial #',     'watch', 130),
  ...numCol ('watch_year',          'Year',         'watch', 80),
  ...textCol('watch_condition',     'Condition',    'watch', 110),
  // DIAMOND
  ...textCol('diamond_lab_type',      'Lab',         'diamond', 80),
  ...textCol('diamond_report_number', 'Report #',    'diamond', 130),
  ...numCol ('diamond_carat',         'Carat',       'diamond', 80),
  ...textCol('diamond_color',         'Color',       'diamond', 80),
  ...textCol('diamond_clarity',       'Clarity',     'diamond', 90),
  // META
  {
    id: 'date_acquired', label: 'Stocked', group: 'meta', defaultOn: false, width: 110,
    render: ({ item }) => <span style={{ color: 'var(--mist)', whiteSpace: 'nowrap' }}>{fmtDate(item.date_acquired)}</span>,
  },
  ...textCol('internal_notes', 'Internal notes', 'meta', 220),
]

function textCol(id: keyof InventoryItem & string, label: string, group: ColumnDef['group'], width: number): ColumnDef[] {
  return [{
    id, label, group, defaultOn: false, width,
    render: ({ item, save }) => (
      <input type="text" defaultValue={(item as any)[id] || ''}
        onBlur={e => {
          const v = e.target.value.trim() || null
          if (v !== ((item as any)[id] || null)) save({ [id]: v } as any)
        }}
        style={cellInput(width - 16)} />
    ),
  }]
}
function numCol(id: keyof InventoryItem & string, label: string, group: ColumnDef['group'], width: number): ColumnDef[] {
  return [{
    id, label, group, defaultOn: false, width,
    render: ({ item, save }) => (
      <input type="text" inputMode="decimal" defaultValue={(item as any)[id] != null ? String((item as any)[id]) : ''}
        onBlur={e => {
          const raw = e.target.value.trim()
          const v = raw === '' ? null : Number(raw)
          if (v !== ((item as any)[id] ?? null)) save({ [id]: v } as any)
        }}
        style={{ ...cellInput(width - 16), textAlign: 'right' }} />
    ),
  }]
}
function cellInput(width: number): React.CSSProperties {
  return { width, padding: '4px 6px', fontSize: 12, border: '1px solid var(--pearl)', borderRadius: 4, background: '#fff', fontFamily: 'inherit' }
}

const STORAGE_KEY = (brand: string) => `wholesale.inventory_sheet.cols.${brand}`
const DEFAULT_COL_IDS = ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.id)

interface SheetProps {
  items: InventoryItem[]
  onChanged: () => void
}

export default function InventorySheet({ items, onChanged }: SheetProps) {
  const { user, brand } = useApp()
  const [vendors, setVendors] = useState<WholesaleVendor[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [lists, setLists] = useState<Record<string, string[]>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'uncategorized' | InventoryCategory>('uncategorized')
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  const [activeIds, setActiveIds] = useState<string[]>(DEFAULT_COL_IDS)

  useEffect(() => {
    if (typeof window === 'undefined' || !brand) return
    const saved = window.localStorage.getItem(STORAGE_KEY(brand))
    if (saved) {
      try {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr)) setActiveIds(arr.filter((x: any) => typeof x === 'string'))
      } catch { /* ignore */ }
    } else {
      setActiveIds(DEFAULT_COL_IDS)
    }
  }, [brand])

  function setColumnIds(ids: string[]) {
    // Always include item_number — it's the row's identity.
    const next = ids.includes('item_number') ? ids : ['item_number', ...ids]
    setActiveIds(next)
    if (typeof window !== 'undefined' && brand) {
      window.localStorage.setItem(STORAGE_KEY(brand), JSON.stringify(next))
    }
  }

  useEffect(() => {
    if (!brand) return
    void Promise.all([
      supabase.from('wholesale_vendors').select('*').eq('brand', brand).is('archived_at', null).order('company_name'),
      supabase.from('inventory_locations').select('*').eq('brand', brand).is('archived_at', null).eq('active', true).order('sort_order'),
      loadAdminLists(brand, ['metal_type','metal_color','metal_karat','jewelry_type','diamond_shape','period_era','watch_brand','watch_band_style','watch_movement','watch_case_material','watch_condition']),
    ]).then(([v, l, a]) => {
      setVendors((v.data || []) as WholesaleVendor[])
      setLocations((l.data || []) as InventoryLocation[])
      const flat: Record<string, string[]> = {}
      for (const k of Object.keys(a)) flat[k] = (a[k] || []).filter(e => e.active).map(e => e.value)
      setLists(flat)
    })
  }, [brand])

  const activeCols = useMemo(() => {
    // Preserve registry order for visual stability when toggling.
    const set = new Set(activeIds)
    return ALL_COLUMNS.filter(c => set.has(c.id))
  }, [activeIds])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (filter === 'uncategorized' && i.category != null) return false
      if (filter !== 'all' && filter !== 'uncategorized' && i.category !== filter) return false
      if (q) {
        const blob = [
          i.item_number, i.public_notes, i.vendor_stock_number, i.vendor_invoice_number,
          i.alternate_item_number,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, filter])

  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search item #, description, vendor stock #…"
          style={{ flex: '1 1 240px', maxWidth: 320, fontSize: 12, padding: '6px 10px' }} />
        {(['uncategorized','all','jewelry','watch','diamond'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter === f ? 'btn-primary btn-xs' : 'btn-outline btn-xs'}
            style={{ textTransform: 'capitalize' }}>
            {f === 'uncategorized' ? '? Uncategorized' : f === 'all' ? 'All' : f}
          </button>
        ))}
        <span style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--mist)' }}>{filtered.length} of {items.length}</span>
        <button onClick={() => setShowColumnPicker(true)} className="btn-outline btn-sm" title="Choose which columns appear">⚙ Edit columns</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
          {filter === 'uncategorized' ? '🎉 Every item has a category.' : 'Nothing matches.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                {activeCols.map(c => (
                  <th key={c.id}
                    style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--mist)', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </th>
                ))}
                <th style={{ padding: '8px 10px', width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <SheetRow key={it.id} item={it}
                  cols={activeCols}
                  vendors={vendors} locations={locations} lists={lists}
                  actorId={user?.id || null} actorEmail={user?.email || null}
                  onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showColumnPicker && (
        <ColumnPickerModal
          activeIds={activeIds}
          onChange={setColumnIds}
          onClose={() => setShowColumnPicker(false)}
        />
      )}
    </div>
  )
}

function SheetRow({
  item, cols, vendors, locations, lists, actorId, actorEmail, onChanged,
}: {
  item: InventoryItem
  cols: ColumnDef[]
  vendors: WholesaleVendor[]
  locations: InventoryLocation[]
  lists: Record<string, string[]>
  actorId: string | null
  actorEmail: string | null
  onChanged: () => void
}) {
  const [local, setLocal] = useState(item)
  const [status, setStatus] = useState<RowSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setLocal(item) }, [item.id, item.updated_at])

  async function save(patch: Patch, isCostEdit = false) {
    setLocal(prev => ({ ...prev, ...patch }))
    setStatus('saving'); setError(null)
    try {
      const { error: err } = await supabase.from('inventory_items')
        .update({ ...patch, updated_by: actorId }).eq('id', item.id)
      if (err) throw new Error(err.message)
      setStatus('saved')
      await logAudit({
        brand: item.brand,
        entity_type: 'inventory_item', entity_id: item.id,
        action: isCostEdit ? 'cost_edited' : 'updated',
        before: Object.fromEntries(Object.keys(patch).map(k => [k, (item as any)[k] ?? null])),
        after: patch,
        actor_id: actorId, actor_email: actorEmail,
      })
      onChanged()
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1200)
    } catch (e: any) {
      setStatus('error')
      setError(e?.message || 'Save failed')
      setLocal(item)
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--pearl)' }}>
      {cols.map(c => (
        <td key={c.id} style={{ padding: '6px 10px', verticalAlign: 'middle' }}>
          {c.render({ item: local, save, vendors, locations, lists })}
        </td>
      ))}
      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
        {status === 'saving' && <span style={{ fontSize: 10, color: 'var(--mist)' }}>⟳</span>}
        {status === 'saved' && <span style={{ fontSize: 10, color: 'var(--green)' }}>✓</span>}
        {status === 'error' && <span style={{ fontSize: 10, color: '#ef4444' }} title={error || 'failed'}>⚠</span>}
      </td>
    </tr>
  )
}

function ColumnPickerModal({
  activeIds, onChange, onClose,
}: {
  activeIds: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(activeIds))

  function toggle(id: string) {
    if (id === 'item_number') return // locked
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  function apply() {
    onChange(Array.from(selected))
    onClose()
  }
  function reset() {
    setSelected(new Set(DEFAULT_COL_IDS))
  }

  const groups: Array<{ id: ColumnDef['group']; label: string }> = [
    { id: 'core',    label: 'Core' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'jewelry', label: 'Jewelry' },
    { id: 'watch',   label: 'Watch' },
    { id: 'diamond', label: 'Diamond' },
    { id: 'meta',    label: 'Other' },
  ]

  return (
    <Modal onClose={onClose} title="Sheet columns" wide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {groups.map(g => {
          const cols = ALL_COLUMNS.filter(c => c.group === g.id)
          if (cols.length === 0) return null
          return (
            <div key={g.id}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                {g.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cols.map(c => {
                  const locked = c.id === 'item_number'
                  return (
                    <Checkbox
                      key={c.id}
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={locked}
                      label={<>{c.label}{locked && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--mist)' }}>(always shown)</span>}</>}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <button onClick={reset} className="btn-outline btn-sm">Reset to defaults</button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={apply} className="btn-primary btn-sm">Apply</button>
        </div>
      </div>
    </Modal>
  )
}
