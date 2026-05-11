'use client'

// v1 builder for custom_reports. Single-source picker + flat column
// chip list (with related-entity columns inline) + filter rows +
// sort + visibility. Saves to custom_reports.config jsonb.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import {
  SOURCES, allColumns, TYPE_OPERATORS, OPERATOR_LABELS, DATE_PRESETS,
  AGG_LABELS, aggregateKey, aggregateLabel, computedKey,
  type ReportConfig, type ReportFilter, type ReportSort, type Operator, type ColumnDef,
  type AggregateColumn, type AggregateOp, type FilterCombinator, type ComputedColumn,
} from '@/lib/reports/schema'
import { validateFormula } from '@/lib/reports/formula'

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
  const [filterCombinator, setFilterCombinator] = useState<FilterCombinator>('and')
  const [sort, setSort] = useState<ReportSort[]>([])
  const [groupBy, setGroupBy] = useState<string[]>([])
  const [aggregates, setAggregates] = useState<AggregateColumn[]>([])
  const [computed, setComputed] = useState<ComputedColumn[]>([])
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
        setFilterCombinator(cfg.filterCombinator === 'or' ? 'or' : 'and')
        setSort(cfg.sort || [])
        setGroupBy(cfg.groupBy || [])
        setAggregates(cfg.aggregates || [])
        setComputed(cfg.computed || [])
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

  // ── Sort options change with grouping. Ungrouped → all source cols.
  // Grouped → groupBy keys + aggregate keys (with friendly labels).
  const isGrouped = groupBy.length > 0
  const sortOptions = useMemo<{ key: string; label: string }[]>(() => {
    if (!isGrouped) {
      return colCatalog.map(c => ({ key: c.column.key, label: `${c.groupLabel} → ${c.column.label}` }))
    }
    const out: { key: string; label: string }[] = []
    for (const gk of groupBy) {
      const cd = colByKey.get(gk)
      out.push({ key: gk, label: cd ? `${cd.groupLabel} → ${cd.column.label}` : gk })
    }
    aggregates.forEach((a, i) => {
      const fl = a.field ? colByKey.get(a.field)?.column.label : undefined
      out.push({ key: aggregateKey(i), label: aggregateLabel(a, fl) })
    })
    return out
  }, [isGrouped, colCatalog, groupBy, aggregates, colByKey])

  // Sort options always include computed columns at the tail (regardless
  // of grouping) so users can sort by their derived metrics.
  const sortOptionsWithComputed = useMemo(() => {
    const base = sortOptions.slice()
    computed.forEach((c, i) => {
      base.push({ key: computedKey(i), label: c.label || `Computed ${i + 1}` })
    })
    return base
  }, [sortOptions, computed])

  // Labels available as `[Label]` references inside formulas. Mirrors
  // what the runner's resolver looks up: source cols (ungrouped), or
  // groupBy + aggregate labels (grouped).
  const availableRefs = useMemo<string[]>(() => {
    if (!isGrouped) return colCatalog.map(c => c.column.label)
    const out: string[] = []
    for (const gk of groupBy) {
      const cd = colByKey.get(gk)
      if (cd) out.push(cd.column.label)
    }
    aggregates.forEach((a, i) => {
      const fl = a.field ? colByKey.get(a.field)?.column.label : undefined
      out.push(aggregateLabel(a, fl))
    })
    return out
  }, [isGrouped, colCatalog, groupBy, aggregates, colByKey])

  const defaultSortKey = sortOptionsWithComputed[0]?.key || ''
  const addSort = () => setSort(p => [...p, { field: defaultSortKey, direction: 'asc' }])
  const updateSort = (i: number, patch: Partial<ReportSort>) =>
    setSort(p => p.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const removeSort = (i: number) => setSort(p => p.filter((_, idx) => idx !== i))

  // ── Group by ──────────────────────────────────────────
  const addGroupBy = (k: string) => setGroupBy(p => p.includes(k) ? p : [...p, k])
  const removeGroupBy = (k: string) => {
    setGroupBy(p => p.filter(x => x !== k))
    // Drop any sort rules that referenced this groupBy key.
    setSort(p => p.filter(s => s.field !== k))
  }

  // ── Computed columns ──────────────────────────────────
  const addComputed = () =>
    setComputed(p => [...p, { label: `Computed ${p.length + 1}`, formula: '' }])
  const updateComputed = (i: number, patch: Partial<ComputedColumn>) =>
    setComputed(p => p.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const removeComputed = (i: number) => {
    setComputed(p => p.filter((_, idx) => idx !== i))
    // Re-key sort rules that referenced a computed col by index.
    const stripped = computedKey(i)
    setSort(p => p
      .filter(s => s.field !== stripped)
      .map(s => {
        const m = s.field.match(/^__calc_(\d+)$/)
        if (!m) return s
        const idx = Number(m[1])
        return idx > i ? { ...s, field: computedKey(idx - 1) } : s
      }))
  }

  // ── Aggregates ────────────────────────────────────────
  const addAggregate = () =>
    setAggregates(p => [...p, { op: 'count' }])
  const updateAggregate = (i: number, patch: Partial<AggregateColumn>) => {
    setAggregates(p => p.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }
  const removeAggregate = (i: number) => {
    setAggregates(p => p.filter((_, idx) => idx !== i))
    // Re-key sort rules that referenced an aggregate by index.
    const stripped = aggregateKey(i)
    setSort(p => p
      .filter(s => s.field !== stripped)
      .map(s => {
        const m = s.field.match(/^__agg_(\d+)$/)
        if (!m) return s
        const idx = Number(m[1])
        return idx > i ? { ...s, field: aggregateKey(idx - 1) } : s
      }))
  }

  // ── Save ─────────────────────────────────────────────

  // Save gating: ungrouped → at least one column. Grouped → at least one
  // groupBy AND one aggregate (otherwise the result is empty).
  const canSave = !!name.trim() && !saving && (
    isGrouped
      ? (groupBy.length > 0 && aggregates.length > 0)
      : columns.length > 0
  )

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
      config: {
        columns, filters, sort,
        ...(filterCombinator === 'or' ? { filterCombinator } : {}),
        ...(isGrouped ? { groupBy, aggregates } : {}),
        ...(computed.length > 0 ? { computed } : {}),
      } as ReportConfig,
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
          <select value={source} onChange={e => { setSource(e.target.value); setColumns([]); setFilters([]); setFilterCombinator('and'); setSort([]); setGroupBy([]); setAggregates([]); setComputed([]) }} style={{ width: '100%' }}>
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
          {/* Columns — hidden in grouping mode, output cols are derived. */}
          {!isGrouped && (
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
          )}

          {/* Group by */}
          <div className="card">
            <div className="card-title">Group by</div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
              Roll input rows up by these columns. When set, output is one row per group with the aggregates below.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {groupBy.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)' }}>Not grouped — report returns raw rows.</div>}
              {groupBy.map(k => {
                const cd = colByKey.get(k)
                return (
                  <span key={k} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'var(--amber-pale)', color: 'var(--amber)',
                    padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  }}>
                    {cd?.column.label || k}
                    <button onClick={() => removeGroupBy(k)} title="Remove" style={chipBtn}>×</button>
                  </span>
                )
              })}
            </div>
            <ColumnPicker catalog={colCatalog} selected={groupBy} onAdd={addGroupBy} buttonLabel="+ Add group" />
          </div>

          {/* Aggregations — only meaningful when grouped */}
          {isGrouped && (
            <div className="card">
              <div className="card-title">Aggregations</div>
              {aggregates.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>Add at least one aggregate (Count / Sum / Avg / Min / Max).</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {aggregates.map((a, i) => (
                  <AggregateRow key={i} agg={a} catalog={colCatalog}
                    onChange={patch => updateAggregate(i, patch)}
                    onRemove={() => removeAggregate(i)}
                  />
                ))}
              </div>
              <button onClick={addAggregate} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add aggregate</button>
            </div>
          )}

          {/* Computed columns — derived per-row formulas */}
          <div className="card">
            <div className="card-title">Computed columns</div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
              Formulas of <code>+ - * / ( )</code> over <code>[Column label]</code> references.{' '}
              {isGrouped
                ? 'In grouping mode, references resolve against groupBy columns + aggregate labels.'
                : 'References resolve against the source columns.'}
            </div>
            {computed.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>No computed columns yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {computed.map((c, i) => (
                <ComputedRow key={i} computed={c} availableRefs={availableRefs}
                  onChange={patch => updateComputed(i, patch)}
                  onRemove={() => removeComputed(i)}
                />
              ))}
            </div>
            <button onClick={addComputed} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add computed</button>
          </div>

          {/* Filters */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Filters</div>
              {filters.length >= 2 && (
                <div style={{
                  display: 'inline-flex', borderRadius: 6, overflow: 'hidden',
                  border: '1px solid var(--pearl)', fontSize: 12, fontWeight: 700,
                }}>
                  {(['and', 'or'] as FilterCombinator[]).map(c => (
                    <button key={c}
                      onClick={() => setFilterCombinator(c)}
                      style={{
                        padding: '4px 10px',
                        background: filterCombinator === c ? 'var(--green-pale)' : '#fff',
                        color: filterCombinator === c ? 'var(--green-dark)' : 'var(--ash)',
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        textTransform: 'uppercase', letterSpacing: '.04em',
                      }}>
                      Match {c === 'and' ? 'ALL' : 'ANY'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {filters.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>No filters yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filters.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {filters.length >= 2 && i > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, color: 'var(--mist)',
                      letterSpacing: '.08em', minWidth: 30, textAlign: 'center',
                    }}>
                      {filterCombinator === 'or' ? 'OR' : 'AND'}
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FilterRow filter={f} catalog={colCatalog}
                      onChange={patch => updateFilter(i, patch)}
                      onRemove={() => removeFilter(i)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addFilter} className="btn-outline btn-sm" style={{ marginTop: 8 }}>+ Add filter</button>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
              {filters.length < 2
                ? 'Add a second filter to choose between Match ALL (AND) and Match ANY (OR).'
                : filterCombinator === 'or'
                  ? 'Match ANY: a row passes if it matches at least one filter.'
                  : 'Match ALL: a row passes only if it matches every filter.'}
            </div>
          </div>

          {/* Sort */}
          <div className="card">
            <div className="card-title">Sort by</div>
            {sort.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>No sort yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sort.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={s.field} onChange={e => updateSort(i, { field: e.target.value })} style={{ flex: 1, fontSize: 13 }}>
                    {sortOptionsWithComputed.map(o => (
                      <option key={o.key} value={o.key}>{o.label}</option>
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

function ColumnPicker({ catalog, selected, onAdd, buttonLabel }: {
  catalog: { groupLabel: string; column: ColumnDef }[]
  selected: string[]
  onAdd: (k: string) => void
  buttonLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const remaining = catalog.filter(c => !selected.includes(c.column.key))
  if (remaining.length === 0) return null

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-outline btn-sm">{buttonLabel || '+ Add column'}</button>
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

function ComputedRow({ computed, availableRefs, onChange, onRemove }: {
  computed: ComputedColumn
  availableRefs: string[]
  onChange: (patch: Partial<ComputedColumn>) => void
  onRemove: () => void
}) {
  const validation = useMemo(
    () => computed.formula.trim() ? validateFormula(computed.formula) : { ok: true as const },
    [computed.formula],
  )
  const insertRef = (label: string) => {
    onChange({ formula: (computed.formula || '') + `[${label}]` })
  }
  return (
    <div style={{
      border: '1px solid var(--pearl)', borderRadius: 8, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={computed.label}
          onChange={e => onChange({ label: e.target.value })}
          placeholder="Column name"
          style={{ flex: '0 0 180px', fontSize: 13, fontWeight: 700 }}
        />
        <input value={computed.formula}
          onChange={e => onChange({ formula: e.target.value })}
          placeholder="e.g. [Spend VDP] + [Spend newspaper]"
          style={{ flex: 1, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        />
        <button onClick={onRemove} className="btn-danger btn-sm">×</button>
      </div>
      {availableRefs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 4 }}>
            Insert:
          </span>
          {availableRefs.slice(0, 14).map(label => (
            <button key={label} type="button" onClick={() => insertRef(label)} style={{
              background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
              padding: '2px 6px', fontSize: 11, color: 'var(--ash)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>[{label}]</button>
          ))}
        </div>
      )}
      {!validation.ok && (
        <div style={{ fontSize: 11, color: '#B91C1C', fontWeight: 700 }}>
          {validation.error}
        </div>
      )}
    </div>
  )
}

function AggregateRow({ agg, catalog, onChange, onRemove }: {
  agg: AggregateColumn
  catalog: { groupLabel: string; column: ColumnDef }[]
  onChange: (patch: Partial<AggregateColumn>) => void
  onRemove: () => void
}) {
  // count operates on rows, no field needed. Other ops always need a field.
  const needsField = agg.op !== 'count'
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={agg.op}
        onChange={e => onChange({ op: e.target.value as AggregateOp, field: e.target.value === 'count' ? undefined : (agg.field || catalog[0]?.column.key) })}
        style={{ fontSize: 13 }}>
        {(Object.keys(AGG_LABELS) as AggregateOp[]).map(o => (
          <option key={o} value={o}>{AGG_LABELS[o]}</option>
        ))}
      </select>
      {needsField ? (
        <select value={agg.field || ''}
          onChange={e => onChange({ field: e.target.value })}
          style={{ flex: '1 1 200px', fontSize: 13 }}>
          {!agg.field && <option value="">— pick column —</option>}
          {catalog.map(c => (
            <option key={c.column.key} value={c.column.key}>{c.groupLabel} → {c.column.label}</option>
          ))}
        </select>
      ) : (
        <span style={{ flex: '1 1 200px', fontSize: 12, color: 'var(--mist)' }}>(counts rows in each group)</span>
      )}
      <input value={agg.label || ''}
        onChange={e => onChange({ label: e.target.value || undefined })}
        placeholder="Label (optional)"
        style={{ flex: '1 1 140px', fontSize: 13 }}
      />
      <button onClick={onRemove} className="btn-danger btn-sm">×</button>
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
