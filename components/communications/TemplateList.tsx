'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CommunicationTemplate } from '@/types'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  canEdit: boolean
  onOpen: (t: CommunicationTemplate) => void
}

export default function TemplateList({ canEdit, onOpen }: Props) {
  const [rows, setRows] = useState<CommunicationTemplate[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)

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


  const visible = rows.filter(r => showArchived || r.is_active)

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading templates…</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Checkbox
          checked={showArchived}
          onChange={setShowArchived}
          size={16}
          label="Show archived"
          labelStyle={{ fontSize: 12, color: 'var(--mist)' }}
        />
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
            display: 'grid', gridTemplateColumns: '1.5fr 2fr 140px 100px 100px',
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
              display: 'grid', gridTemplateColumns: '1.5fr 2fr 140px 100px 100px',
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
              <div style={{ textAlign: 'right' }}>
                <button onClick={() => onOpen(t)} className="btn-outline btn-xs">
                  {canEdit ? 'Edit' : 'View'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
