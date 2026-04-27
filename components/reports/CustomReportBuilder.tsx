'use client'

// v1 builder for custom_reports. Single-source picker + flat column
// chip list (with related-entity columns inline) + filter rows +
// sort + visibility. Saves to custom_reports.config jsonb.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import {
  SOURCES, allColumns, TYPE_OPERATORS, OPERATOR_LABELS, DATE_PRESETS,
  type ReportConfig, type ReportFilter, type ReportSort, type Operator, type ColumnDef,
} from '@/lib/reports/schema'

type Visibility = 'global' | 'store' | 'private'

interface ExistingReport {
  id: string
  name: string
  description: string | null
  tags: string[] | null
  source: string
  visibility: Visibility
  store_id: string | null
  config: ReportConfig
}

export default function CustomReportBuilder({ reportId, onCancel, onSaved }: {
  reportId: string | null  // null = new
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const { user, stores, brand } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [source, setSource] = useState<string>('appointments')
  const [columns, setColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<ReportFilter[]>([])
  const [sort, setSort] = useState<ReportSort[]>([])
  const [visibility, setVisibility] = useState<Visibility>('global')
  const [storeId, setStoreId] = useState<string>('')
  const [loaded, setLoaded] = useState(reportId === null)
  const [saving, setSaving] = useState(false)

  // Load existing report if editing.
  useEffect(() => {
    if (!reportId || reportId === 'new') return
    supabase.from('custom_reports').select('*').eq('id', reportId).maybeSingle()
      .then(({ data }) => {
        const r = data as any
        if (!r) { setLoaded(true); return }
        setName(r.name || '')
        setDescription(r.description || '')
        setTags((r.tags || []).join(', '))
        setSource(r.source || 'appointments')
        setVisibility(r.visibility || 'global')
        setStoreId(r.store_id || '')
        const cfg: ReportConfig = r.config || { columns: [], filters: [], sort: [] }
        setColumns(cfg.columns || [])
        setFilters(cfg.filters || [])
        setSort(cfg.sort || [])
        setLoaded(true)
      })
  }, [reportId])

  // Default columns when picking a fresh source — first 3 own columns.
  useEffect(() => {
    if (reportId && reportId !== 'new') return
    if (columns.length > 0) return
    const def = SOURCES[source]
    if (def) setColumns(def.columns.slice(0, 3).map(c => c.key))
  }, [source, reportId])

  const colCatalog = useMemo(() => allColumns(source), [source])
  const colByKey = useMemo(() => {
    const m = new Map<string, { groupLabel: string; column: ColumnDef }>()
    colCatalog.forEach(c => m.set(c.column.key, c))
    return m
  }, [colCatalog])

  // ── Mutators ─────────────────────────────────────────

  const addColumn = (k: string) => setColumns(p => p.includes(k) ? p : [...p, k])
  const removeColumn = (k: string) => setColumns(p => p.filter(c => c !== k))
  const moveColumn = (from: number, to: number) => setColumns(p => {
    const next = [...p]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next
  })

  const addFilter = () => {
    const first = colCatalog[0]?.column
    if (!first) return
    const ops = TYPE_OPERATORS[first.type]
    setFilters(p => [...p, { field: first.key, op: ops[0], value: '' }])
  }
  const updateFilter = (i: number, patch: Partial<ReportFilter>) =>
    setFilters(p => p.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  const removeFilter = (i: number) => setFilters(p => p.filter((_, idx) => idx !== i))

  const addSort = () => setSort(p => [...p, { field: columns[0] || colCatalog[0]?.column.key || '', direction: 'asc' }])
  const updateSort = (i: number, patch: Partial<ReportSort>) =>
    setSort(p => p.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const removeSort = (i: number) => setSort(p => p.filter((_, idx) => idx !== i))

  // ── Save ─────────────────────────────────────────────

  const canSave = !!name.trim() && columns.length > 0 && !saving

  const save = async () => {
    if (!canSave || !user) return
    setSaving(true)
    const payload: any = {
      name: name.trim(),
      description: description.trim() || null,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      source,
      visibility,
      store_id: visibility === 'store' ? (storeId || null) : null,
      config: { columns, filters, sort } as ReportConfig,
      updated_at: new Date().toISOString(),
    }
    let res: any
    if (reportId && reportId !== 'new') {
      res = await supabase.from('custom_reports').update(payload).eq('id', reportId).select('id').maybeSingle()
    } else {
      payload.created_by = user.id
      res = await supabase.from('custom_reports').insert(payload).select('id').single()
    }
    setSaving(false)
    if (res.error) { alert('Save failed: ' + res.error.message); return }
    onSaved(res.data?.id || reportId || '')
  }

  if (!loaded) return <div className="p-6"><p style={{ color: 'var(--mist)' }}>Loading…</p></div>

  const brandStores = stores.filter((s: any) => s.brand === brand)

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}>
            ← Back to Reports
          </button>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Untitled report"
            style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', border: 'none', background: 'transparent', width: '100%', padding: 0, marginTop: 4 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} className="btn-outline btn-sm">Cancel</button>
          <button onClick={save} disabled={!canSave} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save & run'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
        {/* Left rail: source */}
        <div className="card" style={{ position: 'sticky', top: 12, alignSelf: 'flex-start' }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Data source</div>
          <select value={source} onChange={e => { setSource(e.target.value); setColumns([]); setFilters([]); setSort([]) }} style={{ width: '100%' }}>
            {Object.entries(SOURCES).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </select>
          {SOURCES[source]?.brandScoped && (
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
              Auto-scoped to active brand at run time.
            </div>
          )}
        </div>

        {/* Main panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Columns */}
          <div className="card">
            <div className="card-title">Columns</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {columns.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)' }}>No columns yet — add some below.</div>}
              {columns.map((k, i) => {
                const cd = colByKey.get(k)
                return (
                  <span key={k} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'var(--green-pale)', color: 'var(--green-dark)',
                    padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  }}>
                    {i > 0 && <button onClick={() => moveColumn(i, i - 1)} title="Move left" style={chipBtn}>‹</button>}
                    {cd?.column.label || k}
                    {i < columns.length - 1 && <button onClick={() => moveColumn(i, i + 1)} title="Move right" style={chipBtn}>›</button>}
                    <button onClick={() => removeColumn(k)} title="Remove" style={chipBtn}>×</button>
                  </span>
                )
              })}
            </div>
            <ColumnPicker catalog={colCatalog} selected={columns} onAdd={addColumn} />
          </div>

          {/* Filters */}
          <div className="card">
            <div className="card-title">Filters</div>
            {filters.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>No filters yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filters.map((f, i) => (
                <FilterRow key={i} filter={f} catalog={colCatalog}
                  onChange={patch => updateFilter(i, patch)}
                  onRemove={() => removeFilter(i)}
                />
              ))}
            </div>
            <button onClick={addFilter} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add filter</button>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>Filters AND together (no OR support in v1).</div>
          </div>

          {/* Sort */}
          <div className="card">
            <div className="card-title">Sort by</div>
            {sort.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>No sort yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sort.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={s.field} onChange={e => updateSort(i, { field: e.target.value })} style={{ flex: 1, fontSize: 13 }}>
                    {colCatalog.map(c => (
                      <option key={c.column.key} value={c.column.key}>{c.groupLabel} → {c.column.label}</option>
                    ))}
                  </select>
                  <select value={s.direction} onChange={e => updateSort(i, { direction: e.target.value as 'asc' | 'desc' })} style={{ fontSize: 13 }}>
                    <option value="asc">asc</option>
                    <option value="desc">desc</option>
                  </select>
                  <button onClick={() => removeSort(i)} className="btn-danger btn-sm">×</button>
                </div>
              ))}
            </div>
            <button onClick={addSort} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add sort</button>
          </div>

          {/* Description / tags / visibility */}
          <div className="card">
            <div className="card-title">Details</div>
            <div className="field">
              <label className="fl">Description (optional)</label>
              <input value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Tags (comma-separated)</label>
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. weekly, sales" />
            </div>
            <div className="field">
              <label className="fl">Visibility</label>
              <select value={visibility} onChange={e => setVisibility(e.target.value as Visibility)} style={{ maxWidth: 320 }}>
                <option value="global">Shared globally (default)</option>
                <option value="store">Shared with my store</option>
                <option value="private">Private to me</option>
              </select>
            </div>
            {visibility === 'store' && brandStores.length > 0 && (
              <div className="field">
                <label className="fl">Store</label>
                <select value={storeId} onChange={e => setStoreId(e.target.value)} style={{ maxWidth: 320 }}>
                  <option value="">— pick a store —</option>
                  {brandStores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const chipBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--green-dark)',
  cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1, fontFamily: 'inherit',
}

function ColumnPicker({ catalog, selected, onAdd }: {
  catalog: { groupLabel: string; column: ColumnDef }[]
  selected: string[]
  onAdd: (k: string) => void
}) {
  const [open, setOpen] = useState(false)
  const remaining = catalog.filter(c => !selected.includes(c.column.key))
  if (remaining.length === 0) return null

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-outline btn-sm">+ Add column</button>
  }

  // Group remaining by groupLabel
  const groups = new Map<string, ColumnDef[]>()
  for (const c of remaining) {
    if (!groups.has(c.groupLabel)) groups.set(c.groupLabel, [])
    groups.get(c.groupLabel)!.push(c.column)
  }

  return (
    <div style={{
      border: '1px solid var(--pearl)', borderRadius: 8, padding: 10,
      background: 'var(--cream)', maxHeight: 300, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Pick a column</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mist)' }}>×</button>
      </div>
      {Array.from(groups.entries()).map(([group, cols]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{group}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cols.map(c => (
              <button key={c.key} onClick={() => onAdd(c.key)} style={{
                background: 'white', border: '1px solid var(--pearl)', borderRadius: 6,
                padding: '4px 8px', fontSize: 12, color: 'var(--ash)', cursor: 'pointer', fontFamily: 'inherit',
              }}>+ {c.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function FilterRow({ filter, catalog, onChange, onRemove }: {
  filter: ReportFilter
  catalog: { groupLabel: string; column: ColumnDef }[]
  onChange: (patch: Partial<ReportFilter>) => void
  onRemove: () => void
}) {
  const col = catalog.find(c => c.column.key === filter.field)?.column
  const ops = col ? TYPE_OPERATORS[col.type] : []

  const onFieldChange = (k: string) => {
    const nextCol = catalog.find(c => c.column.key === k)?.column
    if (!nextCol) return
    const nextOps = TYPE_OPERATORS[nextCol.type]
    onChange({ field: k, op: nextOps[0], value: '' })
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={filter.field} onChange={e => onFieldChange(e.target.value)} style={{ flex: '1 1 200px', fontSize: 13 }}>
        {catalog.map(c => (
          <option key={c.column.key} value={c.column.key}>{c.groupLabel} → {c.column.label}</option>
        ))}
      </select>
      <select value={filter.op} onChange={e => onChange({ op: e.target.value as Operator, value: '' })} style={{ fontSize: 13 }}>
        {ops.map(o => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
      </select>
      {filter.op === 'date_preset' ? (
        <select value={filter.preset || 'today'} onChange={e => onChange({ preset: e.target.value })} style={{ fontSize: 13 }}>
          {DATE_PRESETS.filter(p => p.value !== 'custom').map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      ) : filter.op === 'is_null' || filter.op === 'not_null' ? (
        <span style={{ fontSize: 12, color: 'var(--mist)' }}>—</span>
      ) : (
        <input value={filter.value ?? ''} onChange={e => onChange({ value: e.target.value })} style={{ flex: '1 1 140px', fontSize: 13 }} />
      )}
      <button onClick={onRemove} className="btn-danger btn-sm">×</button>
    </div>
  )
}
