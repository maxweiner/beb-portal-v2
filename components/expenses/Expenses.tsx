'use client'

// Expenses & Invoicing — main entry point. PR2 ships:
//   - List view (own reports for buyers; all reports for admin/superadmin)
//   - Detail view: header, line-item add/edit/delete, autosave indicator,
//     "Submit for Review" state transition.
//
// No OCR, no PDF generation, no accountant email, no compensation
// invoices yet — those land in PRs 3, 6, 7, 9.
//
// Uses the `supabase` anon-key client; PR1's RLS enforces that buyers
// only see their own reports and can only mutate while status='active'.

import { useState } from 'react'
import { useApp } from '@/lib/context'
import ExpensesList from './ExpensesList'
import ExpenseReportDetail from './ExpenseReportDetail'

export default function Expenses() {
  const { user } = useApp()
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>
        Sign in to view expenses.
      </div>
    )
  }

  if (selectedReportId) {
    return (
      <ExpenseReportDetail
        reportId={selectedReportId}
        onBack={() => setSelectedReportId(null)}
      />
    )
  }

  return (
    <ExpensesList onOpen={(reportId) => setSelectedReportId(reportId)} />
  )
}
