// Shared "initials from a name" helper. Mirrors the implementation
// previously inlined in components/events/HubView.tsx so the public
// event dashboard and any future caller render identical glyphs.

export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
