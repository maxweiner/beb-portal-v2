'use client'

import { useApp } from '@/lib/context'

const BRAND_LABEL: Record<string, string> = {
  beb: 'Beneficial',
  liberty: 'Liberty',
}

const BRAND_ACCENT: Record<string, string> = {
  beb: '#7EC8A0',
  liberty: '#93C5FD',
}

/**
 * Full-screen overlay shown while the active brand is being swapped.
 * Renders above everything (z 99999) so the user never sees a frame where
 * the new theme is applied but the new data hasn't arrived yet.
 */
export default function BrandSwitchOverlay() {
  const { isSwitching, pendingBrand } = useApp()
  if (!isSwitching) return null

  const accent = BRAND_ACCENT[pendingBrand ?? 'beb'] ?? '#7EC8A0'
  const label = BRAND_LABEL[pendingBrand ?? 'beb'] ?? ''

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'radial-gradient(circle at 50% 40%, rgba(20,30,40,.95), rgba(8,12,18,.98))',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        color: '#fff',
        fontFamily: 'inherit',
      }}
    >
      <Spinner accent={accent} />

      <div style={{ textAlign: 'center', maxWidth: 360, padding: '0 24px' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            color: accent,
            marginBottom: 10,
          }}
        >
          Switching to {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
          Fixing up your changeover…
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginTop: 10 }}>
          Loading your data so the colors and numbers all match.
        </div>
      </div>

      <style>{`
        @keyframes beb-switch-spin { to { transform: rotate(360deg); } }
        @keyframes beb-switch-pulse {
          0%, 100% { transform: scale(1); opacity: .35; }
          50% { transform: scale(1.08); opacity: .7; }
        }
        @keyframes beb-switch-orbit {
          0% { transform: rotate(0deg) translateX(46px) rotate(0deg); }
          100% { transform: rotate(360deg) translateX(46px) rotate(-360deg); }
        }
      `}</style>
    </div>
  )
}

function Spinner({ accent }: { accent: string }) {
  return (
    <div style={{ position: 'relative', width: 120, height: 120 }}>
      {/* Pulsing core */}
      <div
        style={{
          position: 'absolute',
          inset: 30,
          borderRadius: '50%',
          background: accent,
          opacity: 0.35,
          animation: 'beb-switch-pulse 1.6s ease-in-out infinite',
        }}
      />
      {/* Spinning ring */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `3px solid ${accent}22`,
          borderTopColor: accent,
          borderRightColor: accent,
          animation: 'beb-switch-spin 1.1s linear infinite',
        }}
      />
      {/* Orbiting dot — adds a touch of motion variety */}
      <div
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: 10, height: 10, marginLeft: -5, marginTop: -5,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: `0 0 12px ${accent}, 0 0 24px ${accent}88`,
          animation: 'beb-switch-orbit 2.2s linear infinite',
        }}
      />
    </div>
  )
}
