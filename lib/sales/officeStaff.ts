// Office-staff notification recipients. Either a BEB Portal user
// (user_id set) or an external email-only entry (email set).
// Recipients with both user_id and email get the email; user_id
// alone is fine if the user's portal account email lives in
// public.users.email.

import { supabase } from '@/lib/supabase'

export interface OfficeStaffRecipient {
  id: string
  user_id: string | null
  email: string | null
  is_active: boolean
  created_at: string
}

const COLS = `id, user_id, email, is_active, created_at`

export async function listRecipients(): Promise<OfficeStaffRecipient[]> {
  const { data, error } = await supabase
    .from('office_staff_notification_recipients').select(COLS)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as OfficeStaffRecipient[]
}

export async function addUserRecipient(userId: string): Promise<OfficeStaffRecipient> {
  const { data, error } = await supabase
    .from('office_staff_notification_recipients')
    .insert({ user_id: userId, is_active: true })
    .select(COLS).single()
  if (error) throw new Error(error.message)
  return data as OfficeStaffRecipient
}

export async function addEmailRecipient(email: string): Promise<OfficeStaffRecipient> {
  const { data, error } = await supabase
    .from('office_staff_notification_recipients')
    .insert({ email: email.trim(), is_active: true })
    .select(COLS).single()
  if (error) throw new Error(error.message)
  return data as OfficeStaffRecipient
}

export async function setActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('office_staff_notification_recipients')
    .update({ is_active: active }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function removeRecipient(id: string): Promise<void> {
  const { error } = await supabase
    .from('office_staff_notification_recipients').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
