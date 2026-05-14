'use client'

// Sidebar badge feeder for the Leads nav item. Counts leads that
// need follow-up TODAY (or are already overdue) and that the current
// user is responsible for.
//
// Recipient model (matches the email cron at
// /api/cron/lead-follow-up-reminders):
//   - Lead has an assigned_rep_id → owner is the assigned rep
//   - Lead is unassigned → owner is whoever last set the follow-up
//     date (follow_up_set_by_user_id, stamped by the
//     handle_lead_follow_up_change() trigger)
//
// Terminal statuses (converted, dead) and soft-deleted rows are
// excluded. The partial index idx_leads_due_follow_up makes this
// query nearly free.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

export function useLeadFollowUpAlerts(): { count: number; loaded: boolean } {
  const { user } = useApp()
  const [count, setCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user?.id) { setCount(0); setLoaded(true); return }
    let cancelled = false

    const load = async () => {
      // Today as 'YYYY-MM-DD' (local-ish). We compare with the
      // string column directly — leads.follow_up_date is DATE in
      // Postgres, ISO-8601 lexicographic compare works on YYYY-MM-DD.
      const today = new Date().toISOString().slice(0, 10)
      const myId = user.id

      // Two queries (assigned-to-me + unassigned-and-set-by-me)
      // joined client-side. PostgREST doesn't support OR with
      // mixed-column predicates cleanly in count-only mode, so
      // two HEAD calls is the cleanest path. Both queries hit
      // the partial index — fast.
      const [assignedRes, fallbackRes] = await Promise.all([
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_rep_id', myId)
          .lte('follow_up_date', today)
          .not('follow_up_date', 'is', null)
          .not('status', 'in', '(converted,dead)')
          .is('deleted_at', null),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .is('assigned_rep_id', null)
          .eq('follow_up_set_by_user_id', myId)
          .lte('follow_up_date', today)
          .not('status', 'in', '(converted,dead)')
          .is('deleted_at', null),
      ])
      if (cancelled) return
      const total = (assignedRes.count ?? 0) + (fallbackRes.count ?? 0)
      setCount(total)
      setLoaded(true)
    }
    load()
    // Refresh on focus so the badge clears once the operator
    // acts on a lead (no need to re-poll on a timer for this).
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [user?.id])

  return { count, loaded }
}
