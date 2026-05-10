'use client'

// Sheet view of inventory — designed for fast category triage on
// freshly-imported items, plus quick price + stock # edits. Each
// row is editable inline; saves are autosaved per-cell with a
// per-row indicator (⟳ / ✓ / ⚠).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { InventoryItem, InventoryCategory, InventoryStatus } from '@/types/wholesale'
import { fmtMoneyCents, dollarsToCents, centsToDollarsString } from '@/lib/wholesale/format'
import { logAudit } from '@/lib/wholesale/audit'

type RowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  jewelry: 'Jewelry', watch: 'Watch', diamond: 'Diamond',
}

const STATUS_OPTIONS: { value: InventoryStatus; label: string }[] = [
  { value: 'in_stock',     label: 'In Stock' },
  { value: 'on_hold',      label: 'On Hold' },
  { value: 'on_memo',      label: 'On Memo' },
  { value: 'sold',         label: 'Sold' },
  { value: 'returned',     label: 'Returned' },
  { value: 'in_repair',    label: 'In Repair' },
  { value: 'consigned_out',label: 'Consigned' },
]

interface SheetProps {
  items: InventoryItem[]
  onChanged: () => void
}

export default function InventorySheet({ items, onChanged }: SheetProps) {
  const { user } = useApp()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'uncategorized' | InventoryCategory>('uncategorized')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (filter === 'uncategorized' && i.category != null) return false
      if (filter !== 'all' && filter !== 'uncategorized' && i.category !== filter) return false
      if (q) {
        const blob = [
          i.item_number, i.public_notes, i.vendor_stock_number, i.alternate_item_number,
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
            style={{ textTransform: 'capitalize' }}>{f === 'uncategorized' ? '? Uncategorized' : f === 'all' ? 'All' : CATEGORY_LABEL[f as InventoryCategory]}</button>
        ))}
        <span style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--mist)' }}>{filtered.length} of {items.length}</span>
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
                {['Item #','Vendor stock #','Description','Category','Status','Cost','Retail',''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--mist)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <SheetRow key={it.id} item={it} actorId={user?.id || null} actorEmail={user?.email || null} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SheetRow({
  item, actorId, actorEmail, onChanged,
}: {
  item: InventoryItem
  actorId: string | null
  actorEmail: string | null
  onChanged: () => void
}) {
  const [local, setLocal] = useState(item)
  const [status, setStatus] = useState<RowSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // Re-sync if parent reloads with fresh data.
  useEffect(() => { setLocal(item) }, [item.id, item.updated_at])

  async function save(patch: Partial<InventoryItem>, isCostEdit = false) {
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
      setLocal(item)  // revert
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--pearl)' }}>
      <td style={{ padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{local.item_number}</td>
      <td style={{ padding: '6px 10px' }}>
        <input type="text" defaultValue={local.vendor_stock_number || ''}
          onBlur={e => {
            const v = e.target.value.trim() || null
            if (v !== (local.vendor_stock_number || null)) save({ vendor_stock_number: v as any })
          }}
          style={{ width: 120, padding: '4px 6px', fontSize: 12 }} />
      </td>
      <td style={{ padding: '6px 10px', minWidth: 240 }}>
        <input type="text" defaultValue={local.public_notes || ''}
          onBlur={e => {
            const v = e.target.value.trim() || null
            if (v !== (local.public_notes || null)) save({ public_notes: v as any })
          }}
          style={{ width: '100%', padding: '4px 6px', fontSize: 12 }} />
      </td>
      <td style={{ padding: '6px 10px' }}>
        <select value={local.category || ''} onChange={e => {
          const v = (e.target.value || null) as InventoryCategory | null
          save({ category: v as any })
        }}
          style={{
            width: 110, padding: '4px 6px', fontSize: 12,
            borderColor: local.category == null ? '#D97706' : 'var(--pearl)',
            background: local.category == null ? '#FFFBEB' : '#fff',
          }}>
          <option value="">— pick —</option>
          <option value="jewelry">Jewelry</option>
          <option value="watch">Watch</option>
          <option value="diamond">Diamond</option>
        </select>
      </td>
      <td style={{ padding: '6px 10px' }}>
        <select value={local.status} onChange={e => save({ status: e.target.value as InventoryStatus })}
          style={{ width: 110, padding: '4px 6px', fontSize: 12 }}>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
        <input type="text" inputMode="decimal" defaultValue={centsToDollarsString(local.cost_cents)}
          placeholder="—"
          onBlur={e => {
            const cents = e.target.value.trim() === '' ? null : dollarsToCents(e.target.value)
            if (cents !== (local.cost_cents ?? null)) save({ cost_cents: cents as any }, true)
          }}
          style={{ width: 90, padding: '4px 6px', fontSize: 12, textAlign: 'right' }} />
      </td>
      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
        <input type="text" inputMode="decimal" defaultValue={centsToDollarsString(local.retail_price_cents)}
          placeholder="—"
          onBlur={e => {
            const cents = e.target.value.trim() === '' ? null : dollarsToCents(e.target.value)
            if (cents !== (local.retail_price_cents ?? null)) save({ retail_price_cents: cents as any })
          }}
          style={{ width: 90, padding: '4px 6px', fontSize: 12, textAlign: 'right' }} />
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
        {status === 'saving' && <span style={{ fontSize: 10, color: 'var(--mist)' }}>⟳</span>}
        {status === 'saved' && <span style={{ fontSize: 10, color: 'var(--green)' }}>✓</span>}
        {status === 'error' && <span style={{ fontSize: 10, color: '#ef4444' }} title={error || 'failed'}>⚠</span>}
      </td>
    </tr>
  )
}
