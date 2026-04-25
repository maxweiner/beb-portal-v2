'use client'

// Inline status pill for a (event, buyer) notification. Renders just
// the title + icon by default; full details (timestamps, channels,
// reasons, errors) and admin actions (Cancel / Send now / Retry)
// appear in a hover popover so the worker chips stay visually quiet.

import { useEffect, useRef, useState } from 'react'
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
  pending:   { bg: '#FEF3C7', fg: '#92400E', icon: '⏰', title: 'Scheduled' },
  held:      { bg: '#E0E7FF', fg: '#3730A3', icon: '🌙', title: 'Held' },
  sent:      { bg: '#DCFCE7', fg: '#166534', icon: '✓',  title: 'Sent' },
  failed:    { bg: '#FEE2E2', fg: '#991B1B', icon: '⚠',  title: 'Failed' },
  cancelled: { bg: '#F3F4F6', fg: '#6B7280', icon: '·',  title: 'Cancelled' },
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
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  function openPopover() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    // Small delay so the cursor can travel from pill to popover without
    // the popover dismissing en route.
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  if (loading || !row) return null

  const palette = COLORS[row.status === 'processing' ? 'pending' : row.status] || COLORS.pending
  const channelTags = (row.channels || []).map(c => c === 'email' ? '✉' : c === 'sms' ? '💬' : '?').join(' ')

  // Detail line for the popover
  let detailLine: string
  switch (row.status) {
    case 'pending':
    case 'processing':
      detailLine = `Scheduled for ${fmtTime(row.scheduled_for)}`
      break
    case 'held':
      detailLine = `Held until ${fmtTime(row.scheduled_for)}`
      break
    case 'sent':
      detailLine = `Sent ${row.sent_at ? fmtTime(row.sent_at) : ''}`
      break
    case 'failed':
      detailLine = row.error_message || 'Unknown error'
      break
    case 'cancelled':
      detailLine = row.cancelled_reason ? `Reason: ${row.cancelled_reason}` : 'Cancelled'
      break
  }

  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClose}
      onFocus={openPopover}
      onBlur={scheduleClose}
    >
      <span
        tabIndex={0}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: palette.bg, color: palette.fg,
          borderRadius: 999, padding: compact ? '2px 8px' : '3px 10px',
          fontSize: compact ? 10 : 11, fontWeight: 700,
          lineHeight: 1.2, whiteSpace: 'nowrap', cursor: 'default',
        }}
      >
        <span aria-hidden="true">{palette.icon}</span>
        <span>{palette.title}</span>
      </span>

      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
            minWidth: 220,
            background: '#1F2937', color: '#F9FAFB',
            borderRadius: 8, padding: '10px 12px',
            boxShadow: '0 6px 20px rgba(0,0,0,.18)',
            fontSize: 12, lineHeight: 1.4, whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            {palette.icon} Notification {palette.title.toLowerCase()}
          </div>
          <div style={{ color: '#D1D5DB' }}>{detailLine}</div>
          {(row.channels || []).length > 0 && (
            <div style={{ color: '#9CA3AF', marginTop: 4 }}>
              Channels: {channelTags}
            </div>
          )}
          {row.hold_reason && row.status === 'held' && (
            <div style={{ color: '#9CA3AF', marginTop: 4 }}>{row.hold_reason}</div>
          )}

          {isSuperAdmin && (row.status === 'pending' || row.status === 'held' || row.status === 'failed') && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, borderTop: '1px solid #374151', paddingTop: 8 }}>
              {(row.status === 'pending' || row.status === 'held') && (
                <>
                  <button
                    onClick={() => action(`/api/notifications/${row.id}/send-now`, {
                      body: { bypass_quiet_hours: row.status === 'held' && window.confirm('It is currently quiet hours for this recipient. Send anyway?') ? true : false },
                    })}
                    disabled={busy}
                    style={popoverBtn('#10B981')}
                  >Send now</button>
                  <button
                    onClick={() => action(`/api/notifications/${row.id}/cancel`, { confirm: 'Cancel this notification?' })}
                    disabled={busy}
                    style={popoverBtn('#EF4444')}
                  >Cancel</button>
                </>
              )}
              {row.status === 'failed' && (
                <button
                  onClick={() => action(`/api/notifications/${row.id}/retry`)}
                  disabled={busy}
                  style={popoverBtn('#3B82F6')}
                >Retry</button>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  )
}

function popoverBtn(color: string): React.CSSProperties {
  return {
    background: color, color: '#fff', border: 'none',
    borderRadius: 6, padding: '4px 10px',
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
