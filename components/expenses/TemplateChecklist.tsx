'use client'

// Renders the "Don't forget to log: …" checklist for a report whose
// template_id is set. Items grey out / get a checkmark as expenses
// land in those categories. Read-only — the user marks items off by
// adding actual expenses, not by toggling the checklist.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { categoryIcon, categoryLabel } from './expensesUtils'
import type { Expense, ExpenseCategory, ExpenseReportTemplate } from '@/types'

export default function TemplateChecklist({
  templateId, expenses,
}: {
  templateId: string
  expenses: Expense[]
}) {
  const [template, setTemplate] = useState<ExpenseReportTemplate | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.from('expense_report_templates').select('*').eq('id', templateId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setTemplate((data ?? null) as ExpenseReportTemplate | null)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [templateId])

  if (!loaded || !template) return null
  if (template.expected_categories.length === 0) return null

  const haveByCategory = new Set<ExpenseCategory>()
  for (const e of expenses) haveByCategory.add(e.category)

  const allDone = template.expected_categories.every(c => haveByCategory.has(c))

  return (
    <div style={{
      marginBottom: 10, padding: 12, borderRadius: 8,
      background: '#FEF3C7', border: '1px solid #FCD34D',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#78350F', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {allDone ? '✅ Template checklist · all logged' : `📋 ${template.name} — don't forget to log:`}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {template.expected_categories.map(c => {
          const have = haveByCategory.has(c)
          const label = c === 'meals' && template.estimated_days
            ? `${categoryLabel(c)} (${template.estimated_days} days)`
            : categoryLabel(c)
          return (
            <span key={c} style={{
              padding: '4px 10px', borderRadius: 999,
              background: have ? '#D1FAE5' : '#fff',
              color: have ? '#065F46' : '#78350F',
              border: `1px solid ${have ? '#A7F3D0' : '#FCD34D'}`,
              fontSize: 12, fontWeight: 700,
              textDecoration: have ? 'line-through' : 'none',
              opacity: have ? 0.85 : 1,
            }}>
              {have ? '✓ ' : ''}{categoryIcon(c)} {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
