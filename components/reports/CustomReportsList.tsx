'use client'

// v1 Custom Reports list. Renders saved reports the current user can
// see (per RLS) with search + tag filter + Run / Edit / Pin / ⋯
// actions. Pin/unpin uses the report_pins table; sidebar surfacing
// of pinned reports lands in PR C alongside the runner.
//
// New / Edit lives in CustomReportBuilder (PR B). Run lives in
// CustomReportRunner (PR C). For now Run + Edit just navigate to
// placeholder routes ('?cr=ID' and '?cr=ID&edit=1') the future
// pieces will read.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface ReportRow {
  id: string
  name: string
  description: string | null
  tags: string[] | null
  source: string
  visibility: 'global' | 'store' | 'private'
  store_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  last_run_at: string | null
}

const PIN_CAP = 5

export default function CustomReportsList() {
  const { user, users } = useApp()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [pins, setPins] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string>('')

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const reload = async () => {
    const [{ data: rs }, { data: ps }] = await Promise.all([
      supabase.from('reports').select('*').order('updated_at', { ascending: false }),
      user ? supabase.from('report_pins').select('report_id').eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ])
    setReports((rs || []) as ReportRow[])
    setPins(new Set(((ps || []) as { report_id: string }[]).map(p => p.report_id)))
    setLoaded(true)
  }
  useEffect(() => { if (user) reload() /* eslint-disable-next-line */ }, [user?.id])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    reports.forEach(r => (r.tags || []).forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [reports])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter(r => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.description || '').toLowerCase().includes(q)) return false
      if (tag && !(r.tags || []).includes(tag)) return false
      return true
    })
  }, [reports, search, tag])

  const togglePin = async (reportId: string) => {
    if (!user) return
    const isPinned = pins.has(reportId)
    if (isPinned) {
      await supabase.from('report_pins').delete().eq('user_id', user.id).eq('report_id', reportId)
      setPins(p => { const n = new Set(p); n.delete(reportId); return n })
    } else {
      if (pins.size >= PIN_CAP) {
        alert(`You already have ${PIN_CAP} pinned reports. Unpin one first.`)
        return
      }
      const { error } = await supabase.from('report_pins').insert({ user_id: user.id, report_id: reportId })
      if (error) { alert('Pin failed: ' + error.message); return }
      setPins(p => new Set(p).add(reportId))
    }
  }

  const deleteReport = async (r: ReportRow) => {
    if (!confirm(`Delete report "${r.name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('reports').delete().eq('id', r.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    reload()
  }

  // PR B / C will replace these stubs with real navigation.
  const openRunner = (id: string) => {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    u.searchParams.set('cr', id)
    window.history.pushState({}, '', u.toString())
    alert('Custom report runner ships in PR C. The list + builder are wired up in PRs A + B; this row will then load the report instead of alerting.')
  }
  const openEditor = (id: string) => {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    u.searchParams.set('cr', id)
    u.searchParams.set('edit', '1')
    window.history.pushState({}, '', u.toString())
    alert('Custom report builder ships in PR B.')
  }
  const openNew = () => {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    u.searchParams.set('cr', 'new')
    window.history.pushState({}, '', u.toString())
    alert('Custom report builder ships in PR B.')
  }

  if (!isAdmin) {
    return (
      <div className="card text-center" style={{ padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div className="font-bold" style={{ color: 'var(--ink)' }}>Admins only</div>
      </div>
    )
  }

  const userNameById = (id: string | null) => id ? users.find((u: any) => u.id === id)?.name || '' : ''
  const fmtRel = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reports…"
          style={{ flex: 1, minWidth: 180, fontSize: 13 }}
        />
        {allTags.length > 0 && (
          <select value={tag} onChange={e => setTag(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button onClick={openNew} className="btn-primary btn-sm">+ New report</button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--cream2)', borderBottom: '2px solid var(--pearl)' }}>
              {['Name', 'Source', 'Visibility', 'Last run', 'Created by', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--mist)' }}>
                {reports.length === 0
                  ? 'No custom reports yet. Click "+ New report" to build one.'
                  : 'No reports match the current filters.'}
              </td></tr>
            ) : filtered.map(r => {
              const isPinned = pins.has(r.id)
              const isOwn = r.created_by === user?.id
              const canEdit = isOwn || user?.role === 'superadmin'
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.name}</div>
                    {(r.tags && r.tags.length > 0) && (
                      <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.tags.map(t => (
                          <span key={t} style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', background: 'var(--cream2)', padding: '1px 6px', borderRadius: 4 }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--mist)', textTransform: 'capitalize' }}>{r.source}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                      background: r.visibility === 'private' ? 'var(--cream2)' : r.visibility === 'store' ? '#FEF3C7' : 'var(--green-pale)',
                      color: r.visibility === 'private' ? 'var(--mist)' : r.visibility === 'store' ? '#92400E' : 'var(--green-dark)',
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>{r.visibility}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--mist)' }}>{fmtRel(r.last_run_at)}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--mist)' }}>{userNameById(r.created_by)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => togglePin(r.id)} title={isPinned ? 'Unpin' : 'Pin to sidebar'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                        color: isPinned ? 'var(--green-dark)' : 'var(--mist)', padding: '0 6px',
                      }}>{isPinned ? '★' : '☆'}</button>
                    <button onClick={() => openRunner(r.id)} className="btn-primary btn-sm" style={{ marginLeft: 6 }}>Run</button>
                    {canEdit && (
                      <>
                        <button onClick={() => openEditor(r.id)} className="btn-outline btn-sm" style={{ marginLeft: 6 }}>Edit</button>
                        <button onClick={() => deleteReport(r)} className="btn-danger btn-sm" style={{ marginLeft: 6 }}>×</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 8 }}>
        Showing {filtered.length} of {reports.length} · {pins.size}/{PIN_CAP} pins used
      </div>
    </div>
  )
}
