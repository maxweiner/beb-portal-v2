// POST /api/expense-reports/[id]/export-quickbooks?format=iif|csv
//
// Builds the IIF (QBD) or CSV (QBO) for a single approved /
// paid expense report and streams it back as a download. Also
// stamps expense_reports.exported_to_qb_at + _format so the
// Accounting Hub can show an "Exported ✓" pill and warn
// before re-exporting.
//
// Auth: admin / superadmin / partner / accounting — same gating
// as the Accounting Hub itself (anyone who can see + approve
// reports can export them).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { buildExpenseReportIif } from '@/lib/quickbooks/iif'
import { buildExpenseReportCsv } from '@/lib/quickbooks/csv'
import type {
  Expense, ExpenseReport, QuickbooksAccountMapping,
} from '@/types'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isAllowed(me: any): boolean {
  if (!me) return false
  return isAdminLike(me) || me.role === 'accounting' || me.is_partner === true
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const format = (url.searchParams.get('format') || 'iif').toLowerCase()
  if (format !== 'iif' && format !== 'csv') {
    return NextResponse.json({ error: 'format must be iif or csv' }, { status: 400 })
  }

  const sb = admin()

  // ── Load report + line items + owner + event + mapping in
  //    parallel. The mapping comes from the settings row seeded
  //    by supabase-migration-quickbooks-export.sql; the export
  //    falls back to hardcoded defaults per-category if a key
  //    is missing so a future new category doesn't crash here.
  const [
    { data: report, error: rErr },
    { data: expenses, error: eErr },
    { data: mappingRow },
  ] = await Promise.all([
    sb.from('expense_reports').select('*').eq('id', params.id).maybeSingle(),
    sb.from('expenses').select('*').eq('expense_report_id', params.id).order('expense_date'),
    sb.from('settings').select('value').eq('key', 'quickbooks.account_mapping').maybeSingle(),
  ])

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  // Owner (the buyer — becomes the Vendor on the Bill) +
  // event for the trip label/date.
  const [{ data: owner }, { data: event }] = await Promise.all([
    sb.from('users')
      .select('name, email, phone, home_address')
      .eq('id', (report as any).user_id)
      .maybeSingle(),
    (report as any).event_id
      ? sb.from('events')
          .select('store_name, store_city, store_state, start_date')
          .eq('id', (report as any).event_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
  ])

  if (!owner) return NextResponse.json({ error: 'Report owner not found' }, { status: 500 })

  const ownerRow = owner as { name?: string; email?: string; phone?: string; home_address?: string }
  const eventRow = event as { store_name?: string; store_city?: string; store_state?: string; start_date?: string } | null

  // ── Build vendor + event payloads for the generator.
  //
  // Vendor name is "Last, First" so QB lists alphabetically and
  // doesn't fork on minor variations. If the user row only has
  // a single-token name (rare — Display Name field), we still
  // emit something usable.
  const vendor = {
    name: formatVendorName(ownerRow.name || ''),
    email: ownerRow.email || null,
    phone: ownerRow.phone || null,
    address: ownerRow.home_address || null,
  }
  const eventLabel = eventRow
    ? `${eventRow.store_name || 'Event'}${eventRow.store_city ? ` (${eventRow.store_city}${eventRow.store_state ? ', ' + eventRow.store_state : ''})` : ''}`
    : 'Trip'
  const eventDate = eventRow?.start_date || new Date().toISOString().slice(0, 10)

  const mapping = ((mappingRow?.value as any) || {}) as QuickbooksAccountMapping
  // Merge with hardcoded defaults so missing keys don't surface
  // as 'undefined' in the generated file.
  const fullMapping: QuickbooksAccountMapping = {
    flight:            mapping.flight            || 'Travel:Flight',
    rental_car:        mapping.rental_car        || 'Travel:Rental Car',
    rideshare:         mapping.rideshare         || 'Travel:Ground Transportation',
    hotel:             mapping.hotel             || 'Travel:Hotel',
    meals:             mapping.meals             || 'Travel:Meals',
    shipping_supplies: mapping.shipping_supplies || 'Supplies:Shipping',
    jewelry_lots_cash: mapping.jewelry_lots_cash || 'Cost of Goods Sold:Jewelry Purchases',
    mileage:           mapping.mileage           || 'Travel:Mileage',
    custom:            mapping.custom            || 'Travel:Other',
    compensation:      mapping.compensation      || 'Buyer Compensation',
    bonus:             mapping.bonus             || 'Buyer Bonus',
    ap_account:        mapping.ap_account        || 'Accounts Payable',
  }

  const buildInput = {
    report: report as ExpenseReport,
    expenses: (expenses || []) as Expense[],
    vendor,
    event: { label: eventLabel, date: eventDate },
    mapping: fullMapping,
  }

  const payload = format === 'iif'
    ? buildExpenseReportIif(buildInput)
    : buildExpenseReportCsv(buildInput)

  // Mark exported on the row — best-effort, non-fatal if it
  // fails. The Accounting Hub uses this for the "Exported ✓"
  // pill + re-export warning.
  void sb.from('expense_reports').update({
    exported_to_qb_at: new Date().toISOString(),
    exported_to_qb_format: format,
  }).eq('id', params.id)

  const reportNumber = (report as any).report_number || `report-${params.id.slice(0, 8)}`
  const filename = `${reportNumber}.${format}`
  const contentType = format === 'iif' ? 'application/octet-stream' : 'text/csv'

  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** "Ryan Smith" → "Smith, Ryan" so QB sorts alphabetically. Skips
 *  the reorder if the name is already in "Last, First" form (has
 *  a comma) or is a single token. */
function formatVendorName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '(unknown)'
  if (trimmed.includes(',')) return trimmed
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return trimmed
  const last = parts[parts.length - 1]
  const first = parts.slice(0, -1).join(' ')
  return `${last}, ${first}`
}
