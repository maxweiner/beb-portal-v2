'use client'

// Admin-only master list of booth cost categories. Lives in
// Settings under a CollapsibleCard. Add new entries, archive
// stale ones (preferred over delete, since past trade-show cost
// rows reference the category by name), reorder via up/down.
// Per spec: archived categories disappear from the per-show
// dropdown but stay readable on existing cost rows.

import { useEffect, useState } from 'react'
import {
  listCategories, createCategory, updateCategory,
  type BoothCostCategory,
} from '@/lib/sales/boothCosts'

export default function BoothCostCategoriesPanel() {
  const [rows, setRows] = useState<BoothCostCategory[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    setError(null)
    try {
      setRows(await listCategories({ includeArchived: true }))
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    }
    setLoaded(true)
  }
  useEffect(() => { void reload() }, [])

  async function add() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true); setError(null)
    try {
      await createCategory(name)
      setNewName('')
      await reload()
    } catch (err: any) {
      setError(err?.message || 'Could not add category')
    }
    setBusy(false)
  }

  async function rename(c: BoothCostCategory, name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === c.name) return
    try {
      await updateCategory(c.id, { name: trimmed })
      setRows(prev => prev.map(r => r.id === c.id ? { ...r, name: trimmed } : r))
    } catch (err: any) {
      alert(err?.message || 'Could not rename')
      void reload()
    }
  }

  async function toggleArchived(c: BoothCostCategory) {
    try {
      await updateCategory(c.id, { is_archived: !c.is_archived })
      setRows(prev => prev.map(r => r.id === c.id ? { ...r, is_archived: !c.is_archived } : r))
    } catch (err: any) {
      alert(err?.message || 'Could not update')
    }
  }

  async function move(c: BoothCostCategory, dir: -1 | 1) {
    // Swap display_order with the neighbor in the same archived bucket.
    // Cheap implementation — full re-sort lives in a future drag-handle
    // pass if reordering becomes a hot path.
    const peers = rows.filter(r => r.is_archived === c.is_archived)
    const idx = peers.findIndex(r => r.id === c.id)
    const swap = peers[idx + dir]
    if (!swap) return
    try {
      await Promise.all([
        updateCategory(c.id, { display_order: swap.display_order }),
        updateCategory(swap.id, { display_order: c.display_order }),
      ])
      await reload()
    } catch (err: any) {
      alert(err?.message || 'Could not reorder')
    }
  }

  const visible = rows.filter(r => showArchived ? true : !r.is_archived)

  return (
    <div>
      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Add category (e.g. Booth Photographer)"
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button onClick={add} disabled={busy || !newName.trim()} className="btn-primary btn-sm">
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ash)', marginBottom: 8 }}>
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
        Show archived
      </label>

      {!loaded ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No categories yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map((c, i) => (
            <CategoryRow
              key={c.id}
              c={c}
              isFirst={i === 0}
              isLast={i === visible.length - 1}
              onRename={(name) => rename(c, name)}
              onToggleArchived={() => toggleArchived(c)}
              onMoveUp={() => move(c, -1)}
              onMoveDown={() => move(c, 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryRow({
  c, isFirst, isLast, onRename, onToggleArchived, onMoveUp, onMoveDown,
}: {
  c: BoothCostCategory
  isFirst: boolean
  isLast: boolean
  onRename: (name: string) => void
  onToggleArchived: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [name, setName] = useState(c.name)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 10px',
      background: c.is_archived ? 'var(--cream2)' : 'var(--cream)',
      borderRadius: 6,
      opacity: c.is_archived ? 0.7 : 1,
    }}>
      <button onClick={onMoveUp} disabled={isFirst}
        title="Move up" aria-label="Move up"
        className="btn-outline btn-xs"
        style={{ minWidth: 28 }}>↑</button>
      <button onClick={onMoveDown} disabled={isLast}
        title="Move down" aria-label="Move down"
        className="btn-outline btn-xs"
        style={{ minWidth: 28 }}>↓</button>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={() => onRename(name)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
      />
      <button onClick={onToggleArchived} className="btn-outline btn-xs">
        {c.is_archived ? 'Unarchive' : 'Archive'}
      </button>
    </div>
  )
}
