'use client'

// Phase 5 send flow. Single scrolling page (not a stepped wizard
// per the spec — easier to scan + edit + send) with:
//
//   • Event picker (active trunk shows, scoped to caller's
//     access)
//   • Template picker (active templates)
//   • Editable subject + body with merge fields applied from
//     real DB context
//   • Read-only From / To readouts
//   • Send button
//
// PDF preview is phase 6 — its placeholder note is rendered
// where the button will live.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { applyMergeFields } from '@/lib/communications/mergeFields'
import type { CommunicationTemplate, TrunkShow, TrunkShowStore, User } from '@/types'
import type { MergeContext } from '@/lib/communications/mergeFields'

interface Props {
  /** Optional preselected pair from the entry-point caller. */
  initialTrunkShowId?: string | null
  initialTemplateId?: string | null
  onClose: () => void
  onSent: (sendId: string) => void
}

export default function SendFlow({
  initialTrunkShowId, initialTemplateId, onClose, onSent,
}: Props) {
  const { user } = useApp()
  const [shows, setShows] = useState<(TrunkShow & { _store?: TrunkShowStore | null })[]>([])
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [trunkShowId, setTrunkShowId] = useState<string>(initialTrunkShowId || '')
  const [templateId,  setTemplateId]  = useState<string>(initialTemplateId  || '')
  const [subject, setSubject] = useState('')
  const [body,    setBody]    = useState('')
  const [toEmail, setToEmail] = useState('')
  const [toName,  setToName]  = useState('')
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoFilled, setAutoFilled] = useState(false)

  // Load pickers
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const todayIso = new Date().toISOString().slice(0, 10)
      const [showRes, tplRes] = await Promise.all([
        supabase
          .from('trunk_shows')
          .select('id, store_id, start_date, end_date, status, assigned_rep_id, store:trunk_show_stores(id, name, primary_contact_email, primary_contact_name, email_1, contact_1)')
          .is('deleted_at', null)
          .neq('status', 'cancelled')
          .gte('end_date', todayIso)
          .order('start_date'),
        supabase
          .from('communication_templates')
          .select('*')
          .eq('is_active', true)
          .order('name'),
      ])
      if (cancelled) return
      const showRows = (showRes.data || []).map((r: any) => ({ ...r, _store: r.store }))
      setShows(showRows as any)
      setTemplates((tplRes.data || []) as CommunicationTemplate[])
    })()
    return () => { cancelled = true }
  }, [])

  // When show + template both selected, fetch real context and
  // pre-fill the editable fields. Also resolve recipient.
  useEffect(() => {
    if (!trunkShowId || !templateId) {
      setSubject(''); setBody(''); setToEmail(''); setToName(''); setAutoFilled(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoadingCtx(true); setError(null)
      try {
        const ctx = await fetchContext(trunkShowId, user?.id)
        if (cancelled) return
        const tpl = templates.find(t => t.id === templateId)
        if (!tpl) return
        setSubject(applyMergeFields(tpl.subject_line, ctx.ctx))
        setBody(applyMergeFields(tpl.body, ctx.ctx))
        setToEmail(ctx.recipient.email || '')
        setToName(ctx.recipient.name || '')
        setAutoFilled(true)
      } catch (e: any) {
        setError(e?.message || 'Could not load event context')
      } finally {
        if (!cancelled) setLoadingCtx(false)
      }
    })()
    return () => { cancelled = true }
  }, [trunkShowId, templateId, user?.id, templates])

  const selectedShow = shows.find(s => s.id === trunkShowId)
  const senderEmail = user?.email || ''
  const canSend = !!trunkShowId && !!templateId && !!subject.trim() && !!body.trim() && !!toEmail.trim() && !sending
  const senderOk = /@bebllp\.com$/i.test(senderEmail)

  async function send() {
    if (!canSend) return
    if (!senderOk) {
      setError(`Your account email (${senderEmail}) is not @bebllp.com — update it before sending.`)
      return
    }
    if (!confirm(`Send "${subject}" to ${toName ? `${toName} <${toEmail}>` : toEmail}?`)) return
    setSending(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/communications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          trunk_show_id: trunkShowId,
          template_id: templateId,
          subject,
          body,
          to_email: toEmail.trim(),
          to_name: toName.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Send failed (${res.status})`); return }
      onSent(json.send_id)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <button onClick={onClose} className="btn-outline btn-xs" style={{ marginBottom: 6 }}>← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>📤 Send a letter</h1>
        </div>
        <button onClick={send} disabled={!canSend} className="btn-primary btn-sm">
          {sending ? 'Sending…' : '📤 Send Email'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fdecea', color: '#7a1f0f', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="fl">Trunk show</label>
            <select value={trunkShowId} onChange={e => setTrunkShowId(e.target.value)}>
              <option value="">— Select trunk show —</option>
              {shows.map(s => (
                <option key={s.id} value={s.id}>
                  {(s as any)._store?.name || 'Trunk show'} · {s.start_date}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="fl">Template</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
              <option value="">— Select template —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {trunkShowId && templateId && (
        <>
          <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</span>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                {user?.name} <span style={{ color: 'var(--mist)' }}>{`<${senderEmail}>`}</span>
                {!senderOk && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#7a1f0f' }}>⚠ not @bebllp.com</span>
                )}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em', paddingTop: 8 }}>To</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input value={toName} onChange={e => setToName(e.target.value)}
                  placeholder="Recipient name" />
                <input value={toEmail} onChange={e => setToEmail(e.target.value)}
                  placeholder="recipient@example.com" type="email" />
              </div>
            </div>
          </div>

          {loadingCtx ? (
            <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading event details…</div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="fl">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
              <div className="field">
                <label className="fl">Body
                  {autoFilled && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--mist)' }}>
                      · merge fields applied; edit freely (e.g., add a P.S. line)
                    </span>
                  )}
                </label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={24}
                  style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
                />
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: 'var(--cream2)', fontSize: 11, color: 'var(--mist)' }}>
                📄 PDF preview button will appear here in phase 6. For now the email goes out as HTML only.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Helper: client-side context fetch (mirrors lib/communications/buildContext.ts
//    server-side resolver but reads via the user's RLS-scoped supabase client) ──

async function fetchContext(trunkShowId: string, repUserId?: string | null): Promise<{
  ctx: MergeContext
  recipient: { email: string | null; name: string | null }
}> {
  const { data: ts } = await supabase
    .from('trunk_shows')
    .select('id, store_id, start_date, end_date, assigned_rep_id')
    .eq('id', trunkShowId)
    .maybeSingle()
  if (!ts) throw new Error('Trunk show not found')

  const [{ data: store }, { data: hours }] = await Promise.all([
    supabase
      .from('trunk_show_stores')
      .select('name, address_1, city, state, zip, primary_contact_email, primary_contact_name, email_1, contact_1')
      .eq('id', ts.store_id)
      .maybeSingle(),
    supabase
      .from('trunk_show_hours')
      .select('show_date, open_time, close_time')
      .eq('trunk_show_id', ts.id)
      .order('show_date'),
  ])

  const effRepId = repUserId || ts.assigned_rep_id
  let rep: Pick<User, 'name' | 'email' | 'phone'> | null = null
  if (effRepId) {
    const { data } = await supabase
      .from('users').select('name, email, phone').eq('id', effRepId).maybeSingle()
    rep = data as any
  }

  const addr1 = store?.address_1 || ''
  const city  = store?.city || ''
  const state = store?.state || ''
  const zip   = store?.zip || ''
  const fullAddress = [addr1, [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n')
  const recipientEmail = store?.primary_contact_email || store?.email_1 || null
  const recipientName  = store?.primary_contact_name  || store?.contact_1 || null

  const ctx: MergeContext = {
    store_name:           store?.name || '',
    store_address_line_1: addr1,
    store_city:           city,
    store_state:          state,
    store_zip:            zip,
    store_full_address:   fullAddress,
    store_contact_name:   recipientName || '',
    store_contact_title:  '',
    event_start_date:     formatDateLong(ts.start_date),
    event_end_date:       formatDateLong(ts.end_date),
    event_dates_range:    formatRange(ts.start_date, ts.end_date),
    event_hours_per_day:  formatHours((hours as any) || []),
    rep_name:             rep?.name || '',
    rep_email:            rep?.email || '',
    rep_phone:            rep?.phone || '',
    today_date:           formatDateLong(new Date().toISOString().slice(0, 10)),
  }
  return { ctx, recipient: { email: recipientEmail, name: recipientName } }
}

function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatRange(s: string | null, e: string | null): string {
  if (!s) return ''
  if (!e || s === e) return formatDateLong(s)
  const sd = new Date(s + 'T12:00:00'), ed = new Date(e + 'T12:00:00')
  const sm = sd.toLocaleDateString('en-US', { month: 'long' })
  const em = ed.toLocaleDateString('en-US', { month: 'long' })
  if (sm === em) return `${sm} ${sd.getDate()}–${ed.getDate()}, ${sd.getFullYear()}`
  return `${sd.toLocaleDateString('en-US', { month: 'short' })} ${sd.getDate()} – ${ed.toLocaleDateString('en-US', { month: 'short' })} ${ed.getDate()}, ${sd.getFullYear()}`
}

function formatHours(rows: { show_date: string; open_time: string; close_time: string }[]): string {
  return rows.map(r => {
    const d = new Date(r.show_date + 'T12:00:00')
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    return `${day}: ${formatTime12h(r.open_time)} – ${formatTime12h(r.close_time)}`
  }).join('\n')
}

function formatTime12h(hms: string): string {
  const [hStr, mStr] = hms.split(':')
  let h = Number(hStr); const m = Number(mStr || '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}
