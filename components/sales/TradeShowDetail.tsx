'use client'

// Trade Show detail page. Phase 3: name, venue, dates, booth #,
// website, organizing body, notes. Inline editable with the
// existing useAutosave pattern. Soft-delete is admin-only.
//
// Phases 4 (booth costs), 5 (staff assignments), 7 (lead capture
// from this page), 9 (booth appointments) layer onto this same
// detail surface as additional cards.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { getTradeShow, updateTradeShow, softDeleteTradeShow } from '@/lib/sales/tradeshows'
import type { TradeShow } from '@/types'

interface Props {
  tradeShowId: string
  onBack: () => void
  onDeleted: () => void
}

export default function TradeShowDetail({ tradeShowId, onBack, onDeleted }: Props) {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.is_partner
  const [show, setShow] = useState<TradeShow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: '', venue_name: '', venue_city: '', venue_state: '',
    venue_address: '', start_date: '', end_date: '',
    booth_number: '', show_website_url: '', organizing_body: '', notes: '',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await getTradeShow(tradeShowId)
        if (cancelled) return
        if (!row) { setError('Trade show not found.'); setLoaded(true); return }
        setShow(row)
        setDraft({
          name:             row.name || '',
          venue_name:       row.venue_name || '',
          venue_city:       row.venue_city || '',
          venue_state:      row.venue_state || '',
          venue_address:    row.venue_address || '',
          start_date:       row.start_date || '',
          end_date:         row.end_date || '',
          booth_number:     row.booth_number || '',
          show_website_url: row.show_website_url || '',
          organizing_body:  row.organizing_body || '',
          notes:            row.notes || '',
        })
        setLoaded(true)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Failed to load'); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [tradeShowId])

  const status = useAutosave(
    draft,
    async (d) => {
      if (!show) return
      // Empty strings → null for optional fields so the DB column
      // stays NULL rather than ''.
      const norm = (v: string) => (v.trim() === '' ? null : v.trim())
      await updateTradeShow(show.id, {
        name: d.name.trim() || show.name,
        venue_name:       norm(d.venue_name),
        venue_city:       norm(d.venue_city),
        venue_state:      norm(d.venue_state),
        venue_address:    norm(d.venue_address),
        start_date:       d.start_date,
        end_date:         d.end_date,
        booth_number:     norm(d.booth_number),
        show_website_url: norm(d.show_website_url),
        organizing_body:  norm(d.organizing_body),
        notes:            norm(d.notes),
      })
    },
    { delay: 800, enabled: loaded && !!show && draft.name.trim().length > 0
                          && !!draft.start_date && !!draft.end_date },
  )

  async function handleDelete() {
    if (!show || !isAdmin) return
    if (!confirm(`Delete "${show.name}"? This soft-deletes the show — you can restore via SQL if needed.`)) return
    try {
      await softDeleteTradeShow(show.id)
      onDeleted()
    } catch (err: any) {
      alert(`Could not delete: ${err?.message || 'unknown'}`)
    }
  }

  if (!loaded) {
    return <div className="p-6 text-center" style={{ color: 'var(--mist)' }}>Loading…</div>
  }
  if (error) {
    return (
      <div className="p-6" style={{ maxWidth: 720, margin: '0 auto' }}>
        <button onClick={onBack} className="btn-outline btn-sm" style={{ marginBottom: 14 }}>← Trade Shows</button>
        <div className="card" style={{ padding: 20, color: '#991B1B', background: '#FEE2E2' }}>{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn-outline btn-sm">← Trade Shows</button>
        <div style={{ flex: 1 }} />
        <AutosaveIndicator status={status} />
        {isAdmin && (
          <button onClick={handleDelete} className="btn-outline btn-sm" style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>
            Delete
          </button>
        )}
      </div>

      {/* Identity */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <Field label="Show name" required>
          <input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
            placeholder="e.g. JCK Las Vegas 2026" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Start date" required>
            <input type="date" value={draft.start_date}
              onChange={e => setDraft(p => ({ ...p, start_date: e.target.value }))} />
          </Field>
          <Field label="End date" required>
            <input type="date" value={draft.end_date}
              onChange={e => setDraft(p => ({ ...p, end_date: e.target.value }))} />
          </Field>
        </div>
        <Field label="Booth number">
          <input value={draft.booth_number}
            onChange={e => setDraft(p => ({ ...p, booth_number: e.target.value }))}
            placeholder="e.g. B-1042" />
        </Field>
      </div>

      {/* Venue */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Venue
        </div>
        <Field label="Venue name">
          <input value={draft.venue_name}
            onChange={e => setDraft(p => ({ ...p, venue_name: e.target.value }))}
            placeholder="e.g. Las Vegas Convention Center" />
        </Field>
        <Field label="Address">
          <input value={draft.venue_address}
            onChange={e => setDraft(p => ({ ...p, venue_address: e.target.value }))}
            placeholder="3150 Paradise Rd" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="City">
            <input value={draft.venue_city}
              onChange={e => setDraft(p => ({ ...p, venue_city: e.target.value }))}
              placeholder="Las Vegas" />
          </Field>
          <Field label="State">
            <input value={draft.venue_state}
              onChange={e => setDraft(p => ({ ...p, venue_state: e.target.value }))}
              placeholder="NV" />
          </Field>
        </div>
      </div>

      {/* Show meta */}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Show info
        </div>
        <Field label="Show website">
          <input type="url" value={draft.show_website_url}
            onChange={e => setDraft(p => ({ ...p, show_website_url: e.target.value }))}
            placeholder="https://www.jckonline.com/show" />
        </Field>
        <Field label="Organizing body">
          <input value={draft.organizing_body}
            onChange={e => setDraft(p => ({ ...p, organizing_body: e.target.value }))}
            placeholder="e.g. RX (Reed Exhibitions)" />
        </Field>
        <Field label="Notes">
          <textarea rows={4} value={draft.notes}
            onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))}
            placeholder="Anything the team should know…" />
        </Field>
      </div>

      {/* Phase placeholders */}
      <div className="card" style={{ padding: 18, marginBottom: 14, opacity: 0.7 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          Coming soon on this page
        </div>
        <ul style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
          <li>Booth cost breakdown — Phase 4</li>
          <li>Staff assignments by date — Phase 5</li>
          <li>Lead capture (manual + business-card scan) — Phase 6 / 7</li>
          <li>Booth appointments with magic-link booking — Phase 9</li>
        </ul>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#B91C1C', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  )
}
