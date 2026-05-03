'use client'

import { useApp } from '@/lib/context'
import { leaderboardBuyers } from '@/lib/leaderboard'

function formatRole(role: string): string {
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

export default function Staff() {
  const { users, events } = useApp()

  const staff = leaderboardBuyers(users, events)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 6 }}>Staff</h1>
      <p style={{ color: 'var(--mist)', fontSize: 14, marginBottom: 24 }}>
        Active staff in this brand and their assigned roles.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 130px 200px 150px',
          padding: '12px 16px', background: 'var(--sidebar-bg)',
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.5)'
        }}>
          <div>Staff Member</div>
          <div>Phone</div>
          <div>Email</div>
          <div>Role(s)</div>
        </div>

        {staff.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>No active staff found.</div>
        )}

        {staff.map(s => (
          <div key={s.id}
            style={{
              display: 'grid', gridTemplateColumns: '1fr 130px 200px 150px',
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
                }}>{s.name.charAt(0).toUpperCase()}</div>
              )}
              <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14 }}>{s.name}</span>
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
    </div>
  )
}
