'use client'

// Superadmin-only panel inside Settings. Lets you upload a per-brand
// logo (one for BEB, one for Liberty). Uploaded files live in the
// private brand-logos bucket and are referenced from the brand_logos
// table by primary key (brand). The expense-report PDF generator
// reads these files server-side at render time.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Brand = 'beb' | 'liberty'

interface LogoState {
  signedUrl: string | null
  updatedAt: string | null
  loading: boolean
  uploading: boolean
  error: string | null
}

const EMPTY: LogoState = { signedUrl: null, updatedAt: null, loading: true, uploading: false, error: null }

export default function BrandLogosPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        Upload a logo for each brand. Used on the Expense Report PDF (and other branded surfaces over time).
        Recommended: a transparent PNG or SVG, wider than tall, minimum 800px wide.
      </div>
      <BrandLogoCard brand="beb" label="Beneficial Estate Buyers" accent="#1D6B44" />
      <BrandLogoCard brand="liberty" label="Liberty" accent="#3B82F6" />
    </div>
  )
}

function BrandLogoCard({ brand, label, accent }: { brand: Brand; label: string; accent: string }) {
  const [state, setState] = useState<LogoState>(EMPTY)
  const fileRef = useRef<HTMLInputElement>(null)

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function load() {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await authedFetch(`/api/admin/brand-logo?brand=${brand}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`)
      setState({
        signedUrl: json.signedUrl || null,
        updatedAt: json.updatedAt || null,
        loading: false, uploading: false, error: null,
      })
    } catch (e: any) {
      setState({ ...EMPTY, loading: false, error: e?.message || 'Load failed' })
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [brand])

  async function pick() { fileRef.current?.click() }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''  // reset so picking the same file again still fires
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setState(s => ({ ...s, error: 'File too large (max 5MB).' })); return
    }
    setState(s => ({ ...s, uploading: true, error: null }))
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await authedFetch('/api/admin/brand-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, dataUrl }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Upload failed (${res.status})`)
      setState({
        signedUrl: json.signedUrl || null,
        updatedAt: new Date().toISOString(),
        loading: false, uploading: false, error: null,
      })
    } catch (err: any) {
      setState(s => ({ ...s, uploading: false, error: err?.message || 'Upload failed' }))
    }
  }

  const fmtUpdated = state.updatedAt
    ? new Date(state.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div style={{
      border: '1px solid var(--pearl)', borderRadius: 10,
      borderTop: `3px solid ${accent}`,
      padding: 14, background: '#fff',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{label}</div>
        {fmtUpdated && (
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>Updated {fmtUpdated}</div>
        )}
      </div>

      <div style={{
        background: 'var(--cream2)', borderRadius: 8,
        padding: 16, marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 100,
      }}>
        {state.loading
          ? <span style={{ fontSize: 12, color: 'var(--mist)' }}>Loading…</span>
          : state.signedUrl
            ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.signedUrl} alt={`${label} logo`} style={{
                maxWidth: '100%', maxHeight: 100, objectFit: 'contain',
              }} />
            )
            : <span style={{ fontSize: 12, color: 'var(--mist)' }}>No logo uploaded — bundled BEB wordmark will be used.</span>
        }
      </div>

      <input ref={fileRef} type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: 'none' }} onChange={onFile} />
      <button className="btn-outline btn-sm" onClick={pick} disabled={state.uploading}>
        {state.uploading ? 'Uploading…' : state.signedUrl ? 'Replace logo' : 'Upload logo'}
      </button>

      {state.error && (
        <div style={{
          marginTop: 8, fontSize: 12,
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 6,
          padding: '6px 10px',
        }}>{state.error}</div>
      )}
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('Read failed'))
    r.readAsDataURL(file)
  })
}
