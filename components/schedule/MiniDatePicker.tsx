'use client'

// Year/month popover triggered by clicking the "May 2026 ▾" label in
// the MonthView header. Lets the user jump anywhere without paging
// through one month at a time.

import { useState, useEffect } from 'react'

export default function MiniDatePicker({ year, month, onPick, onClose }: {
  year: number
  month: number
  onPick: (year: number, month: number) => void
  onClose: () => void
}) {
  const [pickYear, setPickYear] = useState(year)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <>
      {/* Click-outside backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'transparent' }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
        zIndex: 999, background: '#fff', borderRadius: 10,
        boxShadow: '0 12px 30px rgba(0,0,0,.18)',
        padding: 14, width: 260,
        color: 'var(--ink)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => setPickYear(y => y - 1)} aria-label="Previous year"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ash)' }}>‹</button>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{pickYear}</div>
          <button onClick={() => setPickYear(y => y + 1)} aria-label="Next year"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ash)' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {months.map((m, i) => {
            const sel = pickYear === year && i === month
            return (
              <button key={m} onClick={() => onPick(pickYear, i)} style={{
                padding: '8px 0', borderRadius: 6, border: 'none',
                background: sel ? 'var(--green)' : 'transparent',
                color: sel ? '#fff' : 'var(--ash)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background .12s',
              }}
              onMouseEnter={e => { if (!sel) (e.currentTarget.style.background = 'var(--cream2)') }}
              onMouseLeave={e => { if (!sel) (e.currentTarget.style.background = 'transparent') }}
              >{m}</button>
            )
          })}
        </div>
      </div>
    </>
  )
}
