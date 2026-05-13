// GET /api/reconciliation/findings/[id]/dispute-letter
//
// Renders a one-page PDF dispute letter for a finding. Body is shaped
// by finding_type (amount_mismatch / duplicate_clearing / orphan_cleared
// / outstanding). Returns application/pdf inline so the browser can
// preview before saving.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { DisputeLetterPdf, type DisputeLetterData } from '@/lib/reconciliation/disputeLetterPdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const BRAND_FULL_NAME: Record<string, string> = {
  beb: 'Beneficial Estate Buyers, LLP',
  liberty: 'Liberty Estate Buyers, LLC',
}

function isAllowed(role: string | null | undefined, isPartner: boolean | null | undefined): boolean {
  return role === 'accounting' || role === 'admin' || role === 'superadmin' || isPartner === true
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me.role as any, (me as any).is_partner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = ctx.params.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sb = admin()
  const { data: finding, error } = await sb
    .from('reconciliation_findings')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !finding) {
    return NextResponse.json({ error: error?.message || 'Finding not found' }, { status: 404 })
  }

  // Pull the cleared rows for this check.
  const { data: clearings } = await sb
    .from('cleared_checks')
    .select('cleared_date, cleared_amount, description')
    .eq('brand', finding.brand)
    .eq('check_number', finding.check_number)
    .order('cleared_date', { ascending: true })

  // Optional: brand address from a settings row, if you ever populate one.
  // For now, leave null — the buyer can fill it in by hand on the printed
  // letter, or we can wire this up once the addresses are in `settings`.
  let brandAddress: string | null = null
  let accountLastFour: string | null = null
  const { data: settingsRows } = await sb
    .from('settings')
    .select('key, value')
    .in('key', [`reconciliation.${finding.brand}.address`, `reconciliation.${finding.brand}.account_last_four`])
  for (const r of (settingsRows || []) as any[]) {
    const v = typeof r.value === 'string' ? r.value : (r.value as any)
    const stripped = typeof v === 'string' ? v.replace(/^"|"$/g, '') : null
    if (r.key.endsWith('.address')) brandAddress = stripped
    if (r.key.endsWith('.account_last_four')) accountLastFour = stripped
  }

  const data: DisputeLetterData = {
    brand: finding.brand,
    brandFullName: BRAND_FULL_NAME[finding.brand] || finding.brand.toUpperCase(),
    brandAddress,
    preparedByName: me.name || me.email || '(unknown)',
    preparedByEmail: me.email || '',
    preparedAtIso: new Date().toISOString(),
    findingType: finding.finding_type as DisputeLetterData['findingType'],
    checkNumber: finding.check_number,
    writtenAmount: finding.written_amount != null ? Number(finding.written_amount) : null,
    writtenDate: finding.written_date,
    payeeLabel: finding.payee_label,
    eventLabel: finding.event_label,
    clearings: (clearings || []).map((c: any) => ({
      cleared_date: c.cleared_date,
      cleared_amount: Number(c.cleared_amount),
      description: c.description || '',
    })),
    totalCleared: finding.cleared_amount_total != null ? Number(finding.cleared_amount_total) : 0,
    amountDelta: finding.amount_delta != null ? Number(finding.amount_delta) : null,
    bankName: 'Wells Fargo Bank, N.A.',
    accountLastFour,
  }

  const buffer = await renderToBuffer(DisputeLetterPdf({ data }) as any)
  const filename = `dispute-${finding.brand}-check-${finding.check_number}.pdf`
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
