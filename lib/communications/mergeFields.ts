// Canonical merge-field registry + resolver for trunk communications.
//
// Used by:
//   - The template editor's live preview (phase 3)
//   - The actual send pipeline (phase 5)
//   - The validation pass on save (warns about unknown {...}
//     patterns in subject/body)
//
// To add a new field:
//   1. Add an entry to MERGE_FIELDS below
//   2. Populate it in the SAMPLE_FIXTURE for live preview
//   3. Make sure the send pipeline supplies it (phase 5)

export interface MergeFieldDef {
  name: string         // bare field name (no braces)
  label: string        // for the side panel
  description: string  // 1-line hint shown under the label
}

export const MERGE_FIELDS: MergeFieldDef[] = [
  // Store
  { name: 'store_name',          label: 'Store name',         description: 'The hosting jeweler name' },
  { name: 'store_address_line_1',label: 'Address line 1',     description: 'Street address' },
  { name: 'store_city',          label: 'City',               description: '' },
  { name: 'store_state',         label: 'State',              description: 'Two-letter abbreviation' },
  { name: 'store_zip',           label: 'Zip',                description: '' },
  { name: 'store_full_address',  label: 'Full address',       description: 'Multi-line formatted address' },
  { name: 'store_contact_name',  label: 'Contact name',       description: 'Primary contact at the store' },
  { name: 'store_contact_title', label: 'Contact title',      description: 'Empty when not set' },
  // Event
  { name: 'event_start_date',    label: 'Event start date',   description: '"March 11, 2026"' },
  { name: 'event_end_date',      label: 'Event end date',     description: '"March 14, 2026"' },
  { name: 'event_dates_range',   label: 'Dates range',        description: '"March 11–14, 2026"' },
  { name: 'event_hours_per_day', label: 'Hours per day',      description: 'Multi-line list of dates + open/close times' },
  // Rep
  { name: 'rep_name',            label: 'Rep name',           description: 'Full name of the assigned rep' },
  { name: 'rep_email',           label: 'Rep email',          description: '@bebllp.com address' },
  { name: 'rep_phone',           label: 'Rep phone',          description: '' },
  // Misc
  { name: 'today_date',          label: 'Today',              description: "Auto-fills to send date" },
]

const FIELD_NAMES = new Set(MERGE_FIELDS.map(f => f.name))

export type MergeContext = Record<string, string>

/** Replace every {field_name} occurrence with the value from
 *  context. Unknown placeholders are left as-is so missing fields
 *  are visible at preview time, not silently swallowed. */
export function applyMergeFields(text: string, ctx: MergeContext): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key] ?? ''
    return match
  })
}

/** Returns every {field_name} occurrence that doesn't match a
 *  known field. Used by the editor to warn about typos on save. */
export function findUnknownMergeFields(text: string): string[] {
  const out = new Set<string>()
  const re = /\{([a-zA-Z0-9_]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!FIELD_NAMES.has(m[1])) out.add(m[1])
  }
  return [...out]
}

/** Fixture for the live preview pane. Matches the shape phase 5
 *  will pass through at real send time, so a template that previews
 *  cleanly will send cleanly. */
export const SAMPLE_FIXTURE: MergeContext = {
  store_name:           'Sample Jewelers',
  store_address_line_1: '123 Main Street',
  store_city:           'Westport',
  store_state:          'CT',
  store_zip:            '06880',
  store_full_address:   '123 Main Street\nWestport, CT 06880',
  store_contact_name:   'Jane Smith',
  store_contact_title:  'Owner',
  event_start_date:     'March 11, 2026',
  event_end_date:       'March 14, 2026',
  event_dates_range:    'March 11–14, 2026',
  event_hours_per_day:
    'Wed Mar 11: 10:00 AM – 5:00 PM\n' +
    'Thu Mar 12: 10:00 AM – 5:00 PM\n' +
    'Fri Mar 13: 10:00 AM – 5:00 PM\n' +
    'Sat Mar 14: 10:00 AM – 4:00 PM',
  rep_name:             'Tom Smith',
  rep_email:            'tom@bebllp.com',
  rep_phone:            '(555) 123-4567',
  today_date:           formatToday(),
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
