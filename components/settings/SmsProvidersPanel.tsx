'use client'

// Settings → 📡 SMS Providers card. Picks Twilio vs Telnyx per
// "purpose" slot (internal vs marketing) and edits the credential
// rows for each provider. Hot-swap is just changing the dropdown
// and clicking Save — the dispatcher reads the latest setting on
// every send.
//
// Internal flows tag purpose='internal' (the default for every
// legacy callsite). Marketing flows can opt into the marketing
// slot by passing purpose='marketing' when calling dispatchSms.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Provider = 'twilio' | 'telnyx'

interface ServerState {
  providers: { internal: Provider; marketing: Provider }
  telnyx: {
    apiKeyMasked: string; apiKeySet: boolean
    publicKeyMasked: string; publicKeySet: boolean
    fromNumber: string
    messagingProfileId: string
  }
  twilio: {
    accountSidMasked: string; accountSidSet: boolean
    authTokenMasked: string; authTokenSet: boolean
    fromNumber: string
  }
}

async function authHeader(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {}
}

export default function SmsProvidersPanel() {
  const [state, setState] = useState<ServerState | null>(null)
  const [internal, setInternal] = useState<Provider>('twilio')
  const [marketing, setMarketing] = useState<Provider>('twilio')

  const [telnyxApiKey, setTelnyxApiKey] = useState('')
  const [telnyxPublicKey, setTelnyxPublicKey] = useState('')
  const [telnyxFrom, setTelnyxFrom] = useState('')
  const [telnyxProfile, setTelnyxProfile] = useState('')

  const [twilioSid, setTwilioSid] = useState('')
  const [twilioToken, setTwilioToken] = useState('')
  const [twilioFrom, setTwilioFrom] = useState('')

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testPurpose, setTestPurpose] = useState<'internal' | 'marketing'>('internal')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  async function load() {
    const res = await fetch('/api/settings/sms-providers', { headers: await authHeader() })
    if (!res.ok) { setError(await res.text()); return }
    const j: ServerState = await res.json()
    setState(j)
    setInternal(j.providers.internal)
    setMarketing(j.providers.marketing)
    setTelnyxFrom(j.telnyx.fromNumber)
    setTelnyxProfile(j.telnyx.messagingProfileId)
    setTwilioFrom(j.twilio.fromNumber)
  }
  useEffect(() => { load() }, [])

  async function save() {
    setSaving(true); setError(null)
    const body: any = {
      providers: { internal, marketing },
      telnyx: { fromNumber: telnyxFrom, messagingProfileId: telnyxProfile },
      twilio: { fromNumber: twilioFrom },
    }
    if (telnyxApiKey.trim()) body.telnyx.apiKey = telnyxApiKey.trim()
    if (telnyxPublicKey.trim()) body.telnyx.publicKey = telnyxPublicKey.trim()
    if (twilioSid.trim()) body.twilio.accountSid = twilioSid.trim()
    if (twilioToken.trim()) body.twilio.authToken = twilioToken.trim()

    const res = await fetch('/api/settings/sms-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'save failed'); return }
    setTelnyxApiKey(''); setTelnyxPublicKey(''); setTwilioSid(''); setTwilioToken('')
    setSavedAt(new Date().toLocaleTimeString())
    await load()
  }

  async function sendTest() {
    if (!testTo.trim()) return
    setTesting(true); setTestResult(null)
    const res = await fetch('/api/settings/sms-providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({
        to: testTo.trim(),
        body: `BEB portal test (${testPurpose} via ${testPurpose === 'internal' ? internal : marketing}) — ${new Date().toLocaleTimeString()}`,
        purpose: testPurpose,
      }),
    })
    setTesting(false)
    const j = await res.json().catch(() => ({}))
    setTestResult(res.ok ? `✅ sent via ${j.provider || '?'}${j.sid ? ` (id ${j.sid})` : ''}` : `❌ ${j.error || res.statusText}`)
  }

  if (!state) return <div style={{ padding: 12, color: '#7a786a' }}>Loading…</div>

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #d8d3c3',
    borderRadius: 6, fontSize: 14, background: '#fff',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#4a4a42', marginBottom: 4,
  }
  const cardStyle: React.CSSProperties = {
    background: '#fafaf6', border: '1px solid #ede7da', borderRadius: 8,
    padding: 14, marginTop: 12,
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: '#4a4a42', lineHeight: 1.55 }}>
        Pick which provider sends each kind of outbound SMS. The dispatcher
        reads this setting on every send, so swaps take effect immediately
        with no redeploy.
      </div>

      {/* Provider slots */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={cardStyle}>
          <label style={labelStyle}>Internal / transactional</label>
          <select value={internal} onChange={e => setInternal(e.target.value as Provider)} style={inputStyle}>
            <option value="twilio">Twilio</option>
            <option value="telnyx">Telnyx</option>
          </select>
          <div style={{ fontSize: 11, color: '#7a786a', marginTop: 6 }}>
            Chat threads, appointment confirms, expense pings, day-entry alerts.
          </div>
        </div>
        <div style={cardStyle}>
          <label style={labelStyle}>Marketing / promotional</label>
          <select value={marketing} onChange={e => setMarketing(e.target.value as Provider)} style={inputStyle}>
            <option value="twilio">Twilio</option>
            <option value="telnyx">Telnyx</option>
          </select>
          <div style={{ fontSize: 11, color: '#7a786a', marginTop: 6 }}>
            Used when a sender explicitly tags <code>purpose: 'marketing'</code>.
            No callsites tag it yet — opt-in flag for future campaigns.
          </div>
        </div>
      </div>

      {/* Telnyx creds */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Telnyx credentials</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>API key {state.telnyx.apiKeySet && <span style={{ color: '#1D6B44' }}>· {state.telnyx.apiKeyMasked}</span>}</label>
            <input type="password" placeholder={state.telnyx.apiKeySet ? 'leave blank to keep' : 'KEY01...'} value={telnyxApiKey} onChange={e => setTelnyxApiKey(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Public key (inbound verify) {state.telnyx.publicKeySet && <span style={{ color: '#1D6B44' }}>· {state.telnyx.publicKeyMasked}</span>}</label>
            <input type="password" placeholder={state.telnyx.publicKeySet ? 'leave blank to keep' : 'base64 ed25519'} value={telnyxPublicKey} onChange={e => setTelnyxPublicKey(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>From number</label>
            <input placeholder="+15551234567" value={telnyxFrom} onChange={e => setTelnyxFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Messaging Profile ID (optional)</label>
            <input placeholder="40017..." value={telnyxProfile} onChange={e => setTelnyxProfile(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Twilio creds */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Twilio credentials</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Account SID {state.twilio.accountSidSet && <span style={{ color: '#1D6B44' }}>· {state.twilio.accountSidMasked}</span>}</label>
            <input placeholder={state.twilio.accountSidSet ? 'leave blank to keep' : 'AC...'} value={twilioSid} onChange={e => setTwilioSid(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Auth token {state.twilio.authTokenSet && <span style={{ color: '#1D6B44' }}>· {state.twilio.authTokenMasked}</span>}</label>
            <input type="password" placeholder={state.twilio.authTokenSet ? 'leave blank to keep' : ''} value={twilioToken} onChange={e => setTwilioToken(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>From number</label>
            <input placeholder="+15551234567" value={twilioFrom} onChange={e => setTwilioFrom(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={{
          padding: '8px 16px', background: '#1D6B44', color: '#fff',
          border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : 'Save changes'}</button>
        {savedAt && <span style={{ fontSize: 12, color: '#1D6B44' }}>Saved at {savedAt}</span>}
        {error && <span style={{ fontSize: 12, color: '#b00020' }}>{error}</span>}
      </div>

      {/* Test send */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Send a test message</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>To</label>
            <input placeholder="+15551234567" value={testTo} onChange={e => setTestTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Purpose</label>
            <select value={testPurpose} onChange={e => setTestPurpose(e.target.value as any)} style={inputStyle}>
              <option value="internal">internal</option>
              <option value="marketing">marketing</option>
            </select>
          </div>
          <button onClick={sendTest} disabled={testing || !testTo.trim()} style={{
            padding: '8px 16px', background: '#1D6B44', color: '#fff',
            border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
            opacity: testing || !testTo.trim() ? 0.6 : 1,
          }}>{testing ? 'Sending…' : 'Send test'}</button>
        </div>
        {testResult && <div style={{ fontSize: 12, marginTop: 8 }}>{testResult}</div>}
      </div>
    </div>
  )
}
