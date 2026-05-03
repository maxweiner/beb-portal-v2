'use client'

// Drop-in replacement for <input type="time">. Hour + minute selects;
// AM/PM is auto-resolved using retail hours (9am–9pm):
//   9          → AM (boundary; 9pm is closing time, not a start time)
//   10, 11     → AM (only AM is in range)
//   12         → PM (noon)
//   1..8       → PM (only PM is in range)
// Value in/out is HH:mm 24-hour, matching the native input contract.
// Minute granularity is 15 min by default.

import { useMemo } from 'react'

interface Props {
  value: string                              // HH:mm 24-hour or ''
  onChange: (v: string) => void              // emits HH:mm 24-hour
  disabled?: boolean
  step?: 5 | 10 | 15 | 30                    // minute step (default 15)
  className?: string
  style?: React.CSSProperties
  id?: string
}

const HOURS_12 = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]

/** Retail-hours mapping: returns 24-hour version of a 12-hour clock value. */
function to24(h12: number): number {
  if (h12 === 9 || h12 === 10 || h12 === 11) return h12              // AM
  if (h12 === 12) return 12                                          // noon
  return h12 + 12                                                    // 1..8 → 13..20
}

/** Inverse of to24, for displaying the stored value. */
function to12(h24: number): { h12: number; ampm: 'AM' | 'PM' } {
  if (h24 === 0) return { h12: 12, ampm: 'AM' }
  if (h24 < 12) return { h12: h24, ampm: 'AM' }
  if (h24 === 12) return { h12: 12, ampm: 'PM' }
  return { h12: h24 - 12, ampm: 'PM' }
}

function parseHm(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '')
  if (!m) return null
  const h = +m[1], mn = +m[2]
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null
  return { h, m: mn }
}

function fmtHm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function TimePicker({
  value, onChange, disabled, step = 15, className, style, id,
}: Props) {
  const parsed = parseHm(value)
  const { h12, ampm } = parsed ? to12(parsed.h) : { h12: 0 as number, ampm: '' as 'AM' | 'PM' | '' }
  const minute = parsed?.m ?? 0

  const minutes = useMemo(() => {
    const arr: number[] = []
    for (let m = 0; m < 60; m += step) arr.push(m)
    return arr
  }, [step])

  function setHour(h12new: number) {
    const h24 = to24(h12new)
    onChange(fmtHm(h24, minute))
  }
  function setMinute(mNew: number) {
    const baseHour24 = parsed ? parsed.h : to24(9)
    onChange(fmtHm(baseHour24, mNew))
  }

  const labelDisplay = parsed ? `${h12}:${String(minute).padStart(2, '0')} ${ampm}` : ''

  return (
    <div id={id} className={className}
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center', ...style }}>
      <select
        disabled={disabled}
        value={parsed ? h12 : ''}
        onChange={e => setHour(parseInt(e.target.value))}
        style={{ padding: '8px 10px', border: '1px solid var(--pearl, #e2e8f0)', borderRadius: 6, background: '#fff', fontFamily: 'inherit', fontSize: 14 }}>
        {!parsed && <option value="">Hr</option>}
        {HOURS_12.map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <select
        disabled={disabled}
        value={parsed ? minute : ''}
        onChange={e => setMinute(parseInt(e.target.value))}
        style={{ padding: '8px 10px', border: '1px solid var(--pearl, #e2e8f0)', borderRadius: 6, background: '#fff', fontFamily: 'inherit', fontSize: 14 }}>
        {!parsed && <option value="">Min</option>}
        {minutes.map(m => (
          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
        ))}
      </select>
      <span style={{
        fontSize: 12, fontWeight: 800, color: 'var(--mist, #64748b)',
        padding: '0 4px', minWidth: 30, textAlign: 'center',
      }}
        title={labelDisplay || 'Retail hours: 9am–9pm. AM/PM is auto-set.'}>
        {ampm || '—'}
      </span>
    </div>
  )
}
