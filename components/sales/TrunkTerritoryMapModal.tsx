'use client'

// Full-screen modal that shows the trunk-rep territory split as a
// color-coded US map with a per-rep legend. Print-ready: window.print
// triggers a `@media print` stylesheet that hides the portal chrome
// + modal scaffolding so the printed page is just title + map +
// legend on white.
//
// Bonus features included:
//  - "📋 Copy state list" button per rep in the legend
//  - Home-state ★ marker (resolves from a hand-curated map keyed by
//    rep first name; users whose first name isn't in HOME_STATES
//    just get no star, which is fine)

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { US_STATE_PATHS, US_MAP_VIEWBOX } from '@/lib/sales/usStatesSvg'
import { US_STATES } from '@/lib/sales/territories'
import { buildRepColorMap, type RepLike } from '@/lib/sales/repColors'
import type { TerritoryAssignment } from '@/lib/sales/territories'

interface Props {
  rows: TerritoryAssignment[]
  reps: RepLike[]
  onClose: () => void
}

// Tiny states whose centroid label would overlap a neighbor. Renders
// a smaller font so the code still fits inside the shape outline.
const TINY_STATES = new Set(['RI', 'CT', 'DE', 'DC', 'NJ', 'MD'])

// Hand-curated rep home states (keyed by first name, case-insensitive).
// If a future rep doesn't appear here they just don't get a star —
// no breakage. Tweak when reps change.
const HOME_STATES: Record<string, string> = {
  ann:     'NV',
  tanya:   'PA',
  radica:  'IL',
  tiffany: 'VT',
}

