'use client'

// Partner-only management UI for trip templates. Lives inside the
// Settings page as its own card. Read access is broad (RLS lets every
// signed-in user select), but mutation is gated to is_partner=true.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'
import { CATEGORY_OPTIONS, categoryLabel, categoryIcon } from '@/components/expenses/expensesUtils'
import type { ExpenseCategory, ExpenseReportTemplate } from '@/types'

interface DraftTemplate {
  id?: string
  name: string
  description: string
  estimated_days: string
  expected_categories: ExpenseCategory[]
  is_active: boolean
}

const EMPTY_DRAFT: DraftTemplate = {
  name: '',
  description: '',
  estimated_days: '',
  expected_categories: [],
  is_active: true,
}

export default function TripTemplatesSettings() {
  const [templates, setTemplates] = useState<ExpenseReportTemplate[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<DraftTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    const { data, error: err } = await supabase
      .from('expense_report_templates').select('*').order('name', { ascending: true })
    if (err) { setError(err.message); setLoaded(true); return }
    setTemplates((data ?? []) as ExpenseReportTemplate[])
    setLoaded(true)
  }
  useEffect(() => { reload() }, [])

  function startCreate() { setEditing({ ...EMPTY_DRAFT }) }
  function startEdit(t: ExpenseReportTemplate) {
    setEditing({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      estimated_days: t.estimated_days != null ? String(t.estimated_days) : '',
      expected_categories: [...t.expected_categories],
      is_active: t.is_active,
    })
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(null)
    const days = editing.estimated_days.trim() ? Math.max(1, Math.floor(Number(editing.estimated_days))) : null
    const payload = {
      name: editing.name.trim(),
      description: editing.description.trim() || null,
      estimated_days: days,
      expected_categories: editing.expected_categories,
      is_active: editing.is_active,
    }
    const res = editing.id
      ? await supabase.from('expense_report_templates').update(payload).eq('id', editing.id)
      : await supabase.from('expense_report_templates').insert(payload)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setEditing(null)
    await reload()
  }

  async function remove(id: string) {
    if (!confirm('Delete this template? Reports already using it keep their checklist.')) return
    setError(null)
    const { error: err } = await supabase.from('expense_report_templates').delete().eq('id', id)
    if (err) { setError(err.message); return }
    await reload()
  }

  function toggleCategory(c: ExpenseCategory) {
    if (!editing) return
    setEditing(d => d ? {
      ...d,
      expected_categories: d.expected_categories.includes(c)
        ? d.expected_categories.filter(x => x !== c)
        : [...d.expected_categories, c],
    } : d)
  }

  if (!loaded) return null

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>🗺 Trip Templates</span>
        <button className="btn-outline btn-xs" onClick={startCreate}>+ Add Template</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.6 }}>
        Reusable templates buyers can apply when they create an expense report.
        Each template lists the expense categories typically required for that
        kind of trip; the report's checklist greys those out as receipts arrive.
      </p>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {templates.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>
          No templates yet. Click <strong>+ Add Template</strong> to make one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {templates.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 10, borderRadius: 8, background: '#fff', border: '1px solid var(--cream2)',
              opacity: t.is_active ? 1 : 0.55,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, color: 'var(--ink)' }}>
                  {t.name}
                  {!t.is_active && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--mist)' }}>(inactive)</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                  {t.estimated_days ? `${t.estimated_days} day${t.estimated_days === 1 ? '' : 's'} · ` : ''}
                  {t.expected_categories.length === 0
                    ? 'No expected categories'
                    : t.expected_categories.map(c => `${categoryIcon(c)} ${categoryLabel(c)}`).join(' · ')}
                </div>
                {t.description && (
                  <div style={{ fontSize: 12, color: 'var(--ash)', marginTop: 2, fontStyle: 'italic' }}>{t.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-outline btn-xs" onClick={() => startEdit(t)}>Edit</button>
                <button className="btn-outline btn-xs" onClick={() => remove(t.id)}
                  style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div onClick={e => e.target === e.currentTarget && setEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
                {editing.id ? 'Edit template' : 'New template'}
              </h2>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
            </div>

            <div className="field">
              <label className="fl">Name *</label>
              <input type="text" value={editing.name}
                placeholder="e.g. Phoenix Convention Center 4-day"
                onChange={e => setEditing(d => d ? { ...d, name: e.target.value } : d)} />
            </div>

            <div className="field">
              <label className="fl">Description (optional)</label>
              <textarea rows={2} value={editing.description}
                placeholder="Notes for the buyer when they apply this template"
                onChange={e => setEditing(d => d ? { ...d, description: e.target.value } : d)} />
            </div>

            <div className="field">
              <label className="fl">Estimated days</label>
              <input type="number" min="1" step="1" value={editing.estimated_days}
                placeholder="e.g. 4"
                onChange={e => setEditing(d => d ? { ...d, estimated_days: e.target.value } : d)} />
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                Shown in the buyer's checklist hint (e.g. "meals (4 days)").
              </div>
            </div>

            <div className="field">
              <label className="fl">Expected categories</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                {CATEGORY_OPTIONS.map(o => (
                  <label key={o.value}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#fff', border: '1px solid var(--cream2)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                    <Checkbox checked={editing.expected_categories.includes(o.value)}
                      onChange={() => toggleCategory(o.value)} />
                    <span>{o.icon} {o.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                <Checkbox checked={editing.is_active}
                  onChange={() => setEditing(d => d ? { ...d, is_active: !d.is_active } : d)} />
                Active (selectable when creating new reports)
              </label>
            </div>

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEditing(null)} className="btn-outline btn-sm">Cancel</button>
              <button onClick={save} className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editing.id ? 'Save changes' : 'Create template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
