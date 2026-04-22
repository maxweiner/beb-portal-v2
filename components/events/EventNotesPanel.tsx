'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { isMobileDevice } from '@/lib/mobile'
import type { Event, Store, EventNote, EventNoteCategory } from '@/types'

const CATEGORIES: { key: EventNoteCategory; label: string; icon: string; color: string; bg: string }[] = [
  { key: 'worked',        label: 'What worked?',       icon: '✅', color: 'var(--green)',  bg: 'var(--green-pale)'  },
  { key: 'didnt_work',    label: "What didn't work?",  icon: '⚠️', color: 'var(--amber)',  bg: 'var(--amber-pale)' },
  { key: 'do_differently',label: 'Do differently',     icon: '💡', color: 'var(--blue)',   bg: 'var(--blue-pale)'  },
]

const CATEGORY_BY_KEY: Record<EventNoteCategory, typeof CATEGORIES[number]> =
  CATEGORIES.reduce((acc, c) => ({ ...acc, [c.key]: c }), {} as any)

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (diffSec < 60)      return rtf.format(-diffSec, 'second')
  if (diffSec < 3600)    return rtf.format(-Math.round(diffSec / 60), 'minute')
  if (diffSec < 86400)   return rtf.format(-Math.round(diffSec / 3600), 'hour')
  if (diffSec < 2592000) return rtf.format(-Math.round(diffSec / 86400), 'day')
  if (diffSec < 31536000)return rtf.format(-Math.round(diffSec / 2592000), 'month')
  return rtf.format(-Math.round(diffSec / 31536000), 'year')
}

