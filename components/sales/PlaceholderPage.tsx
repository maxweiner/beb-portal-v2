'use client'

// Reusable "Coming soon" page used during the multi-phase sales-rep
// rollout. Each new module wires its nav entry now (Phase 2) and
// swaps the placeholder for the real screen later (Phases 3, 6, 9,
// 10, etc.).

interface Props {
  title: string
  phase: string
  blurb?: string
}

export default function PlaceholderPage({ title, phase, blurb }: Props) {
  return (
    <div className="p-6" style={{ maxWidth: 720, margin: '40px auto' }}>
      <div className="card" style={{ padding: '36px 32px', textAlign: 'center' }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--mist)', marginBottom: 6,
        }}>{phase}</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ash)', lineHeight: 1.5 }}>
          {blurb || 'This page is wired for navigation. The full module ships in a later phase of the sales-rep rollout.'}
        </p>
      </div>
    </div>
  )
}
