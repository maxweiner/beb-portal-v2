// Display + normalization helpers for customer data.

/** Format a 10-digit US phone for display. Falls back to raw on weird input. */
export function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return raw
}

/** Combine address fields into a single one-line string. */
export function fmtAddress(c: {
  address_line_1?: string | null
  address_line_2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): string {
  const street = [c.address_line_1, c.address_line_2].filter(Boolean).join(' ')
  const cityStateZip = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, cityStateZip].filter(Boolean).join(' · ')
}

export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateRel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).getTime()
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  const y = (days / 365).toFixed(1)
  return `${y}y ago`
}
