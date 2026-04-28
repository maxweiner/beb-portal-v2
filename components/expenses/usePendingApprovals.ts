'use client'

// Small client hook + window event the badge / modal share. Counts
// expense_reports in submitted_pending_review state. Re-fetches on
// window focus and whenever a status change is broadcast via the
// 'beb:expense-status-changed' custom event.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

export interface PendingReportRow {
  id: string
  event_id: string
  user_id: string
  grand_total: number | string
  submitted_at: string | null
  user_name: string
  event_name: string
  event_start: string
}

export function broadcastExpenseStatusChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('beb:expense-status-changed'))
}

export function usePendingApprovals(): { rows: PendingReportRow[]; count: number; loaded: boolean } {
  const { user, events } = useApp()
  const isPartner = !!user?.is_partner
  const [rows, setRows] = useState<PendingReportRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isPartner) { setRows([]); setLoaded(true); return }
    let cancelled = false

    const eventById = new Map(events.map(e => [e.id, e]))

    const load = async () => {
      const { data: reports } = await supabase
        .from('expense_reports')
        .select('id, event_id, user_id, grand_total, submitted_at')
        .eq('status', 'submitted_pending_review')
        .order('submitted_at', { ascending: true })
      if (cancelled) return
      const reportsArr = (reports ?? []) as any[]
      const userIds = Array.from(new Set(reportsArr.map(r => r.user_id)))
      let userMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: usersRows } = await supabase.from('users').select('id, name').in('id', userIds)
        userMap = new Map((usersRows ?? []).map((u: any) => [u.id, u.name]))
      }
      if (cancelled) return
      setRows(reportsArr.map(r => ({
        ...r,
        user_name:   userMap.get(r.user_id) ?? '',
        event_name:  eventById.get(r.event_id)?.store_name ?? '(unknown event)',
        event_start: eventById.get(r.event_id)?.start_date ?? '',
      })))
      setLoaded(true)
    }
    load()

    const onFocus = () => load()
    const onStatusChange = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('beb:expense-status-changed', onStatusChange)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beb:expense-status-changed', onStatusChange)
    }
  }, [isPartner, events.length, user?.id])

  return { rows, count: rows.length, loaded }
}
