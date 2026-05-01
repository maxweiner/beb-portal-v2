// Shared filter shape for Marketing Export (Phase 6) and Win-Back
// Segments (Phase 8). Keep this file dumb — types only, no logic.

import type { EngagementTier, HowDidYouHear } from './types'

export interface ExportFilters {
  storeId: string  // required, single

  tiers?: EngagementTier[]
  howHeardEnum?: HowDidYouHear[]
  howHeardLegacy?: string[]  // free-text values from imports

  tags?: string[]
  tagsLogic?: 'and' | 'or'

  lifetimeApptMin?: number | null
  lifetimeApptMax?: number | null
  firstApptStart?: string | null   // YYYY-MM-DD
  firstApptEnd?: string | null
  lastContactStart?: string | null
  lastContactEnd?: string | null

  /** "haven't been mailed in last N days" — excludes any customer
   *  with a customer_mailings row in the trailing window. */
  daysSinceLastMailing?: number | null

  // radiusMiles? — deferred until customer addresses are geocoded.
}

export const POSTCARD_CSV_COLUMNS = [
  'first_name', 'last_name', 'address_line_1', 'address_line_2',
  'city', 'state', 'zip',
] as const
