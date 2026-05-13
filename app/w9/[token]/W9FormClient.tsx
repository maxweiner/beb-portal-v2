'use client'

// Client-side W-9 form. Renders all the fields the IRS PDF expects
// + a signature panel that lets the recipient pick between drawn
// (canvas) or typed signatures. Submit posts to /api/w9/[token]/submit
// which generates the filled PDF, stores it, and emails the
// accountant.
//
// We don't store the TIN in any client state longer than necessary:
// it's a controlled input, but the value never lives in localStorage
// or telemetry, and a successful submit immediately navigates away.

import { useRef, useState } from 'react'

interface Requester {
  name: string
  address: string
  city: string
  state: string
  zip: string
  phone: string | null
}
interface Prefill {
  name: string
  address: string
  city: string
  state: string
  zip: string
}
interface Props {
  token: string
  origin: string
  requesterName: string
  requester: Requester | null
  prefill: Prefill
  recipientEmail: string
}

type TaxClass = 'individual' | 'c_corp' | 's_corp' | 'partnership' | 'trust_estate' | 'llc' | 'other'

const TAX_OPTIONS: { value: TaxClass; label: string }[] = [
  { value: 'individual',   label: 'Individual / sole proprietor / single-member LLC' },
  { value: 'c_corp',       label: 'C corporation' },
  { value: 's_corp',       label: 'S corporation' },
  { value: 'partnership',  label: 'Partnership' },
  { value: 'trust_estate', label: 'Trust / estate' },
  { value: 'llc',          label: 'Limited liability company (LLC)' },
  { value: 'other',        label: 'Other' },
]


