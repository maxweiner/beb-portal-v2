'use client'

// Thin metals price ticker for the buyer dashboard. Three metals
// across, percent-change indicator on each, manual refresh icon
// at the right end. Data source = metals_prices_cache (populated
// every 15 min by the cron). Variant controls layout density —
// 'desktop' (full labels) vs 'mobile' (Au/Ag/Pt + smaller font).

import { useMetals, type MetalKind, type MetalRow } from '@/lib/metals/client'

interface Props {
  variant: 'desktop' | 'mobile'
}

const ORDER: MetalKind[] = ['gold', 'silver', 'platinum']
const FULL_LABEL: Record<MetalKind, string> = { gold: 'Gold', silver: 'Silver', platinum: 'Platinum' }
const SHORT_LABEL: Record<MetalKind, string> = { gold: 'Au', silver: 'Ag', platinum: 'Pt' }

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function MetalsTicker({ variant }: Props) {
  const { rows, freshness, newestFetchedAt, loading, refreshing, refresh } = useMetals(true)
  const isMobile = variant === 'mobile'

  const byMetal = new Map(rows.map(r => [r.metal, r]))

  return (
    <div
      role="region"
      aria-label="Metals spot prices"
      style={{
        display: 'flex', alignItems: 'center',
        gap: isMobile ? 8 : 16,
        padding: isMobile ? '6px 10px' : '8px 16px',
        minHeight: isMobile ? 36 : 44,
        background: 'var(--card-bg, #fff)',
        border: '1px solid var(--pearl, #E5E7EB)',
        borderRadius: 'var(--r2, 8px)',
        marginBottom: 12,
        fontSize: isMobile ? 11 : 13,
        color: 'var(--ink)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        flex: 1, minWidth: 0,
        gap: isMobile ? 6 : 14,
      }}>
        {ORDER.map(m => (
          <MetalCell
            key={m}
            metal={m}
            row={byMetal.get(m)}
            isMobile={isMobile}
            loading={loading}
          />
        ))}
      </div>

      {freshness === 'stale' && newestFetchedAt && (
        <span title={`Last fetched at ${newestFetchedAt.toLocaleString()}`}
          style={{ fontSize: isMobile ? 10 : 11, color: 'var(--mist)', whiteSpace: 'nowrap' }}>
          as of {fmtTime(newestFetchedAt.toISOString())}
        </span>
      )}
      {freshness === 'very-stale' && newestFetchedAt && (
        <span aria-label="Data is over 2 hours old"
          title={`Data is over 2 hours old. Last fetched at ${newestFetchedAt.toLocaleString()}`}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#9CA3AF', flexShrink: 0,
          }}
        />
      )}

      <button
        onClick={refresh}
        disabled={loading || refreshing}
        aria-label="Refresh metals prices"
        title="Refresh metals prices"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: refreshing ? 'wait' : 'pointer',
          padding: isMobile ? '4px 4px' : '4px 6px',
          color: 'var(--mist)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          opacity: refreshing ? 0.5 : 1,
        }}
      >
        <RefreshIcon size={isMobile ? 12 : 14} spinning={refreshing} />
      </button>
    </div>
  )
}

function MetalCell({
  metal, row, isMobile, loading,
}: {
  metal: MetalKind
  row: MetalRow | undefined
  isMobile: boolean
  loading: boolean
}) {
  const label = isMobile ? SHORT_LABEL[metal] : FULL_LABEL[metal]
  const labelStyle: React.CSSProperties = {
    fontWeight: 800,
    color: 'var(--green-dark, #14532D)',
    flexShrink: 0,
  }

  if (loading && !row) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={labelStyle}>{label}</span>
        <span style={{ color: 'var(--mist)', fontStyle: 'italic' }}>…</span>
      </div>
    )
  }

  if (!row) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={labelStyle}>{label}</span>
        <span style={{ color: 'var(--mist)' }}>—</span>
      </div>
    )
  }

  const pct = row.changePercent24h
  const flat = pct === null || Math.abs(pct) < 0.05
  const up = pct !== null && pct > 0 && !flat
  const arrow = flat ? '–' : up ? '▲' : '▼'
  const color = flat ? 'var(--mist)' : up ? '#15803D' : '#B91C1C'
  const pctText = pct === null ? '—' : `${Math.abs(pct).toFixed(2)}%`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <span style={{
        fontWeight: 700, color: 'var(--ink)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {USD.format(row.priceUsd)}
      </span>
      <span style={{
        color, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {arrow} {pctText}
      </span>
    </div>
  )
}

function RefreshIcon({ size, spinning }: { size: number; spinning: boolean }) {
  // Disabled-button opacity is the spin signal. Avoiding @keyframes
  // here keeps the component self-contained — no global CSS hook
  // needed and no SVG-nested <style> quirks.
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { transform: 'rotate(180deg)', transition: 'transform 0.4s ease' } : { transition: 'transform 0.4s ease' }}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  )
}
