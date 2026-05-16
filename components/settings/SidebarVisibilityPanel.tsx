'use client'

// 🧭 Sidebar Items — per-user hide/show for the left-nav sidebar,
// configurable per surface (Desktop / Mobile) and per brand (BEB /
// Liberty). Some jobs happen exclusively on a phone (greeting,
// scanning) while others are desktop-only (admin work, reports), so
// keeping the two lists independent lets each surface stay focused.
//
// Storage: users.preferences.sidebar_hidden_modules = {
//   desktop: { beb: string[], liberty: string[] },
//   mobile:  { beb: string[], liberty: string[] },
// }
//
// Dashboard is hard-pinned via ALWAYS_VISIBLE_NAV — shown grayed
// out with an "Always on" tag rather than mysteriously omitted, so
// users see why it can't be hidden. Settings doesn't appear in this
// list at all because it lives in the sidebar footer / mobile menu
// shell, not the nav list.
//
// Persistence is optimistic — local state flips immediately,
// Supabase write happens in parallel, and we roll back on error.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useRoleModules } from '@/lib/useRoleModules'
import { BEB_NAV, LIBERTY_NAV, ALWAYS_VISIBLE_NAV } from '@/lib/sidebarNav'
import type { NavPage } from '@/app/page'
import Checkbox from '@/components/ui/Checkbox'

// Same mobile-menu candidates as MobileLayout.tsx ALL_PAGES (minus
// the swap-item / scan placeholder). Kept in sync manually — if you
// add a page to the mobile slide-out menu, add the id here too.
const MOBILE_NAV_IDS: { id: NavPage; label: string; brands: ('beb' | 'liberty')[] }[] = [
  { id: 'dashboard',           label: 'Dashboard',           brands: ['beb', 'liberty'] },
  { id: 'buying-events',       label: 'Buying Events',       brands: ['beb', 'liberty'] },
  { id: 'dayentry',            label: 'Enter Buying Data',   brands: ['beb', 'liberty'] },
  { id: 'buy-intake',          label: 'Buy Intake',          brands: ['beb', 'liberty'] },
  { id: 'intake-lookup',       label: 'Buy Form Lookup',     brands: ['beb', 'liberty'] },
  { id: 'appointments',        label: 'Appointments',        brands: ['beb', 'liberty'] },
  { id: 'calendar',            label: 'Calendar',            brands: ['beb', 'liberty'] },
  { id: 'travel',              label: 'Travel Share',        brands: ['beb', 'liberty'] },
  { id: 'staff',               label: 'Staff',               brands: ['beb', 'liberty'] },
  { id: 'trade-shows',         label: 'Trade Shows',         brands: ['beb'] },
  { id: 'trunk-shows',         label: 'Trunk Shows',         brands: ['beb'] },
  { id: 'trunk-show-stores',   label: 'Trunk Show Stores',   brands: ['beb'] },
  { id: 'leads',               label: 'Leads',               brands: ['beb'] },
  { id: 'shipping',            label: 'Shipping',            brands: ['beb', 'liberty'] },
  { id: 'wholesale',           label: 'Inventory',           brands: ['liberty'] },
  { id: 'reports',             label: 'Reports',             brands: ['beb', 'liberty'] },
  { id: 'expenses',            label: 'Expenses',            brands: ['beb', 'liberty'] },
  { id: 'financials',          label: 'Financials',          brands: ['beb', 'liberty'] },
  { id: 'marketing',           label: 'Marketing',           brands: ['beb', 'liberty'] },
  { id: 'admin',               label: 'Admin Panel',         brands: ['beb'] },
  { id: 'liberty-admin',       label: 'Liberty Admin Panel', brands: ['liberty'] },
  { id: 'buying-event-stores', label: 'Buying Event Stores', brands: ['beb', 'liberty'] },
]

// Row in the configuration list — applies to one (surface, brand)
// combo at a time.
interface Row {
  id: NavPage
  label: string
  section: string  // '—' for top-level (Dashboard / Calendar)
  alwaysOn: boolean
}

type Surface = 'desktop' | 'mobile'
type Brand = 'beb' | 'liberty'

const SECTION_ORDER = ['—', 'Buying', 'Selling', 'Operations', 'Admin']

