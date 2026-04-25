'use client'

// Inline status pill for a (event, buyer) notification. Queries the
// most-recent scheduled_notifications row matching the pair and
// renders pending / held / sent / failed / cancelled with the right
// admin actions (cancel, send-now, retry) for superadmins.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface NotifRow {
  id: string
  status: 'pending' | 'processing' | 'held' | 'sent' | 'cancelled' | 'failed'
  channels: string[]
  email_status: string | null
  sms_status: string | null
  scheduled_for: string
  sent_at: string | null
  cancelled_reason: string | null
  hold_reason: string | null
  error_message: string | null
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const COLORS = {
  pending:   { bg: '#FEF3C7', fg: '#92400E', icon: '⏰' },
  held:      { bg: '#E0E7FF', fg: '#3730A3', icon: '🌙' },
  sent:      { bg: '#DCFCE7', fg: '#166534', icon: '✓' },
  failed:    { bg: '#FEE2E2', fg: '#991B1B', icon: '⚠' },
  cancelled: { bg: '#F3F4F6', fg: '#6B7280', icon: '·' },
} as const

export default function NotificationStatusBadge({
  eventId,
  buyerId,
  triggerType = 'buyer_added_to_event',
  compact = false,
}: {
  eventId: string
  buyerId: string
  triggerType?: string
  compact?: boolean
}) {
  const { user } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'

  const [row, setRow] = useState<NotifRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('scheduled_notifications')
      .select('id, status, channels, email_status, sms_status, scheduled_for, sent_at, cancelled_reason, hold_reason, error_message')
      .eq('related_event_id', eventId)
      .eq('recipient_buyer_id', buyerId)
      .eq('trigger_type', triggerType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setRow((data as NotifRow | null) ?? null)
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId, buyerId, triggerType])

  async function action(path: string, opts: { confirm?: string; body?: any } = {}) {
    if (opts.confirm && !window.confirm(opts.confirm)) return
    setBusy(true)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert('Failed: ' + (j.error || res.status))
      }
      await load()
    } catch (e: any) {
      alert('Network error: ' + (e?.message || 'unknown'))
    }
    setBusy(false)
  }

  if (loading || !row) return null

  const palette = COLORS[row.status === 'processing' ? 'pending' : row.status] || COLORS.pending

  let label: string
  switch (row.status) {
    case 'pending':
    case 'processing':
      label = `Notification ${row.sent_at ? 'sent' : 'scheduled'} ${fmtTime(row.scheduled_for)}`
      break
    case 'held':
      label = `Notification held until ${fmtTime(row.scheduled_for)}`
      break
    case 'sent':
      label = `Notification sent ${row.sent_at ? fmtTime(row.sent_at) : ''}`
      break
    case 'failed':
      label = `Notification failed`
      break
    case 'cancelled':
      label = `Notification cancelled${row.cancelled_reason ? ` (${row.cancelled_reason})` : ''}`
      break
  }

  const channelTags = (row.channels || []).map(c => c === 'email' ? '✉' : c === 'sms' ? '💬' : '?').join(' ')

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: palette.bg, color: palette.fg,
      borderRadius: 999, padding: compact ? '2px 8px' : '4px 10px',
      fontSize: compact ? 10 : 11, fontWeight: 700,
      lineHeight: 1.2, whiteSpace: 'nowrap',
    }} title={row.error_message || row.hold_reason || row.cancelled_reason || undefined}>
      <span aria-hidden="true">{palette.icon}</span>
      <span>{label}</span>
      {!compact && row.status === 'sent' && channelTags && <span aria-hidden="true">{channelTags}</span>}
      {isSuperAdmin && (row.status === 'pending' || row.status === 'held') && (
        <>
          <button
            onClick={() => action(`/api/notifications/${row.id}/send-now`, {
              body: { bypass_quiet_hours: row.status === 'held' && window.confirm('It is currently quiet hours for this recipient. Send anyway?') ? true : false },
            })}
            disabled={busy}
            style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
          >Send now</button>
          <button
            onClick={() => action(`/api/notifications/${row.id}/cancel`, { confirm: 'Cancel this notification?' })}
            disabled={busy}
            style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
          >Cancel</button>
        </>
      )}
      {isSuperAdmin && row.status === 'failed' && (
        <button
          onClick={() => action(`/api/notifications/${row.id}/retry`)}
          disabled={busy}
          style={{ background: 'transparent', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
        >Retry</button>
      )}
    </span>
  )
}
