// Leads pipeline helpers. Phase 6 ships manual CRUD; Phase 7
// adds the OCR business-card scan path; Phase 8 auto-assigns by
// territory; Phase 16 wires lead → trunk-show conversion.
//
// RLS from the Phase 1 schema gates access:
//   admin / superadmin / partner: all leads
//   sales_rep: leads where assigned_rep_id OR captured_by_user_id
//              matches the effective user
//   buyer: nothing

import { supabase } from '@/lib/supabase'
import type { Lead, LeadInterestLevel, LeadStatus } from '@/types'
import { lookupTerritoryRep } from './territories'

const COLS = `id, first_name, last_name, company_name, title,
  email, phone, address_line_1, address_line_2, city, state, zip,
  website, assigned_rep_id, captured_at_trade_show_id,
  captured_by_user_id, interest_level, interest_description,
  follow_up_date, status, converted_to_store_id, notes,
  business_card_image_url, ocr_extracted_data,
  created_at, updated_at, deleted_at`

export interface LeadDraft {
  first_name: string
  last_name: string
  company_name?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
  address_line_1?: string | null
  address_line_2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  website?: string | null
  assigned_rep_id?: string | null
  captured_at_trade_show_id?: string | null
  captured_by_user_id?: string | null
  interest_level?: LeadInterestLevel | null
  interest_description?: string | null
  follow_up_date?: string | null
  status?: LeadStatus
  notes?: string | null
}

export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads').select(COLS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as Lead[]
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads').select(COLS).eq('id', id)
    .is('deleted_at', null).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Lead) || null
}

export async function createLead(draft: LeadDraft): Promise<Lead> {
  // Normalize empty strings → null on optional fields so the DB
  // gets a clean NULL rather than ''.
  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

  // Phase 8: territory-based auto-assignment. If the caller didn't
  // pick a rep, look up the lead's state in sales_rep_territories.
  // No mapping → leave assigned_rep_id null so admin can route
  // manually (the leads list filters can surface unassigned).
  let assignedRepId: string | null = draft.assigned_rep_id || null
  if (!assignedRepId && draft.state) {
    try {
      assignedRepId = await lookupTerritoryRep(draft.state)
    } catch { /* swallow — fall back to null */ }
  }

  const payload = {
    first_name: draft.first_name.trim(),
    last_name:  draft.last_name.trim(),
    company_name:    norm(draft.company_name),
    title:           norm(draft.title),
    email:           norm(draft.email),
    phone:           norm(draft.phone),
    address_line_1:  norm(draft.address_line_1),
    address_line_2:  norm(draft.address_line_2),
    city:            norm(draft.city),
    state:           norm(draft.state),
    zip:             norm(draft.zip),
    website:         norm(draft.website),
    assigned_rep_id: assignedRepId,
    captured_at_trade_show_id: draft.captured_at_trade_show_id || null,
    captured_by_user_id:       draft.captured_by_user_id || null,
    interest_level:        draft.interest_level || null,
    interest_description:  norm(draft.interest_description),
    follow_up_date:        draft.follow_up_date || null,
    status:                draft.status || 'new',
    notes:                 norm(draft.notes),
  }
  const { data, error } = await supabase.from('leads').insert(payload).select(COLS).single()
  if (error) throw new Error(error.message)
  return data as Lead
}

export async function updateLead(id: string, patch: Partial<LeadDraft>): Promise<void> {
  const norm = (v: string | null | undefined) => (v === undefined ? undefined : (v && v.trim() ? v.trim() : null))
  const update: any = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (typeof v === 'string') update[k] = norm(v)
    else update[k] = v
  }
  if (Object.keys(update).length === 0) return
  const { error } = await supabase.from('leads').update(update).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function softDeleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
