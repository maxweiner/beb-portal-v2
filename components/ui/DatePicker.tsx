'use client'

// Drop-in replacement for <input type="date">. Click the trigger
// to open an inline month-grid popover. Value is YYYY-MM-DD (same
// shape as the native input), so swapping in is a one-liner.

import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  value: string                            // YYYY-MM-DD or ''
  onChange: (v: string) => void            // emits YYYY-MM-DD
  disabled?: boolean
  placeholder?: string
  min?: string                             // YYYY-MM-DD lower bound (inclusive)
  max?: string                             // YYYY-MM-DD upper bound (inclusive)
  className?: string
  style?: React.CSSProperties
  id?: string
}

const DOWS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']

function parseYmd(v: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
  if (!m) return null
  return { y: +m[1], m: +m[2] - 1, d: +m[3] }
}

function fmtYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function fmtLong(v: string): string {
  const p = parseYmd(v); if (!p) return ''
  const dt = new Date(p.y, p.m, p.d)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DatePicker({
  value, onChange, disabled, placeholder = 'Pick a date',
  min, max, className, style, id,
}: Props) {
  const [open, setOpen] = useState(false)
  const initial = parseYmd(value) || (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } })()
  const [view, setView] = useState({ y: initial.y, m: initial.m })
  const wrapRef = useRef<HTMLDivElement>(null)

  // Re-sync view when value changes externally
  useEffect(() => {
    const p = parseYmd(value); if (p) setView({ y: p.y, m: p.m })
  }, [value])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const sel = parseYmd(value)
  const minD = parseYmd(min || '')
  const maxD = parseYmd(max || '')

  const grid = useMemo(() => {
    const { y, m } = view
    const first = new Date(y, m, 1)
    const startDow = first.getDay()
    const days = new Date(y, m + 1, 0).getDate()
    const cells: Array<{ y: number; m: number; d: number; muted: boolean } | null> = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push({ y, m, d, muted: false })
    return cells
  }, [view])

  const today = new Date(); const todayStr = fmtYmd(today.getFullYear(), today.getMonth(), today.getDate())

  function nav(dir: number) {
    setView(p => {
      let m = p.m + dir, y = p.y
      if (m < 0) { m = 11; y-- }
      if (m > 11) { m = 0; y++ }
      return { y, m }
    })
  }
  function isDisabled(y: number, m: number, d: number): boolean {
    const v = fmtYmd(y, m, d)
    if (minD && v < fmtYmd(minD.y, minD.m, minD.d)) return true
    if (maxD && v > fmtYmd(maxD.y, maxD.m, maxD.d)) return true
    return false
  }
  function pick(y: number, m: number, d: number) {
    if (isDisabled(y, m, d)) return
    onChange(fmtYmd(y, m, d))
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative', ...style }}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          width: '100%', padding: '8px 10px',
          border: '1px solid var(--pearl, #e2e8f0)', borderRadius: 6,
          background: disabled ? 'var(--pearl-pale, #f8fafc)' : '#fff',
          color: value ? 'var(--ink, #0f172a)' : 'var(--mist, #64748b)',
          textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
        <span>{value ? fmtLong(value) : placeholder}</span>
        <span style={{ color: 'var(--mist, #64748b)', fontSize: 14 }}>📅</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
          minWidth: 280, background: '#fff', border: '1px solid var(--pearl, #e2e8f0)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button type="button" onClick={() => nav(-1)}
              style={{ background: 'transparent', border: '1px solid var(--pearl)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 14 }}>‹</button>
            <span style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 13 }}>
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" onClick={() => nav(1)}
              style={{ background: 'transparent', border: '1px solid var(--pearl)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 14 }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
            {DOWS.map((d, i) => (
              <div key={i} style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, padding: '4px 0', textTransform: 'uppercase' }}>{d}</div>
            ))}
            {grid.map((c, i) => {
              if (!c) return <div key={i} />
              const isSel = !!sel && sel.y === c.y && sel.m === c.m && sel.d === c.d
              const v = fmtYmd(c.y, c.m, c.d)
              const isToday = v === todayStr
              const off = isDisabled(c.y, c.m, c.d)
              return (
                <button key={i} type="button"
                  disabled={off}
                  onClick={() => pick(c.y, c.m, c.d)}
                  style={{
                    background: isSel ? 'var(--blue, #3b82f6)' : 'transparent',
                    color: isSel ? '#fff' : (off ? 'var(--mist)' : 'var(--ink)'),
                    border: 'none', borderRadius: 6,
                    padding: '7px 0', cursor: off ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: isSel ? 800 : 500,
                    boxShadow: isToday && !isSel ? 'inset 0 0 0 1px var(--blue, #3b82f6)' : 'none',
                    opacity: off ? 0.4 : 1,
                  }}>
                  {c.d}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--pearl)' }}>
            <button type="button" onClick={() => pick(today.getFullYear(), today.getMonth(), today.getDate())}
              style={{ background: 'transparent', border: 'none', color: 'var(--blue, #3b82f6)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              Today
            </button>
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false) }}
                style={{ background: 'transparent', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 12 }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
