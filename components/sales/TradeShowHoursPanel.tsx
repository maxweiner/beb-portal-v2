'use client'

// Per-day hours editor for a trade show. Mirrors the trunk show
// pattern but trade shows don't auto-reconcile (no fixed window
// like trunk's start_date + 3 days), so we enumerate every day
// in the [start_date, end_date] range and let the admin set or
// clear hours per day.

import { useEffect, useState } from 'react'
import { listHours, setHoursForDate, deleteHoursForDate, type TradeShowHours } from '@/lib/sales/tradeshows'
import TimePicker from '@/components/ui/TimePicker'
import Checkbox from '@/components/ui/Checkbox'

function enumerateDates(startIso: string, endIso: string): string[] {
  if (!startIso || !endIso || endIso < startIso) return []
  const out: string[] = []
  const cur = new Date(startIso + 'T12:00:00')
  const end = new Date(endIso + 'T12:00:00')
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

interface Props {
  tradeShowId: string
  startDate: string
  endDate: string
  canWrite: boolean
  /** Called whenever hours change so the parent can pass fresh data
   *  to the appointments panel without re-fetching from scratch. */
  onHoursChange?: (hours: TradeShowHours[]) => void
}

export default function TradeShowHoursPanel({ tradeShowId, startDate, endDate, canWrite, onHoursChange }: Props) {
  const [hours, setHours] = useState<TradeShowHours[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try {
      const h = await listHours(tradeShowId)
      setHours(h)
      onHoursChange?.(h)
    } catch (e: any) { setError(e?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [tradeShowId])

  const allDates = enumerateDates(startDate, endDate)
  const hoursByDate = new Map(hours.map(h => [h.show_date, h]))

  async function toggleDate(date: string, isOn: boolean) {
    setError(null)
    try {
      if (isOn) {
        // Default to 10am – 5pm — the most common trade-show day.
        await setHoursForDate(tradeShowId, date, '10:00', '17:00')
      } else {
        await deleteHoursForDate(tradeShowId, date)
      }
      await reload()
    } catch (e: any) { setError(e?.message || 'Could not save') }
  }

  async function changeHours(date: string, openTime: string, closeTime: string) {
    if (closeTime <= openTime) return
    setError(null)
    setHours(p => p.map(h => h.show_date === date ? { ...h, open_time: openTime, close_time: closeTime } : h))
    try { await setHoursForDate(tradeShowId, date, openTime, closeTime); await reload() }
    catch (e: any) { setError(e?.message || 'Could not save'); await reload() }
  }

  if (!loaded) return null

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>🕒 Show Hours</div>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 10 }}>
        Toggle each show day on and set its open/close hours. Days that are off don't appear in the booking grid.
      </div>
      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}
      {allDates.length === 0 ? (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--mist)', fontStyle: 'italic', fontSize: 13 }}>
          Set start &amp; end dates to populate the hours grid.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allDates.map(date => {
            const h = hoursByDate.get(date)
            const isOn = !!h
            const dayLabel = new Date(date + 'T12:00:00')
              .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            return (
              <div key={date} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '8px 12px', background: 'var(--cream)', borderRadius: 6,
              }}>
                <Checkbox checked={isOn} onChange={v => toggleDate(date, v)} disabled={!canWrite} size={18} label="" />
                <div style={{ minWidth: 200, fontSize: 13, fontWeight: 700, color: isOn ? 'var(--ink)' : 'var(--mist)' }}>
                  {dayLabel}
                </div>
                {isOn && h && (
                  <HoursEditor
                    open={h.open_time.slice(0, 5)}
                    close={h.close_time.slice(0, 5)}
                    canWrite={canWrite}
                    onChange={(o, c) => changeHours(date, o, c)}
                  />
                )}
                {!isOn && (
                  <span style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>Off</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HoursEditor({ open, close, canWrite, onChange }: {
  open: string; close: string; canWrite: boolean
  onChange: (open: string, close: string) => void
}) {
  const [o, setO] = useState(open)
  const [c, setC] = useState(close)
  return (
    <>
      <TimePicker value={o} onChange={v => { setO(v); onChange(v, c) }} disabled={!canWrite} style={{ width: 200 }} />
      <span style={{ color: 'var(--mist)' }}>–</span>
      <TimePicker value={c} onChange={v => { setC(v); onChange(o, v) }} disabled={!canWrite} style={{ width: 200 }} />
    </>
  )
}
