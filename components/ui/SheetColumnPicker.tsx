'use client'

// Generic column-picker modal shared across sheet-style views
// (Inventory POS, Buying Event sheet, Trunk Show sheet). Each
// caller passes a column registry grouped by category; the picker
// renders shared <Checkbox/> toggles and emits the new selection
// when the user clicks Apply.

import { useState } from 'react'
import Checkbox from '@/components/ui/Checkbox'

export interface SheetColumnDef {
  id: string
  label: string
  /** Optional group key; the picker renders one section per
   *  group. Columns with no group fall under "Columns". */
  group?: string
  /** Locked columns are always shown and can't be toggled off
   *  (the item-number column on a sheet is the row's identity). */
  locked?: boolean
}

interface Props {
  /** All available columns. */
  columns: SheetColumnDef[]
  /** Currently-active column ids. */
  selected: string[]
  /** Defaults to fall back to when the user clicks "Reset". */
  defaults: string[]
  /** Group order/labels. Groups not listed here fall through to a
   *  catch-all "Other" section at the end. */
  groups?: Array<{ id: string; label: string }>
  onChange: (ids: string[]) => void
  onClose: () => void
  title?: string
}

export default function SheetColumnPicker({
  columns, selected, defaults, groups, onChange, onClose,
  title = 'Sheet columns',
}: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set(selected))

  // Always re-include locked columns so the consumer doesn't have to.
  const lockedIds = columns.filter(c => c.locked).map(c => c.id)
  function toggle(id: string) {
    const col = columns.find(c => c.id === id)
    if (col?.locked) return
    const next = new Set(picked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setPicked(next)
  }
  function apply() {
    const out = Array.from(picked)
    for (const id of lockedIds) if (!out.includes(id)) out.unshift(id)
    onChange(out)
    onClose()
  }
  function reset() {
    setPicked(new Set(defaults))
  }

  const groupOrder = groups || []
  const seenGroups = new Set(groupOrder.map(g => g.id))
  const otherCols = columns.filter(c => !c.group || !seenGroups.has(c.group))

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, maxWidth: 980, width: '100%', maxHeight: '92vh', overflow: 'auto', padding: 20, fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--mist)' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {groupOrder.map(g => {
            const cols = columns.filter(c => c.group === g.id)
            if (cols.length === 0) return null
            return (
              <div key={g.id}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                  {g.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cols.map(c => (
                    <Checkbox key={c.id}
                      checked={picked.has(c.id) || !!c.locked}
                      onChange={() => toggle(c.id)}
                      disabled={!!c.locked}
                      label={<>{c.label}{c.locked && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--mist)' }}>(always shown)</span>}</>}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          {otherCols.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Other</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {otherCols.map(c => (
                  <Checkbox key={c.id}
                    checked={picked.has(c.id) || !!c.locked}
                    onChange={() => toggle(c.id)}
                    disabled={!!c.locked}
                    label={c.label}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={reset} className="btn-outline btn-sm">Reset to defaults</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
            <button onClick={apply} className="btn-primary btn-sm">Apply</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Simple localStorage-backed column-id state. Use inside a sheet
 *  component to remember selections per-brand. Returns
 *  [activeIds, setActiveIds, openPicker]. */
