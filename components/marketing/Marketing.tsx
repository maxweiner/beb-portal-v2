'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/types'

type Channel = 'vdp' | 'postcard' | 'newspaper'

const CHANNEL_LABELS: Record<Channel, string> = {
  vdp: '📬 VDP',
  postcard: '📮 Postcards',
  newspaper: '📰 Newspaper',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:        { label: 'Not Started',     color: 'var(--silver)' },
  zips_submitted: { label: 'Targeting Sent',  color: '#f59e0b' },
  quote_approved: { label: 'Quote Approved',  color: '#3b82f6' },
  proof_pending:  { label: 'Proof Pending',   color: '#f59e0b' },
  proof_approved: { label: 'Proof Approved',  color: 'var(--green)' },
  complete:       { label: 'Complete',         color: 'var(--green)' },
}

interface Campaign {
  id: string; event_id: string; channel: Channel
  status: string; budget: number; notes: string
  approved_by: string; approved_at: string; created_at: string
}

interface Zip { id: string; campaign_id: string; zip_code: string; city: string; state: string; household_count: number }
interface Proof { id: string; campaign_id: string; version: number; file_url: string; file_name: string; status: string; notes: string; created_at: string }
interface Vendor { id: string; name: string; email: string; type: string; active: boolean }

export default function Marketing() {
  const { events, stores, user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<Channel>('vdp')
  const [search, setSearch] = useState('')

  const today = new Date(); today.setHours(0,0,0,0)
  const sorted = [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const filtered = sorted.filter(ev => ev.store_name?.toLowerCase().includes(search.toLowerCase()))

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* Event list sidebar */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--pearl)', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--pearl)' }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--ink)', marginBottom: 10 }}>📣 Marketing</div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…" style={{ width: '100%', fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(ev => {
            const store = stores.find(s => s.id === ev.store_id)
            const sel = selectedEvent?.id === ev.id
            return (
              <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--cream2)',
                  background: sel ? 'var(--green-pale)' : 'transparent',
                  borderLeft: sel ? '3px solid var(--green)' : '3px solid transparent',
                }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: sel ? 'var(--green-dark)' : 'var(--ink)' }}>◆ {ev.store_name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{store?.city}, {store?.state} · {fmt(ev.start_date)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--cream2)' }}>
        {!selectedEvent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mist)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📣</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Marketing</div>
            <div style={{ fontSize: 14 }}>Select an event to manage marketing</div>
          </div>
        ) : (
          <MarketingEventView ev={selectedEvent} isAdmin={isAdmin} selectedChannel={selectedChannel} setSelectedChannel={setSelectedChannel} user={user} />
        )}
      </div>
    </div>
  )
}

