// QuickBooks Desktop IIF generator for expense-report → Bill.
//
// IIF (Intuit Interchange Format) is QBD's native bulk-import
// format. It's plain tab-delimited text with header rows (lines
// starting with "!") declaring the column layout for each
// transaction type, followed by data rows.
//
// We emit two kinds of records per report:
//   1. !VEND record (skipped after first export per vendor) so
//      QBD auto-creates the buyer's vendor card on first run.
//   2. !TRNS BILL header + !SPL lines per expense category —
//      single Bill with N category splits. The Bill's credit
//      side is the AP account from the mapping (typically
//      "Accounts Payable").
//
// The buyer is the Vendor on the Bill. Pay-Bills happens in QB
// later when the reimbursement check / ACH is cut.

import type {
  Expense, ExpenseCategory, ExpenseReport, QuickbooksAccountMapping,
} from '@/types'

export interface IifBuildInput {
  report: ExpenseReport
  expenses: Expense[]
  vendor: {
    /** Display name used on the Bill + as the Vendor card. Format
     *  "Last, First" so QB lists alphabetically and so vendor
     *  cards don't fork on first-name variations. */
    name: string
    email?: string | null
    phone?: string | null
    /** Single-line home address — fine for QB's flat ADDR1 field. */
    address?: string | null
  }
  event: {
    /** Friendly label, e.g. "Acme Jewelers" or "Trunk · Westside". */
    label: string
    /** Trip date for the Bill header. */
    date: string
  }
  mapping: QuickbooksAccountMapping
  /** Per-line memo enricher: receipt count etc. for the bill memo. */
  receiptCountByExpenseId?: Record<string, number>
}

