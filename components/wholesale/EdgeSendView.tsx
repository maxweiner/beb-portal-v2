'use client'

// Send-to-Edge view — the Liberty-only wholesale sub-tab that
// composes inventory CSVs + photo bundles and emails them to Mary
// at The Edge. Three internal tabs:
//
//   - Compose  : filter + select inventory items → open the send modal
//   - History  : past batches with re-view link + resend
//   - Settings : edit the to/cc/bcc recipient list
//
// All server work is in /api/wholesale/edge/* — this file is purely
// the UI and orchestration.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type {
  InventoryItem, EdgeBatch, EdgeRecipient, InventoryCategory,
} from '@/types/wholesale'
import { fmtMoneyCents, dollarsToCents } from '@/lib/wholesale/format'
import { Modal } from './InventoryView'

/** Helper: get the current Supabase session token for API auth headers.
 *  Matches the pattern used elsewhere in the wholesale module
 *  (e.g. InventoryView's rapnetLookup, ReportsView). */
async function getAuthToken(): Promise<string> {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token || ''
}

type SubTab = 'compose' | 'history' | 'settings'

export default function EdgeSendView() {
  const { brand } = useApp()
  const [sub, setSub] = useState<SubTab>('compose')

  if (brand !== 'liberty') {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
        Send to Edge is a Liberty-only feature.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['compose', 'history', 'settings'] as SubTab[]).map(t => {
          const sel = sub === t
          return (
            <button key={t} onClick={() => setSub(t)}
              style={{
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                padding: '6px 14px', border: '1px solid var(--cream2)', borderRadius: 6,
                background: sel ? 'var(--green-dark)' : '#fff',
                color: sel ? '#fff' : 'var(--ink)',
                cursor: 'pointer',
              }}>
              {t === 'compose' ? '🚀 Compose' : t === 'history' ? '📜 History' : '⚙️ Settings'}
            </button>
          )
        })}
      </div>

      {sub === 'compose'  && <ComposeTab />}
      {sub === 'history'  && <HistoryTab />}
      {sub === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// COMPOSE
// ─────────────────────────────────────────────────────────────────

function ComposeTab() {
  const { brand } = useApp()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [vendorsById, setVendorsById] = useState<Record<string, { id: string; company_name: string }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recentItemIds, setRecentItemIds] = useState<Set<string>>(new Set())

  // Filters
  const [vendorFilter, setVendorFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<'' | InventoryCategory>('')
  const [search, setSearch] = useState('')
  const [edgeMin, setEdgeMin] = useState('')
  const [edgeMax, setEdgeMax] = useState('')
  const [costMin, setCostMin] = useState('')
  const [costMax, setCostMax] = useState('')
  const [hideAlreadySent, setHideAlreadySent] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [composeOpen, setComposeOpen] = useState(false)

  useEffect(() => {
    if (!brand) return
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      // Inventory: in_stock items with an Edge price set, brand-scoped.
      const { data: rows, error: e } = await supabase.from('inventory_items')
        .select('*')
        .eq('brand', brand)
        .eq('status', 'in_stock')
        .not('edge_price_cents', 'is', null)
        .is('archived_at', null)
        .order('item_number', { ascending: true })
        .limit(2000)
      if (cancelled) return
      if (e) { setError(e.message); setLoading(false); return }
      setItems((rows || []) as any)

      // Vendor name lookup (cheap; one query per render).
      const vendorIds = Array.from(new Set((rows || []).map((r: any) => r.vendor_id).filter(Boolean)))
      if (vendorIds.length) {
        const { data: vs } = await supabase.from('wholesale_vendors')
          .select('id, company_name').in('id', vendorIds)
        if (!cancelled && vs) {
          const map: Record<string, any> = {}
          for (const v of vs as any[]) map[v.id] = v
          setVendorsById(map)
        }
      }

      // Recent batches → recent item ids (for the "already sent" badge).
      try {
        const token = await getAuthToken()
        const r = await fetch(`/api/wholesale/edge/batch?brand=${brand}&limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await r.json()
        if (!cancelled && j?.recentItemIds) {
          setRecentItemIds(new Set(j.recentItemIds as string[]))
        }
      } catch { /* non-fatal */ }

      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [brand])

  const filtered = useMemo(() => {
    const edgeMinC = dollarsToCents(edgeMin)
    const edgeMaxC = dollarsToCents(edgeMax)
    const costMinC = dollarsToCents(costMin)
    const costMaxC = dollarsToCents(costMax)
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (vendorFilter && it.vendor_id !== vendorFilter) return false
      if (categoryFilter && it.category !== categoryFilter) return false
      if (hideAlreadySent && recentItemIds.has(it.id)) return false
      const ep = it.edge_price_cents ?? null
      if (edgeMinC != null && (ep == null || ep < edgeMinC)) return false
      if (edgeMaxC != null && (ep == null || ep > edgeMaxC)) return false
      const c = it.cost_cents ?? null
      if (costMinC != null && (c == null || c < costMinC)) return false
      if (costMaxC != null && (c == null || c > costMaxC)) return false
      if (q) {
        const hay = [it.item_number, it.public_notes, it.vendor_stock_number, it.jewelry_designer]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, vendorFilter, categoryFilter, hideAlreadySent, recentItemIds, edgeMin, edgeMax, costMin, costMax, search])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  function selectAllFiltered() {
    setSelected(new Set(filtered.map(f => f.id)))
  }
  function clearSelection() { setSelected(new Set()) }

  const selectedItems = useMemo(() => items.filter(i => selected.has(i.id)), [items, selected])
  const totalCost = selectedItems.reduce((a, i) => a + (i.cost_cents || 0), 0)
  const totalEdge = selectedItems.reduce((a, i) => a + (i.edge_price_cents || 0), 0)

  const vendors = useMemo(() => Object.values(vendorsById).sort((a, b) => a.company_name.localeCompare(b.company_name)), [vendorsById])

  return (
    <div>
      {/* Filters */}
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <FilterField label="Search">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="SKU, notes, designer…" style={inputStyle} />
          </FilterField>
          <FilterField label="Vendor">
            <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} style={inputStyle}>
              <option value="">All vendors</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Category">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as any)} style={inputStyle}>
              <option value="">All</option>
              <option value="jewelry">Jewelry</option>
              <option value="watch">Watch</option>
              <option value="diamond">Diamond</option>
            </select>
          </FilterField>
          <FilterField label="Edge $ min">
            <input type="text" inputMode="decimal" value={edgeMin} onChange={e => setEdgeMin(e.target.value)} style={inputStyle} />
          </FilterField>
          <FilterField label="Edge $ max">
            <input type="text" inputMode="decimal" value={edgeMax} onChange={e => setEdgeMax(e.target.value)} style={inputStyle} />
          </FilterField>
          <FilterField label="Cost $ min">
            <input type="text" inputMode="decimal" value={costMin} onChange={e => setCostMin(e.target.value)} style={inputStyle} />
          </FilterField>
          <FilterField label="Cost $ max">
            <input type="text" inputMode="decimal" value={costMax} onChange={e => setCostMax(e.target.value)} style={inputStyle} />
          </FilterField>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={hideAlreadySent} onChange={e => setHideAlreadySent(e.target.checked)} />
            Hide items sent to Edge in last 90 days
          </label>
          <button onClick={selectAllFiltered} className="btn-outline btn-xs">Select all filtered ({filtered.length})</button>
          <button onClick={clearSelection} className="btn-outline btn-xs" disabled={selected.size === 0}>Clear selection</button>
        </div>
      </div>

      {error && <div className="card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>
          {items.length === 0
            ? 'No Edge-ready items yet. Set an Edge price on an in-stock item to make it sendable.'
            : 'Nothing matches the current filters.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: 'var(--cream2)' }}>
              <tr>
                <Th style={{ width: 32 }}></Th>
                <Th>SKU</Th>
                <Th>Description / Notes</Th>
                <Th>Vendor</Th>
                <Th>Cost</Th>
                <Th>Edge $</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => {
                const sel = selected.has(it.id)
                const recentlySent = recentItemIds.has(it.id)
                return (
                  <tr key={it.id} style={{ borderTop: '1px solid #eee', background: sel ? '#FEF6E1' : '#fff' }}>
                    <td style={tdCenter}>
                      <input type="checkbox" checked={sel} onChange={() => toggle(it.id)} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{it.item_number}</div>
                      {recentlySent && (
                        <div style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>sent recently</div>
                      )}
                    </td>
                    <td style={td}>
                      <div>{it.public_notes || itemAutoLabel(it)}</div>
                      {it.jewelry_designer && <div style={{ fontSize: 11, color: '#6b7280' }}>{it.jewelry_designer}</div>}
                    </td>
                    <td style={td}>{vendorsById[it.vendor_id || '']?.company_name || '—'}</td>
                    <td style={tdNum}>{fmtMoneyCents(it.cost_cents)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: '#1D6B44' }}>{fmtMoneyCents(it.edge_price_cents)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky footer */}
      <div style={{
        position: 'sticky', bottom: 0, marginTop: 12,
        background: '#fff', borderTop: '2px solid var(--green-dark)',
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        borderRadius: 10, boxShadow: '0 -2px 8px rgba(0,0,0,.04)',
      }}>
        <div style={{ fontWeight: 700 }}>
          {selected.size} selected
          {selected.size > 0 && <>
            &nbsp;·&nbsp; Cost {fmtMoneyCents(totalCost)}
            &nbsp;·&nbsp; Edge total <span style={{ color: '#1D6B44' }}>{fmtMoneyCents(totalEdge)}</span>
          </>}
        </div>
        <div style={{ flex: 1 }} />
        <button
          disabled={selected.size === 0}
          onClick={() => setComposeOpen(true)}
          className="btn-primary"
          style={{ padding: '10px 22px', fontWeight: 700 }}
        >
          🚀 Send {selected.size > 0 ? `${selected.size} items` : ''} to The Edge
        </button>
      </div>

      {composeOpen && (
        <SendComposer
          items={selectedItems}
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); setSelected(new Set()) }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// SEND COMPOSER MODAL
// ─────────────────────────────────────────────────────────────────

function SendComposer({ items, onClose, onSent }: { items: InventoryItem[]; onClose: () => void; onSent: () => void }) {
  const { brand } = useApp()
  const [recipients, setRecipients] = useState<EdgeRecipient[]>([])
  const [recipLoading, setRecipLoading] = useState(true)
  const [toEmail, setToEmail] = useState('')
  const [toName, setToName] = useState('')
  const [ccCsv, setCcCsv] = useState('')   // comma-separated
  const [bccCsv, setBccCsv] = useState('')
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ batchCode: string; batchUrl: string; photoCount: number } | null>(null)

  useEffect(() => {
    setRecipLoading(true)
    ;(async () => {
      try {
        const token = await getAuthToken()
        const r = await fetch(`/api/wholesale/edge/recipients?brand=${brand}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await r.json()
        const list: EdgeRecipient[] = j.recipients || []
        setRecipients(list)
        const def = list.find(x => x.role === 'to' && x.is_default) || list.find(x => x.role === 'to')
        if (def) { setToEmail(def.email); setToName(def.name || '') }
        setCcCsv(list.filter(x => x.role === 'cc').map(x => x.email).join(', '))
        setBccCsv(list.filter(x => x.role === 'bcc').map(x => x.email).join(', '))
      } catch (e: any) {
        setError(e?.message || 'Could not load recipients')
      } finally {
        setRecipLoading(false)
      }
    })()
  }, [brand])

  async function send() {
    if (!toEmail.trim()) { setError('Recipient email required'); return }
    setSending(true); setError(null)
    try {
      const ccList = ccCsv.split(',').map(s => s.trim()).filter(Boolean)
      const bccList = bccCsv.split(',').map(s => s.trim()).filter(Boolean)
      const token = await getAuthToken()
      const r = await fetch('/api/wholesale/edge/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          brand,
          item_ids: items.map(i => i.id),
          recipient_email: toEmail.trim(),
          recipient_name: toName.trim() || null,
          cc_emails: ccList,
          bcc_emails: bccList,
          notes: notes.trim() || null,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setError(j.error || j.emailError || `Send failed (${r.status})`)
        setSending(false)
        return
      }
      setResult({
        batchCode: j.batch?.batch_code || '',
        batchUrl: j.batchUrl,
        photoCount: j.photoCount,
      })
      setSending(false)
    } catch (e: any) {
      setError(e?.message || 'Network error')
      setSending(false)
    }
  }

  if (result) {
    return (
      <Modal onClose={() => { onSent() }} title="Sent ✓">
        <div style={{ padding: 8 }}>
          <p>Sent <strong>{items.length} item{items.length === 1 ? '' : 's'}</strong> ({result.photoCount} photos) to {toEmail}.</p>
          <p style={{ fontFamily: 'monospace', fontSize: 13, background: '#FAF8F4', padding: 8, borderRadius: 6, margin: '12px 0' }}>
            {result.batchCode}
          </p>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            Public batch page:{' '}
            <a href={result.batchUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1D6B44', fontWeight: 700 }}>
              {result.batchUrl}
            </a>
          </p>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" onClick={() => onSent()}>Done</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} title={`Send ${items.length} item${items.length === 1 ? '' : 's'} to The Edge`} wide>
      <div style={{ padding: 8 }}>
        {recipLoading ? (
          <div style={{ color: 'var(--mist)' }}>Loading recipients…</div>
        ) : (
          <>
            <Row>
              <Field label="To email">
                <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="To name (optional)">
                <input type="text" value={toName} onChange={e => setToName(e.target.value)} style={inputStyle} />
              </Field>
            </Row>
            <Row>
              <Field label="CC (comma-separated)">
                <input type="text" value={ccCsv} onChange={e => setCcCsv(e.target.value)} style={inputStyle} />
              </Field>
            </Row>
            <Row>
              <Field label="BCC (comma-separated)">
                <input type="text" value={bccCsv} onChange={e => setBccCsv(e.target.value)} style={inputStyle} />
              </Field>
            </Row>
            <Row>
              <Field label="Notes (optional — appears in email + on batch page)">
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} />
              </Field>
            </Row>

            <div style={{ marginTop: 14, fontSize: 13, color: '#374151', background: '#FAF8F4', padding: 12, borderRadius: 8 }}>
              <strong>{items.length}</strong> items, <strong>{fmtMoneyCents(items.reduce((a, i) => a + (i.edge_price_cents || 0), 0))}</strong> Edge total
            </div>

            {error && <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>{error}</div>}

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn-outline" onClick={onClose} disabled={sending}>Cancel</button>
              <button className="btn-primary" onClick={send} disabled={sending}>
                {sending ? 'Sending…' : '🚀 Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────

function HistoryTab() {
  const { brand } = useApp()
  const [batches, setBatches] = useState<EdgeBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!brand) return
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const token = await getAuthToken()
        const r = await fetch(`/api/wholesale/edge/batch?brand=${brand}&limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Load failed')
        setBatches((j.batches || []) as EdgeBatch[])
      } catch (e: any) { setError(e?.message || 'Load failed') }
      finally { setLoading(false) }
    })()
  }, [brand])

  if (loading) return <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>Loading history…</div>
  if (error) return <div className="card" style={{ padding: 12, background: '#fee2e2', color: '#991b1b' }}>{error}</div>
  if (batches.length === 0) {
    return <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>No batches yet — switch to Compose to send the first one.</div>
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: 'var(--cream2)' }}>
          <tr>
            <Th>Batch code</Th>
            <Th>Sent</Th>
            <Th>Recipient</Th>
            <Th>Items / Photos</Th>
            <Th>Status</Th>
            <Th>Link</Th>
          </tr>
        </thead>
        <tbody>
          {batches.map(b => {
            const url = typeof window !== 'undefined' ? `${window.location.origin}/edge/${b.public_token}` : `/edge/${b.public_token}`
            return (
              <tr key={b.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.batch_code}</span></td>
                <td style={td}>{b.sent_at ? new Date(b.sent_at).toLocaleString() : '—'}</td>
                <td style={td}>{b.recipient_name || ''} <span style={{ color: '#6b7280' }}>&lt;{b.recipient_email}&gt;</span></td>
                <td style={td}>{b.item_count} / {b.photo_count}</td>
                <td style={td}><StatusPill status={b.status} /></td>
                <td style={td}>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#1D6B44', fontWeight: 700 }}>Open</a>
                  {' · '}
                  <button onClick={() => navigator.clipboard.writeText(url)} className="btn-outline btn-xs">Copy</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    draft:   { bg: '#E5E7EB', fg: '#374151', label: 'Draft' },
    sent:    { bg: '#D1FAE5', fg: '#065F46', label: 'Sent' },
    viewed:  { bg: '#DBEAFE', fg: '#1E40AF', label: 'Viewed' },
    failed:  { bg: '#FEE2E2', fg: '#991B1B', label: 'Failed' },
    revoked: { bg: '#FEF3C7', fg: '#92400E', label: 'Revoked' },
  }
  const s = map[status] || { bg: '#F3F4F6', fg: '#374151', label: status }
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS (recipients)
// ─────────────────────────────────────────────────────────────────

function SettingsTab() {
  const { brand } = useApp()
  const [list, setList] = useState<EdgeRecipient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // new-recipient form state
  const [nEmail, setNEmail] = useState('')
  const [nName, setNName] = useState('')
  const [nRole, setNRole] = useState<'to' | 'cc' | 'bcc'>('to')

  async function reload() {
    setLoading(true); setError(null)
    try {
      const token = await getAuthToken()
      const r = await fetch(`/api/wholesale/edge/recipients?brand=${brand}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Load failed')
      setList((j.recipients || []) as EdgeRecipient[])
    } catch (e: any) { setError(e?.message || 'Load failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (brand) reload() }, [brand])

  async function addRecipient() {
    if (!nEmail.trim()) return
    const token = await getAuthToken()
    const r = await fetch('/api/wholesale/edge/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ brand, email: nEmail.trim(), name: nName.trim() || null, role: nRole }),
    })
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Add failed'); return }
    setNEmail(''); setNName(''); setNRole('to')
    reload()
  }

  async function patch(id: string, body: any) {
    const token = await getAuthToken()
    const r = await fetch(`/api/wholesale/edge/recipients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (r.ok) reload()
    else { const j = await r.json().catch(() => ({})); setError(j.error || 'Update failed') }
  }

  async function archive(id: string) {
    if (!confirm('Remove this recipient? Past batches are unaffected.')) return
    const token = await getAuthToken()
    const r = await fetch(`/api/wholesale/edge/recipients/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.ok) reload()
    else { const j = await r.json().catch(() => ({})); setError(j.error || 'Remove failed') }
  }

  return (
    <div>
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Add recipient</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="email" placeholder="email@example.com" value={nEmail} onChange={e => setNEmail(e.target.value)} style={{ ...inputStyle, minWidth: 220 }} />
          <input type="text" placeholder="Name (optional)" value={nName} onChange={e => setNName(e.target.value)} style={{ ...inputStyle, minWidth: 180 }} />
          <select value={nRole} onChange={e => setNRole(e.target.value as any)} style={inputStyle}>
            <option value="to">To</option>
            <option value="cc">CC</option>
            <option value="bcc">BCC</option>
          </select>
          <button className="btn-primary" onClick={addRecipient}>Add</button>
        </div>
      </div>

      {error && <div className="card" style={{ padding: 12, background: '#fee2e2', color: '#991b1b', marginBottom: 12 }}>{error}</div>}

      {loading ? <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: 'var(--cream2)' }}>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Default</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>{r.email}</td>
                  <td style={td}>{r.name || '—'}</td>
                  <td style={td}>
                    <select value={r.role} onChange={e => patch(r.id, { role: e.target.value })} style={inputStyle}>
                      <option value="to">To</option>
                      <option value="cc">CC</option>
                      <option value="bcc">BCC</option>
                    </select>
                  </td>
                  <td style={td}>
                    {r.role === 'to' ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={r.is_default} onChange={e => patch(r.id, { is_default: e.target.checked })} />
                        default
                      </label>
                    ) : <span style={{ color: '#9CA3AF' }}>—</span>}
                  </td>
                  <td style={td}>
                    <button className="btn-outline btn-xs" onClick={() => archive(r.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td style={td} colSpan={5}><span style={{ color: 'var(--mist)' }}>No recipients yet — add one above.</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Small UI bits
// ─────────────────────────────────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: '#374151' }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
      {children}
    </label>
  )
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 10 }}>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
      <span style={{ color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}
function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, fontSize: 12, ...style }}>{children}</th>
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 13, padding: '6px 8px',
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
}
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' }
const tdCenter: React.CSSProperties = { ...td, textAlign: 'center' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

function itemAutoLabel(it: InventoryItem): string {
  if (it.category === 'watch') return [it.watch_brand, it.watch_model].filter(Boolean).join(' ') || it.item_number
  if (it.category === 'diamond') return [it.diamond_carat ? `${it.diamond_carat}ct` : null, it.diamond_shape, it.diamond_color, it.diamond_clarity].filter(Boolean).join(' ') || it.item_number
  return [it.jewelry_metal_karat, it.jewelry_metal_color, it.jewelry_metal_type, it.jewelry_type].filter(Boolean).join(' ') || it.item_number
}