function MarketingEventView({ ev, isAdmin, selectedChannel, setSelectedChannel, user }: {
  ev: Event; isAdmin: boolean
  selectedChannel: Channel; setSelectedChannel: (c: Channel) => void
  user: any
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [selectedVendors, setSelectedVendors] = useState<string[]>([])
  const [showVendorPicker, setShowVendorPicker] = useState(false)

  useEffect(() => {
    loadData()
  }, [ev.id])

  const loadData = async () => {
    setLoading(true)
    const [{ data: camps }, { data: vends }] = await Promise.all([
      supabase.from('marketing_campaigns').select('*').eq('event_id', ev.id),
      supabase.from('marketing_vendors').select('*').eq('active', true).order('name'),
    ])
    let campList = camps || []

    // Auto-create campaigns for each channel if missing
    const channels: Channel[] = ['vdp', 'postcard', 'newspaper']
    const missing = channels.filter(ch => !campList.find(c => c.channel === ch))
    if (missing.length > 0) {
      const { data: created } = await supabase.from('marketing_campaigns')
        .insert(missing.map(ch => ({ event_id: ev.id, channel: ch })))
        .select()
      campList = [...campList, ...(created || [])]
    }

    setCampaigns(campList)
    setVendors(vends || [])
    setLoading(false)
  }

  const [emailMessage, setEmailMessage] = useState('')

  const sendVendorEmail = async () => {
    if (selectedVendors.length === 0) { alert('Select at least one vendor.'); return }
    setSendingEmail(true)
    try {
      const res = await fetch('/api/marketing-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: ev.id,
          vendor_ids: selectedVendors,
          message: emailMessage,
        })
      })
      const data = await res.json()
      if (data.success) {
        const sent = data.results.filter((r: any) => r.status === 'sent').length
        alert(`✅ Email sent to ${sent} vendor${sent !== 1 ? 's' : ''}!`)
      } else {
        alert('Error sending email: ' + (data.error || 'Unknown error'))
      }
    } catch (err: any) {
      alert('Error: ' + err.message)
    }
    setSendingEmail(false)
    setShowVendorPicker(false)
    setSelectedVendors([])
    setEmailMessage('')
  }

  const campaign = campaigns.find(c => c.channel === selectedChannel)
  const token = (ev as any).marketing_token
  const vendorLink = token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/marketing/${token}` : ''

  if (loading) return <div style={{ padding: 40, color: 'var(--mist)' }}>Loading…</div>

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 4 }}>Marketing</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>◆ {ev.store_name}</div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {vendorLink && (
                <button className="btn-outline btn-sm" onClick={() => { navigator.clipboard.writeText(vendorLink); alert('Vendor portal link copied!') }}>
                  🔗 Copy Vendor Link
                </button>
              )}
              <button className="btn-primary btn-sm" onClick={() => setShowVendorPicker(true)}>
                📧 Email Vendors
              </button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>{ev.start_date}</div>
      </div>

      {/* Vendor email picker */}
      {showVendorPicker && (
        <div className="card" style={{ marginBottom: 20, border: '2px solid var(--green3)' }}>
          <div className="card-title">Select Vendors to Notify</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--green-dark)' }}>
              <input type="checkbox"
                checked={selectedVendors.length === vendors.length}
                onChange={() => setSelectedVendors(selectedVendors.length === vendors.length ? [] : vendors.map(v => v.id))}
                style={{ accentColor: 'var(--green)' }} />
              Select All
            </label>
            {vendors.map(v => (
              <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox"
                  checked={selectedVendors.includes(v.id)}
                  onChange={() => setSelectedVendors(p => p.includes(v.id) ? p.filter(x => x !== v.id) : [...p, v.id])}
                  style={{ accentColor: 'var(--green)' }} />
                <span style={{ fontWeight: 600 }}>{v.name}</span>
                <span style={{ color: 'var(--mist)' }}>{v.email}</span>
                <span className="badge badge-silver" style={{ fontSize: 10 }}>{v.type}</span>
              </label>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="fl">Optional Message to Vendor</label>
            <textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)}
              placeholder="Any special instructions or notes for this proof request…"
              rows={2} style={{ resize: 'none', fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" onClick={sendVendorEmail} disabled={sendingEmail}>
              {sendingEmail ? 'Sending…' : `Send to ${selectedVendors.length} vendor${selectedVendors.length !== 1 ? 's' : ''}`}
            </button>
            <button className="btn-outline btn-sm" onClick={() => { setShowVendorPicker(false); setSelectedVendors([]); setEmailMessage('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Channel tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--cream)', padding: 4, borderRadius: 'var(--r)', border: '1px solid var(--pearl)', width: 'fit-content' }}>
        {(['vdp', 'postcard', 'newspaper'] as Channel[]).map(ch => {
          const camp = campaigns.find(c => c.channel === ch)
          const status = STATUS_LABELS[camp?.status || 'pending']
          return (
            <button key={ch} onClick={() => setSelectedChannel(ch)} style={{
              padding: '8px 16px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
              background: selectedChannel === ch ? 'var(--sidebar-bg)' : 'transparent',
              color: selectedChannel === ch ? '#fff' : 'var(--ash)',
              fontWeight: 700, fontSize: 13, transition: 'all .15s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              {CHANNEL_LABELS[ch]}
              <span style={{ fontSize: 9, fontWeight: 600, color: selectedChannel === ch ? 'rgba(255,255,255,.6)' : status.color }}>
                {status.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Channel content */}
      {campaign && (
        <ChannelView
          campaign={campaign}
          channel={selectedChannel}
          ev={ev}
          isAdmin={isAdmin}
          user={user}
          vendors={vendors}
          onUpdate={(updated) => setCampaigns(p => p.map(c => c.id === updated.id ? updated : c))}
        />
      )}
    </div>
  )
}

function ChannelView({ campaign, channel, ev, isAdmin, user, vendors, onUpdate }: {
  campaign: Campaign; channel: Channel; ev: Event
  isAdmin: boolean; user: any; vendors: Vendor[]
  onUpdate: (c: Campaign) => void
}) {
  const [zips, setZips] = useState<Zip[]>([])
  const [proofs, setProofs] = useState<Proof[]>([])
  const [loading, setLoading] = useState(true)
  const [zipInput, setZipInput] = useState('')
  const [publication, setPublication] = useState(campaign.notes || '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadData()
  }, [campaign.id])

  const loadData = async () => {
    setLoading(true)
    const [{ data: z }, { data: p }] = await Promise.all([
      supabase.from('marketing_zips').select('*').eq('campaign_id', campaign.id).order('zip_code'),
      supabase.from('marketing_proofs').select('*').eq('campaign_id', campaign.id).order('version'),
    ])
    setZips(z || [])
    setProofs(p || [])
    setLoading(false)
  }

  const updateStatus = async (status: string) => {
    const { data } = await supabase.from('marketing_campaigns')
      .update({ status, approved_by: user?.name, approved_at: new Date().toISOString() })
      .eq('id', campaign.id).select().single()
    if (data) onUpdate(data)
  }

  const saveNotes = async () => {
    setSaving('notes')
    const { data } = await supabase.from('marketing_campaigns')
      .update({ notes: channel === 'newspaper' ? publication : campaign.notes })
      .eq('id', campaign.id).select().single()
    if (data) onUpdate(data)
    setSaving(null)
  }

  const parseAndSaveZips = async (text: string) => {
    // Parse zip codes from text — handles CSV, newlines, spaces, commas
    const rawZips = text.split(/[\n,\r\t\s]+/).map(z => z.trim()).filter(z => /^\d{5}$/.test(z))
    if (rawZips.length === 0) { alert('No valid 5-digit zip codes found.'); return }
    setSaving('zips')
    // Delete existing and re-insert
    await supabase.from('marketing_zips').delete().eq('campaign_id', campaign.id)
    const toInsert = rawZips.map(z => ({ campaign_id: campaign.id, zip_code: z }))
    const { data } = await supabase.from('marketing_zips').insert(toInsert).select()
    setZips(data || [])
    // Update status
    const { data: updated } = await supabase.from('marketing_campaigns')
      .update({ status: 'zips_submitted' }).eq('id', campaign.id).select().single()
    if (updated) onUpdate(updated)
    setZipInput('')
    setSaving(null)
  }

  const handleCSV = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => parseAndSaveZips(e.target?.result as string)
    reader.readAsText(file)
  }

  const uploadProof = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      const nextVersion = (proofs[proofs.length - 1]?.version || 0) + 1
      const { data } = await supabase.from('marketing_proofs').insert({
        campaign_id: campaign.id, version: nextVersion,
        file_url: dataUrl, file_name: file.name, status: 'pending',
      }).select().single()
      if (data) {
        setProofs(p => [...p, data])
        const { data: updated } = await supabase.from('marketing_campaigns')
          .update({ status: 'proof_pending' }).eq('id', campaign.id).select().single()
        if (updated) onUpdate(updated)
      }
    }
    reader.readAsDataURL(file)
  }

  const updateProof = async (proofId: string, status: string, proofNotes: string) => {
    const { data } = await supabase.from('marketing_proofs')
      .update({ status, notes: proofNotes }).eq('id', proofId).select().single()
    if (data) setProofs(p => p.map(pr => pr.id === proofId ? data : pr))
    if (status === 'approved') {
      const { data: updated } = await supabase.from('marketing_campaigns')
        .update({ status: 'proof_approved', approved_by: user?.name, approved_at: new Date().toISOString() })
        .eq('id', campaign.id).select().single()
      if (updated) onUpdate(updated)
    }
  }

  const status = STATUS_LABELS[campaign.status] || STATUS_LABELS.pending
  const approvedProof = proofs.find(p => p.status === 'approved')
  const latestProof = proofs[proofs.length - 1]

  if (loading) return <div style={{ color: 'var(--mist)', padding: 20 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Status bar */}
      <div className="card" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: status.color }} />
          <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)' }}>{CHANNEL_LABELS[channel]}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: status.color }}>{status.label}</span>
        </div>
        {campaign.approved_by && (
          <div style={{ fontSize: 12, color: 'var(--mist)' }}>
            Approved by {campaign.approved_by} · {new Date(campaign.approved_at).toLocaleDateString()}
          </div>
        )}
        {isAdmin && campaign.status === 'proof_approved' && (
          <button className="btn-primary btn-sm" onClick={() => updateStatus('complete')} style={{ marginLeft: 'auto' }}>
            ✓ Mark Complete
          </button>
        )}
      </div>

      {/* Newspaper: publication name instead of zips */}
      {channel === 'newspaper' ? (
        <div className="card card-accent" style={{ margin: 0 }}>
          <div className="card-title">Publication</div>
          <div className="field">
            <label className="fl">Publication Name</label>
            <input value={publication} onChange={e => setPublication(e.target.value)}
              placeholder="e.g. Omaha World-Herald, Sunday edition" />
          </div>
          <button className="btn-primary btn-sm" onClick={saveNotes} disabled={saving === 'notes'}>
            {saving === 'notes' ? 'Saving…' : 'Save Publication'}
          </button>
        </div>
      ) : (
        /* VDP / Postcard: zip code targeting */
        <div className="card card-accent" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>Zip Code Targeting</div>
            {zips.length > 0 && (
              <span className="badge badge-jade">{zips.length} zip codes</span>
            )}
          </div>

          {/* Existing zips */}
          {zips.length > 0 && (
            <div style={{ marginBottom: 16, maxHeight: 200, overflowY: 'auto', background: 'var(--cream)', borderRadius: 'var(--r)', padding: 12, border: '1px solid var(--pearl)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {zips.map(z => (
                  <span key={z.id} style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--green-pale)', color: 'var(--green-dark)' }}>
                    {z.zip_code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <>
              <div className="field">
                <label className="fl">Paste Zip Codes</label>
                <textarea value={zipInput} onChange={e => setZipInput(e.target.value)}
                  placeholder="Paste zip codes separated by commas, spaces, or new lines&#10;e.g. 68106, 68107, 68108"
                  rows={4} style={{ resize: 'vertical', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary btn-sm" onClick={() => parseAndSaveZips(zipInput)} disabled={saving === 'zips' || !zipInput.trim()}>
                  {saving === 'zips' ? 'Saving…' : `Save Zip Codes`}
                </button>
                <button className="btn-outline btn-sm" onClick={() => csvRef.current?.click()}>
                  📎 Upload CSV
                </button>
                <input ref={csvRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) handleCSV(e.target.files[0]) }} />
                {zips.length > 0 && isAdmin && (
                  <button className="btn-outline btn-sm" onClick={async () => {
                    if (campaign.status === 'pending') await updateStatus('zips_submitted')
                  }}>
                    {campaign.status !== 'pending' ? '✓ Targeting Sent' : 'Mark as Sent to Vendor'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Quote approval */}
      {isAdmin && (campaign.status === 'zips_submitted' || campaign.status === 'pending' || channel === 'newspaper') && (
        <div className="card card-accent" style={{ margin: 0 }}>
          <div className="card-title">Quote Approval</div>
          <div className="field">
            <label className="fl">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about the quote, any feedback or changes needed…"
              rows={3} style={{ resize: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" onClick={async () => {
              if (notes) {
                await supabase.from('marketing_campaigns').update({ notes }).eq('id', campaign.id)
              }
              await updateStatus('quote_approved')
            }}>
              ✓ Approve Quote
            </button>
          </div>
        </div>
      )}

      {/* Proof rounds */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>
            Artwork Proofs {proofs.length > 0 && <span style={{ fontSize: 12, color: 'var(--mist)', fontWeight: 400 }}>({proofs.length} version{proofs.length !== 1 ? 's' : ''})</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
              ⬆️ Upload Proof
            </button>
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) uploadProof(e.target.files[0]) }} />
          </div>
        </div>

        {proofs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--silver)', fontSize: 13 }}>
            No proofs uploaded yet. Upload a proof or share the vendor link for the vendor to submit directly.
          </div>
        )}

        {proofs.map(proof => (
          <ProofRow key={proof.id} proof={proof} isAdmin={isAdmin} onUpdate={updateProof} />
        ))}
      </div>

      {/* Final approved proof pinned */}
      {approvedProof && (
        <div className="card" style={{ margin: 0, border: '2px solid var(--green)', background: 'var(--green-pale)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 18 }}>✅</div>
            <div style={{ fontWeight: 900, color: 'var(--green-dark)' }}>Final Approved Proof — v{approvedProof.version}</div>
          </div>
          {approvedProof.file_url.startsWith('data:image') ? (
            <img src={approvedProof.file_url} alt="Approved proof"
              style={{ maxWidth: '100%', borderRadius: 'var(--r)', border: '1px solid var(--green3)', cursor: 'pointer' }}
              onClick={() => window.open(approvedProof.file_url, '_blank')} />
          ) : (
            <a href={approvedProof.file_url} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 'var(--r)', background: 'var(--green)', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
              📄 View Approved PDF
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function ProofRow({ proof, isAdmin, onUpdate }: {
  proof: Proof; isAdmin: boolean
  onUpdate: (id: string, status: string, notes: string) => void
}) {
  const [notes, setNotes] = useState(proof.notes || '')
  const [expanded, setExpanded] = useState(proof.status === 'pending')
  const [saving, setSaving] = useState(false)

  const statusColors: Record<string, string> = {
    pending: '#f59e0b', needs_edits: '#ef4444', approved: 'var(--green)'
  }
  const statusLabels: Record<string, string> = {
    pending: 'Pending Review', needs_edits: 'Needs Edits', approved: 'Approved'
  }

  return (
    <div style={{ border: '1px solid var(--pearl)', borderRadius: 'var(--r)', marginBottom: 12, overflow: 'hidden' }}>
      {/* Proof header */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
        background: 'var(--cream)', cursor: 'pointer',
        borderBottom: expanded ? '1px solid var(--pearl)' : 'none',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[proof.status] || '#ccc', flexShrink: 0 }} />
        <div style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>
          Version {proof.version} — {proof.file_name}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[proof.status] }}>
          {statusLabels[proof.status] || proof.status}
        </span>
        <div style={{ fontSize: 11, color: 'var(--mist)' }}>
          {new Date(proof.created_at).toLocaleDateString()}
        </div>
        <div style={{ fontSize: 14, color: 'var(--mist)' }}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div style={{ padding: 14 }}>
          {/* Preview */}
          {proof.file_url.startsWith('data:image') ? (
            <div style={{ marginBottom: 14 }}>
              <img src={proof.file_url} alt={proof.file_name}
                style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 'var(--r)', border: '1px solid var(--pearl)', cursor: 'pointer' }}
                onClick={() => window.open(proof.file_url, '_blank')} />
            </div>
          ) : proof.file_url ? (
            <div style={{ marginBottom: 14 }}>
              <a href={proof.file_url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--r)', background: 'var(--cream2)', border: '1px solid var(--pearl)', color: 'var(--ink)', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                📄 {proof.file_name}
              </a>
            </div>
          ) : null}

          {/* Existing notes */}
          {proof.notes && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 'var(--r)', background: proof.status === 'needs_edits' ? 'rgba(239,68,68,.08)' : 'var(--cream2)', border: `1px solid ${proof.status === 'needs_edits' ? 'rgba(239,68,68,.2)' : 'var(--pearl)'}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }}>NOTES</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{proof.notes}</div>
            </div>
          )}

          {/* Admin actions */}
          {isAdmin && proof.status !== 'approved' && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="fl">Edit Notes / Feedback</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Describe any changes needed on this proof…"
                  rows={3} style={{ resize: 'none', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary btn-sm" onClick={async () => {
                  await supabase.auth.refreshSession()
    setSaving(true)
                  await onUpdate(proof.id, 'approved', notes)
                  setSaving(false)
                }} disabled={saving}>
                  ✓ Approve Proof
                </button>
                <button className="btn-outline btn-sm" onClick={async () => {
                  if (!notes.trim()) { alert('Add edit notes before requesting changes.'); return }
                  await supabase.auth.refreshSession()
    setSaving(true)
                  await onUpdate(proof.id, 'needs_edits', notes)
                  setSaving(false)
                }} disabled={saving}>
                  ✎ Request Edits
                </button>
              </div>
            </>
          )}

          {proof.status === 'approved' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green-dark)', fontWeight: 700, fontSize: 13 }}>
              ✅ This proof is approved
            </div>
          )}
        </div>
      )}
    </div>
  )
}
