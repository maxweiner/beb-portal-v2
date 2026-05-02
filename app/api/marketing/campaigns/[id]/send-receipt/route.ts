// POST /api/marketing/campaigns/[id]/send-receipt
//
// Manual re-send of the accountant receipt email + PDF. Mark as Paid
// fires this automatically; this route is the affordance for "the
// original email got lost" or "we updated the campaign details after
// it was paid."
//
// Auth: marketing_access required.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendMarketingReceiptForCampaign } from '@/lib/marketing/sendAccountantReceipt'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  try {
    const result = await sendMarketingReceiptForCampaign(params.id)
    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        reason: result.reason,
        error: result.error,
      }, { status: result.reason === 'no_accountant_address' ? 400 : 500 })
    }
    return NextResponse.json({ ok: true, pdfPath: result.pdfPath })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
