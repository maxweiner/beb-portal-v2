'use client'

// Nearby-airports list for the Travel Share page. Lists every
// airport within 100 miles of the given origin (typically a
// store's geocoded lat/lon), filtered to those served by
// AA / DL / UA / JSX, sorted closest-first.
//
// Distance is straight-line haversine — free, instant, accurate
// enough for "which airport should I fly into" decisions. The
// 5-10 mile delta vs driving distance doesn't change the answer.
//
// Data lives in lib/travel/airports.ts — a curated static list.
// Add airports there as needed (see the file header for the format).
//
// Falls back to an empty state when no airports are within range
// (mostly the Mountain West / remote regions where the nearest
// commercial airport is 150+ miles out).

import { useMemo } from 'react'
import { airportsWithinMiles, type NearbyAirport } from '@/lib/travel/airports'

interface Props {
  /** Origin lat/lon — usually store.lat / store.lng. When either
   *  is missing the component renders a small "address not
   *  geocoded" hint rather than the list. */
  originLat: number | null | undefined
  originLng: number | null | undefined
  /** Optional human-readable origin label for the header (e.g.
   *  the store's city + state). */
  originLabel?: string | null
  /** Defaults to 100mi per the spec. Operators can extend per-
   *  store later via a Settings tweak if needed. */
  maxMiles?: number
}

const CARRIER_COLOR: Record<string, { bg: string; fg: string }> = {
  AA: { bg: '#FFE4E6', fg: '#9F1239' },  // American — red
  DL: { bg: '#E0F2FE', fg: '#075985' },  // Delta — blue
  UA: { bg: '#FEF3C7', fg: '#92400E' },  // United — gold/navy → amber for legibility
  XE: { bg: '#F3E8FF', fg: '#6B21A8' },  // JSX — purple
}

const CARRIER_LABEL: Record<string, string> = {
  AA: 'AA', DL: 'DL', UA: 'UA', XE: 'JSX',
}

export default function NearbyAirports({ originLat, originLng, originLabel, maxMiles = 100 }: Props) {
  const list: NearbyAirport[] = useMemo(() => {
    if (originLat == null || originLng == null) return []
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) return []
    return airportsWithinMiles(originLat, originLng, maxMiles)
  }, [originLat, originLng, maxMiles])

  if (originLat == null || originLng == null) {
    return (
      <div style={{
        marginTop: 24, padding: 14,
        background: 'var(--cream2)', border: '1px dashed var(--pearl)', borderRadius: 8,
        fontSize: 12, color: 'var(--mist)',
      }}>
        ✈️ Nearby airports — store address not geocoded yet. Save the store with
        Google Places autocomplete to populate lat/lon.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'var(--ash)',
        textTransform: 'uppercase', letterSpacing: '.04em',
        marginBottom: 8,
      }}>
        ✈️ Airports within {maxMiles} mi
        {originLabel && <span style={{ fontWeight: 600, color: 'var(--mist)', marginLeft: 6 }}>· {originLabel}</span>}
      </div>

      {list.length === 0 ? (
        <div style={{
          padding: 14,
          background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
          fontSize: 12, color: 'var(--mist)',
        }}>
          No AA / Delta / United / JSX airports within {maxMiles} miles. The closest
          commercial option is likely outside the radius — try a wider search or
          consider regional carriers.
        </div>
      ) : (
        <div style={{
          background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8,
          overflow: 'hidden',
        }}>
          {list.map((a, i) => (
            <div
              key={a.iata}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '1px solid var(--cream2)',
              }}
            >
              <div style={{
                fontSize: 14, fontWeight: 900, color: 'var(--ink)',
                fontFamily: 'monospace', letterSpacing: '.02em',
                minWidth: 44,
              }}>
                {a.iata}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--ink)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  {a.city}, {a.state}
                </div>
              </div>
              {/* Carrier pills — small, color-coded chips so the
                  operator can scan for their preferred airline at
                  a glance. */}
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {a.served_by.map(c => {
                  const color = CARRIER_COLOR[c] || { bg: 'var(--cream2)', fg: 'var(--ash)' }
                  return (
                    <span
                      key={c}
                      style={{
                        background: color.bg, color: color.fg,
                        fontSize: 10, fontWeight: 800, letterSpacing: '.02em',
                        padding: '2px 6px', borderRadius: 4,
                      }}
                      title={`Served by ${CARRIER_LABEL[c]}`}
                    >{CARRIER_LABEL[c]}</span>
                  )
                })}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 800, color: 'var(--ink)',
                minWidth: 50, textAlign: 'right',
              }}>
                {Math.round(a.distance_miles)} mi
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
