'use client'

// Marketing module is being rebuilt against the new VDP / Postcard
// flow spec. The previous implementation (campaigns, proofs, vendors,
// email log) was wiped to clear the way for the new schema. Each phase
// of the rebuild lands as its own PR; this placeholder is replaced
// when Phase 3 (Setup phase UI) ships.

export default function Marketing() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div className="card" style={{
        maxWidth: 460, padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚧</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>
          Marketing module — being rebuilt
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)', lineHeight: 1.5 }}>
          The previous Marketing UI was retired so we can rebuild it against the
          new VDP + Postcard flow spec. The new module ships in phases — this
          placeholder is replaced once Phase 3 (Setup) lands.
        </div>
      </div>
    </div>
  )
}
