'use client'

// Boot splash shown while lib/context.tsx is hydrating the user +
// data. Picks one of three loader styles at random on mount so the
// app feels a little less monotonous on repeated reloads. The pick
// is captured in useState's initializer so it's stable across
// re-renders within the same mount — switching only happens on a
// fresh page load.
//
// The three styles each live in app/globals.css so they're available
// even before this component's chunk loads (since LoadingSpinner is
// eagerly imported from app/page.tsx).

import { useState } from 'react'

type LoaderStyle = 'emoji' | 'vault' | 'pearl'
const STYLES: LoaderStyle[] = ['emoji', 'vault', 'pearl']

export default function LoadingSpinner() {
  const [style] = useState<LoaderStyle>(
    () => STYLES[Math.floor(Math.random() * STYLES.length)],
  )

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--page-bg)' }}>
      <div className="flex flex-col items-center gap-5">
        {style === 'emoji' && <EmojiCascade />}
        {style === 'vault' && <VaultDial />}
        {style === 'pearl' && <PearlStrand />}
        <div className="text-sm font-semibold" style={{ color: 'var(--mist)' }}>Loading your portal…</div>
      </div>
    </div>
  )
}

function EmojiCascade() {
  return (
    <div style={{ display: 'flex', gap: 18 }} aria-label="Loading">
      <span className="beb-jewel-loader" style={{ animationDelay: '0s, 0s' }}>💎</span>
      <span className="beb-jewel-loader" style={{ animationDelay: '.2s, .5s' }}>💍</span>
      <span className="beb-jewel-loader" style={{ animationDelay: '.4s, 1s' }}>⌚</span>
    </div>
  )
}

function VaultDial() {
  return <div className="beb-vault-loader" aria-label="Loading" />
}

function PearlStrand() {
  return (
    <div className="beb-pearl-loader" aria-label="Loading">
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} className="beb-pearl-bead" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  )
}
