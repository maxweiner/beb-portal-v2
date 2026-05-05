'use client'

// Per-trunk-show Communications section.
//
// Renders inside TrunkShowDetail as a collapsible block (the
// existing TrunkShowDetail page uses inline collapse, not tabs).
// Lists every communication_sends row for this show, most-recent
// first, with View PDF / View email / Resend actions per row.
//
// Resend deep-links into the Trunk Communications module's send
// flow via setCommsSendIntent — we don't re-implement send-flow
// here, just navigate.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'
import type { CommunicationSend } from '@/types'

interface Props {
  trunkShowId: string
  setNav?: (n: NavPage) => void
}

interface SendRow extends CommunicationSend {
  template_name: string | null
  sender_name: string | null
}

export default function TrunkShowCommsSection({ trunkShowId, setNav }: Props) {
  const { setCommsSendIntent } = useApp()
  const [open, setOpen] = useState(true)
  const [rows, setRows] = useState<SendRow[]>([])
  const [loading, setLoading] = useState(true)
  const [emailModal, setEmailModal] = useState<SendRow | null>(null)

  async function reload() {
    setLoading(true)
    const { data } = await supabase
      .from('communication_sends')
      .select(`
        id, trunk_show_id, template_id, schedule_id,
        sent_by_user_id, sent_at,
        from_email, from_name, to_email, to_name,
        subject_line_rendered, body_rendered,
        pdf_url, resend_message_id,
        delivery_status, delivery_status_updated_at,
        created_at,
        template:communication_templates(name),
        sender:users(name)
      `)
      .eq('trunk_show_id', trunkShowId)
      .order('sent_at', { ascending: false })
    setRows((data || []).map((r: any) => ({
      ...r,
      template_name: Array.isArray(r.template) ? r.template[0]?.name : r.template?.name,
      sender_name:   Array.isArray(r.sender)   ? r.sender[0]?.name   : r.sender?.name,
    })) as SendRow[])
    setLoading(false)
  }
  useEffect(() => { reload() }, [trunkShowId])

  async function viewPdf(sendId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/communications/sends/${sendId}/pdf-url`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.url) { alert(json.error || 'No PDF on file for this send'); return }
    window.open(json.url, '_blank')
  }

  function resend(row: SendRow) {
    if (!row.template_id) { alert('Original template was deleted; cannot resend.'); return }
    setCommsSendIntent({ trunkShowId: row.trunk_show_id, templateId: row.template_id })
    setNav?.('trunk-communications')
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          fontFamily: 'inherit', cursor: 'pointer', padding: 0,
        }}
      >
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: 0 }}>
          <span>📨 Communications {rows.length > 0 && <span style={{ color: 'var(--mist)', fontWeight: 600 }}>· {rows.length}</span>}</span>
          <span style={{ fontSize: 11, color: 'var(--mist)' }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {loading ? (
            <div style={{ color: 'var(--mist)', fontSize: 12, padding: '8px 0' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mist)', padding: '12px 0', textAlign: 'center' }}>
              No letters sent for this trunk show yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map(r => <Row key={r.id} row={r} onViewPdf={() => viewPdf(r.id)} onViewEmail={() => setEmailModal(r)} onResend={() => resend(r)} />)}
            </div>
          )}
        </div>
      )}

      {emailModal && <EmailModal row={emailModal} onClose={() => setEmailModal(null)} />}
    </div>
  )
}

function Row({
  row, onViewPdf, onViewEmail, onResend,
}: {
  row: SendRow
  onViewPdf: () => void
  onViewEmail: () => void
  onResend: () => void
}) {
  const statusColor: Record<string, { bg: string; fg: string }> = {
    sent:      { bg: '#e0e7ff', fg: '#1e40af' },
    delivered: { bg: '#dcfce7', fg: '#065f46' },
    bounced:   { bg: '#fdecea', fg: '#7a1f0f' },
    failed:    { bg: '#fdecea', fg: '#7a1f0f' },
  }
  const c = statusColor[row.delivery_status] || statusColor.sent

  return (
    <div style={{
      background: 'var(--cream2)', borderRadius: 8, padding: '10px 12px',
      display: 'grid', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.template_name || '(deleted template)'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            {new Date(row.sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {' · by '}{row.sender_name || row.from_name || row.from_email}
            {' · to '}{row.to_email}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
          background: c.bg, color: c.fg, textTransform: 'uppercase', letterSpacing: '.04em',
          whiteSpace: 'nowrap',
        }}>{row.delivery_status}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Subject: {row.subject_line_rendered}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {row.pdf_url && (
          <button onClick={onViewPdf} className="btn-outline btn-xs">📄 View PDF</button>
        )}
        <button onClick={onViewEmail} className="btn-outline btn-xs">✉ View email</button>
        <button onClick={onResend} className="btn-outline btn-xs">↻ Resend</button>
      </div>
    </div>
  )
}

function EmailModal({ row, onClose }: { row: SendRow; onClose: () => void }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: 18, maxWidth: 760, width: '100%',
        marginTop: 30, boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: 'var(--ink)' }}>✉ Email content</div>
          <button onClick={onClose} className="btn-outline btn-xs">Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 8 }}>
          From: <strong style={{ color: 'var(--ink)' }}>{row.from_name} {`<${row.from_email}>`}</strong>
          <br/>To: <strong style={{ color: 'var(--ink)' }}>{row.to_name ? `${row.to_name} <${row.to_email}>` : row.to_email}</strong>
          <br/>Sent: {new Date(row.sent_at).toLocaleString('en-US')}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', padding: '8px 0', borderTop: '1px solid var(--cream2)', borderBottom: '1px solid var(--cream2)' }}>
          {row.subject_line_rendered}
        </div>
        <pre style={{
          margin: '12px 0 0', padding: 0,
          fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55,
          color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{row.body_rendered}</pre>
      </div>
    </div>
  )
}
