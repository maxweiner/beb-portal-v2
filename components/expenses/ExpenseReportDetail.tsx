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
import { broadcastExpenseStatusChanged } from './usePendingApprovals'
import AddReceiptButton from './AddReceiptButton'
import AddMileageButton from './AddMileageButton'
import TemplateChecklist from './TemplateChecklist'

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
  const [approving, setApproving] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [paying, setPaying] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null)

  const isOwner = !!user && !!report && user.id === report.user_id
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const isPartner = !!user?.is_partner
  const canMutate = (isOwner && report?.status === 'active') || isAdmin
  const hasContent = expenses.length > 0 || Number(report?.comp_rate || 0) > 0
  const canSubmit = isOwner && report?.status === 'active' && hasContent
  const canApprove = isPartner && report?.status === 'submitted_pending_review'
  const canRecall  = isOwner && report?.status === 'submitted_pending_review'
  const canMarkPaid = (isPartner || isOwner) && report?.status === 'approved'

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
  // expense add / edit / delete. The DB also has a trigger that
  // recomputes — this client write is belt-and-suspenders so the local
  // state reflects the change immediately without a re-fetch.
  const recomputeTotals = useCallback(async (next: Expense[]) => {
    if (!report) return
    const totalExpenses = next.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const comp = Number(report.comp_rate || 0)
    const grand = totalExpenses + comp
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

  async function updateCompRate(newRate: number) {
    if (!canMutate || !report) return
    if (!Number.isFinite(newRate) || newRate < 0) return
    if (Number(report.comp_rate) === newRate) return
    setSaveState('saving'); setError(null)
    const { error: upErr } = await supabase.from('expense_reports')
      .update({ comp_rate: newRate })
      .eq('id', report.id)
    if (upErr) { setSaveState('error'); setError(upErr.message); return }
    // The DB trigger updates total_compensation + grand_total; mirror
    // those locally so the UI reflects the new grand total without a
    // re-fetch.
    setReport(p => p ? {
      ...p,
      comp_rate: newRate,
      total_compensation: newRate,
      grand_total: Number(p.total_expenses || 0) + newRate,
    } : p)
    flashSaved()
  }

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

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  async function viewPdf() {
    if (!report) return
    setPdfBusy(true); setError(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${report.id}/pdf`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) {
        setError(json.error || 'Could not generate PDF.')
      } else {
        window.open(json.url, '_blank', 'noopener')
        // Refresh so pdf_url shows up locally too.
        await load()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setPdfBusy(false)
  }

  async function sendToAccountant() {
    if (!report) return
    if (!confirm('Generate the PDF and email it to the accountant now?')) return
    setEmailBusy(true); setError(null); setEmailMsg(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${report.id}/send-to-accountant`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        if (json.reason === 'no_accountant_address') {
          setError('No accountant email is configured. Set the value in the settings table (key=accountant_email).')
        } else {
          setError(json.error || 'Could not send the email.')
        }
      } else {
        setEmailMsg('Sent ✓')
        await load()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setEmailBusy(false)
  }

  async function submitForReview() {
    if (!canSubmit || !report) return
    setSubmitting(true); setError(null)
    const { error: upErr } = await supabase.from('expense_reports')
      .update({ status: 'submitted_pending_review', submitted_at: new Date().toISOString() })
      .eq('id', report.id)
    if (upErr) { setSubmitting(false); setError(upErr.message); return }
    setReport(p => p ? { ...p, status: 'submitted_pending_review', submitted_at: new Date().toISOString() } : p)
    broadcastExpenseStatusChanged()
    // Fire the partner alert email — best effort. The state transition
    // already succeeded; if the email fails the user sees a non-fatal
    // banner and can ask an admin to chase it down.
    try {
      await authedFetch(`/api/expense-reports/${report.id}/notify-partners`, { method: 'POST' })
    } catch { /* swallow — see comment above */ }
    setSubmitting(false)
  }

  async function approveReport() {
    if (!canApprove || !report) return
    if (!confirm('Approve this report? The PDF will be emailed to the accountant.')) return
    setApproving(true); setError(null); setApprovalMsg(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${report.id}/approve`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not approve.')
      } else {
        if (json.emailWarning) {
          setApprovalMsg(`Approved. Email warning: ${json.emailWarning}`)
        } else if (json.email?.reason === 'no_accountant_address') {
          setApprovalMsg('Approved. Accountant email is not configured — set it in Settings.')
        } else {
          setApprovalMsg('Approved. Accountant email sent ✓')
        }
        await load()
        broadcastExpenseStatusChanged()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setApproving(false)
  }

  async function recallReport() {
    if (!canRecall || !report) return
    if (!confirm('Recall this report from review? It will return to active so you can edit and re-submit.')) return
    setRecalling(true); setError(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${report.id}/recall`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not recall.')
      } else {
        setReport(p => p ? { ...p, status: 'active', submitted_at: null } : p)
        broadcastExpenseStatusChanged()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setRecalling(false)
  }

  async function markPaid() {
    if (!canMarkPaid || !report) return
    if (!confirm('Mark this report as paid?')) return
    setPaying(true); setError(null)
    try {
      const res = await authedFetch(`/api/expense-reports/${report.id}/mark-paid`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not mark paid.')
      } else {
        await load()
        broadcastExpenseStatusChanged()
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setPaying(false)
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
            {totalsByCategory.length === 0 && Number(report.comp_rate || 0) === 0 ? (
              <span style={{ color: 'var(--mist)', fontSize: 12, fontStyle: 'italic' }}>No expenses or compensation yet.</span>
            ) : (
              <>
                {totalsByCategory.map(([cat, amt]) => (
                  <span key={cat} style={{
                    padding: '3px 9px', borderRadius: 6,
                    background: 'var(--cream2)', color: 'var(--ink)',
                    fontSize: 12, fontWeight: 700,
                  }}>
                    {categoryIcon(cat)} {categoryLabel(cat)} · {formatCurrency(amt)}
                  </span>
                ))}
                {Number(report.comp_rate || 0) > 0 && (
                  <span style={{
                    padding: '3px 9px', borderRadius: 6,
                    background: '#D1FAE5', color: '#065F46',
                    fontSize: 12, fontWeight: 700,
                  }}>
                    💼 Compensation · {formatCurrency(report.comp_rate)}
                  </span>
                )}
              </>
            )}
          </div>
          <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--ink)' }}>
            Grand total: {formatCurrency(report.grand_total)}
          </div>
        </div>
      </div>

      {/* Template checklist (when one was applied at creation) */}
      {report.template_id && (
        <TemplateChecklist templateId={report.template_id} expenses={expenses} />
      )}

      {/* Compensation card (Option A — per-trip rate) */}
      <CompensationCard
        rate={Number(report.comp_rate || 0)}
        canMutate={canMutate}
        onSave={updateCompRate}
      />

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Add Receipt (OCR) — primary, mobile-first action */}
      {canMutate && (
        <div style={{ marginBottom: 10 }}>
          <AddReceiptButton reportId={report.id} onAdded={load} />
        </div>
      )}

      {/* Add Mileage — calculated from home → store → home */}
      {canMutate && (
        <div style={{ marginBottom: 10 }}>
          <AddMileageButton reportId={report.id} onAdded={load} />
        </div>
      )}

      {/* Manual entry fallback */}
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
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-outline btn-sm"
            onClick={viewPdf} disabled={pdfBusy || expenses.length === 0}
            title={expenses.length === 0 ? 'Add an expense first.' : ''}>
            {pdfBusy ? 'Generating…' : 'View PDF'}
          </button>
          {isAdmin && (
            <button className="btn-outline btn-sm"
              onClick={sendToAccountant} disabled={emailBusy || expenses.length === 0}
              title={expenses.length === 0 ? 'Add an expense first.' : 'Email this report to the configured accountant.'}>
              {emailBusy ? 'Sending…' : 'Send to Accountant'}
            </button>
          )}
          {emailMsg && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{emailMsg}</span>}
          {report.accountant_email_sent_at && (
            <span style={{ fontSize: 11, color: 'var(--mist)' }}>
              Last sent {new Date(report.accountant_email_sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {report.status === 'active' && isOwner && (
            <button className="btn-primary"
              onClick={submitForReview}
              disabled={!canSubmit || submitting}
              title={canSubmit ? '' : 'Add at least one expense or set a compensation amount before submitting.'}>
              {submitting ? 'Submitting…' : 'Submit for Review'}
            </button>
          )}
          {canRecall && (
            <button className="btn-outline"
              onClick={recallReport}
              disabled={recalling}
              title="Pulls the report back to active so you can edit and re-submit.">
              {recalling ? 'Recalling…' : '↩ Recall'}
            </button>
          )}
          {canApprove && (
            <button className="btn-primary"
              style={{ background: '#065F46' }}
              onClick={approveReport}
              disabled={approving}
              title="Approves the report and emails the PDF to the accountant.">
              {approving ? 'Approving…' : '✓ Approve'}
            </button>
          )}
          {canMarkPaid && (
            <button className="btn-primary"
              onClick={markPaid}
              disabled={paying}>
              {paying ? 'Marking…' : 'Mark Paid'}
            </button>
          )}
        </div>
      </div>

      {approvalMsg && (
        <div style={{ marginTop: 10, padding: 10, background: '#D1FAE5', color: '#065F46', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
          {approvalMsg}
        </div>
      )}

      {report.status !== 'active' && (
        <div style={{ marginTop: 12, padding: 12, textAlign: 'center', background: 'var(--cream2)', borderRadius: 8, color: 'var(--ash)', fontSize: 13 }}>
          Locked — this report is {STATUS_LABEL[report.status].toLowerCase()}.
          {canRecall && ' Use Recall to edit and re-submit.'}
          {isAdmin && !canRecall && ' (Admins can still edit.)'}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' }}>
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
const SOURCE_BADGE: Partial<Record<Expense['source'], { label: string; bg: string; fg: string }>> = {
  travel_module: { label: '✈️ from Travel', bg: '#DBEAFE', fg: '#1E40AF' },
  ocr:           { label: '📷 OCR',         bg: '#FEF3C7', fg: '#92400E' },
  magic_inbox:   { label: '✉️ inbox',        bg: '#E0E7FF', fg: '#3730A3' },
  mileage_calc:  { label: '🛣 calc',         bg: '#D1FAE5', fg: '#065F46' },
}

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

  const sourceBadge = SOURCE_BADGE[expense.source]

  return (
    <div className="card" style={{ padding: 12 }}>
      {sourceBadge && (
        <div style={{ marginBottom: 8 }}>
          <span style={{
            display: 'inline-block',
            background: sourceBadge.bg, color: sourceBadge.fg,
            padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 800,
          }}>{sourceBadge.label}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' }}>
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

// ── Compensation card (Option A: per-trip rate) ──────────
function CompensationCard({
  rate, canMutate, onSave,
}: {
  rate: number
  canMutate: boolean
  onSave: (next: number) => Promise<void>
}) {
  const [local, setLocal] = useState<string>(String(rate))
  // Keep in sync if the parent value changes (e.g. trigger-recompute, refresh).
  useEffect(() => { setLocal(String(rate)) }, [rate])

  function commit() {
    if (!canMutate) return
    const n = Number(local)
    if (!Number.isFinite(n) || n < 0) {
      setLocal(String(rate)); return
    }
    void onSave(n)
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(160px, 200px)', gap: 12, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
            💼 Compensation (your time / event rate)
          </div>
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            Per-trip rate. Defaults to your role's standard rate; edit before submitting.
          </div>
        </div>
        <div>
          <label style={lbl}>Amount</label>
          <input type="number" step="0.01" min="0" value={local}
            disabled={!canMutate}
            onChange={e => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
            placeholder="0.00" />
        </div>
      </div>
    </div>
  )
}
