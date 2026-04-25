// Public install instructions for adding the portal as an iPhone home-screen app.
// Linked from the store portal header and from the welcome email.

export const metadata = { title: 'Install BEB Portal' }

export default function InstallPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F0E8',
      paddingTop: 'max(env(safe-area-inset-top), 24px)',
      paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
      paddingLeft: 16,
      paddingRight: 16,
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <header style={{
          background: 'white', borderRadius: 14,
          borderBottom: '4px solid #1D6B44',
          padding: '20px 22px', marginBottom: 16,
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1D6B44', margin: 0 }}>
            Install on your iPhone
          </h1>
          <p style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
            Add BEB Portal to your home screen so it opens like a native app — no Safari URL bar, full-screen.
          </p>
        </header>

        <ol style={{
          listStyle: 'none', counterReset: 'step',
          padding: 0, margin: 0,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <Step
            num={1}
            title="Open the portal in Safari"
            body="The link only works in Safari on iPhone — not Chrome, not in-app browsers. If you're not sure, tap and hold the link and choose Open in Safari."
          />
          <Step
            num={2}
            title="Tap the Share button"
            body="It's the square with an arrow pointing up, at the bottom of the screen (or top right on iPad)."
          />
          <Step
            num={3}
            title='Tap "Add to Home Screen"'
            body="Scroll down in the share sheet — it's about halfway down the list. The icon looks like a square with a plus inside."
          />
          <Step
            num={4}
            title='Tap "Add" in the top right'
            body="You can rename the app first if you want, then tap Add. The icon appears on your home screen."
          />
          <Step
            num={5}
            title="Open it from your home screen"
            body="Tap the new icon. It launches full-screen with no browser UI. Treat it like a regular app."
          />
        </ol>

        <div style={{
          marginTop: 18, padding: 14,
          background: '#FEF3C7', border: '1px solid #F59E0B',
          borderRadius: 12, fontSize: 13, color: '#92400E',
        }}>
          <strong>Heads up:</strong> Apple doesn't let websites add themselves to your home screen automatically. You have to do steps 2–4 yourself, but only once per device.
        </div>

        <p style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
          On Android? Use Chrome's "Install app" or "Add to Home screen" menu — same idea.
        </p>
      </div>
    </div>
  )
}

function Step({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <li style={{
      background: 'white', borderRadius: 12,
      padding: '14px 16px', display: 'flex', gap: 12,
      border: '1px solid #E5E7EB',
    }}>
      <div style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
        background: '#1D6B44', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 14,
      }}>
        {num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#374151', marginTop: 4, lineHeight: 1.5 }}>{body}</div>
      </div>
    </li>
  )
}
