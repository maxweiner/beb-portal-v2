'use client'

// Lightweight rich-text editor for broadcast bodies. contentEditable
// + a small toolbar driving document.execCommand for bold / italic /
// list / link. execCommand is technically deprecated but still works
// across every browser the team uses, and it ships zero KB beyond
// the React render. For email-output purposes the supported subset
// (b, i, ul, ol, li, a, p, br) is exactly what survives across
// Gmail / Outlook / Apple Mail anyway.

import { useEffect, useRef } from 'react'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

const BTN_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  border: '1px solid var(--pearl)',
  background: '#fff',
  color: 'var(--ash)',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 240 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Sync external value → editor when it changes from outside (e.g.
  // duplicate-as-new pre-fill). We avoid resetting on every render
  // because that would clobber the user's caret position while typing.
  useEffect(() => {
    if (!ref.current) return
    if (ref.current.innerHTML !== value) ref.current.innerHTML = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function exec(cmd: string, arg?: string) {
    if (!ref.current) return
    ref.current.focus()
    document.execCommand(cmd, false, arg)
    // Trigger onChange with the latest html.
    onChange(ref.current.innerHTML)
  }

  function insertLink() {
    const url = window.prompt('URL (https://…)')
    if (!url) return
    const safe = url.startsWith('http') ? url : `https://${url}`
    exec('createLink', safe)
  }

  function clearFormatting() {
    exec('removeFormat')
    exec('unlink')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => exec('bold')}    style={{ ...BTN_STYLE, fontWeight: 900 }}>B</button>
        <button type="button" onClick={() => exec('italic')}  style={{ ...BTN_STYLE, fontStyle: 'italic' }}>I</button>
        <button type="button" onClick={() => exec('underline')} style={{ ...BTN_STYLE, textDecoration: 'underline' }}>U</button>
        <span style={{ width: 1, background: 'var(--pearl)', margin: '0 4px' }} />
        <button type="button" onClick={() => exec('insertUnorderedList')} style={BTN_STYLE}>• List</button>
        <button type="button" onClick={() => exec('insertOrderedList')}   style={BTN_STYLE}>1. List</button>
        <span style={{ width: 1, background: 'var(--pearl)', margin: '0 4px' }} />
        <button type="button" onClick={insertLink}            style={BTN_STYLE}>🔗 Link</button>
        <button type="button" onClick={clearFormatting}       style={{ ...BTN_STYLE, color: 'var(--mist)' }}>Clear</button>
      </div>

      {/* Editor */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={e => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        data-placeholder={placeholder || 'Type your message…'}
        style={{
          minHeight,
          background: '#fff',
          border: '1px solid var(--pearl)',
          borderRadius: 6,
          padding: 14,
          fontSize: 15,
          lineHeight: 1.55,
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <style jsx global>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: var(--mist);
          pointer-events: none;
        }
        [contenteditable] a { color: var(--green-dark); text-decoration: underline; }
        [contenteditable] ul, [contenteditable] ol { margin: 8px 0; padding-left: 24px; }
        [contenteditable] li { margin: 4px 0; }
      `}</style>
    </div>
  )
}
