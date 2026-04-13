import { NextRequest, NextResponse } from 'next/server'

// With implicit flow, the session token comes back in the URL hash (#access_token=...)
// The browser client detects it automatically via detectSessionInUrl: true
// This route just redirects home — the client does the rest
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/', request.url))
}
