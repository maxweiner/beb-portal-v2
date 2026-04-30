'use client'

// Manage marketing_team_emails — recipients of "Notify Marketing Team"
// emails (Collected Concepts contacts + anyone else who should hear
// when a budget is set on a new campaign).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TeamEmail {
  id: string
  email: string
  name: string | null
  is_active: boolean
}

export default function TeamEmailsPanel() {
  const [rows, setRows] = useState<TeamEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('marketing_team_emails')
      .select('id, email, name, is_active').order('email')
    setRows((data ?? []) as TeamEmail[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) { alert('Enter a valid email.'); return }
    setBusy(true)
    const { error } = await supabase.from('marketing_team_emails').insert({
      email: e, name: name.trim() || null, is_active: true,
    })
    if (error) alert('Failed to add: ' + error.message)
    else { setEmail(''); setName(''); await load() }
    setBusy(false)
  }

  async function setActive(id: string, next: boolean) {
    const { error } = await supabase.from('marketing_team_emails').update({ is_active: next }).eq('id', id)
    if (error) { alert('Failed: ' + error.message); return }
    setRows(p => p.map(r => r.id === id ? { ...r, is_active: next } : r))
  }

  async function remove(id: string) {
    if (!confirm('Remove this email from the team list?')) return
    const { error } = await supabase.from('marketing_team_emails').delete().eq('id', id)
    if (error) { alert('Failed: ' + error.message); return }
    setRows(p => p.filter(r => r.id !== id))
  }

  if (loading) return <div className="card" style={{ padding: 16, color: 'var(--mist)' }}>Loading…</div>

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Team Emails</div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Recipients of the "Notify Marketing Team" email (sent when a campaign budget is set). Includes Collected Concepts contacts.
      </div>

      {/* Add row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 14 }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Name (optional)" style={{ fontSize: 13 }} />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="email@collectedconcepts.com" style={{ fontSize: 13 }} />
        <button className="btn-primary btn-sm" onClick={add} disabled={!email.trim() || busy}>
          {busy ? '…' : '+ Add'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, background: 'var(--cream2)', borderRadius: 8 }}>
          No recipients configured yet.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--cream2)' : 'none',
              background: r.is_active ? '#fff' : 'var(--cream2)',
              opacity: r.is_active ? 1 : 0.65,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {r.name || r.email}
                </div>
                {r.name && <div style={{ fontSize: 11, color: 'var(--mist)' }}>{r.email}</div>}
              </div>
              <button onClick={() => setActive(r.id, !r.is_active)} className="btn-outline btn-xs">
                {r.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => remove(r.id)} style={{
                background: 'transparent', border: 'none', color: 'var(--red)',
                cursor: 'pointer', fontSize: 16, padding: '0 4px', fontWeight: 700,
              }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
