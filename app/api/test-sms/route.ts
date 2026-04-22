import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/sms'

export async function POST(request: NextRequest) {
  try {
    const { to } = await request.json()
    if (!to) return NextResponse.json({ error: 'to is required' }, { status: 400 })
    await sendSMS(to, '✅ BEB Portal SMS test — your notifications are working!')
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('test-sms error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