// Build rows for the active (surface, brand) combo. Desktop reads
// from BEB_NAV or LIBERTY_NAV. Mobile reads from the smaller mobile
// list above.
function buildRowsFor(surface: Surface, brand: Brand): Row[] {
  if (surface === 'desktop') {
    const nav = brand === 'liberty' ? LIBERTY_NAV : BEB_NAV
    const out: Row[] = []
    let cur = '—'
    for (const it of nav) {
      if (it.section) { cur = it.label; continue }
      if (!it.id) continue
      out.push({
        id: it.id,
        label: it.label,
        section: cur,
        alwaysOn: ALWAYS_VISIBLE_NAV.includes(it.id),
      })
    }
    return out
  }
  // mobile — flat list, no sections
  return MOBILE_NAV_IDS
    .filter(p => p.brands.includes(brand))
    .map(p => ({
      id: p.id,
      label: p.label,
      section: '—',
      alwaysOn: ALWAYS_VISIBLE_NAV.includes(p.id),
    }))
}

interface HiddenShape {
  desktop?: { beb?: NavPage[]; liberty?: NavPage[] }
  mobile?:  { beb?: NavPage[]; liberty?: NavPage[] }
}

function readSet(prefs: any, surface: Surface, brand: Brand): Set<NavPage> {
  const root = prefs?.sidebar_hidden_modules as HiddenShape | undefined
  const arr = root?.[surface]?.[brand]
  return new Set<NavPage>(Array.isArray(arr) ? arr : [])
}

function writeSet(prefs: any, surface: Surface, brand: Brand, next: Set<NavPage>): HiddenShape {
  const root = (prefs?.sidebar_hidden_modules as HiddenShape | undefined) || {}
  const surfaceObj = { ...(root[surface] || {}) }
  surfaceObj[brand] = Array.from(next)
  return { ...root, [surface]: surfaceObj }
}

