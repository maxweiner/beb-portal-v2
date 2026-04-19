'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type Channel = 'vdp' | 'postcard' | 'newspaper'

const CHANNEL_LABELS: Record<Channel, string> = {
  vdp: '📬 VDP Mailers',
  postcard: '📮 Postcards',
  newspaper: '📰 Newspaper',
}

interface Campaign {
  id: string; event_id: string; channel: Channel
  status: string; budget: number; notes: string
  approved_by: string; approved_at: string
}

interface Proof {
  id: string; campaign_id: string; version: number
  file_url: string; file_name: string; status: string; notes: string; created_at: string
}

interface EventData {
  id: string; store_name: string; start_date: string; marketing_token: string
}

export default function VendorPortal({ params }: { params: { token: string } }) {
  const [event, setEvent] = useState<EventData | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [proofs, setProofs] = useState<Record<string, Proof[]>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<Channel>('vdp')
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    loadData()
  }, [params.token])

  const loadData = async () => {
    setLoading(true)
    // Find event by token
    const { data: ev } = await supabase
      .from('events')
      .select('id, store_name, start_date, marketing_token')
      .eq('marketing_token', params.token)
      .maybeSingle()

    if (!ev) { setNotFound(true); setLoading(false); return }
    setEvent(ev)

    // Load campaigns
    const { data: camps } = await supabase
      .from('marketing_campaigns')
      .select('*')
      .eq('event_id', ev.id)
    setCampaigns(camps || [])

    // Load proofs for each campaign
    if (camps && camps.length > 0) {
      const allProofs: Record<string, Proof[]> = {}
      for (const camp of camps) {
        const { data: p } = await supabase
          .from('marketing_proofs')
          .select('*')
          .eq('campaign_id', camp.id)
          .order('version')
        allProofs[camp.id] = p || []
      }
      setProofs(allProofs)
    }

    setLoading(false)
  }

  const uploadProof = async (file: File, campaignId: string) => {
    setUploading(true)
    setUploaded(false)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      const campProofs = proofs[campaignId] || []
      const nextVersion = (campProofs[campProofs.length - 1]?.version || 0) + 1

      const { data } = await supabase.from('marketing_proofs').insert({
        campaign_id: campaignId,
        version: nextVersion,
        file_url: dataUrl,
        file_name: file.name,
        status: 'pending',
      }).select().single()

      if (data) {
        setProofs(p => ({ ...p, [campaignId]: [...(p[campaignId] || []), data] }))
        // Update campaign status to proof_pending
        await supabase.from('marketing_campaigns')
          .update({ status: 'proof_pending' })
          .eq('id', campaignId)
        setCampaigns(p => p.map(c => c.id === campaignId ? { ...c, status: 'proof_pending' } : c))
      }

      setUploading(false)
      setUploaded(true)
      setTimeout(() => setUploaded(false), 4000)
    }
    reader.readAsDataURL(file)
  }

  const campaign = campaigns.find(c => c.channel === selectedChannel)
  const campProofs = campaign ? (proofs[campaign.id] || []) : []
  const approvedProof = campProofs.find(p => p.status === 'approved')
  const latestProof = campProofs[campProofs.length - 1]

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f0e8' }}>
      <div style={{ textAlign: 'center', color: '#666' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <div style={{ fontWeight: 700 }}>Loading portal…</div>
      </div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f0e8' }}>
      <div style={{ textAlign: 'center', color: '#666', maxWidth: 400, padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
        <div style={{ fontWeight: 900, fontSize: 20, color: '#1a1a1a', marginBottom: 8 }}>Portal Not Found</div>
        <div style={{ fontSize: 14 }}>This link may be invalid or expired. Please contact Beneficial Estate Buyers for a new link.</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f5f0e8', fontFamily: 'Lato, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#2D3B2D', padding: '20px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
              Beneficial Estate Buyers · Vendor Portal
            </div>
            <div style={{ color: '#fff', fontSize: 20, fontWeight: 900 }}>◆ {event?.store_name}</div>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, marginTop: 2 }}>
              Event: {event?.start_date ? new Date(event.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
            </div>
          </div>
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12, textAlign: 'right' }}>
            <div>Proof Upload Portal</div>
            <div>No login required</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>

        {/* Instructions */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid #e8e0d0' }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#1a1a1a', marginBottom: 8 }}>📋 How to Submit a Proof</div>
          <ol style={{ fontSize: 14, color: '#555', lineHeight: 2, paddingLeft: 20, margin: 0 }}>
            <li>Select the campaign type below (VDP, Postcards, or Newspaper)</li>
            <li>Drag and drop your proof file or click to browse</li>
            <li>Upload — we'll review and respond with approval or edit notes</li>
            <li>If edits are needed, upload a new version here</li>
          </ol>
        </div>

        {/* Channel selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {(['vdp', 'postcard', 'newspaper'] as Channel[]).map(ch => {
            const camp = campaigns.find(c => c.channel === ch)
            const hasApproved = camp ? (proofs[camp.id] || []).some(p => p.status === 'approved') : false
            return (
              <button key={ch} onClick={() => setSelectedChannel(ch)} style={{
                padding: '10px 20px', borderRadius: 99, cursor: 'pointer',
                background: selectedChannel === ch ? '#2D3B2D' : '#fff',
                color: selectedChannel === ch ? '#fff' : '#555',
                fontWeight: 700, fontSize: 14, transition: 'all .15s',
                border: `1px solid ${selectedChannel === ch ? '#2D3B2D' : '#e8e0d0'}`,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {CHANNEL_LABELS[ch]}
                {hasApproved && <span style={{ fontSize: 10, background: '#22c55e', color: '#fff', padding: '1px 6px', borderRadius: 99 }}>Approved</span>}
              </button>
            )
          })}
        </div>

        {campaign && (
          <>
            {/* Edit notes from team */}
            {latestProof?.status === 'needs_edits' && latestProof.notes && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 900, color: '#dc2626', marginBottom: 8, fontSize: 14 }}>✎ Edit Request from Beneficial Estate Buyers</div>
                <div style={{ fontSize: 14, color: '#7f1d1d', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{latestProof.notes}</div>
                <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8, opacity: .7 }}>
                  Please upload a revised version addressing these notes below.
                </div>
              </div>
            )}

            {/* Approved notice */}
            {approvedProof && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 900, color: '#16a34a', fontSize: 14 }}>✅ Proof Approved — Version {approvedProof.version}</div>
                <div style={{ fontSize: 13, color: '#166534', marginTop: 4 }}>This proof has been approved. No further action needed for this campaign.</div>
              </div>
            )}

            {/* Upload zone */}
            {!approvedProof && (
              <div
                ref={dropRef}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragging(false)
                  const files = Array.from(e.dataTransfer.files)
                  if (files[0]) uploadProof(files[0], campaign.id)
                }}
                onClick={() => !uploading && fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? '#2D3B2D' : '#ccc'}`,
                  borderRadius: 16, padding: '48px 24px', textAlign: 'center',
                  cursor: uploading ? 'wait' : 'pointer',
                  background: dragging ? 'rgba(45,59,45,.04)' : '#fff',
                  transition: 'all .15s', marginBottom: 24,
                }}>
                {uploading ? (
                  <>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
                    <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 16 }}>Uploading proof…</div>
                    <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Please wait</div>
                  </>
                ) : uploaded ? (
                  <>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                    <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 16 }}>Proof uploaded successfully!</div>
                    <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Beneficial Estate Buyers will review and respond shortly.</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
                    <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 16, marginBottom: 6 }}>
                      {dragging ? 'Drop to upload proof' : 'Drag & drop your proof here'}
                    </div>
                    <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>or click to browse · PDF or image files</div>
                    <div style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 99, background: '#2D3B2D', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                      Choose File
                    </div>
                    {campProofs.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                        This will upload as Version {(campProofs[campProofs.length - 1]?.version || 0) + 1}
                      </div>
                    )}
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) uploadProof(e.target.files[0], campaign.id) }} />
              </div>
            )}

            {/* Proof history */}
            {campProofs.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e0d0', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e8e0d0', fontWeight: 900, fontSize: 14, color: '#1a1a1a' }}>
                  Proof History
                </div>
                {campProofs.map((proof, i) => (
                  <div key={proof.id} style={{ padding: '14px 18px', borderBottom: i < campProofs.length - 1 ? '1px solid #f0ebe0' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: proof.notes ? 8 : 0 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: proof.status === 'approved' ? '#22c55e' : proof.status === 'needs_edits' ? '#ef4444' : '#f59e0b'
                      }} />
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a', flex: 1 }}>
                        Version {proof.version} — {proof.file_name}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: proof.status === 'approved' ? '#16a34a' : proof.status === 'needs_edits' ? '#dc2626' : '#d97706' }}>
                        {proof.status === 'approved' ? '✅ Approved' : proof.status === 'needs_edits' ? '✎ Needs Edits' : '⏳ Pending Review'}
                      </span>
                      <span style={{ fontSize: 11, color: '#888' }}>{new Date(proof.created_at).toLocaleDateString()}</span>
                    </div>
                    {proof.notes && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: proof.status === 'needs_edits' ? '#fef2f2' : '#f0fdf4', fontSize: 13, color: proof.status === 'needs_edits' ? '#7f1d1d' : '#166534' }}>
                        {proof.notes}
                      </div>
                    )}
                    {proof.file_url && (
                      <div style={{ marginTop: 8 }}>
                        {proof.file_url.startsWith('data:image') ? (
                          <img src={proof.file_url} alt={proof.file_name}
                            style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid #e8e0d0', cursor: 'pointer' }}
                            onClick={() => window.open(proof.file_url, '_blank')} />
                        ) : (
                          <a href={proof.file_url} target="_blank" rel="noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: '#f5f0e8', border: '1px solid #e8e0d0', color: '#1a1a1a', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                            📄 View PDF
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #e8e0d0', padding: '20px 24px', textAlign: 'center', color: '#888', fontSize: 12, marginTop: 40 }}>
        Beneficial Estate Buyers · Vendor Portal · Questions? Contact your BEB representative.
      </div>
    </div>
  )
}
