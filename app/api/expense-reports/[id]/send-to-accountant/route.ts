// POST /api/expense-reports/[id]/send-to-accountant
//
// Regenerates the PDF and emails it to the configured accountant
// address. Stamps accountant_email_sent_at.
//
// Auth: admin/superadmin only in PR3 (manual trigger). PR4's approval
// workflow will call this same module automatically when a report
// transitions to 'approved' (gated on is_partner there).

import { NextResponse } from 'next/server'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendAccountantEmailForReport } from '@/lib/expenses/sendAccountantEmail'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const portalBaseUrl =
    process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'

  try {
    const result = await sendAccountantEmailForReport(params.id, { portalBaseUrl })
    if (!result.ok) {
      const status = result.reason === 'no_accountant_address' ? 412 : 500
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Send failed' }, { status: 500 })
  }
}