export default function SidebarVisibilityPanel() {
  const { user } = useApp()
  const { modules: grantedModules, loaded: modulesLoaded } = useRoleModules()

  const [surface, setSurface] = useState<Surface>('desktop')
  const [brand, setBrand]     = useState<Brand>('beb')

  // Hidden set for the active (surface, brand) combo — re-derived
  // whenever the toggle changes or the user object updates.
  const [hidden, setHidden] = useState<Set<NavPage>>(() => readSet(user?.preferences, 'desktop', 'beb'))
  useEffect(() => {
    setHidden(readSet(user?.preferences, surface, brand))
  }, [user?.id, user?.preferences, surface, brand])

  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function persist(next: Set<NavPage>) {
    if (!user) return
    const nextRoot = writeSet(user.preferences, surface, brand, next)
    const nextPrefs = { ...(user.preferences || {}), sidebar_hidden_modules: nextRoot }
    const { error: e } = await supabase.from('users')
      .update({ preferences: nextPrefs })
      .eq('id', user.id)
    if (e) {
      setError(e.message)
      setHidden(readSet(user.preferences, surface, brand))
    } else {
      setError(null)
      setSavedAt(new Date())
    }
  }

  async function toggle(id: NavPage, alwaysOn: boolean) {
    if (alwaysOn) return
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id); else next.add(id)
    setHidden(next)
    await persist(next)
  }

  async function showAll() {
    setHidden(new Set())
    await persist(new Set())
  }

  const rows = useMemo(() => buildRowsFor(surface, brand), [surface, brand])

  // Filter to modules the user actually has access to. Dashboard
  // stays visible even before modulesLoaded so the list isn't empty.
  const visibleRows = useMemo(() => {
    if (!modulesLoaded) return rows.filter(r => r.alwaysOn)
    return rows.filter(r => r.alwaysOn || grantedModules.has(r.id))
  }, [rows, grantedModules, modulesLoaded])

  // Group by section for the desktop view; mobile is flat.
  const grouped = useMemo(() => {
    if (surface === 'mobile') {
      return [{ section: '—', rows: visibleRows }]
    }
    const out: { section: string; rows: Row[] }[] = []
    for (const s of SECTION_ORDER) {
      const inSection = visibleRows.filter(r => r.section === s)
      if (inSection.length > 0) out.push({ section: s, rows: inSection })
    }
    return out
  }, [visibleRows, surface])

  const hiddenCount = hidden.size
  const totalCount = visibleRows.length

  return (
    <div>
      {/* Surface + Brand selector — two parallel chip strips.
          Together they pick which (surface, brand) hide list the
          checkboxes below are editing. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        marginBottom: 14, padding: 12,
        background: 'var(--cream2)', borderRadius: 10,
        border: '1px solid var(--pearl)',
      }}>
        <ChipStrip
          label="Surface"
          options={[
            { id: 'desktop', label: '🖥 Desktop' },
            { id: 'mobile',  label: '📱 Mobile' },
          ]}
          value={surface}
          onChange={v => setSurface(v as Surface)}
        />
        <ChipStrip
          label="Brand"
          options={[
            { id: 'beb',     label: 'BEB' },
            { id: 'liberty', label: 'Liberty' },
          ]}
          value={brand}
          onChange={v => setBrand(v as Brand)}
        />
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12, padding: '8px 12px',
        background: '#fff', borderRadius: 8, border: '1px solid var(--pearl)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--ash)' }}>
          Editing: <strong>{surface === 'desktop' ? '🖥 Desktop' : '📱 Mobile'}</strong> · <strong>{brand === 'beb' ? 'BEB' : 'Liberty'}</strong>
          {' · '}
          <span>{totalCount - hiddenCount} of {totalCount} shown</span>
          {hiddenCount > 0 && <span style={{ color: 'var(--mist)' }}> · {hiddenCount} hidden</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {savedAt && (
            <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
              ✓ Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {hiddenCount > 0 && (
            <button onClick={showAll} className="btn-outline btn-xs">
              Show all
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: '8px 12px',
          background: '#FEE2E2', color: '#991B1B',
          borderRadius: 8, fontSize: 13, fontWeight: 700,
        }}>
          ⚠ {error}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14, lineHeight: 1.5 }}>
        Pick which modules show in your <strong>{surface}</strong> sidebar for the <strong>{brand === 'beb' ? 'BEB' : 'Liberty'}</strong> brand. Hiding only affects what you see — your underlying access is unchanged. The other surface/brand combos are independent — switch the chips above to configure them.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {grouped.map(({ section, rows: sectionRows }) => (
          <div key={section}>
            {section !== '—' && surface === 'desktop' && (
              <div style={{
                fontSize: 10, fontWeight: 800,
                color: 'var(--mist)', textTransform: 'uppercase',
                letterSpacing: '.06em', marginBottom: 6,
              }}>{section}</div>
            )}
            <div style={{
              border: '1px solid var(--pearl)', borderRadius: 10,
              background: '#fff', overflow: 'hidden',
            }}>
              {sectionRows.map((r, i) => {
                const isHidden = hidden.has(r.id)
                const isLast = i === sectionRows.length - 1
                const tooltip = r.alwaysOn
                  ? 'Dashboard is always visible'
                  : isHidden ? `Show "${r.label}"` : `Hide "${r.label}"`
                return (
                  <Checkbox
                    key={r.id}
                    checked={!isHidden}
                    onChange={() => toggle(r.id, r.alwaysOn)}
                    disabled={r.alwaysOn}
                    size={20}
                    labelStyle={{
                      display: 'flex', width: '100%', gap: 10,
                      padding: '10px 14px',
                      borderBottom: isLast ? 'none' : '1px solid var(--pearl)',
                      background: r.alwaysOn ? 'var(--cream2)' : 'transparent',
                      opacity: r.alwaysOn ? 0.7 : 1,
                      cursor: r.alwaysOn ? 'not-allowed' : 'pointer',
                    }}
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 8 }} title={tooltip}>
                        <span style={{
                          fontSize: 13, fontWeight: 600,
                          color: isHidden ? 'var(--mist)' : 'var(--ink)',
                          textDecoration: isHidden ? 'line-through' : 'none',
                        }}>{r.label}</span>
                        {r.alwaysOn && (
                          <span style={{
                            fontSize: 9, fontWeight: 800,
                            padding: '2px 6px', borderRadius: 4,
                            textTransform: 'uppercase', letterSpacing: '.04em',
                            background: '#F3E8FF', color: '#6B21A8',
                          }}>Always on</span>
                        )}
                      </div>
                    }
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 14, fontStyle: 'italic', lineHeight: 1.5 }}>
        Saved changes take effect on the next page load (or reload this page). Each combo of (surface, brand) is independent — useful when, say, you want a slimmer mobile menu while keeping the full desktop sidebar.
      </p>
    </div>
  )
}

function ChipStrip({
  label, options, value, onChange,
}: {
  label: string
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontSize: 10, fontWeight: 800, color: 'var(--mist)',
        textTransform: 'uppercase', letterSpacing: '.05em',
        minWidth: 56,
      }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map(o => {
          const sel = value === o.id
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              style={{
                padding: '5px 14px', borderRadius: 999,
                border: '1px solid var(--pearl)',
                background: sel ? 'var(--green-dark)' : '#fff',
                color: sel ? '#fff' : 'var(--ink)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >{o.label}</button>
          )
        })}
      </div>
    </div>
  )
}
