'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { fileSlug, qrShortUrl } from '@/lib/qr/code'

interface QrRow {
  id: string
  code: string
  type: 'channel' | 'custom' | 'employee' | 'group'
  lead_source: string | null
  custom_label: string | null
  appointment_employee_id: string | null
  label: string
  active: boolean
  created_at: string
}

interface AppointmentEmployee {
  id: string
  name: string
}

const DEFAULT_HEAR_ABOUT = [
  'Large Postcard', 'Small Postcard', 'Newspaper', 'Email', 'Text', 'The Store Told Me',
]

export default function QrCodesSection({
  storeId,
  storeName,
}: {
  storeId: string
  storeName: string
}) {
  const [qrs, setQrs] = useState<QrRow[]>([])
  const [employees, setEmployees] = useState<AppointmentEmployee[]>([])
  const [hearAboutOptions, setHearAboutOptions] = useState<string[]>(DEFAULT_HEAR_ABOUT)
  const [loaded, setLoaded] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set())
  const [customLabel, setCustomLabel] = useState('')
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<string>>(new Set())

  async function load() {
    const [qrRes, empRes, cfgRes] = await Promise.all([
      supabase.from('qr_codes')
        .select('id, code, type, lead_source, custom_label, appointment_employee_id, label, active, created_at')
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('appointment_employees')
        .select('id, name')
        .eq('store_id', storeId)
        .eq('active', true)
        .order('name'),
      supabase.from('booking_config')
        .select('hear_about_options')
        .eq('store_id', storeId)
        .maybeSingle(),
    ])
    if (qrRes.error) { setError(qrRes.error.message); return }
    setQrs((qrRes.data || []) as QrRow[])
    setEmployees((empRes.data || []) as AppointmentEmployee[])
    if (cfgRes.data?.hear_about_options && Array.isArray(cfgRes.data.hear_about_options)) {
      setHearAboutOptions(cfgRes.data.hear_about_options as string[])
    }
    setLoaded(true)
  }

  useEffect(() => { load() /* eslint-disable-line */ }, [storeId])

  // Lookup which lead sources / employees already have a QR (so we don't
  // offer to create duplicates).
  const existingChannelSources = new Set(
    qrs.filter(q => q.type === 'channel' && q.lead_source).map(q => q.lead_source!)
  )
  const existingEmployeeIds = new Set(
    qrs.filter(q => q.type === 'employee' && q.appointment_employee_id)
       .map(q => q.appointment_employee_id!)
  )

  async function generate(items: any[]) {
    if (items.length === 0) return
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, items }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Generate failed (${res.status})`)
      } else {
        setSelectedChannels(new Set())
        setCustomLabel('')
        setSelectedEmpIds(new Set())
        await load()
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setWorking(false)
  }

  async function generateChannelQrs() {
    const items = [...selectedChannels].map(src => ({
      type: 'channel',
      lead_source: src,
      label: `${storeName} — ${src}`,
    }))
    await generate(items)
  }

  async function generateCustomQr() {
    const lbl = customLabel.trim()
    if (!lbl) return
    await generate([{
      type: 'custom',
      custom_label: lbl,
      label: `${storeName} — ${lbl}`,
    }])
  }

  async function generateEmployeeQrs() {
    const items = [...selectedEmpIds].map(empId => {
      const emp = employees.find(e => e.id === empId)
      return {
        type: 'employee',
        appointment_employee_id: empId,
        label: `${storeName} — ${emp?.name || 'Employee'}`,
      }
    })
    await generate(items)
  }

  async function deleteQr(id: string) {
    if (!confirm('Move this QR code to the trash bin? It will keep working for 60 days, then permanently purge.')) return
    const res = await fetch(`/api/qr/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert('Delete failed: ' + (json.error || res.status))
      return
    }
    await load()
  }

  function toggle(set: Set<string>, val: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(val)) next.delete(val); else next.add(val)
    setter(next)
  }

  if (!loaded) return null

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title">QR Codes</div>
      <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
        Permanent codes for advertising. Each QR redirects to this store's booking page and tracks scans + conversions. The code never changes once generated, so printed materials keep working even if the slug changes.
      </p>

      {/* Existing QR list */}
      {qrs.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 12 }}>
          No QR codes yet. Generate some below.
        </p>
      )}
      {qrs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {qrs.map(q => <QrCard key={q.id} qr={q} onDelete={() => deleteQr(q.id)} />)}
        </div>
      )}

      {error && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 'var(--r)',
          background: '#fee2e2', color: '#991b1b', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Channel QR generator */}
      <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 8 }}>
          Generate Channel QR Codes
        </div>
        <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>
          One QR per advertising channel. Pre-fills and locks the source on the customer booking page.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          {hearAboutOptions.map(src => {
            const exists = existingChannelSources.has(src)
            const checked = selectedChannels.has(src)
            return (
              <label key={src} style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                padding: 8, border: '1px solid var(--pearl)', borderRadius: 'var(--r)',
                background: exists ? '#f3f4f6' : 'white',
                color: exists ? 'var(--mist)' : 'var(--ink)',
                cursor: exists ? 'not-allowed' : 'pointer',
                opacity: exists ? 0.6 : 1,
              }}>
                <input type="checkbox"
                  checked={checked}
                  disabled={exists}
                  onChange={() => toggle(selectedChannels, src, setSelectedChannels)} />
                <span style={{ flex: 1 }}>{src}</span>
                {exists && <span style={{ fontSize: 10, fontWeight: 700 }}>EXISTS</span>}
              </label>
            )
          })}
        </div>
        <button
          className="btn-primary btn-sm"
          disabled={working || selectedChannels.size === 0}
          onClick={generateChannelQrs}
        >
          {working ? 'Generating…' : `Generate ${selectedChannels.size || ''} channel QR${selectedChannels.size === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Custom-label QR generator */}
      <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 8 }}>
          Generate a Custom-Label QR
        </div>
        <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>
          For specific publications or campaigns (e.g., "Philadelphia Inquirer", "Spring Mailer 2026").
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Custom label…"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); generateCustomQr() } }}
            style={{ flex: 1 }}
          />
          <button
            className="btn-primary btn-sm"
            disabled={working || customLabel.trim().length === 0}
            onClick={generateCustomQr}
          >
            Generate
          </button>
        </div>
      </div>

      {/* Employee QR generator */}
      {employees.length > 0 && (
        <div style={{ borderTop: '1px solid var(--pearl)', paddingTop: 12, marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 8 }}>
            Generate Employee QR Codes
          </div>
          <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>
            One QR per spiff employee. Scans are recorded as Employee Referral and credited to that employee.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {employees.map(emp => {
              const exists = existingEmployeeIds.has(emp.id)
              const checked = selectedEmpIds.has(emp.id)
              return (
                <label key={emp.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                  padding: 8, border: '1px solid var(--pearl)', borderRadius: 'var(--r)',
                  background: exists ? '#f3f4f6' : 'white',
                  color: exists ? 'var(--mist)' : 'var(--ink)',
                  cursor: exists ? 'not-allowed' : 'pointer',
                  opacity: exists ? 0.6 : 1,
                }}>
                  <input type="checkbox"
                    checked={checked}
                    disabled={exists}
                    onChange={() => toggle(selectedEmpIds, emp.id, setSelectedEmpIds)} />
                  <span style={{ flex: 1 }}>{emp.name}</span>
                  {exists && <span style={{ fontSize: 10, fontWeight: 700 }}>EXISTS</span>}
                </label>
              )
            })}
          </div>
          <button
            className="btn-primary btn-sm"
            disabled={working || selectedEmpIds.size === 0}
            onClick={generateEmployeeQrs}
          >
            {working ? 'Generating…' : `Generate ${selectedEmpIds.size || ''} employee QR${selectedEmpIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}

function QrCard({ qr, onDelete }: { qr: QrRow; onDelete: () => void }) {
  const url = qrShortUrl(qr.code)
  const svgRef = useRef<SVGSVGElement | null>(null)

  function downloadSvg() {
    const svg = document.querySelector(`#qr-svg-${qr.id}`) as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([
      '<?xml version="1.0" encoding="UTF-8"?>\n',
      xml,
    ], { type: 'image/svg+xml' })
    triggerDownload(blob, `${fileSlug(qr.label)}.svg`)
  }

  function downloadPng() {
    const svg = document.querySelector(`#qr-svg-${qr.id}`) as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
    const img = new Image()
    img.onload = () => {
      const size = 1024
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      canvas.toBlob(b => { if (b) triggerDownload(b, `${fileSlug(qr.label)}.png`) }, 'image/png')
    }
    img.src = svg64
  }

  function triggerDownload(blob: Blob, filename: string) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 0)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 12, background: 'white', border: '1px solid var(--pearl)',
      borderRadius: 'var(--r)',
    }}>
      <div style={{ background: 'white', padding: 4, borderRadius: 6, flexShrink: 0 }}>
        <QRCodeSVG id={`qr-svg-${qr.id}`} value={url} size={88} includeMargin={false} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{qr.label}</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
          Type: <strong>{qr.type}</strong>
          {qr.lead_source && ` · Source: ${qr.lead_source}`}
          {qr.custom_label && ` · Label: ${qr.custom_label}`}
          {' · Code: '}<code style={{ fontSize: 11 }}>{qr.code}</code>
        </div>
        <a href={url} target="_blank" rel="noreferrer"
           style={{ fontSize: 11, color: 'var(--green)', wordBreak: 'break-all' }}>
          {url}
        </a>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button onClick={downloadPng} className="btn-primary btn-sm">PNG</button>
        <button onClick={downloadSvg} className="btn-outline btn-sm">SVG</button>
        <button onClick={onDelete} className="btn-danger btn-sm">×</button>
      </div>
    </div>
  )
}
