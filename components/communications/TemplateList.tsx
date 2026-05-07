'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CommunicationTemplate } from '@/types'

interface Props {
  canEdit: boolean
  onOpen: (t: CommunicationTemplate) => void
}

export default function TemplateList({ canEdit, onOpen }: Props) {
  const [rows, setRows] = useState<CommunicationTemplate[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const { data } = await supabase
      .from('communication_templates')
      .select('*')
      .order('updated_at', { ascending: false })
    setRows((data || []) as CommunicationTemplate[])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function deleteTemplate(t: CommunicationTemplate) {
    if (!confirm(
      `🗑 Permanently delete template "${t.name}"?\n\n` +
      `This cannot be undone. Past sends already created from this template stay intact.\n\n` +
      `If you just want to stop using it, edit the template and uncheck Active instead.`,
    )) return
    setDeletingId(t.id)
    try {
      const { error } = await supabase
        .from('communication_templates')
        .delete()
        .eq('id', t.id)
      if (error) {
        alert('Delete failed: ' + error.message)
        return
      }
      setRows(prev => prev.filter(r => r.id !== t.id))
    } finally {
      setDeletingId(null)
    }
  }

  const visible = rows.filter(r => showArchived || r.is_active)

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading templates…</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mist)' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            style={{ width: 16, height: 16, padding: 0, margin: 0, appearance: 'auto', WebkitAppearance: 'checkbox' } as React.CSSProperties}
          />
          Show archived
        </label>
        <span style={{ fontSize: 12, color: 'var(--mist)' }}>{visible.length} template{visible.length === 1 ? '' : 's'}</span>
      </div>

      {visible.length === 0 ? (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 13,
        }}>
          {showArchived ? 'No templates yet.' : 'No active templates. Click "+ New Template" to create one.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.5fr 2fr 140px 100px 160px',
            background: 'var(--cream2)', padding: '8px 14px',
            fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <div>Name</div>
            <div>Subject</div>
            <div>Updated</div>
            <div>Status</div>
            <div></div>
          </div>
          {visible.map(t => (
            <div key={t.id} style={{
              display: 'grid', gridTemplateColumns: '1.5fr 2fr 140px 100px 160px',
              padding: '10px 14px', borderTop: '1px solid var(--cream2)', alignItems: 'center',
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{t.name}</div>
              <div style={{ color: 'var(--ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.subject_line}
              </div>
              <div style={{ color: 'var(--mist)', fontSize: 12 }}>
                {new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  background: t.is_active ? 'var(--green-pale)' : 'var(--cream2)',
                  color: t.is_active ? 'var(--green-dark)' : 'var(--mist)',
                }}>{t.is_active ? 'Active' : 'Archived'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => onOpen(t)} className="btn-outline btn-xs">
                  {canEdit ? 'Edit' : 'View'}
                </button>
                {canEdit && (
                  <button
                    onClick={() => deleteTemplate(t)}
                    disabled={deletingId === t.id}
                    className="btn-outline btn-xs"
                    style={{ color: '#B22234', borderColor: '#fecdd3' }}
                    title="Permanently delete this template"
                  >
                    {deletingId === t.id ? 'Deleting…' : '🗑 Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
