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
          {qrs.map(q => (
            <QrCard
              key={q.id}
              qr={q}
              employees={employees}
              onDelete={() => deleteQr(q.id)}
              onUpdated={load}
            />
          ))}
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
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                padding: '4px 0',
                cursor: exists ? 'not-allowed' : 'pointer',
                opacity: exists ? 0.55 : 1,
              }}>
                <input type="checkbox"
                  checked={checked}
                  disabled={exists}
                  onChange={() => toggle(selectedChannels, src, setSelectedChannels)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                <span aria-hidden="true" style={{
                  width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                  border: `2px solid ${checked ? 'var(--green)' : 'var(--pearl)'}`,
                  background: checked ? 'var(--green)' : '#FFFFFF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#FFFFFF', fontSize: 13, fontWeight: 900, lineHeight: 1,
                  transition: 'all .15s ease',
                }}>{checked ? '✓' : ''}</span>
                <span style={{ flex: 1, color: exists ? 'var(--mist)' : 'var(--ink)' }}>{src}</span>
                {exists && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)' }}>EXISTS</span>}
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
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  padding: '4px 0',
                  cursor: exists ? 'not-allowed' : 'pointer',
                  opacity: exists ? 0.55 : 1,
                }}>
                  <input type="checkbox"
                    checked={checked}
                    disabled={exists}
                    onChange={() => toggle(selectedEmpIds, emp.id, setSelectedEmpIds)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                  <span aria-hidden="true" style={{
                    width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                    border: `2px solid ${checked ? 'var(--green)' : 'var(--pearl)'}`,
                    background: checked ? 'var(--green)' : '#FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#FFFFFF', fontSize: 13, fontWeight: 900, lineHeight: 1,
                    transition: 'all .15s ease',
                  }}>{checked ? '✓' : ''}</span>
                  <span style={{ flex: 1, color: exists ? 'var(--mist)' : 'var(--ink)' }}>{emp.name}</span>
                  {exists && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)' }}>EXISTS</span>}
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

function QrCard({
  qr,
  employees,
  onDelete,
  onUpdated,
}: {
  qr: QrRow
  employees: AppointmentEmployee[]
  onDelete: () => void
  onUpdated: () => void
}) {
  const url = qrShortUrl(qr.code)

  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(qr.label)
  const [customLabel, setCustomLabel] = useState(qr.custom_label || '')
  const [empId, setEmpId] = useState(qr.appointment_employee_id || '')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setLabel(qr.label)
    setCustomLabel(qr.custom_label || '')
    setEmpId(qr.appointment_employee_id || '')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
  }

  async function save() {
    if (!label.trim()) { alert('Label cannot be empty.'); return }
    if (qr.type === 'employee' && !empId) {
      if (!confirm('No employee selected — this QR will redirect to the store with no spiff attribution. Continue?')) return
    }
    const updates: Record<string, any> = { label: label.trim() }
    if (qr.type === 'custom') updates.custom_label = customLabel.trim()
    if (qr.type === 'employee') updates.appointment_employee_id = empId || null
    setSaving(true)
    const res = await fetch(`/api/qr/${qr.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setSaving(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert('Save failed: ' + (json.error || res.status))
      return
    }
    setEditing(false)
    onUpdated()
  }

  const employeeName = qr.appointment_employee_id
    ? employees.find(e => e.id === qr.appointment_employee_id)?.name
    : null

  // ---- helpers ----
  // Wrap label into lines that fit a given pixel width with a measuring ctx.
  function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? line + ' ' + w : w
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line)
        line = w
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    return lines
  }

  function downloadSvg() {
    const svg = document.querySelector(`#qr-svg-${qr.id}`) as SVGSVGElement | null
    if (!svg) return
    // Render the QR onto a larger SVG with the label and code printed below
    // so the printer can verify they have the right asset by eye.
    const qrSize = 1024
    const padding = 40
    const lineHeight = 70
    const codeHeight = 50
    // Pre-measure with a temp canvas to know how many lines we need
    const measureCanvas = document.createElement('canvas')
    const mctx = measureCanvas.getContext('2d')!
    mctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const lines = wrapLines(mctx, qr.label, qrSize - padding * 2)
    const totalHeight = qrSize + padding + lines.length * lineHeight + codeHeight + padding

    const inner = svg.innerHTML
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${qrSize}" height="${totalHeight}" viewBox="0 0 ${qrSize} ${totalHeight}">
  <rect width="${qrSize}" height="${totalHeight}" fill="#FFFFFF"/>
  <svg x="0" y="0" width="${qrSize}" height="${qrSize}" viewBox="${svg.getAttribute('viewBox') || `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`}">
    ${inner}
  </svg>
  <g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" text-anchor="middle">
    ${lines.map((ln, i) => `<text x="${qrSize / 2}" y="${qrSize + padding + (i + 1) * lineHeight - 20}" font-size="56" font-weight="700" fill="#111111">${escapeXml(ln)}</text>`).join('\n    ')}
    <text x="${qrSize / 2}" y="${qrSize + padding + lines.length * lineHeight + codeHeight - 10}" font-size="36" font-weight="500" fill="#666666" letter-spacing="6">${escapeXml(qr.code)}</text>
  </g>
</svg>`
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    triggerDownload(blob, `${fileSlug(qr.label)}.svg`)
  }

  function downloadPng() {
    const svg = document.querySelector(`#qr-svg-${qr.id}`) as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
    const img = new Image()
    img.onload = () => {
      const qrSize = 1024
      const padding = 40
      const lineHeight = 70
      const codeHeight = 50

      // Measure label wrapping
      const measureCanvas = document.createElement('canvas')
      const mctx = measureCanvas.getContext('2d')!
      mctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      const lines = wrapLines(mctx, qr.label, qrSize - padding * 2)
      const totalHeight = qrSize + padding + lines.length * lineHeight + codeHeight + padding

      const canvas = document.createElement('canvas')
      canvas.width = qrSize
      canvas.height = totalHeight
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, qrSize, totalHeight)
      ctx.drawImage(img, 0, 0, qrSize, qrSize)

      // Label
      ctx.fillStyle = '#111111'
      ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      lines.forEach((ln, i) => {
        ctx.fillText(ln, qrSize / 2, qrSize + padding + (i + 1) * lineHeight - 20)
      })

      // Code (smaller, lighter, letter-spaced)
      ctx.fillStyle = '#666666'
      ctx.font = '500 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(
        qr.code.split('').join(' '), // visual letter-spacing for readability
        qrSize / 2,
        qrSize + padding + lines.length * lineHeight + codeHeight - 10,
      )

      canvas.toBlob(b => { if (b) triggerDownload(b, `${fileSlug(qr.label)}.png`) }, 'image/png')
    }
    img.src = svg64
  }

  function escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
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
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: 12, background: 'white',
      border: editing ? '2px solid var(--green)' : '1px solid var(--pearl)',
      borderRadius: 'var(--r)',
    }}>
      <div style={{ background: 'white', padding: 4, borderRadius: 6, flexShrink: 0 }}>
        <QRCodeSVG id={`qr-svg-${qr.id}`} value={url} size={88} includeMargin={false} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!editing ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{qr.label}</div>
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, lineHeight: 1.5 }}>
              Type: <strong>{qr.type}</strong>
              {qr.lead_source && ` · Source: ${qr.lead_source}`}
              {qr.custom_label && ` · Label: ${qr.custom_label}`}
              {qr.type === 'employee' && (
                <> · Spiff: <strong>{employeeName || '— none —'}</strong></>
              )}
              {' · Code: '}<code style={{ fontSize: 11 }}>{qr.code}</code>
            </div>
            <a href={url} target="_blank" rel="noreferrer"
               style={{ fontSize: 11, color: 'var(--green)', wordBreak: 'break-all' }}>
              {url}
            </a>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="fl">Label (display name)</label>
              <input type="text" value={label} onChange={e => setLabel(e.target.value)} />
            </div>
            {qr.type === 'custom' && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="fl">Custom label (used in attribution)</label>
                <input type="text" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
              </div>
            )}
            {qr.type === 'employee' && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="fl">Spiff employee</label>
                <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— none —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--mist)' }}>
              Type, code, and lead source are immutable (changing them would break attribution on already-printed QRs).
            </div>
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              paddingTop: 8, marginTop: 4, borderTop: '1px solid var(--pearl)',
            }}>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelEdit} disabled={saving} className="btn-outline btn-sm">
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={onDelete} disabled={saving} className="btn-danger btn-sm">
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        {!editing && (
          <>
            <button onClick={startEdit} className="btn-outline btn-sm">Edit</button>
            <button onClick={downloadPng} className="btn-primary btn-sm">PNG</button>
            <button onClick={downloadSvg} className="btn-outline btn-sm">SVG</button>
          </>
        )}
      </div>
    </div>
  )
}
