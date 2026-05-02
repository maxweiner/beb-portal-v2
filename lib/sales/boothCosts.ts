// Helpers for the booth cost master list + per-trade-show line
// items. Phase 1 seeded the master list with 11 standard
// categories (Booth Space, Lighting, Showcases, etc.). Admin can
// archive / reorder / add new ones; the dropdown filters to
// non-archived. Custom line items are stored on the cost row
// directly with is_custom=true.

import { supabase } from '@/lib/supabase'

export interface BoothCostCategory {
  id: string
  name: string
  is_archived: boolean
  display_order: number
  created_at: string
}

export interface BoothCostLine {
  id: string
  trade_show_id: string
  category: string
  is_custom: boolean
  description: string | null
  amount: number
  created_at: string
}

export async function listCategories(opts: { includeArchived?: boolean } = {}): Promise<BoothCostCategory[]> {
  let q = supabase.from('booth_cost_categories')
    .select('id, name, is_archived, display_order, created_at')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (!opts.includeArchived) q = q.eq('is_archived', false)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []) as BoothCostCategory[]
}

export async function createCategory(name: string): Promise<BoothCostCategory> {
  // Place new categories at the end of the list. Cheap "next index"
  // — race conditions don't matter; admin can re-sort.
  const { data: existing } = await supabase
    .from('booth_cost_categories').select('display_order')
    .order('display_order', { ascending: false }).limit(1)
  const nextOrder = ((existing?.[0]?.display_order as number | undefined) ?? 0) + 10
  const { data, error } = await supabase
    .from('booth_cost_categories')
    .insert({ name: name.trim(), display_order: nextOrder })
    .select('id, name, is_archived, display_order, created_at')
    .single()
  if (error) throw new Error(error.message)
  return data as BoothCostCategory
}

export async function updateCategory(id: string, patch: Partial<Pick<BoothCostCategory, 'name' | 'is_archived' | 'display_order'>>): Promise<void> {
  const { error } = await supabase
    .from('booth_cost_categories').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listCosts(tradeShowId: string): Promise<BoothCostLine[]> {
  const { data, error } = await supabase
    .from('trade_show_booth_costs')
    .select('id, trade_show_id, category, is_custom, description, amount, created_at')
    .eq('trade_show_id', tradeShowId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({ ...r, amount: Number(r.amount) })) as BoothCostLine[]
}

export interface BoothCostDraft {
  category: string
  is_custom: boolean
  description?: string | null
  amount: number
}

export async function createCost(tradeShowId: string, draft: BoothCostDraft): Promise<BoothCostLine> {
  const { data, error } = await supabase
    .from('trade_show_booth_costs')
    .insert({
      trade_show_id: tradeShowId,
      category: draft.category.trim(),
      is_custom: draft.is_custom,
      description: draft.description?.trim() || null,
      amount: draft.amount,
    })
    .select('id, trade_show_id, category, is_custom, description, amount, created_at')
    .single()
  if (error) throw new Error(error.message)
  return { ...data, amount: Number(data.amount) } as BoothCostLine
}

export async function updateCost(id: string, patch: Partial<BoothCostDraft>): Promise<void> {
  const update: any = {}
  if (patch.category !== undefined) update.category = patch.category.trim()
  if (patch.is_custom !== undefined) update.is_custom = patch.is_custom
  if (patch.description !== undefined) update.description = patch.description?.trim() || null
  if (patch.amount !== undefined) update.amount = patch.amount
  const { error } = await supabase
    .from('trade_show_booth_costs').update(update).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCost(id: string): Promise<void> {
  const { error } = await supabase
    .from('trade_show_booth_costs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
