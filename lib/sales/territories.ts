// Sales rep territories: state → assigned rep mapping. Drives
// auto-assignment of new leads on creation. Admin manages the
// table in Settings → Sales Rep Territories.

import { supabase } from '@/lib/supabase'

export interface TerritoryAssignment {
  id: string
  state: string
  rep_user_id: string
  assigned_at: string
  assigned_by: string | null
}

export async function listTerritories(): Promise<TerritoryAssignment[]> {
  const { data, error } = await supabase
    .from('sales_rep_territories')
    .select('id, state, rep_user_id, assigned_at, assigned_by')
    .order('state', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as TerritoryAssignment[]
}

/** Returns the rep_user_id assigned to a 2-letter state code,
 *  or null if no mapping exists. Case-insensitive. */
export async function lookupTerritoryRep(state: string | null | undefined): Promise<string | null> {
  if (!state) return null
  const code = state.trim().toUpperCase()
  if (!code) return null
  const { data, error } = await supabase
    .from('sales_rep_territories')
    .select('rep_user_id')
    .eq('state', code)
    .maybeSingle()
  if (error || !data) return null
  return (data as any).rep_user_id || null
}

export async function setTerritory(state: string, repUserId: string, byUserId: string | null): Promise<void> {
  const code = state.trim().toUpperCase()
  // Upsert on the unique state.
  const { error } = await supabase
    .from('sales_rep_territories')
    .upsert(
      {
        state: code,
        rep_user_id: repUserId,
        assigned_at: new Date().toISOString(),
        assigned_by: byUserId,
      },
      { onConflict: 'state' },
    )
  if (error) throw new Error(error.message)
}

export async function clearTerritory(state: string): Promise<void> {
  const code = state.trim().toUpperCase()
  const { error } = await supabase
    .from('sales_rep_territories').delete().eq('state', code)
  if (error) throw new Error(error.message)
}

/** All 50 US states + DC + PR. Used to render the admin grid. */
export const US_STATES: { code: string; name: string }[] = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
  ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],
  ['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],
  ['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
  ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],
  ['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
  ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],
  ['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],['PR','Puerto Rico'],
].map(([code, name]) => ({ code, name }))
