'use client'

// "Add Receipt" button. On mobile, opens the camera (capture="environment").
// On desktop, opens the file picker. Pipeline:
//   1. compressImage() shrinks the photo to ≤ 1600px wide JPEG @ 0.7
//      so we stay well under Vercel's 4.5 MB body limit.
//   2. POST to /api/expense-reports/[id]/upload-receipt — server
//      uploads to the private bucket and runs Claude vision OCR.
//   3. Confirmation modal pre-fills with extracted vendor / amount /
//      date / category. User edits, hits Save.
//   4. INSERT into expenses with source='ocr', receipt_url=path,
//      ocr_extracted_data=raw — goes through PR1 RLS so only owner /
//      admin can write while report is active.

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { compressImage } from '@/lib/imageUtils'
import { CATEGORY_OPTIONS, todayIso } from './expensesUtils'
import type { ExpenseCategory } from '@/types'
import DatePicker from '@/components/ui/DatePicker'

interface Suggestion {
  vendor: string | null
  amount: number | null
  date: string | null
  suggestedCategory: ExpenseCategory | null
  raw: unknown
}

export default function AddReceiptButton({
  reportId, onAdded,
}: {
  reportId: string
  onAdded: () => void | Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'extracting' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    vendor: string
    amount: string
    expense_date: string
    category: ExpenseCategory
    customLabel: string
    notes: string
  } | null>(null)
  const [rawSuggestion, setRawSuggestion] = useState<unknown>(null)

  function reset() {
    setBusy('idle'); setError(null); setExtractError(null)
    setPreviewUrl(null); setReceiptPath(null); setDraft(null); setRawSuggestion(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  async function handleFile(file: File) {
    setError(null); setExtractError(null)
    setBusy('uploading')
    try {
      // Compress + convert to JPEG. compressImage returns a data: URL.
      const dataUrl = await compressImage(file, 1600, 0.7)
      setPreviewUrl(dataUrl)

      const commaIdx = dataUrl.indexOf(',')
      const imageBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl

      setBusy('extracting')
      const res = await authedFetch(`/api/expense-reports/${reportId}/upload-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType: 'image/jpeg' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Upload failed (${res.status})`)
        setBusy('idle'); return
      }
      setReceiptPath(json.receiptPath ?? null)
      const s: Suggestion | null = json.suggestion ?? null
      setRawSuggestion(s?.raw ?? null)
      setExtractError(json.extractError ?? null)
      setDraft({
        vendor: s?.vendor ?? '',
        amount: s?.amount != null ? String(s.amount) : '',
        expense_date: s?.date ?? todayIso(),
        category: s?.suggestedCategory ?? 'meals',
        customLabel: '',
        notes: '',
      })
      setBusy('idle')
    } catch (err: any) {
      setError(err?.message || 'Failed to process the image')
      setBusy('idle')
    }
  }

  async function saveExpense() {
    if (!draft || !receiptPath) return
    if (Number(draft.amount) <= 0) { setError('Amount must be greater than 0.'); return }
    if (draft.category === 'custom' && !draft.customLabel.trim()) {
      setError('A custom category needs a label.'); return
    }
    setBusy('saving'); setError(null)
    const { error: insertErr } = await supabase.from('expenses').insert({
      expense_report_id: reportId,
      category: draft.category,
      custom_category_label: draft.category === 'custom' ? draft.customLabel.trim() : null,
      vendor: draft.vendor.trim() || null,
      amount: Number(draft.amount),
      expense_date: draft.expense_date,
      notes: draft.notes.trim() || null,
      source: 'ocr',
      receipt_url: receiptPath,
      ocr_extracted_data: rawSuggestion ?? null,
    })
    if (insertErr) {
      setError(insertErr.message); setBusy('idle'); return
    }
    await onAdded()
    reset()
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy !== 'idle'}
        style={{
          width: '100%', padding: '14px 16px', borderRadius: 10,
          border: '2px dashed var(--green)', background: 'transparent',
          color: 'var(--green-dark)', fontWeight: 800, fontSize: 14,
          cursor: busy === 'idle' ? 'pointer' : 'wait',
          fontFamily: 'inherit',
        }}>
        {busy === 'uploading'  ? 'Compressing photo…'
        : busy === 'extracting' ? 'Reading receipt with AI…'
        : busy === 'saving'    ? 'Saving expense…'
        : '📷 Add Receipt (camera or file)'}
      </button>

      {error && !draft && (
        <div style={{ marginTop: 8, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Confirmation modal */}
      {draft && (
        <div onClick={e => e.target === e.currentTarget && reset()}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Confirm receipt details</h2>
              <button onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
            </div>

            {extractError && (
              <div style={{ padding: 10, marginBottom: 10, background: '#FEF3C7', color: '#78350F', borderRadius: 6, fontSize: 12 }}>
                Couldn't auto-extract: {extractError}. Fill in the fields manually.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'flex-start' }}>
              {previewUrl && (
                <img src={previewUrl} alt="receipt preview"
                  style={{ width: '100%', borderRadius: 8, border: '1px solid var(--cream2)', objectFit: 'contain', maxHeight: 320 }} />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Field label="Date *">
                  <DatePicker value={draft.expense_date}
                    onChange={v => setDraft(d => d ? { ...d, expense_date: v } : d)} />
                </Field>
                <Field label="Category *">
                  <select value={draft.category}
                    onChange={e => setDraft(d => d ? { ...d, category: e.target.value as ExpenseCategory } : d)}>
                    {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
                  </select>
                </Field>
                {draft.category === 'custom' && (
                  <Field label="Custom label *">
                    <input type="text" value={draft.customLabel}
                      onChange={e => setDraft(d => d ? { ...d, customLabel: e.target.value } : d)} />
                  </Field>
                )}
                <Field label="Vendor">
                  <input type="text" value={draft.vendor}
                    onChange={e => setDraft(d => d ? { ...d, vendor: e.target.value } : d)} />
                </Field>
                <Field label="Amount *">
                  <input type="number" step="0.01" min="0" value={draft.amount}
                    onChange={e => setDraft(d => d ? { ...d, amount: e.target.value } : d)} />
                </Field>
                <Field label="Notes">
                  <textarea rows={2} value={draft.notes}
                    onChange={e => setDraft(d => d ? { ...d, notes: e.target.value } : d)} />
                </Field>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 10, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={reset} className="btn-outline btn-sm">Cancel</button>
              <button onClick={saveExpense} className="btn-primary"
                disabled={busy === 'saving'}>
                {busy === 'saving' ? 'Saving…' : 'Save expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.05em', color: 'var(--mist)', marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  )
}
