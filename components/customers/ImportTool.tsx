'use client'

// Bulk-import UI for the Customers module. Two-step:
//   1. Pick store + CSV → POST /api/customers/import (mode=preview)
//      → shows counts (new / merged / flagged / errored) + the per-
//      row error list so the operator can fix the CSV.
//   2. Click Run import → same endpoint with mode=commit.
//
// Provides a "Download CSV template" link with the exact header
// names the parser recognizes.

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Store } from '@/types'

type Stage = 'pick' | 'previewing' | 'preview_ready' | 'committing' | 'done'

interface PreviewResp {
  ok: boolean
  total: number
  previewable?: number
  newCount: number
  mergedCount: number
  flaggedCount: number
  erroredCount?: number
  errors: { row: number; reason: string }[]
}

const TEMPLATE_HEADERS = [
  'first_name', 'last_name', 'address_line_1', 'address_line_2',
  'city', 'state', 'zip', 'phone', 'email', 'date_of_birth',
  'how_did_you_hear', 'notes', 'last_contact_date', 'do_not_contact',
]

export default function ImportTool({ stores, storeId, setStoreId, onImported }: {
  stores: Store[]
  storeId: string
  setStoreId: (id: string) => void
  onImported: () => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  function downloadTemplate() {
    const example = [
      'Mary,Smith,123 Main St,Apt 4,Phoenix,AZ,85001,(602) 555-1234,mary@example.com,1965-04-12,Postcard,VIP — bring jewelry,2024-09-12,N',
      'John,Doe,456 Oak Ave,,Tucson,AZ,85701,520.555.9876,john@example.com,03/22/1972,Word of mouth,,,N',
    ]
    const csv = TEMPLATE_HEADERS.join(',') + '\n' + example.join('\n') + '\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'customers-import-template.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function runPreview() {
    if (!file || !storeId) return
    setStage('previewing'); setError(null); setPreview(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('storeId', storeId); fd.append('mode', 'preview')
    try {
      const res = await authedFetch('/api/customers/import', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setStage('pick'); return }
      setPreview(json as PreviewResp)
      setStage('preview_ready')
    } catch (e: any) {
      setError(e?.message || 'Network error'); setStage('pick')
    }
  }

  async function runCommit() {
    if (!file || !storeId) return
    setStage('committing'); setError(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('storeId', storeId); fd.append('mode', 'commit')
    try {
      const res = await authedFetch('/api/customers/import', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setStage('preview_ready'); return }
      setPreview(json as PreviewResp)
      setStage('done')
      onImported()
    } catch (e: any) {
      setError(e?.message || 'Network error'); setStage('preview_ready')
    }
  }

  function reset() {
    setStage('pick'); setFile(null); setPreview(null); setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="card-title">📥 Bulk Import Customers</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14, lineHeight: 1.5 }}>
          Upload a CSV. Each row runs through the dedup matcher: exact email or phone match auto-merges; fuzzy name+address match goes to the review queue; everything else creates a new customer.
          <br />
          <button type="button" onClick={downloadTemplate} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--green-dark)', fontSize: 12, fontWeight: 700,
            textDecoration: 'underline', padding: 0, marginTop: 6, fontFamily: 'inherit',
          }}>📄 Download CSV template</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">Target store</label>
            <select value={storeId} onChange={e => { setStoreId(e.target.value); reset() }}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="fl">CSV file</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain"
              onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setStage('pick') }} />
          </div>
        </div>

        {error && (
          <div style={{
            marginTop: 12,
            background: 'var(--red-pale)', color: '#7f1d1d',
            border: '1px solid #fecaca', borderRadius: 8,
            padding: '10px 14px', fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          {stage === 'pick' && (
            <button className="btn-primary btn-sm" disabled={!file || !storeId} onClick={runPreview}>
              Preview import
            </button>
          )}
          {stage === 'previewing' && (
            <button className="btn-primary btn-sm" disabled>Previewing…</button>
          )}
          {(stage === 'preview_ready' || stage === 'committing') && (
            <>
              <button className="btn-primary btn-sm" disabled={stage === 'committing'} onClick={runCommit}>
                {stage === 'committing' ? 'Importing…' : `▶ Run import (${preview?.previewable || 0} row${preview?.previewable === 1 ? '' : 's'})`}
              </button>
              <button className="btn-outline btn-sm" onClick={reset}>Cancel</button>
            </>
          )}
          {stage === 'done' && (
            <button className="btn-outline btn-sm" onClick={reset}>Import another file</button>
          )}
        </div>
      </div>

      {preview && (
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title">{stage === 'done' ? '✅ Import complete' : 'Preview'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            <Stat label="New" value={preview.newCount} color="var(--green)" />
            <Stat label="Merged" value={preview.mergedCount} color="var(--green-dark)" />
            <Stat label="Review queue" value={preview.flaggedCount} color="#92400E" />
            <Stat label="Errors" value={preview.errors.length} color="#7f1d1d" />
          </div>
          {preview.errors.length > 0 && (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 800, color: 'var(--mist)',
                textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
              }}>Errors (skipped on commit)</div>
              <div style={{
                maxHeight: 280, overflowY: 'auto',
                border: '1px solid var(--pearl)', borderRadius: 6,
                background: '#fff',
              }}>
                {preview.errors.map(e => (
                  <div key={e.row} style={{
                    padding: '6px 12px', fontSize: 12,
                    borderBottom: '1px solid var(--cream2)',
                  }}>
                    <strong>Row {e.row}:</strong> <span style={{ color: 'var(--ash)' }}>{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stage === 'done' && preview.flaggedCount > 0 && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              background: 'var(--cream2)', borderRadius: 6,
              fontSize: 12, color: 'var(--ash)',
            }}>
              💡 {preview.flaggedCount} row{preview.flaggedCount === 1 ? ' was' : 's were'} flagged for manual review. Open the <strong>Dedup Review</strong> tab to merge or keep them separate.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8,
      padding: '12px 14px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}
