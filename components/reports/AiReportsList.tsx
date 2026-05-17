'use client'

// Top-level UI inside the renamed "Reports" tab. Shows every
// ai_reports row as a card, with controls to create / edit / delete.
// Clicking a card (or "+ New Report") drops us into AiReportEditor.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AiReportRow } from '@/lib/ai-reports/types'
import { describeSchedule } from '@/lib/ai-reports/scheduleMatch'
import AiReportEditor from './AiReportEditor'

export default function AiReportsList() {
  const [reports, setReports] = useState<AiReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AiReportRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('ai_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    setReports((data as AiReportRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function remove(report: AiReportRow) {
    if (!confirm(`Delete "${report.name}"? This cannot be undone.`)) return
    const { error: err } = await supabase.from('ai_reports').delete().eq('id', report.id)
    if (err) { setError(err.message); return }
    await load()
  }

  if (editing || creating) {
    return (
      <AiReportEditor
        report={editing}
        onClose={() => { setEditing(null); setCreating(false) }}
        onSaved={() => { setEditing(null); setCreating(false); void load() }}
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--mist)' }}>
          AI-generated reports that fire on a schedule. Each one queries current data and asks Claude to write a fresh narrative.
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
          + New Report
        </button>
      </div>

      {error && <div className="notice notice-ruby" style={{ marginBottom: 12 }}>{error}</div>}

      {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--mist)' }}>Loading…</div>}

      {!loading && reports.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 800, color: 'var(--ink)' }}>No reports yet</div>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
            Click <strong>+ New Report</strong> to create your first AI-powered scheduled report.
          </div>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {reports.map(r => <Card key={r.id} report={r} onEdit={() => setEditing(r)} onDelete={() => void remove(r)} />)}
        </div>
      )}
    </div>
  )
}

function Card({ report, onEdit, onDelete }: { report: AiReportRow; onEdit: () => void; onDelete: () => void }) {
  const brandLabel = report.brand === 'liberty' ? 'Liberty' : 'BEB'
  const brandColor = report.brand === 'liberty' ? '#1D3A6B' : '#1D6B44'
  const schedule = describeSchedule(report)
  const lastSent = report.last_sent_at
    ? new Date(report.last_sent_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : null
  const status = report.last_send_status
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } }}
      style={{
        background: '#fff',
        border: '1px solid var(--pearl)',
        borderRadius: 12,
        padding: 16,
        cursor: 'pointer',
        position: 'relative',
        transition: 'transform .1s, box-shadow .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.06)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 7px',
              borderRadius: 4, color: '#fff',
              background: brandColor,
              letterSpacing: '.05em', textTransform: 'uppercase',
            }}>{brandLabel}</span>
            {!report.active && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4, color: 'var(--mist)', background: 'var(--cream2)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Paused</span>
            )}
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{report.name}</div>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete() }}
          aria-label="Delete report"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 16, padding: 4,
          }}
        >🗑</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ash)', marginTop: 8 }}>{schedule}</div>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
        {report.recipient_user_ids.length} recipient(s) · window: {humanWindow(report.time_window)}
      </div>
      {lastSent && (
        <div style={{
          marginTop: 10, paddingTop: 8,
          borderTop: '1px solid var(--cream2)',
          fontSize: 11, color: status === 'error' ? '#DC2626' : 'var(--mist)',
        }}>
          {status === 'error' ? '⚠ Last fire failed' : '✓ Last sent'} · {lastSent}
        </div>
      )}
    </div>
  )
}

function humanWindow(w: string): string {
  switch (w) {
    case 'last_7d': return 'last 7 days'
    case 'last_30d': return 'last 30 days'
    case 'last_90d': return 'last 90 days'
    case 'current_month': return 'current month'
    default: return w
  }
}
