// Customers module — shared types. Mirrors the schema shipped in
// supabase-migration-customers-phase-1-schema.sql.

export type HowDidYouHear =
  | 'postcard' | 'newspaper' | 'word_of_mouth' | 'walk_in'
  | 'online' | 'referral' | 'other'

export type EngagementTier = 'active' | 'lapsed' | 'cold' | 'vip'

export type MailingType = 'postcard' | 'vdp' | 'other'

export interface CustomerTagDefinition {
  id: string
  tag: string
  description: string | null
  color: string
  is_archived: boolean
  created_at: string
}

export interface CustomerTag {
  id: string
  customer_id: string
  tag: string
  created_at: string
  created_by: string | null
}

export interface Customer {
  id: string
  store_id: string

  first_name: string
  last_name: string
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  date_of_birth: string | null

  how_did_you_hear: HowDidYouHear | null
  how_did_you_hear_legacy: string | null
  how_did_you_hear_other_text: string | null

  notes: string | null
  last_contact_date: string | null
  do_not_contact: boolean

  engagement_tier: EngagementTier | null
  vip_override: boolean
  lifetime_appointment_count: number
  first_appointment_date: string | null
  last_appointment_date: string | null

  phone_normalized: string | null
  email_normalized: string | null

  created_at: string
  updated_at: string
  deleted_at: string | null
}

export const HOW_DID_YOU_HEAR_LABELS: Record<HowDidYouHear, string> = {
  postcard:      'Postcard',
  newspaper:     'Newspaper',
  word_of_mouth: 'Word of mouth',
  walk_in:       'Walk-in',
  online:        'Online',
  referral:      'Referral',
  other:         'Other',
}

export const ENGAGEMENT_TIER_LABELS: Record<EngagementTier, string> = {
  active: 'Active',
  lapsed: 'Lapsed',
  cold:   'Cold',
  vip:    'VIP',
}

export const ENGAGEMENT_TIER_COLORS: Record<EngagementTier, { bg: string; fg: string }> = {
  active: { bg: '#E8F2EC', fg: '#155538' },  // green-pale / green-dark
  lapsed: { bg: '#FEF3C7', fg: '#92400E' },  // amber
  cold:   { bg: '#F1F5F9', fg: '#475569' },  // slate
  vip:    { bg: '#FEF3C7', fg: '#7C2D12' },  // gold-ish
}
