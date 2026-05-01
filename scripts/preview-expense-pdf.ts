// Local-only: render a sample expense PDF with mock data so we can
// eyeball the wordmark logo placement on each page header without
// touching the DB. Run: npx tsx scripts/preview-expense-pdf.ts
import { writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { ExpenseReportPdf } from '../lib/expenses/pdf'

async function main() {
  const logoBytes = await readFile(path.join(process.cwd(), 'public', 'beb-wordmark.png'))
  const logo = { data: logoBytes, format: 'png' as const }
  const buf = await renderToBuffer(ExpenseReportPdf({
    report: {
      id: '11111111-2222-3333-4444-555555555555',
      user_id: 'u1',
      event_id: 'e1',
      status: 'submitted_pending_review',
      total_compensation: 750,
      grand_total: 1245.32,
      submitted_at: '2026-04-25T12:00:00Z',
      pdf_url: null,
    } as any,
    expenses: [
      { id: 'x1', expense_report_id: 'r', user_id: 'u', event_id: 'e', category: 'flight',
        custom_category_label: null, vendor: 'Delta', amount: 412.18, expense_date: '2026-04-22',
        notes: 'BWI → ATL', receipt_url: null, created_at: '', updated_at: '' } as any,
      { id: 'x2', expense_report_id: 'r', user_id: 'u', event_id: 'e', category: 'hotel',
        custom_category_label: null, vendor: 'Hilton Garden', amount: 268.40, expense_date: '2026-04-23',
        notes: '2 nights', receipt_url: null, created_at: '', updated_at: '' } as any,
      { id: 'x3', expense_report_id: 'r', user_id: 'u', event_id: 'e', category: 'meals',
        custom_category_label: null, vendor: 'Various', amount: 64.50, expense_date: '2026-04-23',
        notes: '', receipt_url: null, created_at: '', updated_at: '' } as any,
      { id: 'x4', expense_report_id: 'r', user_id: 'u', event_id: 'e', category: 'rideshare',
        custom_category_label: null, vendor: 'Uber', amount: 49.74, expense_date: '2026-04-24',
        notes: '', receipt_url: null, created_at: '', updated_at: '' } as any,
    ],
    event: { store_name: 'Goodman & Sons Jewelers, Williamsburg', start_date: '2026-04-23' },
    owner: { name: 'Max Weiner' },
    receipts: [],
    signatureUrl: null,
    logo,
  }) as any)
  const out = path.join(process.cwd(), 'docs', 'mockups', 'expense-pdf-sample.pdf')
  await writeFile(out, buf)
  console.log('Wrote', out, '(' + buf.length + ' bytes)')
}
main().catch(e => { console.error(e); process.exit(1) })
