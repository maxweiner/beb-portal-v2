// Auth'd PDF opener. Plain <a href> links to /api/wholesale/* PDF
// routes don't include the bearer token getAuthedUser expects, so
// they 401 in a new tab. This helper fetches with the Supabase
// session token, materializes the blob, and opens it.

import { supabase } from '@/lib/supabase'

export async function openWholesalePdf(path: string): Promise<void> {
  const sess = await supabase.auth.getSession()
  const token = sess.data.session?.access_token || ''
  const res = await fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    let msg = `PDF failed (${res.status})`
    try { const j = await res.json(); msg = j?.error || msg } catch {}
    alert(msg)
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  // Revoke after a beat — give Safari a moment to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
