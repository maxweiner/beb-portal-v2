'use client'

// Special requests on a trunk show. Sales rep adds free-text;
// office staff sees them and marks acknowledged / completed.
// Submission goes through the API route which emails active
// office-staff recipients.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  listRequests, createRequest, setRequestStatus,
  type SpecialRequest, type SpecialRequestStatus,
} from '@/lib/sales/specialRequests'

const STATUS_LABEL: Record<SpecialRequestStatus, string> = {
  open: 'Open', acknowledged: 'Acknowledged', completed: 'Completed',
}
const STATUS_COLOR: Record<SpecialRequestStatus, { bg: string; fg: string }> = {
  open:         { bg: '#FEF3C7', fg: '#92400E' },
  acknowledged: { bg: '#DBEAFE', fg: '#1E40AF' },
  completed:    { bg: '#D1FAE5', fg: '#065F46' },
}

interface Props {
  trunkShowId: string
  canWrite: boolean
}

export default function SpecialRequestsPanel({ trunkShowId, canWrite }: Props) {
  const { user, users } = useApp()
  const [rows, setRows] = useState<SpecialRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    setError(null)
    try { setRows(await listRequests(trunkShowId)) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [trunkShowId])

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const created = await createRequest(trunkShowId, text.trim())
      setRows(p => [created, ...p])
      setText('')
    } catch (err: any) {
      setError(err?.message || 'Could not save')
    }
    setBusy(false)
  }

  async function changeStatus(r: SpecialRequest, status: SpecialRequestStatus) {
    try {
      await setRequestStatus(r.id, status, user?.id || null)
      setRows(prev => prev.map(x => x.id === r.id
        ? { ...x, status, acknowledged_by: status === 'open' ? null : (user?.id || null), acknowledged_at: status === 'open' ? null : new Date().toISOString() }
        : x))
    } catch (err: any) {
      alert(err?.message || 'Could not update')
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>📣 Special Requests</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
          Anything the office should know — extra silver bags, particular paperwork, security needs. Office staff get an email when you submit.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {canWrite && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What do you need from the office?"
            rows={2}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={submit} disabled={busy || !text.trim()} className="btn-primary btn-sm">
              {busy ? 'Sending…' : 'Submit request'}
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No requests yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const sc = STATUS_COLOR[r.status]
            const author = r.created_by ? usersById.get(r.created_by) : null
            const ackBy = r.acknowledged_by ? usersById.get(r.acknowledged_by) : null
            return (
              <div key={r.id} style={{
                background: 'var(--cream)', borderRadius: 8, padding: '10px 14px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mist)' }}>
                    {author?.name || '(unknown)'} · {new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <div style={{ flex: 1 }} />
                  {canWrite && (
                    <>
                      {r.status === 'open' && (
                        <button onClick={() => changeStatus(r, 'acknowledged')} className="btn-outline btn-xs">Acknowledge</button>
                      )}
                      {r.status !== 'completed' && (
                        <button onClick={() => changeStatus(r, 'completed')} className="btn-outline btn-xs">Mark done</button>
                      )}
                      {r.status !== 'open' && (
                        <button onClick={() => changeStatus(r, 'open')} className="btn-outline btn-xs" title="Reopen">↺</button>
                      )}
                    </>
                  )}
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{r.request_text}</div>
                {ackBy && r.status !== 'open' && (
                  <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                    {r.status === 'completed' ? 'Completed' : 'Acknowledged'} by {ackBy.name} · {r.acknowledged_at ? new Date(r.acknowledged_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
