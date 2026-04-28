'use client'

// Detail view for a single expense report. Inline-editable line items
// with per-field autosave (debounced) and a "Saved ✓" indicator.
//
// State machine in PR2 is intentionally minimal: active → submitted_pending_review.
// approved / paid transitions land in PR4 (approval workflow + partner alerts).
//
// PR1 RLS gates writes by status: owner can only mutate while
// status='active'. UI mirrors that — fields disable once submitted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event, Expense, ExpenseCategory, ExpenseReport } from '@/types'
import {
  CATEGORY_OPTIONS, categoryIcon, categoryLabel,
  STATUS_LABEL, STATUS_COLOR,
  formatCurrency, formatDateLong, todayIso,
} from './expensesUtils'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function ExpenseReportDetail({
  reportId, onBack,
}: {
  reportId: string
  onBack: () => void
}) {
  const { user, events } = useApp()
  const [report, setReport] = useState<ExpenseReport | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [ownerName, setOwnerName] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isOwner = !!user && !!report && user.id === report.user_id
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const canMutate = (isOwner && report?.status === 'active') || isAdmin
  const canSubmit = isOwner && report?.status === 'active' && expenses.length > 0

  const event: Event | undefined = useMemo(
    () => events.find(e => e.id === report?.event_id),
    [events, report?.event_id],
  )

  // Saved-indicator fade.
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function flashSaved() {
    setSaveState('saved')
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    fadeTimer.current = setTimeout(() => setSaveState('idle'), 2000)
  }

  async function load() {
    setError(null)
    const [{ data: r, error: rErr }, { data: rows, error: eErr }] = await Promise.all([
      supabase.from('expense_reports').select('*').eq('id', reportId).maybeSingle(),
      supabase.from('expenses').select('*').eq('expense_report_id', reportId)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (rErr || !r) { setError(rErr?.message ?? 'Report not found'); setLoaded(true); return }
    if (eErr) { setError(eErr.message); setLoaded(true); return }
    setReport(r as ExpenseReport)
    setExpenses((rows ?? []) as Expense[])
    if (r.user_id) {
      const { data: u } = await supabase.from('users').select('name').eq('id', r.user_id).maybeSingle()
      setOwnerName((u as any)?.name ?? '')
    }
    setLoaded(true)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [reportId])

  // Recompute totals + push to the report row. Cheap; runs after every
  // expense add / edit / delete. Compensation = 0 until PR9.
  const recomputeTotals = useCallback(async (next: Expense[]) => {
    if (!report) return
    const totalExpenses = next.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const grand = totalExpenses + Number(report.total_compensation || 0)
    if (
      Number(report.total_expenses) === totalExpenses &&
      Number(report.grand_total) === grand
    ) return
    const { error: upErr } = await supabase.from('expense_reports')
      .update({ total_expenses: totalExpenses, grand_total: grand })
      .eq('id', report.id)
    if (upErr) { setError(upErr.message); return }
    setReport(p => p ? { ...p, total_expenses: totalExpenses, grand_total: grand } : p)
  }, [report])

  async function addExpense(draft: NewExpenseDraft) {
    if (!canMutate || !report) return
    setSaveState('saving'); setError(null)
    const payload = {
      expense_report_id: report.id,
      category: draft.category,
      custom_category_label: draft.category === 'custom' ? (draft.customLabel || null) : null,
      vendor: draft.vendor || null,
      amount: Number(draft.amount) || 0,
      expense_date: draft.expense_date,
      notes: draft.notes || null,
      source: 'manual' as const,
    }
    const { data, error: insertErr } = await supabase
      .from('expenses').insert(payload).select('*').single()
    if (insertErr || !data) {
      setSaveState('error'); setError(insertErr?.message ?? 'Could not add expense.'); return
    }
    const next = [data as Expense, ...expenses]
    setExpenses(next)
    await recomputeTotals(next)
    flashSaved()
  }

  async function updateExpense(id: string, patch: Partial<Expense>) {
    if (!canMutate) return
    setSaveState('saving'); setError(null)
    const { error: upErr } = await supabase.from('expenses').update(patch).eq('id', id)
    if (upErr) { setSaveState('error'); setError(upErr.message); return }
    const next = expenses.map(e => e.id === id ? { ...e, ...patch } as Expense : e)
    setExpenses(next)
    if ('amount' in patch) await recomputeTotals(next)
    flashSaved()
  }

  async function deleteExpense(id: string) {
    if (!canMutate) return
    if (!confirm('Delete this expense?')) return
    setSaveState('saving'); setError(null)
    const { error: delErr } = await supabase.from('expenses').delete().eq('id', id)
    if (delErr) { setSaveState('error'); setError(delErr.message); return }
    const next = expenses.filter(e => e.id !== id)
    setExpenses(next)
    await recomputeTotals(next)
    flashSaved()
  }

  async function submitForReview() {
    if (!canSubmit || !report) return
    setSubmitting(true); setError(null)
    const { error: upErr } = await supabase.from('expense_reports')
      .update({ status: 'submitted_pending_review', submitted_at: new Date().toISOString() })
      .eq('id', report.id)
    setSubmitting(false)
    if (upErr) { setError(upErr.message); return }
    setReport(p => p ? { ...p, status: 'submitted_pending_review', submitted_at: new Date().toISOString() } : p)
  }

  // Per-category running totals.
  const totalsByCategory = useMemo(() => {
    const m = new Map<ExpenseCategory, number>()
    for (const e of expenses) {
      m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [expenses])

  if (!loaded) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>
    )
  }
  if (!report) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>
        {error ?? 'Report not found.'}
        <div style={{ marginTop: 16 }}><button className="btn-outline btn-sm" onClick={onBack}>← Back</button></div>
      </div>
    )
  }

  const sc = STATUS_COLOR[report.status]

  return (
    <div className="p-6" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button className="btn-outline btn-sm" onClick={onBack}>← Back</button>
        <SavedIndicator state={saveState} />
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>
              {event?.store_name ?? '(unknown event)'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>
              {event?.start_date ? formatDateLong(event.start_date) : ''}
              {ownerName && <> · {ownerName}</>}
            </div>
          </div>
          <span style={{
            background: sc.bg, color: sc.fg,
            padding: '4px 12px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
          }}>{STATUS_LABEL[report.status]}</span>
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {totalsByCategory.length === 0 ? (
              <span style={{ color: 'var(--mist)', fontSize: 12, fontStyle: 'italic' }}>No expenses yet.</span>
            ) : totalsByCategory.map(([cat, amt]) => (
              <span key={cat} style={{
                padding: '3px 9px', borderRadius: 6,
                background: 'var(--cream2)', color: 'var(--ink)',
                fontSize: 12, fontWeight: 700,
              }}>
                {categoryIcon(cat)} {categoryLabel(cat)} · {formatCurrency(amt)}
              </span>
            ))}
          </div>
          <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--ink)' }}>
            Grand total: {formatCurrency(report.grand_total)}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Add expense form */}
      {canMutate && <AddExpenseForm onAdd={addExpense} />}

      {/* Expenses list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {expenses.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)', background: 'var(--cream2)', borderRadius: 8 }}>
            No expenses yet — add the first one above.
          </div>
        ) : expenses.map(ex => (
          <ExpenseRow key={ex.id} expense={ex} canMutate={canMutate}
            onUpdate={(patch) => updateExpense(ex.id, patch)}
            onDelete={() => deleteExpense(ex.id)} />
        ))}
      </div>

      {/* Footer actions */}
      {report.status === 'active' && isOwner && (
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary"
            onClick={submitForReview}
            disabled={!canSubmit || submitting}
            title={canSubmit ? '' : 'Add at least one expense before submitting.'}>
            {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      )}
      {report.status !== 'active' && (
        <div style={{ marginTop: 18, padding: 12, textAlign: 'center', background: 'var(--cream2)', borderRadius: 8, color: 'var(--ash)', fontSize: 13 }}>
          Locked — this report is {STATUS_LABEL[report.status].toLowerCase()}.
          {isAdmin && ' (Admins can still edit.)'}
        </div>
      )}
    </div>
  )
}

