'use client'

// AI Template Generation Modal — Reports edition.
//
// Parallel to components/communications/AiTemplateModal.tsx but
// shaped for the 5-field report_templates schema (subject + greeting
// + header_subtitle + footer + shoutout_fallback) and pinned to the
// CURRENT report row (one row per report_id — no "new" creation
// since the report inventory is hard-coded in code, you only refine
// the existing row).
//
// Flow:
//   1. User types a prompt describing what they want.
//   2. ✨ Generate → POST /api/report-templates/generate → returns
//      the 5 fields.
//   3. Fields render read-only in the modal.
//   4. User MUST click "📄 Open PDF preview" before Save unlocks.
//      Same friction-gate pattern as comms templates.
//   5. "Save template" upserts into report_templates with
//      created_by_ai=true + ai_prompt=<the prompt>.
//   6. "Re-generate" loops back to step 1 with prompt preserved;
//      pdfViewed resets so they have to re-open.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ExistingTemplate {
  subject: string
  greeting: string
  header_subtitle: string
  footer: string
  shoutout_fallback: string
}

interface Props {
  reportId: string
  reportTitle: string
  reportDescription: string
  varHint: string
  sampleVars: Record<string, string>
  /** Existing template values to pre-fill + show in "refine" mode.
   *  Pass null/undefined to start fresh (the modal still does an
   *  upsert on save so this is safe either way). */
  existing?: ExistingTemplate | null
  onClose: () => void
  onSaved: () => void
  currentUserId?: string | null
}

interface Generated {
  subject: string
  greeting: string
  header_subtitle: string
  footer: string
  shoutout_fallback: string
}

async function getAuthToken(): Promise<string> {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token || ''
}

export default function AiReportTemplateModal({
  reportId, reportTitle, reportDescription, varHint, sampleVars,
  existing, onClose, onSaved, currentUserId,
}: Props) {
  // We treat "has any non-empty existing field" as the refine signal.
  // The report row always exists conceptually (one per reportId), so
  // a brand-new install just sees default empty strings — we still
  // call it 'new' in that case to nudge the AI to write fresh.
  const hasExisting = !!existing && Object.values(existing).some(v => (v || '').trim().length > 0)
  const mode: 'new' | 'refine' = hasExisting ? 'refine' : 'new'

  const [prompt, setPrompt] = useState('')
  const [generated, setGenerated] = useState<Generated | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfViewed, setPdfViewed] = useState(false)

  async function generate() {
    if (!prompt.trim()) { setError('Tell the AI what you want.'); return }
    setBusy(true); setError(null); setPdfViewed(false)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/report-templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reportId,
          reportTitle,
          reportDescription,
          varHint,
          prompt: prompt.trim(),
          mode,
          existing: mode === 'refine' && existing ? existing : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (j?.error === 'rate_limited') setError('Anthropic rate-limited this minute — try again in 30 seconds.')
        else setError(j?.error || `Failed (${res.status})`)
        return
      }
      setGenerated({
        subject: j.subject ?? '',
        greeting: j.greeting ?? '',
        header_subtitle: j.header_subtitle ?? '',
        footer: j.footer ?? '',
        shoutout_fallback: j.shoutout_fallback ?? '',
      })
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
      const res = await fetch('/api/report-templates/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reportId, reportTitle, reportDescription, varHint,
          ...generated,
          sampleVars,
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
      // Upsert keyed on id. created_by_ai stays TRUE forever once
      // set; ai_prompt is overwritten with each save so it always
      // reflects the most recent AI-driven write.
      const { error: e } = await supabase.from('report_templates').upsert({
        id: reportId,
        subject:           generated.subject,
        greeting:          generated.greeting,
        header_subtitle:   generated.header_subtitle,
        footer:            generated.footer,
        shoutout_fallback: generated.shoutout_fallback,
        updated_at:        new Date().toISOString(),
        updated_by:        currentUserId ?? null,
        created_by_ai:     true,
        ai_prompt:         prompt.trim().slice(0, 2000),
      }, { onConflict: 'id' })
      if (e) throw new Error(e.message)
      onSaved()
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
        background: '#fff', borderRadius: 14, maxWidth: 760, width: '100%',
        maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--cream2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>
            ✨ {mode === 'refine' ? 'Refine report template with AI' : 'Generate report template with AI'}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 22, color: 'var(--mist)', cursor: 'pointer' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 22 }}>
          <div style={{
            background: 'var(--cream)', border: '1px solid var(--pearl)',
            borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--ash)', marginBottom: 4 }}>
              {mode === 'refine' ? 'Refining' : 'Writing for'}: {reportTitle}
            </div>
            <div style={{ color: 'var(--mist)' }}>{reportDescription}</div>
            <div style={{ color: 'var(--mist)', marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}>
              Variables: {varHint}
            </div>
          </div>

          <label className="fl">
            {mode === 'refine'
              ? 'What should change? (tone, shorten, add an emoji, swap the shoutout, etc.)'
              : 'Describe the email you want'}
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={mode === 'refine'
              ? 'e.g. "Make the greeting more energetic, add a coffee emoji, keep the shoutout under 2 sentences."'
              : 'e.g. "Warm morning recap, mention the weather, energizing tone, keep it under 4 lines."'}
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
                <FieldRow label="Subject"          value={generated.subject} />
                <FieldRow label="Greeting"         value={generated.greeting} />
                <FieldRow label="Header subtitle"  value={generated.header_subtitle} />
                <FieldRow label="Shoutout"         value={generated.shoutout_fallback} multiline />
                <FieldRow label="Footer"           value={generated.footer} />
              </div>

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
                    : <span><strong>Review required before save.</strong> Open the PDF preview to see the rendered email with sample values filled in.</span>}
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

function FieldRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      {multiline ? (
        <pre style={{
          margin: '4px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          fontSize: 13, lineHeight: 1.5, color: 'var(--ink)',
          maxHeight: 180, overflowY: 'auto',
        }}>{value || <span style={{ color: 'var(--mist)', fontStyle: 'italic' }}>(empty)</span>}</pre>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>{value || <span style={{ color: 'var(--mist)', fontStyle: 'italic' }}>(empty)</span>}</div>
      )}
    </div>
  )
}
