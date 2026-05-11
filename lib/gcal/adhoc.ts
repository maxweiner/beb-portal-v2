// Helpers shared between the /api/gcal-adhoc/events routes. Kept
// separate from lib/gcal/client.ts so the Google Calendar client
// stays generic.

export function portalAdHocUrlFor(adhocId: string): string {
  const base =
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  // Source.url on the Google event lets future dedupe / lookup
  // tools recognize ours by extracting `adhoc=<uuid>`.
  return `${base}/?nav=settings&adhoc=${adhocId}`
}
