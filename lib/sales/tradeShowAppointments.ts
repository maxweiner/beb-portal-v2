// Trade show booth appointments. Slots are created by booth staff
// within the show window (no per-day hours like trunk shows have);
// each slot is bookable manually OR via a magic-link URL.
//
// Statuses:
//   available — slot exists, nobody booked
//   booked    — someone has the slot
//   completed — meeting happened, staff marked it
//   cancelled — booked then cancelled
//   no_show   — booked but didn't show up

import { supabase } from '@/lib/supabase'

export type TradeShowAppointmentStatus = 'available' | 'booked' | 'completed' | 'cancelled' | 'no_show'

export interface TradeShowAppointment {
  id: string
  trade_show_id: string
  slot_start: string
  slot_end: string
  status: TradeShowAppointmentStatus
  booked_by_lead_id: string | null
  booked_by_external_name: string | null
  booked_by_external_email: string | null
  booked_by_external_phone: string | null
  assigned_staff_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const COLS = `id, trade_show_id, slot_start, slot_end, status,
  booked_by_lead_id, booked_by_external_name, booked_by_external_email,
  booked_by_external_phone, assigned_staff_id, notes,
  created_at, updated_at`

export async function listAppointments(tradeShowId: string): Promise<TradeShowAppointment[]> {
  const { data, error } = await supabase
    .from('trade_show_appointments').select(COLS)
    .eq('trade_show_id', tradeShowId)
    .order('slot_start', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as TradeShowAppointment[]
}

export interface AppointmentDraft {
  slot_start: string
  slot_end: string
  assigned_staff_id?: string | null
  notes?: string | null
}

export async function createSlot(tradeShowId: string, draft: AppointmentDraft): Promise<TradeShowAppointment> {
  const { data, error } = await supabase
    .from('trade_show_appointments')
    .insert({
      trade_show_id: tradeShowId,
      slot_start: draft.slot_start,
      slot_end:   draft.slot_end,
      status: 'available',
      assigned_staff_id: draft.assigned_staff_id || null,
      notes: draft.notes?.trim() || null,
    })
    .select(COLS).single()
  if (error) throw new Error(error.message)
  return data as TradeShowAppointment
}

export async function bulkCreateSlots(
  tradeShowId: string,
  drafts: AppointmentDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0
  const { error, count } = await supabase
    .from('trade_show_appointments')
    .insert(
      drafts.map(d => ({
        trade_show_id: tradeShowId,
        slot_start: d.slot_start,
        slot_end:   d.slot_end,
        status: 'available',
        assigned_staff_id: d.assigned_staff_id || null,
        notes: d.notes?.trim() || null,
      })),
      { count: 'exact' },
    )
  if (error) throw new Error(error.message)
  return count || 0
}

export interface BookingDraft {
  booked_by_lead_id?: string | null
  booked_by_external_name?: string | null
  booked_by_external_email?: string | null
  booked_by_external_phone?: string | null
  notes?: string | null
}

export async function bookSlot(slotId: string, booking: BookingDraft): Promise<void> {
  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const { error } = await supabase
    .from('trade_show_appointments').update({
      status: 'booked',
      booked_by_lead_id:        booking.booked_by_lead_id || null,
      booked_by_external_name:  norm(booking.booked_by_external_name),
      booked_by_external_email: norm(booking.booked_by_external_email),
      booked_by_external_phone: norm(booking.booked_by_external_phone),
      notes: booking.notes ? norm(booking.notes) : undefined,
    }).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function setSlotStatus(slotId: string, status: TradeShowAppointmentStatus): Promise<void> {
  const { error } = await supabase
    .from('trade_show_appointments').update({ status }).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function setAssignedStaff(slotId: string, staffId: string | null): Promise<void> {
  const { error } = await supabase
    .from('trade_show_appointments')
    .update({ assigned_staff_id: staffId }).eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function deleteSlot(slotId: string): Promise<void> {
  const { error } = await supabase
    .from('trade_show_appointments').delete().eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function generateBookingToken(tradeShowId: string): Promise<{ token: string; url: string }> {
  // Use crypto.randomUUID() — same approach as marketing module.
  // Token has no expiry by default; admin can rotate via the panel
  // by generating a new token (old one keeps working until purged).
  const token = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  const { error } = await supabase
    .from('trade_show_booking_tokens')
    .insert({ trade_show_id: tradeShowId, token })
  if (error) throw new Error(error.message)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return { token, url: `${origin}/trade-show-book/${token}` }
}
