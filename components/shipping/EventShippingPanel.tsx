'use client'

// Per-event shipping panel — opened from the Events list toolbar
// (and later from the Calendar drawer + standalone Shipping page).
// Shows shipment metadata, editable box counts (until labels are
// made), and per-box status flow with bulk actions.
//
// Scanner is wired in PR 6; this PR has only a placeholder for it.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

type BoxType = 'jewelry' | 'silver'
type BoxStatus = 'pending' | 'labels_sent' | 'shipped' | 'received' | 'cancelled'

const STATUS_ORDER: BoxStatus[] = ['pending', 'labels_sent', 'shipped', 'received']
const STATUS_LABEL: Record<BoxStatus, string> = {
  pending: 'Pending',
  labels_sent: 'Labels sent',
  shipped: 'Shipped',
  received: 'Received',
  cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<BoxStatus, string> = {
  pending: 'var(--mist)',
  labels_sent: '#3B82F6',
  shipped: '#F59E0B',
  received: 'var(--green)',
  cancelled: 'var(--silver)',
}

const CARRIER_URL: Record<string, (n: string) => string> = {
  ups:   n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  usps:  n => `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(n)}`,
  fedex: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  dhl:   n => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`,
}

function detectCarrier(num: string): string | null {
  const s = num.replace(/\s+/g, '').toUpperCase()
  if (/^1Z[0-9A-Z]{16}$/.test(s)) return 'ups'
  if (/^9[0-9]{15,21}$/.test(s)) return 'usps'      // USPS IMpb
  if (/^[0-9]{12}$/.test(s) || /^[0-9]{15}$/.test(s)) return 'fedex'
  if (/^[0-9]{10}$/.test(s)) return 'dhl'
  return null
}

interface ShipmentRow {
  id: string
  event_id: string
  store_id: string
  ship_date: string
  jewelry_box_count: number
  silver_box_count: number
  status: string
}

interface BoxRow {
  id: string
  shipment_id: string
  type: BoxType
  number: number
  identifier: string
  status: BoxStatus
  tracking_number: string | null
  carrier: string | null
  notes: string | null
  labels_sent_at: string | null
  shipped_at: string | null
  received_at: string | null
  labels_sent_by: string | null
  shipped_by: string | null
  received_by: string | null
  carrier_status: string | null
  carrier_status_detail: string | null
  carrier_last_event: string | null
  carrier_event_at: string | null
  carrier_eta: string | null
  last_polled_at: string | null
  carrier_poll_error: string | null
}

const CARRIER_STATUS_LABEL: Record<string, string> = {
  unknown: 'Unknown',
  label_created: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Exception',
  returned: 'Returned',
}
const CARRIER_STATUS_COLOR: Record<string, string> = {
  unknown: 'var(--mist)',
  label_created: '#3B82F6',
  in_transit: '#F59E0B',
  out_for_delivery: '#8B5CF6',
  delivered: 'var(--green)',
  exception: 'var(--red)',
  returned: 'var(--red)',
}
const CARRIERS_WITH_LIVE_TRACKING = new Set(['fedex', 'ups'])

function fmtRelative(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export default function EventShippingPanel({
  eventId, eventStartDate, eventWorkers, onClose,
}: {
  eventId: string
  eventStartDate: string
  eventWorkers: { id: string; name: string }[]
  onClose: () => void
}) {
  const { user } = useApp()
  const role = user?.role
  const isAdmin = role === 'admin' || role === 'superadmin'
  const isWorker = !!user?.id && eventWorkers.some(w => w.id === user.id)
  const canMutate = isAdmin || isWorker

  const [shipment, setShipment] = useState<ShipmentRow | null>(null)
  const [boxes, setBoxes] = useState<BoxRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [savingCounts, setSavingCounts] = useState(false)
  const [draftJewelry, setDraftJewelry] = useState<number>(0)
  const [draftSilver, setDraftSilver] = useState<number>(0)
  const [busyBoxId, setBusyBoxId] = useState<string | null>(null)
  const [refreshingBoxId, setRefreshingBoxId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState<BoxType | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from('event_shipments').select('*').eq('event_id', eventId).maybeSingle(),
      supabase.from('event_shipment_boxes').select('*').order('type').order('number'),
    ])
    if (!s) {
      setShipment(null); setBoxes([]); setLoaded(true); return
    }
    const shipRow = s as unknown as ShipmentRow
    setShipment(shipRow)
    setDraftJewelry(shipRow.jewelry_box_count)
    setDraftSilver(shipRow.silver_box_count)
    const filteredBoxes = ((b || []) as unknown as BoxRow[]).filter(x => x.shipment_id === shipRow.id)
    setBoxes(filteredBoxes)
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [eventId])

  const jewelryBoxes = useMemo(() => boxes.filter(b => b.type === 'jewelry').sort((a, b) => a.number - b.number), [boxes])
  const silverBoxes  = useMemo(() => boxes.filter(b => b.type === 'silver').sort((a, b) => a.number - b.number),  [boxes])

  const anyMovement = boxes.some(b => b.status !== 'pending' && b.status !== 'cancelled')
  const countsLocked = anyMovement
  const countsDirty = !!shipment && (draftJewelry !== shipment.jewelry_box_count || draftSilver !== shipment.silver_box_count)

  async function saveCounts() {
    if (!shipment || !canMutate || countsLocked) return
    setSavingCounts(true); setError(null)
    const { error } = await supabase.from('event_shipments')
      .update({
        jewelry_box_count: Math.max(0, Math.floor(draftJewelry || 0)),
        silver_box_count:  Math.max(0, Math.floor(draftSilver  || 0)),
      })
      .eq('id', shipment.id)
    setSavingCounts(false)
    if (error) { setError(error.message); return }
    await reload()
  }

  async function advanceBox(box: BoxRow) {
    if (!canMutate || box.status === 'received' || box.status === 'cancelled') return
    const idx = STATUS_ORDER.indexOf(box.status)
    const next = STATUS_ORDER[idx + 1]
    if (!next) return

    let trackingNumber = box.tracking_number
    let carrier = box.carrier
    if (next === 'shipped' && !trackingNumber) {
      const t = window.prompt(`Enter tracking number for ${box.identifier} (leave blank to skip):`)
      if (t === null) return
      const trimmed = t.trim()
      if (trimmed) {
        trackingNumber = trimmed
        if (!carrier) carrier = detectCarrier(trimmed)
      }
    }

    setBusyBoxId(box.id); setError(null)
    const stamp: Record<string, string> = next === 'labels_sent' ? 'labels_sent_at,labels_sent_by'.split(',').reduce((o, k) => ({ ...o, [k]: '' }), {}) : {}
    const update: any = { status: next }
    const now = new Date().toISOString()
    if (next === 'labels_sent') { update.labels_sent_at = now; update.labels_sent_by = user?.id }
    if (next === 'shipped')     { update.shipped_at = now;      update.shipped_by = user?.id; update.tracking_number = trackingNumber; update.carrier = carrier }
    if (next === 'received')    { update.received_at = now;     update.received_by = user?.id }

    const { error } = await supabase.from('event_shipment_boxes').update(update).eq('id', box.id)
    setBusyBoxId(null)
    if (error) { setError(error.message); return }
    void stamp // unused; keep TS happy if we tweak later
    await reload()
  }

  async function bulkAdvance(type: BoxType, fromStatus: BoxStatus) {
    if (!canMutate) return
    const idx = STATUS_ORDER.indexOf(fromStatus)
    const next = STATUS_ORDER[idx + 1]
    if (!next) return
    const targets = boxes.filter(b => b.type === type && b.status === fromStatus)
    if (targets.length === 0) return

    if (next === 'shipped') {
      // Shipped via bulk requires per-box tracking; force the user to do it one by one (or use scanner — PR 6).
      alert('Use the per-box "Mark shipped" buttons (or the scanner once it lands in PR 6) to record tracking numbers.')
      return
    }

    setBulkBusy(type); setError(null)
    const update: any = { status: next }
    const now = new Date().toISOString()
    if (next === 'labels_sent') { update.labels_sent_at = now; update.labels_sent_by = user?.id }
    if (next === 'received')    { update.received_at = now;     update.received_by = user?.id }
    const { error } = await supabase.from('event_shipment_boxes').update(update).in('id', targets.map(b => b.id))
    setBulkBusy(null)
    if (error) { setError(error.message); return }
    await reload()
  }

  async function setManualTracking(box: BoxRow) {
    if (!canMutate) return
    const t = window.prompt(`Tracking number for ${box.identifier}:`, box.tracking_number || '')
    if (t === null) return
    const trimmed = t.trim()
    const carrier = trimmed ? (box.carrier || detectCarrier(trimmed)) : null
    setBusyBoxId(box.id); setError(null)
    const { error } = await supabase.from('event_shipment_boxes')
      .update({ tracking_number: trimmed || null, carrier })
      .eq('id', box.id)
    setBusyBoxId(null)
    if (error) { setError(error.message); return }
    await reload()
  }

  async function refreshTracking(box: BoxRow) {
    if (!box.tracking_number || !box.carrier) return
    setRefreshingBoxId(box.id); setError(null)
    try {
      const res = await fetch(`/api/shipping/boxes/${box.id}/refresh-tracking`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Refresh failed (${res.status})`)
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setRefreshingBoxId(null)
    await reload()
  }

  if (!loaded) {
    return (
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">📦 Shipping</div>
        <div style={{ padding: 16, color: 'var(--mist)' }}>Loading…</div>
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className="card card-accent" style={{ margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="card-title">📦 Shipping</div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>
        <div style={{ padding: 16, color: 'var(--mist)', textAlign: 'center' }}>
          Shipping not tracked for this store (Hold Time = No Hold).
        </div>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const shipDateLabel = new Date(shipment.ship_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="card-title">📦 Shipping</div>
        <button onClick={onClose} style={closeBtn}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--mist)', marginBottom: 14, flexWrap: 'wrap' }}>
        <span>Ship date: <strong style={{ color: 'var(--ink)' }}>{shipDateLabel}</strong></span>
        <span>·</span>
        <span>Status: <strong style={{ color: 'var(--ink)' }}>{shipment.status}</strong></span>
      </div>

      {/* Box counts */}
      <div style={{ background: 'var(--cream2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Box counts
          </div>
          {countsLocked && (
            <span style={{ fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>Locked — labels are out</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={lbl}>Jewelry</label>
            <input type="number" min={0} value={draftJewelry}
              disabled={!canMutate || countsLocked}
              onChange={e => setDraftJewelry(Number(e.target.value))} />
          </div>
          <div>
            <label style={lbl}>Silver</label>
            <input type="number" min={0} value={draftSilver}
              disabled={!canMutate || countsLocked}
              onChange={e => setDraftSilver(Number(e.target.value))} />
          </div>
          <button className="btn-primary btn-sm"
            disabled={!canMutate || countsLocked || !countsDirty || savingCounts}
            onClick={saveCounts}>
            {savingCounts ? 'Saving…' : 'Save counts'}
          </button>
        </div>
      </div>

      {!canMutate && (
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 10, fontStyle: 'italic' }}>
          Read-only — only event workers, admins, and superadmins can update boxes.
        </div>
      )}

      {error && (
        <div style={{ padding: 8, marginBottom: 10, background: 'var(--red-pale)', color: 'var(--red)', borderRadius: 6, fontSize: 12 }}>
          {error}
        </div>
      )}

      <BoxSection
        title="Jewelry"
        boxes={jewelryBoxes}
        canMutate={canMutate}
        bulkBusy={bulkBusy === 'jewelry'}
        busyBoxId={busyBoxId}
        refreshingBoxId={refreshingBoxId}
        onAdvance={advanceBox}
        onBulkAdvance={(s) => bulkAdvance('jewelry', s)}
        onSetTracking={setManualTracking}
        onRefresh={refreshTracking}
      />

      <div style={{ height: 12 }} />

      <BoxSection
        title="Silver"
        boxes={silverBoxes}
        canMutate={canMutate}
        bulkBusy={bulkBusy === 'silver'}
        busyBoxId={busyBoxId}
        refreshingBoxId={refreshingBoxId}
        onAdvance={advanceBox}
        onBulkAdvance={(s) => bulkAdvance('silver', s)}
        onSetTracking={setManualTracking}
        onRefresh={refreshTracking}
      />

      <div style={{ marginTop: 14, padding: 10, background: 'var(--cream)', borderRadius: 6, fontSize: 12, color: 'var(--mist)' }}>
        🧪 Scanner integration ships in a follow-up PR. For now, enter tracking numbers manually with the "Tracking" button on each box.
      </div>
    </div>
  )
}

function BoxSection({
  title, boxes, canMutate, bulkBusy, busyBoxId, refreshingBoxId,
  onAdvance, onBulkAdvance, onSetTracking, onRefresh,
}: {
  title: string
  boxes: BoxRow[]
  canMutate: boolean
  bulkBusy: boolean
  busyBoxId: string | null
  refreshingBoxId: string | null
  onAdvance: (b: BoxRow) => void
  onBulkAdvance: (fromStatus: BoxStatus) => void
  onSetTracking: (b: BoxRow) => void
  onRefresh: (b: BoxRow) => void
}) {
  if (boxes.length === 0) {
    return (
      <div style={{ padding: 12, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13, background: 'var(--cream2)', borderRadius: 8 }}>
        No {title} boxes for this shipment.
      </div>
    )
  }

  const counts: Record<BoxStatus, number> = boxes.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1
    return acc
  }, { pending: 0, labels_sent: 0, shipped: 0, received: 0, cancelled: 0 } as Record<BoxStatus, number>)

  const summary = (() => {
    if (counts.received === boxes.length) return `All ${boxes.length} received`
    if (counts.received > 0) return `${counts.received} of ${boxes.length} received`
    if (counts.shipped > 0) return `${counts.shipped} of ${boxes.length} shipped`
    if (counts.labels_sent > 0) return `${counts.labels_sent} of ${boxes.length} labels sent`
    return `0 of ${boxes.length} started`
  })()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{title} <span style={{ color: 'var(--mist)', fontWeight: 600 }}>· {summary}</span></div>
        {canMutate && (
          <div style={{ display: 'flex', gap: 4 }}>
            {counts.pending > 0 && (
              <button className="btn-outline btn-xs" disabled={bulkBusy} onClick={() => onBulkAdvance('pending')}>
                Mark all labels sent ({counts.pending})
              </button>
            )}
            {counts.shipped > 0 && (
              <button className="btn-outline btn-xs" disabled={bulkBusy} onClick={() => onBulkAdvance('shipped')}>
                Mark all received ({counts.shipped})
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {boxes.map(b => (
          <BoxRowItem key={b.id} box={b} canMutate={canMutate}
            busy={busyBoxId === b.id} refreshing={refreshingBoxId === b.id}
            onAdvance={() => onAdvance(b)} onSetTracking={() => onSetTracking(b)}
            onRefresh={() => onRefresh(b)}
          />
        ))}
      </div>
    </div>
  )
}

function BoxRowItem({
  box, canMutate, busy, refreshing,
  onAdvance, onSetTracking, onRefresh,
}: {
  box: BoxRow
  canMutate: boolean
  busy: boolean
  refreshing: boolean
  onAdvance: () => void
  onSetTracking: () => void
  onRefresh: () => void
}) {
  const idx = STATUS_ORDER.indexOf(box.status)
  const next = STATUS_ORDER[idx + 1]
  const advanceLabel = next === 'labels_sent' ? 'Mark labels sent' : next === 'shipped' ? 'Mark shipped' : next === 'received' ? 'Mark received' : null
  const trackingHref = box.tracking_number && box.carrier ? CARRIER_URL[box.carrier]?.(box.tracking_number) : null
  const liveTrackable = !!(box.tracking_number && box.carrier && CARRIERS_WITH_LIVE_TRACKING.has(box.carrier))
  const carrierStatus = box.carrier_status
  const carrierLabel = carrierStatus ? CARRIER_STATUS_LABEL[carrierStatus] ?? carrierStatus : null
  const carrierColor = carrierStatus ? CARRIER_STATUS_COLOR[carrierStatus] ?? 'var(--mist)' : 'var(--mist)'
  const etaLabel = box.carrier_eta ? new Date(box.carrier_eta + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  return (
    <div style={{
      padding: '8px 10px', background: '#fff', border: '1px solid var(--cream2)', borderRadius: 6,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '60px 110px 1fr auto', gap: 8, alignItems: 'center',
      }}>
        <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{box.identifier}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[box.status] }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[box.status] }}>{STATUS_LABEL[box.status]}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {box.tracking_number ? (
            trackingHref ? (
              <a href={trackingHref} target="_blank" rel="noreferrer" style={{ color: 'var(--green-dark)', fontWeight: 600 }}>
                {box.tracking_number}{box.carrier ? ` · ${box.carrier.toUpperCase()}` : ''}
              </a>
            ) : (
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{box.tracking_number}</span>
            )
          ) : (
            <span style={{ fontStyle: 'italic' }}>no tracking</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {liveTrackable && (
            <button className="btn-outline btn-xs" disabled={refreshing} onClick={onRefresh}
              title="Refresh carrier status now">{refreshing ? '…' : '↻'}</button>
          )}
          {canMutate && (
            <button className="btn-outline btn-xs" disabled={busy} onClick={onSetTracking}>Tracking</button>
          )}
          {canMutate && advanceLabel && (
            <button className="btn-primary btn-xs" disabled={busy} onClick={onAdvance}>{advanceLabel}</button>
          )}
        </div>
      </div>

      {liveTrackable && (carrierStatus || box.carrier_poll_error) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--cream2)', fontSize: 11,
        }}>
          {carrierLabel && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: carrierColor + '18', color: carrierColor, fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: carrierColor }} />
              {carrierLabel}
            </span>
          )}
          {box.carrier_last_event && (
            <span style={{ color: 'var(--ash)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {box.carrier_last_event}
            </span>
          )}
          {etaLabel && (
            <span style={{ color: 'var(--mist)' }}>ETA {etaLabel}</span>
          )}
          {box.last_polled_at && (
            <span style={{ color: 'var(--mist)', marginLeft: 'auto' }}>checked {fmtRelative(box.last_polled_at)}</span>
          )}
          {box.carrier_poll_error && (
            <span style={{ color: 'var(--red)', fontStyle: 'italic' }}>error: {box.carrier_poll_error}</span>
          )}
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.05em', color: 'var(--mist)', marginBottom: 4,
}
const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)',
}
