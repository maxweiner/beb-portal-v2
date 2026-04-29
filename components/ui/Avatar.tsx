'use client'

// Tiny user avatar — initials in a colored circle, or photo_url when
// available. Color is derived from the name so the same person always
// gets the same color. Used in the To-Do members stack and assignee
// display; safe to use elsewhere too.

const PALETTE = [
  '#1D6B44', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#6366F1', '#EF4444', '#14B8A6', '#F97316',
]

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

interface Props {
  name: string
  photoUrl?: string | null
  size?: number
  /** When inside a stack with overlap, draws a white ring. */
  ring?: boolean
}

export default function Avatar({ name, photoUrl, size = 24, ring = false }: Props) {
  const ringStyle = ring ? { boxShadow: '0 0 0 2px #fff' } : {}
  if (photoUrl) {
    return (
      <img src={photoUrl} alt={name} style={{
        width: size, height: size, borderRadius: '50%',
        objectFit: 'cover', flexShrink: 0, ...ringStyle,
      }} />
    )
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span aria-label={name} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: colorFor(name || ''), color: '#fff',
      fontSize: Math.round(size * 0.42), fontWeight: 800,
      flexShrink: 0, ...ringStyle,
    }}>{initial}</span>
  )
}
