// Rendered when a customer hits the waitlist page after 7pm
// store-local. The waitlist is "today only" — we don't accept
// signups for tomorrow via this URL.

export default function WaitlistClosed({ storeName }: { storeName: string }) {
  return (
    <div style={{
      maxWidth: 480, margin: '0 auto', padding: '24px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 32, textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,.06)',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🌙</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>The waitlist is closed for today</h1>
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.5 }}>
          The signup list at <strong>{storeName}</strong> resets each day at 7pm.
          Please come back tomorrow during event hours, or speak to staff in person.
        </p>
      </div>
    </div>
  )
}