function fmtEventDate(start_date: string): string {
  return new Date(start_date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface EventNotesPanelProps {
  event: Event
  store: Store | undefined
  onClose: () => void
  /** Fires after any save/update/delete so the parent can refresh note counts. */
  onNotesChanged?: () => void
}

export default function EventNotesPanel({ event, store, onClose, onNotesChanged }: EventNotesPanelProps) {
  const { user } = useApp()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentNotes, setCurrentNotes] = useState<EventNote[]>([])
  const [pastNotes, setPastNotes] = useState<EventNote[]>([])
  const [pastOpen, setPastOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<EventNoteCategory | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setMounted(true)
    setIsMobile(isMobileDevice())
    // Trigger the slide-in on next tick so CSS transition plays.
    const t = setTimeout(() => setEntered(true), 10)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => { loadNotes() }, [event.id, event.store_id])

  const loadNotes = async () => {
    setLoading(true)
    const [cur, past] = await Promise.all([
      supabase.from('event_notes').select('*').eq('event_id', event.id).order('created_at', { ascending: false }),
      supabase.from('event_notes').select('*').eq('store_id', event.store_id).neq('event_id', event.id).order('created_at', { ascending: false }),
    ])
    setCurrentNotes((cur.data as EventNote[]) || [])
    setPastNotes((past.data as EventNote[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    if (selectedCategory) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [selectedCategory])

  const closeWithAnim = () => {
    setEntered(false)
    setTimeout(() => onClose(), 240)
  }

  const saveNew = async () => {
    if (!user || !selectedCategory || !draft.trim()) return
    setSaving(true)
    try {
      await supabase.auth.refreshSession()
      const { data, error } = await supabase.from('event_notes').insert({
        event_id: event.id,
        store_id: event.store_id,
        user_id: user.id,
        user_name: user.name,
        category: selectedCategory,
        content: draft.trim(),
      }).select().single()
      if (error) throw error
      if (data) {
        setCurrentNotes(prev => [data as EventNote, ...prev])
        setJustSavedId((data as any).id)
        setTimeout(() => setJustSavedId(null), 1400)
      }
      setDraft('')
      setSelectedCategory(null)
      onNotesChanged?.()
    } catch (err: any) {
      alert('Failed to save note: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (n: EventNote) => {
    setEditingId(n.id)
    setEditingDraft(n.content)
  }
  const cancelEdit = () => { setEditingId(null); setEditingDraft('') }

  const saveEdit = async () => {
    if (!editingId || !editingDraft.trim()) return
    try {
      await supabase.auth.refreshSession()
      const { error } = await supabase.from('event_notes')
        .update({ content: editingDraft.trim(), updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) throw error
      setCurrentNotes(prev => prev.map(n => n.id === editingId ? { ...n, content: editingDraft.trim() } : n))
      setEditingId(null); setEditingDraft('')
      onNotesChanged?.()
    } catch (err: any) {
      alert('Failed to update: ' + (err?.message || 'unknown'))
    }
  }

  const deleteNote = async (id: string) => {
    if (!confirm('Delete this note? This can’t be undone.')) return
    try {
      await supabase.auth.refreshSession()
      const { error } = await supabase.from('event_notes').delete().eq('id', id)
      if (error) throw error
      setCurrentNotes(prev => prev.filter(n => n.id !== id))
      onNotesChanged?.()
    } catch (err: any) {
      alert('Failed to delete: ' + (err?.message || 'unknown'))
    }
  }

  // Group current notes by category for display.
  const currentByCategory = useMemo(() => {
    const g: Record<EventNoteCategory, EventNote[]> = { worked: [], didnt_work: [], do_differently: [] }
    for (const n of currentNotes) g[n.category].push(n)
    return g
  }, [currentNotes])

  // Past notes grouped by event_id, keeping event order by most recent.
  const pastByEvent = useMemo(() => {
    const map = new Map<string, EventNote[]>()
    for (const n of pastNotes) {
      if (!map.has(n.event_id)) map.set(n.event_id, [])
      map.get(n.event_id)!.push(n)
    }
    return Array.from(map.entries())
  }, [pastNotes])

  if (!mounted) return null

  const panelTransform = isMobile
    ? (entered ? 'translateY(0)' : 'translateY(100%)')
    : (entered ? 'translateX(0)' : 'translateX(100%)')

  const panelBase: React.CSSProperties = isMobile
    ? {
        position: 'fixed', inset: 0, background: 'var(--cream)',
        zIndex: 1001, display: 'flex', flexDirection: 'column',
        transform: panelTransform, transition: 'transform .25s ease',
      }
    : {
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
        maxWidth: '100vw', background: 'var(--cream)',
        borderLeft: '1px solid var(--pearl)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 1001, display: 'flex', flexDirection: 'column',
        transform: panelTransform, transition: 'transform .25s ease',
      }

  return createPortal((
    <>
      <div
        onClick={closeWithAnim}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
          zIndex: 1000, opacity: entered ? 1 : 0, transition: 'opacity .25s ease',
        }}
      />
      <div style={panelBase} role="dialog" aria-modal="true">
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0' }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--pearl)' }} />
          </div>
        )}

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--pearl)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mist)' }}>
              Event Notes
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {store?.name || event.store_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
              {[store?.city, store?.state].filter(Boolean).join(', ')} · {fmtEventDate(event.start_date)}
            </div>
          </div>
          <button onClick={closeWithAnim} aria-label="Close notes"
            style={{
              background: 'var(--cream2)', border: 'none', cursor: 'pointer',
              width: 32, height: 32, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--mist)', fontSize: 20, fontWeight: 600, flexShrink: 0,
            }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Add a note */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mist)', marginBottom: 8 }}>Add a note</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => {
                const active = selectedCategory === c.key
                return (
                  <button key={c.key} onClick={() => setSelectedCategory(c.key)} style={{
                    padding: '8px 12px', borderRadius: 99,
                    border: `1.5px solid ${active ? c.color : 'var(--pearl)'}`,
                    background: active ? c.bg : 'var(--cream2)',
                    color: active ? c.color : 'var(--ash)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all .15s',
                  }}>
                    <span>{c.icon}</span>{c.label}
                  </button>
                )
              })}
            </div>
            {selectedCategory && (
              <div style={{ marginTop: 10 }}>
                <textarea ref={textareaRef} value={draft} onChange={e => setDraft(e.target.value)}
                  placeholder="What's on your mind?" rows={4}
                  style={{
                    width: '100%', padding: 12,
                    borderRadius: 10, border: '1px solid var(--pearl)',
                    background: '#fff', color: 'var(--ink)',
                    fontSize: 14, lineHeight: 1.5, resize: 'vertical',
                    fontFamily: 'inherit', outline: 'none',
                  }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setSelectedCategory(null); setDraft('') }}
                    className="btn-outline btn-sm">Cancel</button>
                  <button onClick={saveNew} disabled={saving || !draft.trim()} className="btn-primary btn-sm">
                    {saving ? 'Saving…' : 'Save note'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Current event notes */}
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>This Event</div>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                {loading ? 'Loading…' : `${currentNotes.length} note${currentNotes.length === 1 ? '' : 's'}`}
              </div>
            </div>
            {!loading && currentNotes.length === 0 ? (
              <div style={{
                padding: 20, textAlign: 'center',
                background: 'var(--cream2)', border: '1px dashed var(--pearl)',
                borderRadius: 10, color: 'var(--mist)', fontSize: 13,
              }}>
                No notes yet — be the first to share what you learned!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {CATEGORIES.map(cat => {
                  const notes = currentByCategory[cat.key]
                  if (!notes.length) return null
                  return (
                    <div key={cat.key}>
                      <div style={{
                        fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em',
                        color: cat.color, marginBottom: 6,
                      }}>
                        {cat.icon} {cat.label.replace('?', '')}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {notes.map(n => (
                          <NoteCard key={n.id} note={n} canEdit={n.user_id === user?.id} canDelete={n.user_id === user?.id || isAdmin}
                            justSaved={justSavedId === n.id}
                            editing={editingId === n.id} editingDraft={editingDraft}
                            setEditingDraft={setEditingDraft}
                            onStartEdit={() => startEdit(n)}
                            onCancelEdit={cancelEdit}
                            onSaveEdit={saveEdit}
                            onDelete={() => deleteNote(n.id)} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Past events at this store */}
          {pastByEvent.length > 0 && (
            <section style={{ background: 'var(--cream2)', borderRadius: 12, padding: 14 }}>
              <button onClick={() => setPastOpen(v => !v)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: 0, color: 'var(--ink)', fontFamily: 'inherit',
              }}>
                <span style={{ fontSize: 13, transition: 'transform .15s', transform: pastOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                <span style={{ fontSize: 13, fontWeight: 800 }}>Previous Events at {store?.name || event.store_name}</span>
                <span style={{ fontSize: 12, color: 'var(--mist)', marginLeft: 'auto' }}>
                  {pastNotes.length} note{pastNotes.length === 1 ? '' : 's'}
                </span>
              </button>
              {pastOpen && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {pastByEvent.map(([eventId, notes]) => {
                    const dateSrc = notes[0]?.created_at
                    return (
                      <div key={eventId}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--mist)',
                          textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6,
                        }}>
                          {dateSrc ? new Date(dateSrc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Earlier'}
                          {' — '}
                          {notes.length} note{notes.length === 1 ? '' : 's'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {notes.map(n => (
                            <NoteCard key={n.id} note={n} readOnly />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  ), document.body)
}

/* ── Note card ── */
function NoteCard({ note, canEdit, canDelete, readOnly, editing, editingDraft, setEditingDraft, onStartEdit, onCancelEdit, onSaveEdit, onDelete, justSaved }: {
  note: EventNote
  canEdit?: boolean
  canDelete?: boolean
  readOnly?: boolean
  editing?: boolean
  editingDraft?: string
  setEditingDraft?: (s: string) => void
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSaveEdit?: () => void
  onDelete?: () => void
  justSaved?: boolean
}) {
  const cat = CATEGORY_BY_KEY[note.category]
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--pearl)',
      borderLeft: `3px solid ${cat.color}`,
      borderRadius: 'var(--r)',
      padding: '10px 12px',
      position: 'relative',
      transition: 'background .8s ease',
      boxShadow: justSaved ? '0 0 0 2px var(--green3)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{note.user_name}</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 1 }}>{relativeTime(note.created_at)}</div>
        </div>
        {!readOnly && (canEdit || canDelete) && (
          <div style={{ display: 'flex', gap: 4 }}>
            {canEdit && !editing && (
              <button onClick={onStartEdit} aria-label="Edit note" style={iconBtnStyle}>✎</button>
            )}
            {canDelete && !editing && (
              <button onClick={onDelete} aria-label="Delete note" style={{ ...iconBtnStyle, color: '#B91C1C' }}>🗑</button>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <div style={{ marginTop: 8 }}>
          <textarea value={editingDraft || ''} onChange={e => setEditingDraft?.(e.target.value)}
            rows={3}
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid var(--pearl)', background: '#fff',
              fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
            }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={onCancelEdit} className="btn-outline btn-xs">Cancel</button>
            <button onClick={onSaveEdit} className="btn-primary btn-xs">Save</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--ash)', lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {note.content}
        </div>
      )}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--mist)', fontSize: 14, width: 28, height: 28,
  borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
