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
  const { user, users } = useApp()
  const [shows, setShows] = useState<(TrunkShow & { _store?: TrunkShowStore | null })[]>([])
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [trunkShowId, setTrunkShowId] = useState<string>(initialTrunkShowId || '')
  const [templateId,  setTemplateId]  = useState<string>(initialTemplateId  || '')
  const [subject, setSubject] = useState('')
  const [body,    setBody]    = useState('')
  // Comma-joined recipient lists. Editable so the rep can drop
  // a recipient last-minute or add an ad-hoc one.
  const [toEmail, setToEmail] = useState('')
  const [toName,  setToName]  = useState('')
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoFilled, setAutoFilled] = useState(false)
  const [sendingEnabled, setSendingEnabled] = useState<boolean | null>(null)

  // Search box that filters the trunk-show dropdown — matches store
  // name, city, state, and assigned-rep name (Q5: c).
  const [showSearch, setShowSearch] = useState('')

  // Schedule-send modal state.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduling, setScheduling] = useState(false)

  // Load the safety kill-switch state. Defaults to disabled
  // until an admin flips it in Settings.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('settings').select('value').eq('key', 'trunk_comms_send_enabled').maybeSingle()
      if (cancelled) return
      const raw = ((data as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
      setSendingEnabled(raw === 'true')
    })()
    return () => { cancelled = true }
  }, [])

  // Load pickers
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const todayIso = new Date().toISOString().slice(0, 10)
      const [showRes, tplRes] = await Promise.all([
        supabase
          .from('trunk_shows')
          .select('id, store_id, start_date, end_date, status, assigned_rep_id, store:trunk_show_stores(id, name, city, state, primary_contact_email, primary_contact_name, email_1, contact_1)')
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
        // Comma-joined for display + edit; the endpoint splits.
        setToEmail(ctx.recipients.map(r => r.email).join(', '))
        setToName(ctx.recipients.map(r => r.name || '').join(', '))
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

  // Filtered dropdown list — matches store name + city + state +
  // assigned rep's name. The currently-selected show always stays
  // visible so a search-narrow doesn't make the active row vanish.
  const filteredShows = (() => {
    const q = showSearch.trim().toLowerCase()
    if (!q) return shows
    return shows.filter(s => {
      if (s.id === trunkShowId) return true
      const store = (s as any)._store as TrunkShowStore | null
      const repName = s.assigned_rep_id
        ? (users || []).find(u => u.id === s.assigned_rep_id)?.name || ''
        : ''
      const hay = [store?.name, store?.city, store?.state, repName]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  })()
  const senderEmail = user?.email || ''
  const canSend =
    !!trunkShowId && !!templateId && !!subject.trim() && !!body.trim()
    && !!toEmail.trim() && !sending
    && sendingEnabled === true
  const senderOk = /@bebllp\.com$/i.test(senderEmail)

  async function previewPdf() {
    if (!subject.trim() || !body.trim()) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/communications/preview-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          subject,
          body,
          to_email: toEmail.trim(),
          to_name: toName.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Preview failed: ${j.error || res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      alert('Preview failed: ' + (e?.message || 'unknown'))
    }
  }

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
          // Comma-joined → endpoint splits into Resend's `to` array.
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setScheduleOpen(true)}
            disabled={!canSend || sending}
            className="btn-outline btn-sm"
            title="Schedule this letter to send at 9 AM (store-local) on a future date">
            📅 Schedule Send
          </button>
          <button onClick={send} disabled={!canSend} className="btn-primary btn-sm">
            {sending ? 'Sending…' : '📤 Send Email'}
          </button>
        </div>
      </div>

      {sendingEnabled === false && (
        <div style={{
          background: '#fdecea', color: '#7a1f0f',
          border: '2px solid #7a1f0f', borderRadius: 8,
          padding: 14, marginBottom: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔒 Trunk-show sends are disabled</div>
          <div style={{ fontSize: 13 }}>
            Real recipient emails are on file. Sends are blocked until an admin flips
            <strong> Settings → 📨 Trunk Comms → Sending enabled</strong>.
            You can still draft + preview the PDF, but the Send Email button is locked.
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#fdecea', color: '#7a1f0f', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label className="fl">Trunk show</label>
            {selectedShow ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, padding: '8px 10px', border: '1px solid var(--pearl)',
                borderRadius: 6, background: 'var(--cream)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(selectedShow as any)._store?.name || 'Trunk show'} · {selectedShow.start_date}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setTrunkShowId(''); setShowSearch('') }}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--mist)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  }}
                >change</button>
              </div>
            ) : (
              <>
                <input
                  value={showSearch}
                  onChange={e => setShowSearch(e.target.value)}
                  placeholder="Search by store, city, state, or rep…"
                  autoFocus
                />
                {filteredShows.length > 0 && (
                  <div style={{
                    marginTop: 4, maxHeight: 220, overflowY: 'auto',
                    border: '1px solid var(--pearl)', borderRadius: 6, background: '#fff',
                  }}>
                    {filteredShows.slice(0, 50).map(s => {
                      const store = (s as any)._store
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setTrunkShowId(s.id); setShowSearch('') }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '8px 10px', background: '#fff', border: 'none',
                            borderBottom: '1px solid var(--pearl)', cursor: 'pointer',
                            fontSize: 13, fontFamily: 'inherit',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                            {store?.name || 'Trunk show'}
                          </span>
                          <span style={{ color: 'var(--mist)' }}>
                            {' · '}{s.start_date}
                            {store?.city ? ` · ${store.city}${store.state ? `, ${store.state}` : ''}` : ''}
                          </span>
                        </button>
                      )
                    })}
                    {filteredShows.length > 50 && (
                      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>
                        Showing first 50 — refine your search to see more.
                      </div>
                    )}
                  </div>
                )}
                {showSearch && filteredShows.length === 0 && (
                  <div style={{ marginTop: 4, padding: '8px 10px', fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                    No trunk shows match.
                  </div>
                )}
              </>
            )}
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
                  placeholder="Names (comma-separated)" />
                <input value={toEmail} onChange={e => setToEmail(e.target.value)}
                  placeholder="email1@x.com, email2@x.com" type="text" />
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, gridColumn: '2 / 3' }}>
                {toEmail.includes(',') && '📨 Sending to multiple recipients · '}
                Auto-filled from contacts flagged "Send Documents"; comma-separate to add or trim.
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
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={previewPdf} disabled={!subject.trim() || !body.trim()} className="btn-outline btn-sm">
                  📄 Preview PDF
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {scheduleOpen && (
        <div onClick={() => !scheduling && setScheduleOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12, width: 'min(420px, 100%)',
            padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.30)',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', margin: '0 0 12px' }}>
              📅 Schedule Send
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ash)', margin: '0 0 14px' }}>
              The letter will fire at <strong>9:00 AM</strong> in the recipient store's local
              time zone on the chosen date. You can cancel or reschedule from the
              Communications log on the trunk show page.
            </p>
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="fl">Send date</label>
              <input
                type="date"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            {error && <div style={{ background: '#fdecea', color: '#7a1f0f', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setScheduleOpen(false)} disabled={scheduling} className="btn-outline btn-sm">Cancel</button>
              <button
                onClick={async () => {
                  if (!scheduleDate) { setError('Pick a date.'); return }
                  setScheduling(true); setError(null)
                  try {
                    const { data: { session } } = await supabase.auth.getSession()
                    const res = await fetch('/api/communications/schedule', {
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
                        scheduled_for_date: scheduleDate,
                      }),
                    })
                    const json = await res.json().catch(() => ({}))
                    if (!res.ok) { setError(json.error || `Schedule failed (${res.status})`); return }
                    setScheduleOpen(false)
                    setScheduleDate('')
                    alert(`✅ Scheduled for ${new Date(json.scheduled_for).toLocaleString()} (${json.timezone})`)
                    onClose()
                  } finally {
                    setScheduling(false)
                  }
                }}
                disabled={scheduling || !scheduleDate || !canSend}
                className="btn-primary btn-sm"
              >
                {scheduling ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper: client-side context fetch — resolves the real MergeContext for
//    a trunk-show + rep pair via the user's RLS-scoped supabase client, so
//    the preview reflects exactly what the send pipeline will produce. ──

async function fetchContext(trunkShowId: string, repUserId?: string | null): Promise<{
  ctx: MergeContext
  recipient: { email: string | null; name: string | null }
  recipients: { email: string; name: string | null }[]
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
      .select('name, address_1, city, state, zip, primary_contact_email, primary_contact_name, email_1, contact_1, contacts')
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

  // Resolve recipients from the new contacts array; fall back
  // to legacy primary_contact_* / email_1 when the array is
  // empty so old data still sends.
  const contactsArr = Array.isArray((store as any)?.contacts) ? ((store as any).contacts as any[]) : []
  const flagged = contactsArr.filter(c => c?.send_documents && typeof c?.email === 'string' && c.email.trim())
  let recipients: { email: string; name: string | null }[] = flagged.map(c => ({
    email: String(c.email).trim(),
    name: (typeof c?.name === 'string' && c.name.trim()) ? c.name.trim() : null,
  }))
  if (recipients.length === 0) {
    const fallbackEmail = store?.primary_contact_email || store?.email_1 || null
    const fallbackName  = store?.primary_contact_name  || store?.contact_1 || null
    if (fallbackEmail) recipients = [{ email: fallbackEmail, name: fallbackName }]
  }
  const recipientEmail = recipients[0]?.email ?? null
  const recipientName  = recipients[0]?.name ?? null

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
  return { ctx, recipient: { email: recipientEmail, name: recipientName }, recipients }
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
