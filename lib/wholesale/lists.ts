// Helper to load + cache active admin-list values for the active
// brand. Most forms need a handful of these (jewelry_type,
// metal_karat, payment_method, …) and would otherwise round-trip
// once each on mount.

import { supabase } from '@/lib/supabase'

export interface AdminListEntry {
  value: string
  active: boolean
  sort_order: number
}

export async function loadAdminLists(brand: string, listKeys: string[]): Promise<Record<string, AdminListEntry[]>> {
  if (listKeys.length === 0) return {}
  const { data, error } = await supabase
    .from('wholesale_admin_lists')
    .select('list_key, value, active, sort_order')
    .eq('brand', brand)
    .in('list_key', listKeys)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  const out: Record<string, AdminListEntry[]> = {}
  for (const k of listKeys) out[k] = []
  for (const r of (data || []) as any[]) {
    if (!out[r.list_key]) out[r.list_key] = []
    out[r.list_key].push({ value: r.value, active: r.active, sort_order: r.sort_order })
  }
  return out
}

/** Active values for a single list key. */
export async function loadAdminList(brand: string, listKey: string): Promise<string[]> {
  const all = await loadAdminLists(brand, [listKey])
  return (all[listKey] || []).filter(e => e.active).map(e => e.value)
}
