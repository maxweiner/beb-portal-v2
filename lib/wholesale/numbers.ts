// Atomic next-number RPC wrapper for the wholesale module.
// Returns 'J-1042' / 'W-1043' / 'D-1044' / 'M-101' / 'INV-2048' etc.
// Sequence is per (brand, prefix) and lives in
// public.wholesale_number_sequences. See
// supabase-migration-wholesale-schema.sql for the SQL function.

import { supabase } from '@/lib/supabase'

export type WholesalePrefix = 'J' | 'W' | 'D' | 'M' | 'INV'

export async function nextWholesaleNumber(
  brand: string,
  prefix: WholesalePrefix,
): Promise<string> {
  const { data, error } = await supabase.rpc('next_wholesale_number', {
    p_brand: brand,
    p_prefix: prefix,
  })
  if (error) throw new Error(`next_wholesale_number(${brand},${prefix}) failed: ${error.message}`)
  if (typeof data !== 'string') throw new Error('next_wholesale_number returned a non-string')
  return data
}

/** Convert an inventory category to its number prefix. */
export function prefixForCategory(category: 'jewelry' | 'watch' | 'diamond'): WholesalePrefix {
  if (category === 'jewelry') return 'J'
  if (category === 'watch')   return 'W'
  return 'D'
}
