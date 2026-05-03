'use client'

import { useApp } from '@/lib/context'

// Display labels override the auto title-cased version. Keep this map
// in sync with the labels stored in the `roles` table (Settings →
// Role Manager) so the badge text matches what admins see there.
const ROLE_LABEL_OVERRIDE: Record<string, string> = {
  admin: 'Buyer Admin',
}

function formatRole(role: string): string {
  if (ROLE_LABEL_OVERRIDE[role]) return ROLE_LABEL_OVERRIDE[role]
  return (role || '').split('_')
    .map(w => w.length === 0 ? w : w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  superadmin:  { bg: '#FEE2E2', fg: '#991B1B' },
  admin:       { bg: '#FEF3C7', fg: '#92400E' },
  buyer:       { bg: '#DBEAFE', fg: '#1E40AF' },
  marketing:   { bg: '#FCE7F3', fg: '#9D174D' },
  accounting:  { bg: '#E0E7FF', fg: '#3730A3' },
  sales_rep:   { bg: '#D1FAE5', fg: '#065F46' },
  trunk_admin: { bg: '#EDE9FE', fg: '#5B21B6' },
  trunk_rep:   { bg: '#EDE9FE', fg: '#5B21B6' },
  pending:     { bg: '#E5E7EB', fg: '#374151' },
}

function RoleBadge({ role }: { role: string }) {
  const c = ROLE_COLORS[role] || { bg: '#E5E7EB', fg: '#374151' }
  return (
    <span style={{
      background: c.bg, color: c.fg,
      padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 700,
      letterSpacing: '.02em', whiteSpace: 'nowrap',
    }}>{formatRole(role)}</span>
  )
}

// Display order for role groups. Unknown / custom roles fall through
// to a generic group at the bottom (alphabetized).
const ROLE_ORDER: Array<{ role: string; label: string }> = [
  { role: 'superadmin',  label: 'Superadmins' },
  { role: 'admin',       label: 'Buyer Admins' },
  { role: 'trunk_admin', label: 'Trunk Admins' },
  { role: 'sales_rep',   label: 'Sales Reps' },
  { role: 'trunk_rep',   label: 'Trunk Reps' },
  { role: 'marketing',   label: 'Marketing' },
  { role: 'accounting',  label: 'Accounting' },
  { role: 'buyer',       label: 'Buyers' },
  { role: 'pending',     label: 'Pending' },
]

const GRID = '1fr 130px 200px 150px'

export default function Staff() {
  const { users } = useApp()

  const active = users
    .filter(u => u.active)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const groups: Array<{ role: string; label: string; users: typeof active }> = []
  const seen = new Set<string>()
  for (const { role, label } of ROLE_ORDER) {
    const list = active.filter(u => u.role === role)
    seen.add(role)
    if (list.length > 0) groups.push({ role, label, users: list })
  }
  const remaining = active.filter(u => !seen.has(u.role))
  const byOther: Record<string, typeof active> = {}
  for (const u of remaining) (byOther[u.role] ||= []).push(u)
  for (const role of Object.keys(byOther).sort()) {
    groups.push({
      role,
      label: role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' '),
      users: byOther[role],
    })
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 18 }}>Staff</h1>

      {groups.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>
          No active staff found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groups.map(g => (
            <div key={g.role} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px',
                background: 'var(--sidebar-bg)',
                color: '#fff',
                fontSize: 12, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '.06em',
              }}>
                <span>{g.label}</span>
                <span style={{ opacity: .6, fontWeight: 600 }}>{g.users.length}</span>
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: GRID,
                padding: '8px 16px',
                background: 'var(--cream2)',
                borderBottom: '1px solid var(--pearl)',
                fontSize: 11, fontWeight: 700, color: 'var(--ash)',
                textTransform: 'uppercase', letterSpacing: '.06em',
              }}>
                <div>Staff Member</div>
                <div>Phone</div>
                <div>Email</div>
                <div>Role(s)</div>
              </div>

              {g.users.map(s => (
                <div key={s.id}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--cream2)',
                    alignItems: 'center',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {s.photo_url ? (
                      <img src={s.photo_url} alt={s.name}
                        style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', background: 'var(--green-pale)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, color: 'var(--green-dark)', flexShrink: 0,
                      }}>{(s.name || s.email).charAt(0).toUpperCase()}</div>
                    )}
                    <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14 }}>
                      {s.name || <span style={{ color: 'var(--mist)' }}>(no name)</span>}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                    {s.phone ? <a href={`tel:${s.phone}`} style={{ color: 'var(--ash)', textDecoration: 'none' }}>{s.phone}</a> : <span style={{ color: 'var(--fog)' }}>—</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.email ? <a href={`mailto:${s.email}`} style={{ color: 'var(--green)', textDecoration: 'none' }}>{s.email}</a> : <span style={{ color: 'var(--fog)' }}>—</span>}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <RoleBadge role={s.role} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