export default function TrunkTerritoryMapModal({ rows, reps, onClose }: Props) {
  const colorByRepId = useMemo(() => buildRepColorMap(reps), [reps])

  // state code → rep_user_id (only for assigned states)
  const assignedRepByState = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.state, r.rep_user_id)
    return m
  }, [rows])

  // rep id → human-readable bundle for the legend
  const repBundles = useMemo(() => {
    const byId = new Map<string, { rep: RepLike; states: string[]; color: string }>()
    for (const r of rows) {
      const rep = reps.find(u => u.id === r.rep_user_id)
      if (!rep) continue
      if (!byId.has(rep.id)) {
        byId.set(rep.id, {
          rep,
          states: [],
          color: colorByRepId.get(rep.id) || '#999',
        })
      }
      byId.get(rep.id)!.states.push(r.state)
    }
    // Sort each rep's state list by code; sort reps alphabetically by name.
    const bundles = Array.from(byId.values())
    bundles.forEach(b => b.states.sort())
    bundles.sort((a, b) => (a.rep.name || '').localeCompare(b.rep.name || ''))
    return bundles
  }, [rows, reps, colorByRepId])

  // Home state lookup keyed by rep id
  const homeStateByRepId = useMemo(() => {
    const m = new Map<string, string>()
    for (const rep of reps) {
      const first = (rep.name || '').split(' ')[0].toLowerCase()
      const home = HOME_STATES[first]
      if (home) m.set(rep.id, home)
    }
    return m
  }, [reps])

  // Place state-code labels at each path's bbox centroid after mount.
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [labels, setLabels] = useState<Array<{ code: string; cx: number; cy: number; isHome: boolean }>>([])

  useEffect(() => {
    if (!svgRef.current) return
    const out: Array<{ code: string; cx: number; cy: number; isHome: boolean }> = []
    svgRef.current.querySelectorAll('path[data-state]').forEach(node => {
      const code = node.getAttribute('data-state')!
      const bbox = (node as SVGPathElement).getBBox()
      const repId = assignedRepByState.get(code)
      const isHome = !!repId && homeStateByRepId.get(repId) === code
      out.push({
        code,
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
        isHome,
      })
    })
    setLabels(out)
  }, [assignedRepByState, homeStateByRepId])

  // ESC + outside-click to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portaled to body so the `body > *:not(.ttmm-overlay)` print rule isolates it.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  async function copyStateList(rep: RepLike, states: string[]) {
    const code = (s: string) => US_STATES.find(x => x.code === s)?.name || s
    const csv = states.map(code).join(', ')
    const payload = `${rep.name || 'Rep'} — ${csv}`
    try {
      await navigator.clipboard.writeText(payload)
      // toast handled inline via button label flip
    } catch { /* clipboard blocked — silently ignore */ }
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  if (!mounted) return null

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      className="ttmm-overlay"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(2px)',
        zIndex: 9000,
        padding: '32px 24px',
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <div className="ttmm-modal" style={{
        background: '#fff',
        borderRadius: 14,
        maxWidth: 1100, width: '100%',
        padding: '28px 32px 32px',
        boxShadow: '0 20px 60px rgba(0,0,0,.35)',
      }}>
        <div className="ttmm-head" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>
            Trunk Rep Territories
          </h2>
          <div className="ttmm-actions" style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.print()} className="btn-primary btn-sm">🖨️ Print</button>
            <button onClick={onClose} className="btn-outline btn-sm">✕ Close</button>
          </div>
        </div>
        <p className="ttmm-sub" style={{ color: 'var(--mist)', fontSize: 13, margin: '0 0 22px' }}>
          Generated {today} · ★ marks home state
        </p>

        <div style={{
          width: '100%', maxWidth: 1040, margin: '0 auto 24px',
          background: '#fff',
          border: '1px solid var(--pearl)',
          borderRadius: 12,
          padding: 12,
        }}>
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={US_MAP_VIEWBOX}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          >
            <g>
              {US_STATE_PATHS.map(s => {
                const repId = assignedRepByState.get(s.code)
                const fill = repId ? colorByRepId.get(repId) : '#CCCCCC'
                return (
                  <path
                    key={s.code}
                    data-state={s.code}
                    d={s.d}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={1}
                  >
                    <title>{s.name}</title>
                  </path>
                )
              })}
              {labels.map(l => (
                <g key={l.code}>
                  <text
                    x={l.cx}
                    y={l.cy}
                    fill="#fff"
                    fontSize={TINY_STATES.has(l.code) ? 9 : 13}
                    fontWeight={800}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.25)', strokeWidth: 0.6 }}
                  >
                    {l.code}
                  </text>
                  {l.isHome && (
                    <text
                      x={l.cx + (TINY_STATES.has(l.code) ? 8 : 14)}
                      y={l.cy - (TINY_STATES.has(l.code) ? 8 : 12)}
                      fill="#FFE89A"
                      fontSize={11}
                      fontWeight={900}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.4)', strokeWidth: 0.6 }}
                    >★</text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* Legend */}
        {repBundles.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>
            No territories assigned yet — pick a rep for each state below.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
          }}>
            {repBundles.map(b => (
              <LegendCard key={b.rep.id} bundle={b} home={homeStateByRepId.get(b.rep.id) || null} onCopy={() => copyStateList(b.rep, b.states)} />
            ))}
          </div>
        )}
      </div>

      {/* Print + scoped styles — keyed by className prefix to avoid
          colliding with anything else. */}
      <style jsx global>{`
        @media print {
          body > *:not(.ttmm-overlay) { display: none !important; }
          .ttmm-overlay { position: static !important; background: none !important; padding: 0 !important; backdrop-filter: none !important; display: block !important; overflow: visible !important; }
          .ttmm-modal { box-shadow: none !important; max-width: none !important; padding: 0 !important; }
          .ttmm-actions { display: none !important; }
          .ttmm-copy-btn { display: none !important; }
          @page { margin: 12mm; }
        }
      `}</style>
    </div>,
    document.body,
  )
}

function LegendCard({
  bundle, home, onCopy,
}: {
  bundle: { rep: RepLike; states: string[]; color: string }
  home: string | null
  onCopy: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{
      border: '1px solid var(--pearl)',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: bundle.color, flexShrink: 0 }} />
        <span style={{ fontSize: 15, fontWeight: 900, flex: 1 }}>{bundle.rep.name || 'Rep'}</span>
      </div>
      {home && (
        <div style={{ color: 'var(--mist)', fontSize: 11, marginTop: 4 }}>
          Home: {home} ★
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', marginTop: 8 }}>
        {bundle.states.length} state{bundle.states.length === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 4, lineHeight: 1.5 }}>
        {bundle.states.join(' · ')}
      </div>
      <button
        className="ttmm-copy-btn"
        type="button"
        onClick={() => {
          onCopy()
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        style={{
          marginTop: 10,
          background: copied ? 'var(--green)' : 'var(--cream)',
          color: copied ? '#fff' : 'var(--ash)',
          border: `1px solid ${copied ? 'var(--green)' : 'var(--pearl)'}`,
          padding: '5px 10px',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >{copied ? '✓ Copied' : '📋 Copy state list'}</button>
    </div>
  )
}
