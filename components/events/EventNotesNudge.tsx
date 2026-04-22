'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import type { Event, Store, EventNoteCategory } from '@/types'

const CATEGORIES: { key: EventNoteCategory; label: string; icon: string; color: string; bg: string }[] = [
  { key: 'worked',         label: 'What worked?',       icon: '✅', color: 'var(--green)', bg: 'var(--green-pale)' },
  { key: 'didnt_work',     label: "What didn't work?",  icon: '⚠️', color: 'var(--amber)', bg: 'var(--amber-pale)' },
  { key: 'do_differently', label: 'Do differently',     icon: '💡', color: 'var(--blue)',  bg: 'var(--blue-pale)'  },
]

interface EventNotesNudgeProps {
  event: Event
  store: Store | undefined
  userId: string
  userName: string
  onClose: () => void
  onSaved: () => void
}

export default function EventNotesNudge({ event, store, userId, userName, onClose, onSaved }: EventNotesNudgeProps) {
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)
  const [category, setCategory] = useState<EventNoteCategory | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setMounted(true)
    const t = setTimeout(() => setEntered(true), 10)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => { if (category) setTimeout(() => textareaRef.current?.focus(), 50) }, [category])

  const close = (animate = true) => {
    if (!animate) return onClose()
    setEntered(false)
    setTimeout(() => onClose(), 200)
  }

  const save = async () => {
    if (!category || !content.trim()) return
    setSaving(true)
    try {
      await supabase.auth.refreshSession()
      const { error } = await supabase.from('event_notes').insert({
        event_id: event.id,
        store_id: event.store_id,
        user_id: userId,
        user_name: userName,
        category,
        content: content.trim(),
      })
      if (error) throw error
      onSaved()
      close()
    } catch (err: any) {
      alert('Failed to save note: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      opacity: entered ? 1 : 0, transition: 'opacity .2s ease',
    }} onClick={() => close()}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--cream)', borderRadius: 16, maxWidth: 460, width: '100%',
        boxShadow: 'var(--shadow-lg)',
        transform: entered ? 'scale(1) translateY(0)' : 'scale(.96) translateY(8px)',
        transition: 'transform .22s cubic-bezier(.2,1.2,.4,1)',
        padding: '22px 24px',
      }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>
          How did it go at {store?.name || event.store_name}?
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
          Take a minute to jot down what worked and what we can improve for next time.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {CATEGORIES.map(c => {
            const active = category === c.key
            return (
              <button key={c.key} onClick={() => setCategory(c.key)} style={{
                padding: '8px 12px', borderRadius: 99,
                border: `1.5px solid ${active ? c.color : 'var(--pearl)'}`,
                background: active ? c.bg : 'var(--cream2)',
                color: active ? c.color : 'var(--ash)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>{c.icon}</span>{c.label}
              </button>
            )
          })}
        </div>

        {category && (
          <textarea ref={textareaRef} value={content} onChange={e => setContent(e.target.value)}
            placeholder="Type your note…" rows={4}
            style={{
              width: '100%', marginTop: 12, padding: 12,
              borderRadius: 10, border: '1px solid var(--pearl)',
              background: '#fff', color: 'var(--ink)',
              fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit',
              resize: 'vertical', outline: 'none',
            }} />
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => close()} className="btn-outline" style={{ flex: 1 }}>
            Skip for now
          </button>
          <button onClick={save} disabled={saving || !category || !content.trim()} className="btn-primary" style={{ flex: 1 }}>
            {saving ? 'Saving…' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}
