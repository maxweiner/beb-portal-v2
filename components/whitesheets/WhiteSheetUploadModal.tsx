'use client'

// White Sheet Upload modal — opens from the "📄 White Sheet Upload"
// launcher on the Buying Events Hub. Single drop-zone, accepts one
// PDF at a time, max ~80 MB.
//
// Upload flow:
//   1. Operator picks / drops a PDF.
//   2. Client generates a fresh upload_id (uuid) and POSTs the file
//      directly to Supabase Storage at
//        white-sheets/{brand}/{event_id}/{upload_id}/source.pdf
//      Authed user's session covers RLS (matches the bucket policy
//      in supabase-migration-white-sheets-phase-1-schema.sql).
//   3. Client POSTs /api/white-sheets/uploads/finalize with the
//      event_id + upload_id + source_pdf_path + filename.
//   4. The finalize route inserts the white_sheet_uploads row in
//      status='splitting'; the every-minute cron picks it up and
//      runs the splitter. OCR ships in Phase 3.
//
// Phase 2 UI: just show a "Processing 100 pages — we'll let you
// know when it's done" toast on success and close. Live counter +
// notification + email summary land in Phase 6.

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const MAX_BYTES = 80 * 1024 * 1024  // 80 MB

interface Props {
  /** Event the white sheets belong to. */
  eventId: string
  /** Brand the event lives in — drives the storage path. The
   *  finalize route re-validates this against events.brand on the
   *  server, so a wrong value here returns 400. */
  brand: string
  onClose: () => void
  onSubmitted: () => void
}

function uuidv4(): string {
  // Crypto-strong if available, fall back to RFC4122-shaped pseudo-random.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export default function WhiteSheetUploadModal({ eventId, brand, onClose, onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | null) {
    setError(null)
    if (!f) { setFile(null); return }
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF only — that file looks like ' + (f.type || 'an unknown type'))
      return
    }
    if (f.size > MAX_BYTES) {
      setError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB — max is ${MAX_BYTES / 1024 / 1024} MB. Try lowering scanner DPI to 200.`)
      return
    }
    setFile(f)
  }

  async function upload() {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      // 1. Generate fresh upload_id + storage path.
      const uploadId = uuidv4()
      const sourcePath = `${brand}/${eventId}/${uploadId}/source.pdf`

      // 2. Direct upload to the white-sheets bucket. RLS allows
      //    authenticated users in the eligible roles (see Phase 1
      //    migration); the supabase client uses the user's session
      //    bearer token automatically.
      const upRes = await supabase.storage
        .from('white-sheets')
        .upload(sourcePath, file, {
          contentType: 'application/pdf',
          upsert: false,
        })
      if (upRes.error) {
        throw new Error(`Upload failed: ${upRes.error.message}`)
      }

      // 3. Finalize — creates the white_sheet_uploads row in
      //    status='splitting'; cron drains within ~60s.
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const finalRes = await fetch('/api/white-sheets/uploads/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          event_id: eventId,
          upload_id: uploadId,
          source_pdf_path: sourcePath,
          original_filename: file.name,
        }),
      })
      const finalJson = await finalRes.json().catch(() => ({}))
      if (!finalRes.ok) {
        throw new Error(`Finalize failed: ${finalJson.error || finalRes.status}`)
      }

      // 4. Done — close + notify parent.
      onSubmitted()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520,
        padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--ink)' }}>📄 White Sheet Upload</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, color: 'var(--mist)', lineHeight: 1,
          }}>×</button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--mist)', margin: '0 0 16px' }}>
          Upload the scanned PDF of dealer-copy white sheets for this event. The system splits
          the PDF into pages and queues each for OCR — you can keep working while it processes
          in the background.
        </p>

        {/* Drop-zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) pickFile(f)
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--pearl)'}`,
            background: dragOver ? 'var(--green-pale)' : 'var(--cream2)',
            borderRadius: 12, padding: '32px 16px',
            textAlign: 'center', cursor: 'pointer',
            transition: 'all .15s',
          }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>📄</div>
          {file ? (
            <>
              <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{file.name}</div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4 }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · click to choose another
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, color: 'var(--ink)' }}>Drop a PDF or click to pick</div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4 }}>
                Single PDF, ~100 pages, max {MAX_BYTES / 1024 / 1024} MB
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={e => pickFile(e.target.files?.[0] || null)}
          />
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: '#FEE2E2', color: '#991B1B', fontSize: 12, fontWeight: 700,
          }}>⚠ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} className="btn-outline">Cancel</button>
          <button onClick={upload} disabled={!file || busy} className="btn-primary">
            {busy ? 'Uploading…' : 'Upload & process'}
          </button>
        </div>
      </div>
    </div>
  )
}
