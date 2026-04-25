// Central registry of notification trigger types. Adding a new trigger
// is two steps:
//   1. Add an entry to TRIGGER_REGISTRY below describing the trigger.
//   2. Insert one row per brand into notification_templates with the
//      matching trigger_type (or do it through the editor UI).
// The dispatcher and editor both read from this registry, so listing a
// trigger here makes it available everywhere.

export type TriggerType =
  | 'buyer_added_to_event'
  | 'event_reminder_day_before'
  | 'event_cancelled'
  | 'event_follow_up'
  | 'vdp_dropped'

export type Channel = 'email' | 'sms'

export interface TriggerDefinition {
  type: TriggerType
  /** Human-readable name shown in the editor list. */
  name: string
  /** Sentence describing when this fires — shown in the editor sidebar. */
  description: string
  /** Default delay if a template is created without an explicit value. */
  defaultDelayMinutes: number
  /** Channels that make sense for this trigger. */
  supportedChannels: Channel[]
  /** Merge variables available in this trigger's templates. */
  variables: { key: string; description: string }[]
  /**
   * Whether this trigger is fully implemented end-to-end. Scaffolds are
   * listed in the editor UI but the enqueue path no-ops until flipped.
   */
  implemented: boolean
}

const COMMON_VARS = [
  { key: 'first_name', description: "Buyer's first name" },
  { key: 'last_name', description: "Buyer's last name" },
  { key: 'full_name', description: "Buyer's full name" },
  { key: 'event_name', description: 'Event display name (e.g. store name)' },
  { key: 'event_dates', description: 'Formatted date range, e.g. "Tues Dec 29th – Thurs Dec 31st"' },
  { key: 'event_city', description: 'City the event is held in' },
  { key: 'event_address', description: 'Full street address of the event' },
  { key: 'store_name', description: 'Name of the host store' },
  { key: 'other_buyers', description: 'Other buyers assigned to the same event ("our team" if none)' },
  { key: 'travel_share_link', description: 'Deep link to the Travel Share page for this event' },
  { key: 'admin_contact', description: 'Configured admin contact for this brand' },
  { key: 'portal_url', description: 'Root URL of the portal' },
]

export const TRIGGER_REGISTRY: Record<TriggerType, TriggerDefinition> = {
  buyer_added_to_event: {
    type: 'buyer_added_to_event',
    name: 'Buyer Added to Event',
    description: 'Sent to a buyer 15 minutes after they are added to an event.',
    defaultDelayMinutes: 15,
    supportedChannels: ['email', 'sms'],
    variables: COMMON_VARS,
    implemented: true,
  },
  event_reminder_day_before: {
    type: 'event_reminder_day_before',
    name: 'Event Reminder (Day Before)',
    description: 'Sent the day before an event to all assigned buyers. Scaffold — not yet wired.',
    defaultDelayMinutes: 0,
    supportedChannels: ['email', 'sms'],
    variables: COMMON_VARS,
    implemented: false,
  },
  event_cancelled: {
    type: 'event_cancelled',
    name: 'Event Cancelled',
    description: 'Sent to assigned buyers when an event is cancelled. Scaffold — not yet wired.',
    defaultDelayMinutes: 0,
    supportedChannels: ['email', 'sms'],
    variables: COMMON_VARS,
    implemented: false,
  },
  event_follow_up: {
    type: 'event_follow_up',
    name: 'Event Follow-up',
    description: 'Sent some time after an event wraps. Scaffold — not yet wired.',
    defaultDelayMinutes: 60 * 24, // 24 hours after
    supportedChannels: ['email', 'sms'],
    variables: COMMON_VARS,
    implemented: false,
  },
  vdp_dropped: {
    type: 'vdp_dropped',
    name: 'VDP Dropped (2 scans)',
    description: 'Fires when a Channel QR (VDP / Postcard / etc.) records its second scan within an event campaign window. One alert per (event, source).',
    defaultDelayMinutes: 0,
    supportedChannels: ['email', 'sms'],
    variables: [
      { key: 'event_name', description: 'Event display name' },
      { key: 'event_dates', description: 'Formatted date range' },
      { key: 'event_city', description: 'City the event is held in' },
      { key: 'store_name', description: 'Host store' },
      { key: 'channel_source', description: 'The source / channel that just dropped (e.g. VDP, Postcard)' },
      { key: 'first_scan_at', description: 'When the first scan happened' },
      { key: 'portal_url', description: 'Root URL of the portal' },
    ],
    implemented: true,
  },
}

export function getTrigger(type: string): TriggerDefinition | null {
  return (TRIGGER_REGISTRY as Record<string, TriggerDefinition>)[type] ?? null
}

export function listTriggers(): TriggerDefinition[] {
  return Object.values(TRIGGER_REGISTRY)
}
