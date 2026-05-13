// QuickBooks Online CSV generator for expense-report → Bill.
//
// QBO doesn't accept a native Bill-with-splits import. The
// expected path is one of:
//   - SaasAnt Transactions (most common)
//   - Transaction Pro Importer
//   - Intuit's Spreadsheet Sync
// All three accept the same broad shape: multi-row per bill,
// grouped by RefNumber, with category split + amount on each
// row. Column names below match SaasAnt's "Bills Import" template
// since it's the most lenient — Transaction Pro + Spreadsheet
// Sync ignore extra columns and read what they need.
//
// One report → multiple rows in the CSV (one per category
// split). The tool groups them into a single Bill by matching
// RefNumber.

import type {
  Expense, ExpenseCategory, ExpenseReport, QuickbooksAccountMapping,
} from '@/types'

export interface CsvBuildInput {
  report: ExpenseReport
  expenses: Expense[]
  vendor: { name: string }
  event: { label: string; date: string }
  mapping: QuickbooksAccountMapping
}

/** Build a complete .csv payload (one report → N rows, one per
 *  category split, all sharing the same RefNumber). */
export function buildExpenseReportCsv(input: CsvBuildInput): string {
  const { report, expenses, vendor, event, mapping } = input

  const headers = [
    'RefNumber',      // bill identifier — same across all rows of one bill
    'Vendor',
    'BillDate',
    'DueDate',
    'BillNo',         // mirror of RefNumber — SaasAnt expects both
    'Memo',           // bill-level memo
    'Account',        // GL account for THIS split
    'LineDescription',
    'LineAmount',
    'Currency',
    'Class',          // optional, blank for now
    'Location',       // optional, blank for now
  ]

  const billDate = formatCsvDate(new Date(event.date))
  const billMemo = `${event.label} · ${report.report_number}`

  // Aggregate by category + filter out credit-card-paid.
  const byCat = new Map<ExpenseCategory, { total: number; memos: string[] }>()
  for (const e of expenses) {
    if (e.paid_by_credit_card) continue
    const cur = byCat.get(e.category) || { total: 0, memos: [] }
    cur.total += Number(e.amount || 0)
    const piece = [e.vendor, e.notes].filter(Boolean).join(' · ')
    if (piece) cur.memos.push(piece)
    byCat.set(e.category, cur)
  }

  type Split = { account: string; amount: number; description: string }
  const splits: Split[] = []
  for (const [cat, agg] of byCat.entries()) {
    if (agg.total === 0) continue
    const account = mapping[cat as keyof QuickbooksAccountMapping] as string | undefined
                  || fallbackAccountFor(cat)
    splits.push({
      account,
      amount: round2(agg.total),
      description: agg.memos.slice(0, 3).join(' · ') || categoryLabel(cat),
    })
  }
  const comp = Number(report.total_compensation || 0)
  if (comp > 0) {
    splits.push({
      account: mapping.compensation || 'Buyer Compensation',
      amount: round2(comp),
      description: `Trip compensation (rate $${report.comp_rate})`,
    })
  }
  const bonus = Number(report.bonus_amount || 0)
  if (bonus > 0) {
    splits.push({
      account: mapping.bonus || 'Buyer Bonus',
      amount: round2(bonus),
      description: report.bonus_note || 'Partner-granted bonus',
    })
  }

  const rows: string[][] = []
  for (const s of splits) {
    rows.push([
      report.report_number,
      vendor.name,
      billDate,
      billDate,              // DueDate — Diane sets terms in QBO; same date as bill
      report.report_number,  // BillNo mirror
      billMemo,
      s.account,
      s.description,
      s.amount.toFixed(2),
      'USD',
      '',                    // Class
      '',                    // Location
    ])
  }

  const out = [headers, ...rows].map(row => row.map(csvField).join(',')).join('\r\n')
  return out + '\r\n'
}

// ── helpers ─────────────────────────────────────────────────────

function formatCsvDate(d: Date): string {
  // ISO-like MM/DD/YYYY is universally accepted by QBO importers.
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

function csvField(v: string): string {
  const s = String(v ?? '')
  // Quote any cell that contains comma, quote, or newline. Escape
  // embedded quotes by doubling. Standard RFC 4180.
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fallbackAccountFor(cat: ExpenseCategory): string {
  switch (cat) {
    case 'flight':            return 'Travel:Flight'
    case 'rental_car':        return 'Travel:Rental Car'
    case 'rideshare':         return 'Travel:Ground Transportation'
    case 'hotel':             return 'Travel:Hotel'
    case 'meals':             return 'Travel:Meals'
    case 'shipping_supplies': return 'Supplies:Shipping'
    case 'jewelry_lots_cash': return 'Cost of Goods Sold:Jewelry Purchases'
    case 'mileage':           return 'Travel:Mileage'
    case 'custom':            return 'Travel:Other'
    default:                  return 'Travel:Other'
  }
}

function categoryLabel(c: ExpenseCategory): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}
