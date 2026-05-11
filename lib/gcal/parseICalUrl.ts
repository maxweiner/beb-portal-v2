// Google Calendar "Secret address in iCal format" parser.
//
// The URL Google hands operators looks like:
//   https://calendar.google.com/calendar/ical/<urlencoded-calendar-id>/private-<hash>/basic.ics
//
// We need the bare Calendar ID for write API calls — the segment
// between `/ical/` and `/private-` (URL-decoded). The full URL gets
// stored separately as the rep's subscribe link.
//
// Public-format URLs (calendar marked public-readable) use
// `/public/basic.ics` instead of `/private-<hash>/basic.ics`; we
// accept both shapes so a misconfigured calendar at least parses.

export interface ParsedICal {
  calendarId: string
  /** The original URL, kept verbatim so we can store it as the
   *  rep's subscribe link. */
  icalUrl: string
}

export function parseICalUrl(input: string | null | undefined): ParsedICal | null {
  if (!input) return null
  const trimmed = String(input).trim()
  if (!trimmed) return null
  // Match either private-<hash>/basic.ics or public/basic.ics.
  // `[^/]+` captures the URL-encoded calendar id segment.
  const m = trimmed.match(/\/calendar\/ical\/([^/]+)\/(?:private-[^/]+|public)\/basic\.ics/i)
  if (!m) return null
  try {
    const calendarId = decodeURIComponent(m[1])
    if (!calendarId) return null
    return { calendarId, icalUrl: trimmed }
  } catch {
    return null
  }
}
