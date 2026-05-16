// Canonical merge-field registry + resolver for BUYING communications.
//
// Parallel to lib/communications/mergeFields.ts (which serves trunk
// communications). Same SHAPE — name, label, description — but the
// field set is tuned for messages going to store owners about
// upcoming BUYING events.
//
// Differences from the trunk registry:
//   - {rep_name} / {rep_email} / {rep_phone} → {buyer_names} (the
//     assigned buyers for this event, comma-separated). Buying
//     events are run by 2-4 buyers, not a single rep.
//   - Everything else (store + event date fields) is shape-
//     identical, just sourced from `events` + `stores` instead of
//     `trunk_shows` + `trunk_show_stores`.
//
// Used by:
//   - components/communications/AiTemplateModal (when domain='buying')
//   - The buying-side send pipeline (phase 2 PR)
//   - The PDF preview at lib/communications/buyingTemplatePdf.tsx

import type { MergeContext, MergeFieldDef } from './mergeFields'

export const BUYING_MERGE_FIELDS: MergeFieldDef[] = [
  // Store
  { name: 'store_name',          label: 'Store name',         description: 'The hosting jeweler name' },
  { name: 'store_address_line_1',label: 'Address line 1',     description: 'Street address' },
  { name: 'store_city',          label: 'City',               description: '' },
  { name: 'store_state',         label: 'State',              description: 'Two-letter abbreviation' },
  { name: 'store_zip',           label: 'Zip',                description: '' },
  { name: 'store_full_address',  label: 'Full address',       description: 'Multi-line formatted address' },
  { name: 'store_contact_name',  label: 'Contact name',       description: 'Primary contact at the store' },
  { name: 'store_contact_title', label: 'Contact title',      description: 'Empty when not set' },
  // Event (buying event — sourced from `events` table)
  { name: 'event_start_date',    label: 'Event start date',   description: '"March 11, 2026"' },
  { name: 'event_end_date',      label: 'Event end date',     description: '"March 13, 2026" — 3-day event end' },
  { name: 'event_dates_range',   label: 'Dates range',        description: '"March 11–13, 2026"' },
  // Buyers (multiple — replaces rep_name from trunk registry)
  { name: 'buyer_names',         label: 'Buyer names',        description: 'Comma-separated list of buyers assigned to this event (e.g. "Max, Joe, Rich")' },
  // Misc
  { name: 'today_date',          label: 'Today',              description: 'Auto-fills to send date' },
]

const BUYING_FIELD_NAMES = new Set(BUYING_MERGE_FIELDS.map(f => f.name))

/** Replace every {field_name} occurrence with the value from
 *  context. Unknown placeholders are left as-is so missing fields
 *  are visible at preview time, not silently swallowed. Same
 *  semantics as the trunk applyMergeFields — kept in this file so
 *  the registry + applier stay together. */
export function applyBuyingMergeFields(text: string, ctx: MergeContext): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key] ?? ''
    return match
  })
}

/** Returns every {field_name} occurrence that doesn't match a
 *  known BUYING field. Used by the editor to warn about typos on
 *  save. */
export function findUnknownBuyingMergeFields(text: string): string[] {
  const out = new Set<string>()
  const re = /\{([a-zA-Z0-9_]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!BUYING_FIELD_NAMES.has(m[1])) out.add(m[1])
  }
  return [...out]
}

/** Fixture for the live preview pane. Mirrors the trunk
 *  SAMPLE_FIXTURE but uses buyer_names. */
export const BUYING_SAMPLE_FIXTURE: MergeContext = {
  store_name:           'Sample Jewelers',
  store_address_line_1: '123 Main Street',
  store_city:           'Westport',
  store_state:          'CT',
  store_zip:            '06880',
  store_full_address:   '123 Main Street\nWestport, CT 06880',
  store_contact_name:   'Jane Smith',
  store_contact_title:  'Owner',
  event_start_date:     'March 11, 2026',
  event_end_date:       'March 13, 2026',
  event_dates_range:    'March 11–13, 2026',
  buyer_names:          'Max, Joe, Rich',
  today_date:           formatToday(),
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