export default function W9FormClient({
  token, origin, requesterName, requester, prefill, recipientEmail,
}: Props) {
  const [name, setName] = useState(prefill.name || '')
  const [businessName, setBusinessName] = useState('')
  const [taxClass, setTaxClass] = useState<TaxClass>('individual')
  const [llcCode, setLlcCode] = useState<'C' | 'S' | 'P' | ''>('')
  const [otherClass, setOtherClass] = useState('')
  const [exemptPayee, setExemptPayee] = useState('')
  const [exemptFatca, setExemptFatca] = useState('')
  const [address, setAddress] = useState(prefill.address || '')
  const [city, setCity] = useState(prefill.city || '')
  const [stateUS, setStateUS] = useState(prefill.state || '')
  const [zip, setZip] = useState(prefill.zip || '')
  const [tinType, setTinType] = useState<'ssn' | 'ein'>('ssn')
  const [tin, setTin] = useState('')
  const [sigMode, setSigMode] = useState<'drawn' | 'typed'>('drawn')
  const [sigTyped, setSigTyped] = useState('')
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function tinDigits(): string { return tin.replace(/\D/g, '') }

  function formatTin(raw: string): string {
    const d = raw.replace(/\D/g, '').slice(0, 9)
    if (tinType === 'ssn') {
      if (d.length <= 3) return d
      if (d.length <= 5) return `${d.slice(0,3)}-${d.slice(3)}`
      return `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`
    }
    // EIN: xx-xxxxxxx
    if (d.length <= 2) return d
    return `${d.slice(0,2)}-${d.slice(2)}`
  }

  async function submit() {
    setError(null)

    // Quick validation up-front so we don't bounce the server.
    if (!name.trim()) return setError('Please enter your name (Line 1).')
    if (!address.trim()) return setError('Please enter your address.')
    if (!city.trim() || !stateUS.trim() || !zip.trim()) {
      return setError('Please enter your city, state, and ZIP.')
    }
    const d = tinDigits()
    if (d.length !== 9) return setError(`${tinType === 'ssn' ? 'SSN' : 'EIN'} must be 9 digits.`)
    if (sigMode === 'drawn' && !sigDataUrl) return setError('Please draw your signature.')
    if (sigMode === 'typed' && !sigTyped.trim()) return setError('Please type your name as your signature.')
    if (taxClass === 'llc' && !llcCode) return setError('Pick the LLC tax classification (C / S / P).')
    if (taxClass === 'other' && !otherClass.trim()) return setError('Describe the "Other" classification.')

    setBusy(true)
    try {
      const res = await fetch(`${origin}/api/w9/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: {
            name: name.trim(),
            business_name: businessName.trim() || null,
            tax_classification: taxClass,
            llc_classification: taxClass === 'llc' ? llcCode : null,
            other_classification: taxClass === 'other' ? otherClass.trim() : null,
            exempt_payee_code: exemptPayee.trim() || null,
            exempt_fatca_code: exemptFatca.trim() || null,
            address: address.trim(),
            city: city.trim(),
            state: stateUS.trim().toUpperCase(),
            zip: zip.trim(),
            tin_type: tinType,
            signed_name: sigMode === 'typed' ? sigTyped.trim() : name.trim(),
            signed_at: new Date().toISOString(),
          },
          tin: d,
          ...(sigMode === 'drawn' ? { signatureDrawnDataUrl: sigDataUrl } : {}),
          ...(sigMode === 'typed' ? { signatureTypedName: sigTyped.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Submission failed (${res.status})`)
        setBusy(false)
        return
      }
      setDone(true)
    } catch (e: any) {
      setError(e?.message || 'Network error')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Frame>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>✓ Submitted</h1>
        <p style={{ color: '#374151', margin: '0 0 18px' }}>
          Your W-9 has been signed and sent to {requesterName}. A copy has been saved with your record.
        </p>
        <a href="/" style={{
          display: 'inline-block', background: '#1D6B44', color: '#fff',
          padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 700, textDecoration: 'none',
        }}>
          Continue to portal →
        </a>
        <p style={{ marginTop: 14, fontSize: 11, color: '#9CA3AF' }}>
          (If you don&apos;t have a portal account, you can just close this tab.)
        </p>
      </Frame>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#FAF8F4', padding: '24px 16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', color: '#1f2937',
    }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ background: '#1e3a8a', color: '#fff', padding: '20px 24px', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85, letterSpacing: '.06em', textTransform: 'uppercase' }}>IRS Form W-9</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: '4px 0 6px' }}>Request for Taxpayer ID + Certification</h1>
          <div style={{ fontSize: 13, opacity: 0.92 }}>
            Requested by <strong>{requesterName}</strong>{requester ? ` · ${requester.name}` : ''}
          </div>
        </div>

        <div style={{ background: '#fff', padding: '20px 24px', borderRadius: '0 0 12px 12px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          {/* Note */}
          <div style={{ marginBottom: 18, padding: 12, background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 8, fontSize: 12, color: '#713F12' }}>
            🔒 This form collects your taxpayer ID. The information you submit is delivered only to {requesterName} via secure email + saved in your portal record. Your TIN is stored only inside the signed PDF, not in plain database fields.
          </div>

          {/* Line 1-2 */}
          <Field label="Name (as shown on your tax return) *">
            <input value={name} onChange={e => setName(e.target.value)} style={ipt} />
          </Field>
          <Field label="Business name / disregarded entity name (if different)">
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} style={ipt} />
          </Field>

          {/* Line 3 */}
          <Field label="Tax classification *">
            <select value={taxClass} onChange={e => setTaxClass(e.target.value as TaxClass)} style={ipt}>
              {TAX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {taxClass === 'llc' && (
            <Field label="LLC tax classification (C = C corp, S = S corp, P = Partnership) *">
              <div style={{ display: 'flex', gap: 12 }}>
                {(['C', 'S', 'P'] as const).map(c => (
                  <label key={c} style={radioLabel}>
                    <input type="radio" name="llc" checked={llcCode === c} onChange={() => setLlcCode(c)} />
                    {c}
                  </label>
                ))}
              </div>
            </Field>
          )}
          {taxClass === 'other' && (
            <Field label="Describe the classification *">
              <input value={otherClass} onChange={e => setOtherClass(e.target.value)} style={ipt} />
            </Field>
          )}

          {/* Line 4 — exemptions (rare, collapsible feel) */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, color: '#374151' }}>
              Optional: Line 4 exemption codes (most filers skip this)
            </summary>
            <div style={{ paddingTop: 8 }}>
              <Field label="Exempt payee code (Line 4a)">
                <input value={exemptPayee} onChange={e => setExemptPayee(e.target.value)} style={ipt} />
              </Field>
              <Field label="Exemption from FATCA reporting code (Line 4b)">
                <input value={exemptFatca} onChange={e => setExemptFatca(e.target.value)} style={ipt} />
              </Field>
            </div>
          </details>

          {/* Lines 5-6 */}
          <Field label="Address (number, street, apt/suite) *">
            <input value={address} onChange={e => setAddress(e.target.value)} style={ipt} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Field label="City *">
              <input value={city} onChange={e => setCity(e.target.value)} style={ipt} />
            </Field>
            <Field label="State *">
              <input value={stateUS} onChange={e => setStateUS(e.target.value.slice(0, 2).toUpperCase())} maxLength={2} style={ipt} />
            </Field>
            <Field label="ZIP *">
              <input value={zip} onChange={e => setZip(e.target.value)} style={ipt} />
            </Field>
          </div>

          {/* Part I — TIN */}
          <h2 style={{ fontSize: 14, fontWeight: 800, margin: '20px 0 8px', color: '#0f172a' }}>Part I — Taxpayer Identification Number (TIN)</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <label style={radioLabel}>
              <input type="radio" name="tinType" checked={tinType === 'ssn'} onChange={() => { setTinType('ssn'); setTin('') }} />
              SSN
            </label>
            <label style={radioLabel}>
              <input type="radio" name="tinType" checked={tinType === 'ein'} onChange={() => { setTinType('ein'); setTin('') }} />
              EIN
            </label>
          </div>
          <Field label={tinType === 'ssn' ? 'Social Security Number *' : 'Employer Identification Number *'}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={formatTin(tin)}
              onChange={e => setTin(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder={tinType === 'ssn' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
              style={{ ...ipt, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.05em' }}
            />
          </Field>

          {/* Part II — Signature */}
          <h2 style={{ fontSize: 14, fontWeight: 800, margin: '20px 0 4px', color: '#0f172a' }}>Part II — Certification</h2>
          <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>
            Under penalties of perjury, I certify that (1) the TIN shown is correct; (2) I am not subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) the FATCA codes (if any) are correct.
          </p>

          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            <label style={radioLabel}>
              <input type="radio" name="sigMode" checked={sigMode === 'drawn'} onChange={() => setSigMode('drawn')} />
              Draw signature
            </label>
            <label style={radioLabel}>
              <input type="radio" name="sigMode" checked={sigMode === 'typed'} onChange={() => setSigMode('typed')} />
              Type name
            </label>
          </div>

          {sigMode === 'drawn' && (
            <SignaturePad onChange={setSigDataUrl} />
          )}
          {sigMode === 'typed' && (
            <Field label="Type your name (will appear as a typed signature)">
              <input
                value={sigTyped}
                onChange={e => setSigTyped(e.target.value)}
                placeholder="e.g. Jane A. Smith"
                style={{ ...ipt, fontStyle: 'italic', fontSize: 18, fontFamily: '"Brush Script MT", "Lucida Handwriting", cursive' }}
              />
            </Field>
          )}

          {error && (
            <div style={{ marginTop: 12, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={submit} disabled={busy}
              style={{
                background: '#1D6B44', color: '#fff', border: 'none',
                padding: '12px 26px', borderRadius: 8, fontSize: 14, fontWeight: 800,
                cursor: busy ? 'wait' : 'pointer',
              }}>
              {busy ? 'Submitting…' : 'Sign + Submit W-9'}
            </button>
          </div>

          <p style={{ marginTop: 18, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            Sending to {recipientEmail}. Form data is encrypted in transit and at rest.
          </p>
        </div>
      </div>
    </div>
  )
}


// ── Signature canvas ────────────────────────────────────────────

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    drawingRef.current = true
    lastRef.current = pos(e)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    const p = pos(e)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
    ctx.beginPath()
    ctx.moveTo(lastRef.current!.x, lastRef.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
  }
  function up() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    const c = canvasRef.current!
    onChange(c.toDataURL('image/png'))
  }
  function clear() {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    onChange(null)
  }

  return (
    <div>
      <div style={{
        background: '#FAFAFA', border: '1px dashed #d1d5db', borderRadius: 8,
        position: 'relative', height: 140, touchAction: 'none',
      }}>
        <canvas
          ref={canvasRef}
          width={680}
          height={140}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair', borderRadius: 8 }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        <div style={{ position: 'absolute', bottom: 6, left: 10, fontSize: 10, color: '#9CA3AF', pointerEvents: 'none' }}>
          Sign above
        </div>
      </div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={clear} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#6b7280', fontSize: 12, fontWeight: 700,
        }}>Clear ↺</button>
      </div>
    </div>
  )
}


// ── tiny layout helpers ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 800, color: '#374151',
        textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <div style={{ maxWidth: 540, margin: '64px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        {children}
      </div>
    </div>
  )
}

const ipt: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '8px 10px',
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
  fontFamily: 'inherit',
}
const radioLabel: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer',
}
