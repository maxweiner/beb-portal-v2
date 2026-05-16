'use client'

// AI Template Generation Modal — opened from:
//   - "✨ New with AI" button in the Templates list header
//   - "✨ Refine with AI" button on each template row
//
// Flow:
//   1. User types a prompt describing what they want (or how to
//      change an existing template).
//   2. "✨ Generate" → POST /api/trunk-communications/templates/
//      generate → returns { name, subject_line, body }.
//   3. Fields render read-only in the modal.
//   4. User MUST click "📄 Open PDF preview" before Save unlocks.
//      Friction gate so nobody saves AI output without a deliberate
//      read pass. Server tracks created_by_ai + ai_prompt on save
//      for audit.
//   5. "Save template" persists; "Re-generate" loops back to step 1
//      with the prompt + last output preserved.
//
// Used by: components/communications/TrunkCommunications.tsx (admin
// gated). Email-only — the comm_templates schema doesn't carry SMS.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ExistingTemplate {
  id: string
  name: string
  subject_line: string
  body: string
}

interface Props {
  mode: 'new' | 'refine'
  existing?: ExistingTemplate | null  // required when mode='refine'
  onClose: () => void
  /** Called after a successful save. Parent reloads the template list. */
  onSaved: (savedId: string) => void
}

interface Generated {
  name: string
  subject_line: string
  body: string
}

async function getAuthToken(): Promise<string> {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token || ''
}

export default function AiTemplateModal({ mode, existing, onClose, onSaved }: Props) {
  const [prompt, setPrompt] = useState('')
  const [generated, setGenerated] = useState<Generated | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The PDF-review gate: Save stays disabled until this flips true.
  // Clicking "Open PDF preview" is what flips it. Re-generating
  // resets it so each new output requires a fresh read pass.
  const [pdfViewed, setPdfViewed] = useState(false)

  async function generate() {
    if (!prompt.trim()) { setError('Tell the AI what you want.'); return }
    setBusy(true); setError(null); setPdfViewed(false)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/trunk-communications/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: prompt.trim(),
          mode,
          existing: mode === 'refine' && existing
            ? { name: existing.name, subject_line: existing.subject_line, body: existing.body }
            : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (j?.error === 'rate_limited') setError('Anthropic rate-limited this minute — try again in 30 seconds.')
        else setError(j?.error || `Failed (${res.status})`)
        return
      }
      setGenerated({ name: j.name, subject_line: j.subject_line, body: j.body })
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function openPdf() {
    if (!generated) return
    setBusy(true); setError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/trunk-communications/templates/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: generated.name,
          subject_line: generated.subject_line,
          body: generated.body,
          prompt: prompt.trim(),
          mode,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || `PDF render failed (${res.status})`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      // Mark the gate as cleared — Save unlocks now.
      setPdfViewed(true)
    } catch (e: any) {
      setError(e?.message || 'PDF render failed')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!generated || !pdfViewed) return
    setBusy(true); setError(null)
    try {
      const payload = {
        name: generated.name,
        subject_line: generated.subject_line,
        body: generated.body,
        is_active: true,
        created_by_ai: true,
        ai_prompt: prompt.trim().slice(0, 2000),
      }
      let result: any
      if (mode === 'refine' && existing?.id) {
        const { data, error: e } = await supabase
          .from('communication_templates')
          .update(payload)
          .eq('id', existing.id)
          .select('id')
          .single()
        if (e) throw new Error(e.message)
        result = data
      } else {
        const { data, error: e } = await supabase
          .from('communication_templates')
          .insert(payload)
          .select('id')
          .single()
        if (e) throw new Error(e.message)
        result = data
      }
      onSaved(result.id)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, zIndex: 1100,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 700, width: '100%',
        maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--cream2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>
            ✨ {mode === 'refine' ? 'Refine template with AI' : 'New template with AI'}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 22, color: 'var(--mist)', cursor: 'pointer' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 22 }}>
          {mode === 'refine' && existing && (
            <div style={{
              background: 'var(--cream)', border: '1px solid var(--pearl)',
              borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--ash)', marginBottom: 4 }}>Refining: {existing.name}</div>
              <div style={{ color: 'var(--mist)' }}>Subject: {existing.subject_line}</div>
            </div>
          )}

          <label className="fl">
            {mode === 'refine'
              ? 'What should change? (tone, length, add/remove a section, etc.)'
              : 'Describe the email you want'}
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={mode === 'refine'
              ? 'e.g. "Make it shorter and add a P.S. about free parking at the back lot."'
              : 'e.g. "Pre-show reminder, warm friendly tone, mention free appraisals, ask the store contact to share parking info."'}
            rows={5}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14, padding: 10, border: '1px solid var(--pearl)', borderRadius: 8, marginBottom: 10 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--mist)' }}>
              Powered by Claude Haiku 4.5 · ~$0.002 per generation
            </span>
            <button
              type="button"
              onClick={generate}
              disabled={busy || !prompt.trim()}
              className="btn-primary btn-sm"
            >
              {busy && !generated ? '✨ Generating…' : (generated ? '🔄 Re-generate' : '✨ Generate')}
            </button>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13, fontWeight: 700 }}>
              ⚠ {error}
            </div>
          )}

          {generated && (
            <>
              <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 8, background: '#F5F0E8', border: '1px solid var(--pearl)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Generated</div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Name</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{generated.name}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Subject</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>{generated.subject_line}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Body</div>
                  <pre style={{
                    margin: '4px 0 0',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: 'var(--ink)',
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}>{generated.body}</pre>
                </div>
              </div>

              {/* PDF-review gate. Save is disabled until the user
                  has opened the PDF at least once. Re-generating
                  resets it. */}
              <div style={{
                marginTop: 14, padding: '14px 16px',
                background: pdfViewed ? '#D1FAE5' : '#FEF3C7',
                border: `1px solid ${pdfViewed ? '#10B981' : '#FCD34D'}`,
                borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{pdfViewed ? '✅' : '📄'}</span>
                <div style={{ flex: 1, fontSize: 13, color: pdfViewed ? '#065F46' : '#78350F' }}>
                  {pdfViewed
                    ? <span><strong>PDF reviewed.</strong> Save is unlocked.</span>
                    : <span><strong>Review required before save.</strong> Open the PDF preview to read the template the way a recipient sees it (with sample merge fields filled in).</span>}
                </div>
                <button
                  type="button"
                  onClick={openPdf}
                  disabled={busy}
                  className={pdfViewed ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}
                  style={{ flexShrink: 0 }}
                >
                  {busy ? 'Building PDF…' : pdfViewed ? '📄 Re-open PDF' : '📄 Open PDF preview'}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--cream2)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} className="btn-outline btn-sm" disabled={busy}>Cancel</button>
          <button
            onClick={save}
            disabled={busy || !generated || !pdfViewed}
            className="btn-primary btn-sm"
            title={!generated ? 'Generate a template first' : !pdfViewed ? 'Open the PDF preview to unlock save' : 'Save the template'}
          >
            {busy && pdfViewed ? 'Saving…' : `💾 Save template`}
          </button>
        </div>
      </div>
    </div>
  )
}