// ── Saved-indicator pill ──────────────────────────────────
function SavedIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return <span />
  const map: Record<Exclude<SaveState, 'idle'>, { label: string; color: string }> = {
    saving: { label: 'Saving…', color: 'var(--mist)' },
    saved:  { label: 'Saved ✓', color: 'var(--green)' },
    error:  { label: 'Save failed', color: 'var(--red)' },
  }
  const cfg = map[state]
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, color: cfg.color,
      transition: 'opacity .3s ease',
    }}>{cfg.label}</span>
  )
}

// ── Add expense form (always-visible inline) ──────────────
interface NewExpenseDraft {
  category: ExpenseCategory
  customLabel: string
  vendor: string
  amount: string
  expense_date: string
  notes: string
}

function AddExpenseForm({ onAdd }: { onAdd: (d: NewExpenseDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<NewExpenseDraft>({
    category: 'meals',
    customLabel: '',
    vendor: '',
    amount: '',
    expense_date: todayIso(),
    notes: '',
  })
  const [adding, setAdding] = useState(false)

  const canAdd = !!draft.expense_date
    && Number(draft.amount) > 0
    && (draft.category !== 'custom' || draft.customLabel.trim().length > 0)

  async function submit() {
    if (!canAdd) return
    setAdding(true)
    await onAdd(draft)
    setAdding(false)
    setDraft(d => ({ ...d, vendor: '', amount: '', notes: '', customLabel: '' }))
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
        Add expense
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 130px) minmax(140px, 1fr) minmax(140px, 1fr) minmax(110px, 130px) auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Date</label>
          <input type="date" value={draft.expense_date}
            onChange={e => setDraft(d => ({ ...d, expense_date: e.target.value }))} />
        </div>
        <div>
          <label style={lbl}>Category</label>
          <select value={draft.category}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value as ExpenseCategory }))}>
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Vendor</label>
          <input type="text" value={draft.vendor} placeholder="e.g. Delta, Hampton Inn"
            onChange={e => setDraft(d => ({ ...d, vendor: e.target.value }))} />
        </div>
        <div>
          <label style={lbl}>Amount</label>
          <input type="number" step="0.01" min="0" value={draft.amount}
            placeholder="0.00"
            onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} />
        </div>
        <div>
          <button className="btn-primary btn-sm" onClick={submit} disabled={!canAdd || adding}>
            {adding ? '…' : '+ Add'}
          </button>
        </div>
      </div>

      {draft.category === 'custom' && (
        <div style={{ marginTop: 8 }}>
          <label style={lbl}>Custom category label *</label>
          <input type="text" value={draft.customLabel}
            placeholder="e.g. Insurance, Stamps"
            onChange={e => setDraft(d => ({ ...d, customLabel: e.target.value }))} />
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <label style={lbl}>Notes (optional)</label>
        <textarea rows={2} value={draft.notes}
          onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
      </div>
    </div>
  )
}

