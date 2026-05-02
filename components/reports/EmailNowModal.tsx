'use client'

// Email this report to one or more recipients with a CSV attachment.
// Server re-runs the report under the user's auth (RLS-respecting) and
// sends via Resend. Excel + PDF + Print exports remain deferred.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

const MAX_RECIPIENTS = 25
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type AttachFormat = 'csv' | 'xlsx'

export default function EmailNowModal({
  open, onClose, reportId, reportName, rowCount,
}: {
  open: boolean
  onClose: () => void
  reportId: string
  reportName: string
  rowCount: number
}) {
  const { users, user, brand } = useApp()
  const [picked, setPicked] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [formats, setFormats] = useState<AttachFormat[]>(['csv'])

  // Reset state when the modal opens.
  useEffect(() => {
    if (!open) return
    setPicked([])
    setFreeText('')
    setSubject(`Report: ${reportName}`)
    setMessage(defaultMessage(user?.name, reportName, rowCount))
    setStatus(null)
    setBusy(false)
    setFormats(['csv'])
  }, [open, reportName, rowCount, user?.name])

  // Combobox suggestions: app users with an email, minus already-picked.
  const userOptions = useMemo(() => {
    const lower = picked.map(s => s.toLowerCase())
    return (users || [])
      .filter(u => !!u.email && !lower.includes(u.email.toLowerCase()))
      .map(u => ({ id: u.id, name: u.name || u.email, email: u.email }))
  }, [users, picked])

  if (!open) return null

  // Free-text recipients: comma/newline-separated emails. Validated on add.
  function commitFreeText() {
    const candidates = freeText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    if (candidates.length === 0) return
    const valid: string[] = []
    const invalid: string[] = []
    for (const c of candidates) {
      if (EMAIL_RE.test(c)) {
        if (!picked.some(e => e.toLowerCase() === c.toLowerCase())) valid.push(c)
      } else {
        invalid.push(c)
      }
    }
    if (valid.length > 0) setPicked(p => [...p, ...valid])
    setFreeText(invalid.join(', '))
  }

  async function send() {
    setBusy(true); setStatus(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error('Not signed in')
      if (picked.length === 0) throw new Error('Add at least one recipient')
      if (picked.length > MAX_RECIPIENTS) throw new Error(`Too many recipients (max ${MAX_RECIPIENTS})`)
      if (formats.length === 0) throw new Error('Pick at least one attachment format')
      const res = await fetch(`/api/reports/${reportId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipients: picked, subject, message, brand, formats,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      const sent = json.sent ?? picked.length
      const errs = json.errors as string[] | undefined
      if (errs && errs.length > 0) {
        setStatus({ kind: 'err', text: `Sent ${sent}/${picked.length}. Errors: ${errs.join('; ')}` })
      } else {
        setStatus({ kind: 'ok', text: `Sent to ${sent} recipient${sent === 1 ? '' : 's'}.` })
        // Auto-close after a short delay so the success badge is visible.
        setTimeout(() => onClose(), 1200)
      }
    } catch (e: any) {
      setStatus({ kind: 'err', text: e?.message || 'Network error' })
    }
    setBusy(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, maxWidth: 560, width: '100%',
        padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,.25)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>
          Email this report
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 16 }}>
          Sends a fresh CSV attachment, re-run server-side under your access. Up to {MAX_RECIPIENTS} recipients.
        </div>

        {/* Recipients */}
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="fl">Recipients</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {picked.length === 0 && <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>No recipients yet.</div>}
            {picked.map(e => (
              <span key={e} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'var(--green-pale)', color: 'var(--green-dark)',
                padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              }}>
                {e}
                <button onClick={() => setPicked(p => p.filter(x => x !== e))}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', fontSize: 14, lineHeight: 1 }}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text" value={freeText}
            onChange={e => setFreeText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitFreeText()
              }
            }}
            onBlur={commitFreeText}
            placeholder="Type an email and press Enter, or paste a comma-separated list"
            style={{ width: '100%', fontSize: 13 }}
          />
          {userOptions.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 4 }}>
                Quick add:
              </span>
              {userOptions.slice(0, 12).map(u => (
                <button key={u.id} type="button"
                  onClick={() => setPicked(p => [...p, u.email])}
                  style={{
                    background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
                    padding: '3px 8px', fontSize: 12, color: 'var(--ash)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  + {u.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subject */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="fl">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', fontSize: 13 }} />
        </div>

        {/* Message */}
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="fl">Message</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            rows={5}
            style={{ width: '100%', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {/* Format — CSV + Excel. PDF still deferred. */}
        <div className="field" style={{ marginBottom: 18 }}>
          <label className="fl">Attach</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 13, color: 'var(--ink)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <Checkbox
                checked={formats.includes('csv')}
                onChange={() => setFormats(p => p.includes('csv') ? p.filter(f => f !== 'csv') : [...p, 'csv'])}
                size={18}
              />
              CSV
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <Checkbox
                checked={formats.includes('xlsx')}
                onChange={() => setFormats(p => p.includes('xlsx') ? p.filter(f => f !== 'xlsx') : [...p, 'xlsx'])}
                size={18}
              />
              Excel (.xlsx)
            </label>
            <span style={{ color: 'var(--mist)', fontSize: 12 }}>PDF coming next</span>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
            background: status.kind === 'ok' ? '#ECFDF5' : '#FEF2F2',
            color: status.kind === 'ok' ? '#065F46' : '#7F1D1D',
            border: `1px solid ${status.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
          }}>
            {status.text}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline btn-sm">Cancel</button>
          <button onClick={send} disabled={busy || picked.length === 0 || formats.length === 0} className="btn-primary btn-sm">
            {busy ? 'Sending…' : `Send${picked.length > 0 ? ` (${picked.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function defaultMessage(senderName: string | undefined, reportName: string, rowCount: number): string {
  const who = senderName || 'A teammate'
  return `${who} sent you this report from the BEB portal.\n\nReport: ${reportName}\nRows: ${rowCount.toLocaleString()}\nThe full results are attached as a CSV.`
}