/** Build a complete .iif payload (one report → one Bill). */
export function buildExpenseReportIif(input: IifBuildInput): string {
  const { report, expenses, vendor, event, mapping } = input
  const lines: string[] = []

  // ── Header rows ─────────────────────────────────────────────
  //
  // Order matters in IIF: !HDR before any data, then !VEND
  // + !ENDGRP defining vendor-row schema, then !TRNS / !SPL /
  // !ENDTRNS defining the bill-row schema. After the schema
  // declarations come the actual rows tagged with the matching
  // record type at the start of the line.
  lines.push('!HDR\tPROD\tVER\tREL\tIIFVER\tDATE\tTIME\tACCNTNT\tACCNTNTSPLITTIME')
  lines.push(['HDR', 'BEB Portal', '1.0', 'R1', '1', formatIifDate(new Date()), '', '', ''].join('\t'))

  lines.push('!VEND\tNAME\tPRINTAS\tADDR1\tADDR2\tVTYPE\tCONT1\tPHONE1\tEMAIL\tNOTE\tTAXID\tLIMIT\tTERMS\tNOTEPAD\tSALUTATION\tCOMPANYNAME\tFIRSTNAME\tMIDINIT\tLASTNAME\t1099')
  lines.push('!ENDGRP')

  lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tNAMEISTAXABLE\tDUEDATE\tTERMS\tPAID\tSHIPVIA\tSHIPDATE\tREP\tFOB\tPONUM\tINVTITLE\tINVMEMO\tADDR1\tADDR2\tADDR3\tADDR4\tADDR5\tSADDR1\tSADDR2\tSADDR3\tSADDR4\tSADDR5\tTOSEND')
  lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tQNTY\tPRICE\tINVITEM\tPAYMETH\tTAXABLE\tVALADJ\tREIMBEXP\tSERVICEDATE\tOTHER2\tOTHER3\tEXTRA')
  lines.push('!ENDTRNS')

  // ── 1. Vendor record ────────────────────────────────────────
  //
  // Always emitted. QB matches existing vendors by NAME — so
  // re-importing for an existing buyer is a no-op, not a
  // duplicate. The address fields fold the single-line home
  // address into ADDR1 / ADDR2 cleanly: QB expects each line
  // separately but accepts a single-line ADDR1 with the
  // remainder in NOTEPAD.
  lines.push([
    'VEND',
    escapeIif(vendor.name),                  // NAME
    escapeIif(vendor.name),                  // PRINTAS
    escapeIif(vendor.address || ''),         // ADDR1
    '',                                      // ADDR2
    '',                                      // VTYPE
    escapeIif(vendor.name),                  // CONT1
    escapeIif(vendor.phone || ''),           // PHONE1
    escapeIif(vendor.email || ''),           // EMAIL
    `Buyer · ${escapeIif(report.report_number)}`, // NOTE
    '', '', '', '', '', '', '', '', '',      // TAXID..LASTNAME
    'N',                                     // 1099 — flip to 'Y' if buyer is a 1099 contractor
  ].join('\t'))
  lines.push('ENDGRP')

  // ── 2. Bill transaction ─────────────────────────────────────
  //
  // Build the per-category splits first so we know the grand
  // total (TRNS row is the credit side at the negative of the
  // sum). Excludes credit-card-paid line items — those are
  // already on the company card statement and would
  // double-book if exported as reimbursable. Compensation +
  // bonus get their own splits if present.
  const splits: Array<{ account: string; amount: number; memo: string }> = []

  // Group expenses by category, sum amounts, exclude paid-by-cc.
  const byCat = new Map<ExpenseCategory, { total: number; memos: string[] }>()
  for (const e of expenses) {
    if (e.paid_by_credit_card) continue
    const cur = byCat.get(e.category) || { total: 0, memos: [] }
    cur.total += Number(e.amount || 0)
    const piece = [e.vendor, e.notes].filter(Boolean).join(' · ')
    if (piece) cur.memos.push(piece)
    byCat.set(e.category, cur)
  }
  for (const [cat, agg] of byCat.entries()) {
    if (agg.total === 0) continue
    const account = mapping[cat as keyof QuickbooksAccountMapping] as string | undefined
                  || fallbackAccountFor(cat)
    splits.push({
      account,
      amount: round2(agg.total),
      memo: agg.memos.slice(0, 3).join(' · ') || categoryLabel(cat),
    })
  }
  // Comp + bonus, if any.
  const comp = Number(report.total_compensation || 0)
  if (comp > 0) {
    splits.push({
      account: mapping.compensation || 'Buyer Compensation',
      amount: round2(comp),
      memo: `Trip compensation (rate $${report.comp_rate})`,
    })
  }
  const bonus = Number(report.bonus_amount || 0)
  if (bonus > 0) {
    splits.push({
      account: mapping.bonus || 'Buyer Bonus',
      amount: round2(bonus),
      memo: report.bonus_note || 'Partner-granted bonus',
    })
  }

  const grandTotal = splits.reduce((s, x) => s + x.amount, 0)
  const billDate = formatIifDate(new Date(event.date))
  const billMemo = `${event.label} · ${report.report_number}`
  const apAccount = mapping.ap_account || 'Accounts Payable'

  // TRNS row — the Bill header. AMOUNT is negative (credit) of
  // the total, debiting AP. DOCNUM = our report_number so
  // search-by-ER-Bxxxxx finds the bill instantly.
  lines.push([
    'TRNS',
    '',                                       // TRNSID — let QB assign
    'BILL',                                   // TRNSTYPE
    billDate,                                 // DATE
    escapeIif(apAccount),                     // ACCNT (credit side)
    escapeIif(vendor.name),                   // NAME (vendor)
    '',                                       // CLASS
    `-${grandTotal.toFixed(2)}`,              // AMOUNT (negative = credit)
    escapeIif(report.report_number),          // DOCNUM
    escapeIif(billMemo),                      // MEMO
    'N',                                      // CLEAR
    'N',                                      // TOPRINT
    'N',                                      // NAMEISTAXABLE
    billDate,                                 // DUEDATE — same as bill date; Diane sets terms in QB
    '',                                       // TERMS
    'N',                                      // PAID
    '', '', '', '', '', '', '',               // SHIPVIA..INVMEMO
    escapeIif(vendor.address || ''),          // ADDR1
    '', '', '', '',                           // ADDR2..ADDR5
    '', '', '', '', '',                       // SADDR1..SADDR5
    'N',                                      // TOSEND
  ].join('\t'))

  // SPL rows — one per debit line.
  for (const s of splits) {
    lines.push([
      'SPL',
      '',                                     // SPLID
      'BILL',                                 // TRNSTYPE
      billDate,                               // DATE
      escapeIif(s.account),                   // ACCNT (debit)
      escapeIif(vendor.name),                 // NAME
      '',                                     // CLASS
      s.amount.toFixed(2),                    // AMOUNT (positive = debit)
      escapeIif(report.report_number),        // DOCNUM
      escapeIif(s.memo),                      // MEMO
      'N',                                    // CLEAR
      '', '', '', '', '', '', '', '', '', '', '',
    ].join('\t'))
  }
  lines.push('ENDTRNS')

  // IIF needs CRLF per Intuit's spec — LF-only sometimes works
  // but breaks on QBD Windows imports for older releases.
  return lines.join('\r\n') + '\r\n'
}

// ── helpers ─────────────────────────────────────────────────────

/** QB requires MM/DD/YYYY for dates in IIF. */
function formatIifDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

/** IIF is tab-delimited so tabs in field values would break the
 *  format. Replace tabs + newlines with a single space. Quotes
 *  + special chars are otherwise accepted as-is — IIF doesn't
 *  use CSV-style quoting. */
function escapeIif(v: string): string {
  return (v || '').replace(/[\t\r\n]+/g, ' ').trim()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Last-ditch fallback if the settings mapping is missing a
 *  category. Should rarely fire — the seed includes every
 *  current category — but prevents the export from crashing
 *  when a future category lands without a mapping entry. */
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