// ── Editable expense row ──────────────────────────────────
function ExpenseRow({ expense, canMutate, onUpdate, onDelete }: {
  expense: Expense
  canMutate: boolean
  onUpdate: (patch: Partial<Expense>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  // Local mirror of fields so typing feels snappy. We push to the server
  // on blur (or on change for selects). The parent's reload-on-success
  // will refresh from the canonical state, but we don't want every
  // keystroke to round-trip.
  const [local, setLocal] = useState({
    category: expense.category,
    custom_category_label: expense.custom_category_label ?? '',
    vendor: expense.vendor ?? '',
    amount: String(expense.amount ?? ''),
    expense_date: expense.expense_date,
    notes: expense.notes ?? '',
  })

  // Keep local in sync if the parent replaces the row (e.g. after recompute).
  useEffect(() => {
    setLocal({
      category: expense.category,
      custom_category_label: expense.custom_category_label ?? '',
      vendor: expense.vendor ?? '',
      amount: String(expense.amount ?? ''),
      expense_date: expense.expense_date,
      notes: expense.notes ?? '',
    })
  }, [expense.id, expense.updated_at])

  function maybeSave<K extends keyof Expense>(key: K, value: Expense[K]) {
    if (!canMutate) return
    if ((expense as any)[key] === value) return
    onUpdate({ [key]: value } as Partial<Expense>)
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 130px) minmax(140px, 1fr) minmax(140px, 1fr) minmax(110px, 130px) auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Date</label>
          <input type="date" value={local.expense_date} disabled={!canMutate}
            onChange={e => setLocal(p => ({ ...p, expense_date: e.target.value }))}
            onBlur={() => maybeSave('expense_date', local.expense_date)} />
        </div>
        <div>
          <label style={lbl}>Category</label>
          <select value={local.category} disabled={!canMutate}
            onChange={e => {
              const next = e.target.value as ExpenseCategory
              setLocal(p => ({ ...p, category: next }))
              if (canMutate) onUpdate({
                category: next,
                custom_category_label: next === 'custom' ? (local.custom_category_label || null) : null,
              })
            }}>
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Vendor</label>
          <input type="text" value={local.vendor} disabled={!canMutate}
            onChange={e => setLocal(p => ({ ...p, vendor: e.target.value }))}
            onBlur={() => maybeSave('vendor', local.vendor || (null as any))} />
        </div>
        <div>
          <label style={lbl}>Amount</label>
          <input type="number" step="0.01" min="0" value={local.amount} disabled={!canMutate}
            onChange={e => setLocal(p => ({ ...p, amount: e.target.value }))}
            onBlur={() => maybeSave('amount', Number(local.amount) || 0)} />
        </div>
        <div>
          {canMutate && (
            <button onClick={onDelete} title="Delete expense"
              style={{
                background: 'transparent', border: '1px solid var(--cream2)',
                color: 'var(--red)', borderRadius: 6, padding: '6px 10px',
                cursor: 'pointer', fontWeight: 700,
              }}>×</button>
          )}
        </div>
      </div>

      {local.category === 'custom' && (
        <div style={{ marginTop: 8 }}>
          <label style={lbl}>Custom category label *</label>
          <input type="text" value={local.custom_category_label} disabled={!canMutate}
            onChange={e => setLocal(p => ({ ...p, custom_category_label: e.target.value }))}
            onBlur={() => maybeSave('custom_category_label', local.custom_category_label || (null as any))} />
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <label style={lbl}>Notes</label>
        <textarea rows={2} value={local.notes} disabled={!canMutate}
          onChange={e => setLocal(p => ({ ...p, notes: e.target.value }))}
          onBlur={() => maybeSave('notes', local.notes || (null as any))} />
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.05em', color: 'var(--mist)', marginBottom: 4,
}
