'use client'

// Per-trade-show booth cost breakdown. Pulls the master category
// list from booth_cost_categories (admin-managed in Settings),
// plus each line item is stored in trade_show_booth_costs.
// Custom lines are stored with is_custom=true so we know they
// didn't come from the master list.

import { useEffect, useMemo, useState } from 'react'
import {
  listCategories, listCosts, createCost, updateCost, deleteCost,
  type BoothCostCategory, type BoothCostLine,
} from '@/lib/sales/boothCosts'

const CUSTOM_SENTINEL = '__custom__'
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

interface Props {
  tradeShowId: string
  canWrite: boolean
}

export default function BoothCostsPanel({ tradeShowId, canWrite }: Props) {
  const [categories, setCategories] = useState<BoothCostCategory[]>([])
  const [lines, setLines] = useState<BoothCostLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adderOpen, setAdderOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function reload() {
    setError(null)
    try {
      const [cats, ls] = await Promise.all([listCategories(), listCosts(tradeShowId)])
      setCategories(cats)
      setLines(ls)
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [tradeShowId])

  const total = useMemo(() => lines.reduce((s, r) => s + (Number(r.amount) || 0), 0), [lines])

  async function handleCreate(draft: { category: string; is_custom: boolean; description: string; amount: number }) {
    if (!canWrite) return
    setBusy(true)
    try {
      const created = await createCost(tradeShowId, draft)
      setLines(p => [...p, created])
      setAdderOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Could not add line')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!canWrite) return
    if (!confirm('Delete this line item?')) return
    try {
      await deleteCost(id)
      setLines(p => p.filter(l => l.id !== id))
    } catch (err: any) {
      alert(err?.message || 'Could not delete')
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>💵 Booth Cost Breakdown</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            Master categories live in Settings → Booth Cost Categories. Custom lines stay on this show.
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: total > 0 ? 'var(--green-dark)' : 'var(--mist)' }}>
          {USD.format(total)}
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : lines.length === 0 && !adderOpen ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No booth costs added yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lines.map(line => (
            <CostRow
              key={line.id}
              line={line}
              categories={categories}
              canWrite={canWrite}
              onPatched={(patch) => setLines(p => p.map(l => l.id === line.id ? { ...l, ...patch } : l))}
              onDelete={() => handleDelete(line.id)}
            />
          ))}
        </div>
      )}

      {canWrite && (
        adderOpen ? (
          <AddLineRow
            categories={categories}
            busy={busy}
            onCancel={() => setAdderOpen(false)}
            onSubmit={handleCreate}
          />
        ) : (
          <button onClick={() => setAdderOpen(true)} className="btn-outline btn-sm" style={{ marginTop: 12 }}>
            + Add line item
          </button>
        )
      )}
    </div>
  )
}

/* ── single row, inline editable ──────────────────────────── */

function CostRow({
  line, categories, canWrite, onPatched, onDelete,
}: {
  line: BoothCostLine
  categories: BoothCostCategory[]
  canWrite: boolean
  onPatched: (patch: Partial<BoothCostLine>) => void
  onDelete: () => void
}) {
  const [amount, setAmount] = useState(String(line.amount))
  const [description, setDescription] = useState(line.description || '')

  async function commitAmount() {
    const n = parseFloat(amount)
    const clean = Number.isFinite(n) && n >= 0 ? n : 0
    if (clean === Number(line.amount)) return
    try {
      await updateCost(line.id, { amount: clean })
      onPatched({ amount: clean })
    } catch (err: any) {
      alert(err?.message || 'Could not save amount')
      setAmount(String(line.amount))
    }
  }
  async function commitDescription() {
    if ((description || '') === (line.description || '')) return
    try {
      await updateCost(line.id, { description })
      onPatched({ description: description || null })
    } catch (err: any) {
      alert(err?.message || 'Could not save description')
      setDescription(line.description || '')
    }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.2fr 1.5fr minmax(120px, .8fr) auto',
      gap: 8, alignItems: 'center',
      padding: '8px 10px',
      background: 'var(--cream)', borderRadius: 6,
    }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: 'var(--ink)',
        display: 'flex', alignItems: 'center', gap: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {line.category}
        {line.is_custom && (
          <span title="Custom line — not in the master list" style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '.04em',
            background: 'var(--cream2)', color: 'var(--mist)',
            padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase',
          }}>custom</span>
        )}
      </div>
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        onBlur={commitDescription}
        placeholder="Description (optional)"
        disabled={!canWrite}
        style={{ fontSize: 13, padding: '6px 8px' }}
      />
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontSize: 13 }}>$</span>
        <input
          type="number" min="0" step="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          onBlur={commitAmount}
          disabled={!canWrite}
          style={{ paddingLeft: 22, fontSize: 13, padding: '6px 8px 6px 22px', textAlign: 'right' }}
        />
      </div>
      {canWrite ? (
        <button
          onClick={onDelete}
          aria-label="Remove line"
          title="Remove line"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 16, padding: '0 6px',
          }}>×</button>
      ) : <span />}
    </div>
  )
}

/* ── new-line entry row ───────────────────────────────────── */

function AddLineRow({
  categories, busy, onSubmit, onCancel,
}: {
  categories: BoothCostCategory[]
  busy: boolean
  onSubmit: (draft: { category: string; is_custom: boolean; description: string; amount: number }) => void
  onCancel: () => void
}) {
  const [pickedCategoryId, setPickedCategoryId] = useState<string>('')
  const [customLabel, setCustomLabel] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  const isCustom = pickedCategoryId === CUSTOM_SENTINEL
  const valid = !!amount && parseFloat(amount) >= 0
                 && (isCustom ? customLabel.trim().length > 0 : !!pickedCategoryId)

  function submit() {
    if (!valid || busy) return
    const cat = isCustom
      ? customLabel.trim()
      : (categories.find(c => c.id === pickedCategoryId)?.name || '')
    onSubmit({
      category: cat,
      is_custom: isCustom,
      description,
      amount: parseFloat(amount) || 0,
    })
  }

  return (
    <div style={{
      marginTop: 10, padding: 12,
      background: 'var(--green-pale)', border: '1px dashed var(--green3)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--green-dark)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        New line item
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 8, marginBottom: 10,
      }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Category</label>
          <select value={pickedCategoryId} onChange={e => setPickedCategoryId(e.target.value)}>
            <option value="">Select…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={CUSTOM_SENTINEL}>＋ Custom…</option>
          </select>
        </div>
        {isCustom && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">Custom label</label>
            <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Booth photographer" autoFocus />
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Amount *</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
            <input type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="0.00"
              style={{ paddingLeft: 22 }}
              onKeyDown={e => { if (e.key === 'Enter' && valid) submit() }} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
        <button onClick={submit} disabled={!valid || busy} className="btn-primary btn-sm">
          {busy ? 'Adding…' : 'Add line'}
        </button>
      </div>
    </div>
  )
}
