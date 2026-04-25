'use client'

// Editor for v2 brand-scoped templates (brand IS NOT NULL,
// trigger_type IS NOT NULL). Distinct from the legacy editor
// because the schema is wider — channels, delay, separate
// email/SMS bodies, quiet-hour flags — and the trigger registry
// drives which merge vars are valid.

import { useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { TRIGGER_REGISTRY, type TriggerType } from '@/lib/notifications/triggers'
import { buildMergeVars, substitute } from '@/lib/notifications/mergeVars'
import Checkbox from '@/components/ui/Checkbox'

export interface V2TemplateRow {
  id: string
  brand: 'beb' | 'liberty'
  trigger_type: TriggerType
  name: string | null
  enabled: boolean
  channels: string[] | null
  delay_minutes: number | null
  email_subject: string | null
  email_body_html: string | null
  email_body_text: string | null
  sms_body: string | null
  respect_quiet_hours_email: boolean
  respect_quiet_hours_sms: boolean
}

function shellHtml(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f0e8;font-family:system-ui,sans-serif;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      ${inner}
      <p style="font-size:12px;color:#6b7280;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
        Beneficial Estate Buyers
      </p>
    </div>
  </body></html>`
}

function fixtureVars(brand: 'beb' | 'liberty') {
  return buildMergeVars({
    buyer: { id: 'fixture-buyer', name: 'Sam Sample', email: 'sam@example.com', phone: '5551234567' },
    event: {
      id: 'fixture-event',
      name: 'Sample Estate Buying Event',
      start_date: new Date().toISOString().slice(0, 10),
      city: 'Sample City', address: '123 Main St',
      travel_share_url: 'https://beb-portal-v2.vercel.app/?event=fixture-event&nav=travel',
    },
    store: { id: 'fixture-store', name: 'Sample Store', timezone: 'America/New_York' },
    brand,
    otherBuyers: [{ id: 'b1', name: 'Jane Doe' }, { id: 'b2', name: 'Mike Roe' }],
    portalUrl: 'https://beb-portal-v2.vercel.app',
  })
}

export default function NotificationTemplateV2Editor({
  template,
  onBack,
  onSaved,
}: {
  template: V2TemplateRow
  onBack: () => void
  onSaved: (t: V2TemplateRow) => void
}) {
  const { user } = useApp()
  const def = TRIGGER_REGISTRY[template.trigger_type]

  const [name, setName] = useState(template.name ?? def?.name ?? '')
  const [enabled, setEnabled] = useState(!!template.enabled)
  const [channelsSet, setChannelsSet] = useState<Set<'email' | 'sms'>>(() => {
    const ch = (template.channels || []) as ('email' | 'sms')[]
    return new Set(ch.length ? ch : ['email', 'sms'])
  })
  const [delayMinutes, setDelayMinutes] = useState<number>(template.delay_minutes ?? def?.defaultDelayMinutes ?? 15)
  const [delayUnit, setDelayUnit] = useState<'minutes' | 'hours'>('minutes')
  const [emailSubject, setEmailSubject] = useState(template.email_subject ?? '')
  const [emailBodyHtml, setEmailBodyHtml] = useState(template.email_body_html ?? '')
  const [smsBody, setSmsBody] = useState(template.sms_body ?? '')
  const [respectQHEmail, setRespectQHEmail] = useState(!!template.respect_quiet_hours_email)
  const [respectQHSms, setRespectQHSms] = useState(template.respect_quiet_hours_sms !== false) // default true

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [testEmail, setTestEmail] = useState(user?.email ?? '')
  const [testPhone, setTestPhone] = useState(user?.phone ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const subjectRef = useRef<HTMLInputElement | null>(null)
  const emailBodyRef = useRef<HTMLTextAreaElement | null>(null)
  const smsBodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastFocusRef = useRef<'subject' | 'emailBody' | 'smsBody'>('emailBody')

  const vars = useMemo(() => fixtureVars(template.brand), [template.brand])
  const previewSubject = useMemo(() => substitute(emailSubject, vars), [emailSubject, vars])
  const previewEmail = useMemo(() => substitute(emailBodyHtml, vars), [emailBodyHtml, vars])
  const previewSms = useMemo(() => substitute(smsBody, vars), [smsBody, vars])
  const smsCharCount = previewSms.length
  const smsSegments = Math.ceil(smsCharCount / 160) || 1

  function insertVar(key: string) {
    const placeholder = `{{${key}}}`
    if (lastFocusRef.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current
      const start = el.selectionStart ?? emailSubject.length
      const end = el.selectionEnd ?? emailSubject.length
      const next = emailSubject.slice(0, start) + placeholder + emailSubject.slice(end)
      setEmailSubject(next)
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + placeholder.length, start + placeholder.length) })
    } else if (lastFocusRef.current === 'emailBody' && emailBodyRef.current) {
      const el = emailBodyRef.current
      const start = el.selectionStart ?? emailBodyHtml.length
      const end = el.selectionEnd ?? emailBodyHtml.length
      const next = emailBodyHtml.slice(0, start) + placeholder + emailBodyHtml.slice(end)
      setEmailBodyHtml(next)
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + placeholder.length, start + placeholder.length) })
    } else if (lastFocusRef.current === 'smsBody' && smsBodyRef.current) {
      const el = smsBodyRef.current
      const start = el.selectionStart ?? smsBody.length
      const end = el.selectionEnd ?? smsBody.length
      const next = smsBody.slice(0, start) + placeholder + smsBody.slice(end)
      setSmsBody(next)
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + placeholder.length, start + placeholder.length) })
    }
  }

  function toggleChannel(c: 'email' | 'sms') {
    setChannelsSet(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      // Don't allow zero channels — re-add the one that was just removed.
      if (next.size === 0) next.add(c)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setSavedAt(null)
    const minutes = delayUnit === 'hours' ? delayMinutes * 60 : delayMinutes
    const { data, error } = await supabase.from('notification_templates')
      .update({
        name,
        enabled,
        channels: Array.from(channelsSet),
        delay_minutes: minutes,
        email_subject: emailSubject || null,
        email_body_html: emailBodyHtml || null,
        email_body_text: emailBodyHtml || null, // keep text in sync for now; add separate field later if asked
        sms_body: smsBody || null,
        respect_quiet_hours_email: respectQHEmail,
        respect_quiet_hours_sms: respectQHSms,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id)
      .select('*')
      .maybeSingle()
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSavedAt(new Date())
    if (data) onSaved(data as V2TemplateRow)
  }

  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/notifications/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: template.id,
          recipient_email: channelsSet.has('email') ? testEmail : undefined,
          recipient_phone: channelsSet.has('sms') ? testPhone : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTestResult(`Error: ${json.error || res.status}`)
      } else {
        const lines = (json.results || []).map((r: any) =>
          `${r.channel}: ${r.ok ? '✓ sent' : `✗ ${r.error || r.skipped}`}`
        )
        setTestResult(lines.join(' · ') || 'No channels were sent.')
      }
    } catch (e: any) {
      setTestResult('Network error: ' + (e?.message || 'unknown'))
    }
    setTesting(false)
  }

  return (
    <div className="p-6" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'var(--green-dark)',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        padding: '4px 0', marginBottom: 10,
      }}>← Back to Templates</button>

      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>{name || def?.name}</h1>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ background: template.brand === 'liberty' ? '#DBEAFE' : '#DCFCE7', color: template.brand === 'liberty' ? '#1E40AF' : '#166534', padding: '2px 8px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {template.brand}
            </span>
            <code style={{ background: 'var(--cream2)', padding: '2px 6px', borderRadius: 4 }}>{template.trigger_type}</code>
            <span style={{ color: 'var(--mist)' }}>{def?.description}</span>
          </div>
        </div>
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label={
            <span style={{ fontWeight: 700, color: enabled ? 'var(--green-dark)' : 'var(--mist)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          }
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: 14 }}>
        {/* LEFT — editor */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Template</div>
            {savedAt && (
              <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                ✓ Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>

          <div className="field">
            <label className="fl">Name (admin-only label)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={def?.name} />
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">Channels</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {(['email', 'sms'] as const).map(c => (
                  <Checkbox
                    key={c}
                    checked={channelsSet.has(c)}
                    onChange={() => toggleChannel(c)}
                    label={
                      <span style={{
                        fontWeight: 700, fontSize: 12,
                        textTransform: 'uppercase', letterSpacing: '.04em',
                        color: channelsSet.has(c) ? 'var(--green-dark)' : 'var(--mist)',
                      }}>{c}</span>
                    }
                  />
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">Delay before sending</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number" min={0} max={delayUnit === 'hours' ? 168 : 10080}
                  value={delayMinutes}
                  onChange={e => setDelayMinutes(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 80 }}
                />
                <select value={delayUnit} onChange={e => setDelayUnit(e.target.value as 'minutes' | 'hours')}>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </div>
          </div>

          {channelsSet.has('email') && (
            <>
              <div className="field">
                <label className="fl">Email subject</label>
                <input
                  ref={subjectRef}
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  onFocus={() => { lastFocusRef.current = 'subject' }}
                />
              </div>
              <div className="field">
                <label className="fl">Email body (HTML)</label>
                <textarea
                  ref={emailBodyRef}
                  rows={12}
                  value={emailBodyHtml}
                  onChange={e => setEmailBodyHtml(e.target.value)}
                  onFocus={() => { lastFocusRef.current = 'emailBody' }}
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }}
                />
              </div>
              <Checkbox
                checked={respectQHEmail}
                onChange={setRespectQHEmail}
                label={<span style={{ fontSize: 12, color: 'var(--mist)' }}>Respect quiet hours for email</span>}
                labelStyle={{ marginBottom: 12 }}
              />
            </>
          )}

          {channelsSet.has('sms') && (
            <>
              <div className="field">
                <label className="fl">SMS body</label>
                <textarea
                  ref={smsBodyRef}
                  rows={4}
                  value={smsBody}
                  onChange={e => setSmsBody(e.target.value)}
                  onFocus={() => { lastFocusRef.current = 'smsBody' }}
                  style={{ resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                  Preview: {smsCharCount} chars · {smsSegments} segment{smsSegments === 1 ? '' : 's'}
                </div>
              </div>
              <Checkbox
                checked={respectQHSms}
                onChange={setRespectQHSms}
                label={<span style={{ fontSize: 12, color: 'var(--mist)' }}>Respect quiet hours for SMS (default on)</span>}
                labelStyle={{ marginBottom: 12 }}
              />
            </>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>

          {/* Test send */}
          <div style={{ marginTop: 18, padding: 14, background: 'var(--cream)', borderRadius: 8, border: '1px solid var(--pearl)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Send a test</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {channelsSet.has('email') && (
                <input placeholder="test email"
                  value={testEmail} onChange={e => setTestEmail(e.target.value)} />
              )}
              {channelsSet.has('sms') && (
                <input placeholder="test phone (10 digits)"
                  value={testPhone} onChange={e => setTestPhone(e.target.value)} />
              )}
            </div>
            <button onClick={sendTest} disabled={testing} className="btn-outline btn-sm" style={{ marginTop: 8 }}>
              {testing ? 'Sending…' : 'Send test (subject prefixed [TEST])'}
            </button>
            {testResult && (
              <div style={{ fontSize: 12, color: testResult.startsWith('Error') ? '#B91C1C' : 'var(--green-dark)', marginTop: 8 }}>
                {testResult}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — preview + variable sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--cream2)', fontSize: 13, fontWeight: 800, color: 'var(--ink)', borderBottom: '1px solid var(--pearl)' }}>
              Live preview
            </div>
            {channelsSet.has('email') && (
              <>
                <div style={{ padding: '8px 14px', background: 'white', fontSize: 12, color: 'var(--mist)', borderBottom: '1px solid var(--pearl)' }}>
                  <strong>Subject:</strong> {previewSubject || <em>(empty)</em>}
                </div>
                <iframe
                  title="email preview"
                  srcDoc={shellHtml(previewEmail)}
                  style={{ width: '100%', height: 320, border: 'none', display: 'block', background: '#f5f0e8' }}
                />
              </>
            )}
            {channelsSet.has('sms') && (
              <div style={{ padding: 16 }}>
                <div style={{ background: '#E5E5EA', borderRadius: 18, padding: '10px 14px', display: 'inline-block', maxWidth: '85%', fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                  {previewSms || <em>(empty)</em>}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Insert variable</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(def?.variables || []).map(v => (
                <button key={v.key}
                  onClick={() => insertVar(v.key)}
                  style={{
                    background: 'white', border: '1px solid var(--pearl)',
                    borderRadius: 6, padding: '6px 8px', textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <code style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-dark)' }}>{`{{${v.key}}}`}</code>
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{v.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
