// Trunk show special requests. Sales rep adds free-text;
// office staff (configured in office_staff_notification_recipients)
// gets emailed and can mark requests acknowledged / completed.

import { supabase } from '@/lib/supabase'

export type SpecialRequestStatus = 'open' | 'acknowledged' | 'completed'

export interface SpecialRequest {
  id: string
  trunk_show_id: string
  request_text: string
  created_by: string | null
  created_at: string
  status: SpecialRequestStatus
  acknowledged_by: string | null
  acknowledged_at: string | null
}

const COLS = `id, trunk_show_id, request_text, created_by, created_at,
  status, acknowledged_by, acknowledged_at`

export async function listRequests(trunkShowId: string): Promise<SpecialRequest[]> {
  const { data, error } = await supabase
    .from('trunk_show_special_requests').select(COLS)
    .eq('trunk_show_id', trunkShowId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as SpecialRequest[]
}

/**
 * Submit via the API route so we can fan out emails to the
 * configured office-staff recipients in the same call. Direct
 * supabase insert would skip the email side-effect.
 */
export async function createRequest(trunkShowId: string, text: string): Promise<SpecialRequest> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const res = await fetch(`/api/trunk-shows/${trunkShowId}/special-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ request_text: text }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.request) {
    throw new Error(json?.error || `Save failed (${res.status})`)
  }
  return json.request as SpecialRequest
}

export async function setRequestStatus(id: string, status: SpecialRequestStatus, acknowledgedBy?: string | null): Promise<void> {
  const update: any = { status }
  if (status !== 'open') {
    update.acknowledged_by = acknowledgedBy || null
    update.acknowledged_at = new Date().toISOString()
  } else {
    update.acknowledged_by = null
    update.acknowledged_at = null
  }
  const { error } = await supabase
    .from('trunk_show_special_requests').update(update).eq('id', id)
  if (error) throw new Error(error.message)
}
