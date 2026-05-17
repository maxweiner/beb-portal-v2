// Shared types for the Schedule (Calendar) module — used across the
// Schedule orchestrator, all six views, and the side drawers. Local-only
// types (AgendaItem, KanbanItem) stay with their consumer.

export interface ShipmentEntry {
  id: string
  event_id: string
  store_id: string
  store_name: string
  ship_date: string
  jewelry_box_count: number
  silver_box_count: number
  status: string
  event_workers: { id: string; name: string }[]
  event_start_date: string
}

export type ViewMode = 'month' | 'week' | 'day' | 'timeline' | 'agenda' | 'kanban'

// Trade shows have explicit start/end dates and can run any number
// of days. Overlaid on the month grid for admins / sales reps. Trunk
// shows are NOT auto-overlaid (per the e1 walled-off rule) — they
// render via TrunkShowOverlay below when the user opts in.
export interface TradeShowOverlay {
  id: string
  name: string
  start_date: string
  end_date: string
  venue_city: string | null
  venue_state: string | null
}

// Trunk shows — same shape as TradeShowOverlay, but the display "name"
// comes from the trunk_show_stores join (each trunk show happens at
// one store) and there's an assigned rep for the chip's "(rep)" suffix.
export interface TrunkShowOverlay {
  id: string
  store_name: string
  start_date: string
  end_date: string
  city: string | null
  state: string | null
  /** Assigned rep id for the chip's "(rep)" suffix; null when unassigned. */
  assigned_rep_id: string | null
}
