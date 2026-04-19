import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 })
  }

  let decoded = decodeURIComponent(url)
  // Handle double-encoded URLs (e.g. %2540 -> %40 -> @)
  if (decoded.includes('%40')) decoded = decodeURIComponent(decoded)

  // Security: only allow Google Calendar and SimplyBook URLs
  const allowed = ['calendar.google.com', 'simplybook.me', 'simplybook.it']
  if (!allowed.some(d => decoded.includes(d))) {
    return NextResponse.json({ error: 'Only Google Calendar and SimplyBook URLs are allowed' }, { status: 403 })
  }

  try {
    const res = await fetch(decoded, {
      headers: {
        'User-Agent': 'BeneficialOS-BuyerPortal/2.0',
        'Accept': 'text/calendar, */*',
      },
      next: { revalidate: 300 }, // cache 5 minutes
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}`, hint: res.status === 403 ? 'Use the Secret iCal address from Google Calendar Settings → Integrate calendar' : null },
        { status: res.status }
      )
    }

    const text = await res.text()
    if (!text.includes('BEGIN:VCALENDAR')) {
      return NextResponse.json({ error: 'Not a valid iCal feed' }, { status: 422 })
    }

    // Debug mode: return just timezone and DTSTART info
    if (request.nextUrl.searchParams.get('debug') === '1') {
      const lines = text.split(/\r?\n/)
      const info = lines.filter(l => 
        l.startsWith('DTSTART') || l.startsWith('X-WR-TIMEZONE') || 
        l.startsWith('TZID') || l.startsWith('BEGIN:VTIMEZONE')
      ).slice(0, 20)
      return NextResponse.json({ timezone_info: info })
    }

    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'max-age=300',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
