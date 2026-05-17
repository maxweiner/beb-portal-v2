// Shared types for the AI Reports feature. Kept separate from
// lib/ai-reports/* implementation modules so the editor UI can pull
// in just the shape definitions without hauling along server-side
// dependencies (anthropic, resend, supabase admin).

export type Brand = 'beb' | 'liberty'
export type ScheduleType = 'daily' | 'weekly' | 'monthly'
export type TimeWindow = 'last_7d' | 'last_30d' | 'last_90d' | 'current_month'

export interface AiReportRow {
  id: string
  name: string
  prompt: string
  brand: Brand
  schedule_type: ScheduleType
  schedule_day_of_week: number | null
  schedule_day_of_month: number | null
  schedule_hour: number
  schedule_minute: number
  time_window: TimeWindow
  recipient_user_ids: string[]
  active: boolean
  last_sent_at: string | null
  last_send_status: 'sent' | 'error' | null
  last_send_error: string | null
  last_send_body: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A new-or-updated AI report payload accepted by the CRUD UI. */
export type AiReportInput = Omit<
  AiReportRow,
  'id' | 'last_sent_at' | 'last_send_status' | 'last_send_error' |
  'last_send_body' | 'created_by' | 'created_at' | 'updated_at'
>
