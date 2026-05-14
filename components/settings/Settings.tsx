'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { formatPhoneDisplay } from '@/lib/phone'
import type { Theme, BuyerVacation } from '@/types'
import AvatarPicker from './AvatarPicker'
import BrandLogosPanel from './BrandLogosPanel'
import RoleManagerPanel from './RoleManagerPanel'
import ExpenseDelegatesPanel from './ExpenseDelegatesPanel'
import QuickBooksMappingPanel from './QuickBooksMappingPanel'
import WhiteSheetSettingsPanel from './WhiteSheetSettingsPanel'
import DatePicker from '@/components/ui/DatePicker'
import ImpersonationLogPanel from '@/components/impersonation/ImpersonationLogPanel'
import AdHocGCalEvents from './AdHocGCalEvents'
import BoothCostCategoriesPanel from '@/components/sales/BoothCostCategoriesPanel'
import SalesRepTerritoriesPanel from '@/components/sales/SalesRepTerritoriesPanel'
import OfficeStaffRecipientsPanel from '@/components/sales/OfficeStaffRecipientsPanel'
import SpiffConfigPanel from '@/components/sales/SpiffConfigPanel'
import Checkbox from '@/components/ui/Checkbox'
import AddressAutocompleteInput from '@/components/ui/AddressAutocompleteInput'
import CollapsibleCard from '@/components/ui/CollapsibleCard'
import { getCenterModeOverride, setCenterModeOverride, type CenterModeOverride } from '@/lib/centerButtonMode'
import TripTemplatesSettings from '@/components/expenses/TripTemplatesSettings'

const BEB_THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'original',   label: 'Original',        color: '#1D6B44' },
  { id: 'salesforce', label: 'Salesforce Style', color: '#0070D2' },
  { id: 'apple',      label: 'Apple Style',      color: '#007AFF' },
]

const LIBERTY_THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'liberty',         label: 'Navy Classic',   color: '#1D3A6B' },
  { id: 'liberty-gold',    label: 'Navy & Gold',    color: '#C9A84C' },
  { id: 'liberty-slate',   label: 'Slate Steel',    color: '#334155' },
  { id: 'liberty-patriot', label: 'Red White Blue', color: '#B22234' },
]

export default function Settings() {
  const { user, stores, theme, setTheme, reload, brand } = useApp()
  const THEMES = brand === 'liberty' ? LIBERTY_THEMES : BEB_THEMES
  const [profile, setProfile] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    // Single-line address kept in sync with the structured fields below
    // — populated by joining line1/line2/city/state/zip on save so the
    // legacy mileage calculator (which feeds home_address straight to
    // Google Distance Matrix) keeps working unchanged.
    home_address: user?.home_address || '',
    home_address_line1: user?.home_address_line1 || '',
    home_address_line2: user?.home_address_line2 || '',
    home_city:          user?.home_city          || '',
    home_state:         user?.home_state         || '',
    home_zip:           user?.home_zip           || '',
  })
  const [notifyMaster, setNotifyMaster] = useState(user?.notify || false)
  const [notifySms, setNotifySms] = useState(user?.notify_sms || false)
  const [storePrefs, setStorePrefs] = useState<Record<string, boolean>>({})
  const [loadingPrefs, setLoadingPrefs] = useState(true)
  const [photoUrl, setPhotoUrl] = useState(user?.photo_url || '')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [vacations, setVacations] = useState<BuyerVacation[]>([])
  const [showVacForm, setShowVacForm] = useState(false)
  const [vacStart, setVacStart] = useState('')
  const [vacEnd, setVacEnd] = useState('')
  const [vacNote, setVacNote] = useState('')
  const [vacSaving, setVacSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('settings').select('value').eq('key', `notify_stores_${user.id}`).maybeSingle()
      .then(({ data }) => {
        setStorePrefs(data?.value || {})
        setLoadingPrefs(false)
      })
    supabase.from('buyer_vacations').select('*').eq('user_id', user.id).order('start_date')
      .then(({ data }) => setVacations(data || []))
  }, [user])

  const profileStatus = useAutosave(
    profile,
    async (p) => {
      if (!user || !p.name.trim()) return
      // Assemble the legacy single-line `home_address` from the
      // structured fields when at least one is filled. Otherwise
      // preserve whatever the user typed in the legacy field —
      // older profiles still have the pre-structured value there.
      const hasStructured =
        !!(p.home_address_line1.trim() || p.home_city.trim() || p.home_state.trim() || p.home_zip.trim())
      const assembled = hasStructured
        ? [
            p.home_address_line1.trim(),
            p.home_address_line2.trim(),
            [p.home_city.trim(), p.home_state.trim()].filter(Boolean).join(', '),
            p.home_zip.trim(),
          ].filter(Boolean).join(', ')
        : p.home_address.trim()
      await supabase.from('users').update({
        name: p.name.trim(),
        phone: p.phone.trim(),
        home_address:       assembled || null,
        home_address_line1: p.home_address_line1.trim() || null,
        home_address_line2: p.home_address_line2.trim() || null,
        home_city:          p.home_city.trim() || null,
        home_state:         p.home_state.trim().slice(0, 2).toUpperCase() || null,
        home_zip:           p.home_zip.trim() || null,
      }).eq('id', user.id)
      // Refresh any in-flight notifications for this buyer so the
      // updated name/phone shows up when they actually send.
      void fetch('/api/notifications/reenqueue-for-buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer_id: user.id, reason: 'profile_edited' }),
      }).catch(() => {})
      reload()
    },
    { enabled: !!user, delay: 1000 }
  )

  const saveAvatar = async (dataUrl: string) => {
    await supabase.from('users').update({ photo_url: dataUrl }).eq('id', user!.id)
    setPhotoUrl(dataUrl)
    setShowAvatarPicker(false)
    reload()
  }

  const toggleMasterNotify = async () => {
    if (!user) return
    const next = !notifyMaster
    setNotifyMaster(next)
    await supabase.from('users').update({ notify: next }).eq('id', user.id)
    reload()
  }

  const toggleSmsNotify = async () => {
    if (!user) return
    const next = !notifySms
    setNotifySms(next)
    await supabase.from('users').update({ notify_sms: next }).eq('id', user.id)
    reload()
  }

  const toggleStoreNotify = async (storeId: string) => {
    if (!user) return
    const next = { ...storePrefs, [storeId]: !storePrefs[storeId] }
    setStorePrefs(next)
    await supabase.from('settings').upsert({
      key: `notify_stores_${user.id}`,
      value: next,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
  }

  const addVacation = async () => {
    if (!user || !vacStart) return
    const endDate = vacEnd || vacStart
    if (endDate < vacStart) { alert('End date must be on or after start date.'); return }
    setVacSaving(true)
    const { data, error } = await supabase.from('buyer_vacations').insert({
      user_id: user.id,
      start_date: vacStart,
      end_date: endDate,
      note: vacNote,
    }).select().single()
    if (error) { alert('Failed to save: ' + error.message); setVacSaving(false); return }
    setVacations(prev => [...prev, data].sort((a, b) => a.start_date.localeCompare(b.start_date)))
    setVacStart('')
    setVacEnd('')
    setVacNote('')
    setShowVacForm(false)
    setVacSaving(false)
  }

  const removeVacation = async (id: string) => {
    if (!confirm('Remove this vacation?')) return
    await supabase.from('buyer_vacations').delete().eq('id', id)
    setVacations(prev => prev.filter(v => v.id !== id))
  }

  const fmtVacDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const vacDays = (start: string, end: string) => {
    const s = new Date(start + 'T12:00:00')
    const e = new Date(end + 'T12:00:00')
    return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Settings</h1>

      {/* Profile */}
      <CollapsibleCard
        storageKey="settings-profile"
        title="Profile"
        titleAccessory={<AutosaveIndicator status={profileStatus} />}
        defaultOpen
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setShowAvatarPicker(true)}>
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--pearl)' }} />
            ) : (
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#fff' }}>
                {user?.name?.charAt(0) || 'U'}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--green)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', border: '2px solid var(--cream)' }}>✎</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: 'var(--mist)' }}>{user?.email}</div>
            <span className={`badge badge-${user?.role === 'superadmin' ? 'ruby' : user?.role === 'admin' ? 'gold' : 'sapph'}`} style={{ marginTop: 4 }}>
              {user?.role}
            </span>
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setShowAvatarPicker(true)} className="btn-outline btn-xs">Change Avatar</button>
            </div>
          </div>
        </div>
        <div className="field">
          <label className="fl">Display Name</label>
          <input type="text" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="field">
          <label className="fl">Phone</label>
          <input type="tel" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
        </div>
        <div className="field">
          <label className="fl">Home Address — Line 1</label>
          <AddressAutocompleteInput
            value={profile.home_address_line1}
            placeholder="Start typing your street address…"
            onChange={v => setProfile(p => ({ ...p, home_address_line1: v }))}
            onSelectStructured={parts => setProfile(p => ({
              ...p,
              // Picker emits both onChange (full formatted string into
              // line1) and onSelectStructured (parsed parts). The
              // latter runs second, so it wins for line1 — restoring
              // it to just street number + route.
              home_address_line1: parts.line1 || p.home_address_line1,
              home_address_line2: parts.line2 || p.home_address_line2,
              home_city:          parts.city  || p.home_city,
              home_state:         parts.state || p.home_state,
              home_zip:           parts.zip   || p.home_zip,
            }))}
          />
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
            Pick from the suggestions to auto-fill City / State / Zip. Used to prefill the W-9 tax form and as the home origin for mileage calculations.
          </div>
        </div>
        <div className="field">
          <label className="fl">Address Line 2 <span style={{ color: 'var(--mist)', fontWeight: 400 }}>(optional — apt / suite)</span></label>
          <input
            type="text"
            value={profile.home_address_line2}
            placeholder="Apt 5 / Suite 200"
            onChange={e => setProfile(p => ({ ...p, home_address_line2: e.target.value }))}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
          <div className="field">
            <label className="fl">City</label>
            <input
              type="text"
              value={profile.home_city}
              onChange={e => setProfile(p => ({ ...p, home_city: e.target.value }))}
            />
          </div>
          <div className="field">
            <label className="fl">State</label>
            <input
              type="text"
              value={profile.home_state}
              maxLength={2}
              placeholder="PA"
              onChange={e => setProfile(p => ({ ...p, home_state: e.target.value.toUpperCase().slice(0, 2) }))}
            />
          </div>
          <div className="field">
            <label className="fl">ZIP</label>
            <input
              type="text"
              value={profile.home_zip}
              placeholder="19035"
              onChange={e => setProfile(p => ({ ...p, home_zip: e.target.value }))}
            />
          </div>
        </div>
      </CollapsibleCard>

      {showAvatarPicker && (
        <AvatarPicker
          currentPhoto={photoUrl}
          userName={user?.name || ''}
          onSave={saveAvatar}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}

      {/* Vacation Dates */}
      <CollapsibleCard
        storageKey="settings-vacations"
        title="Vacation Dates"
        subtitle="You won't be assigned to events on these days"
        headerExtra={
          <button className="btn-outline btn-xs" onClick={() => setShowVacForm(!showVacForm)}>
            {showVacForm ? 'Cancel' : '+ Add Dates'}
          </button>
        }
      >
        {showVacForm && (
          <div style={{ padding: 14, background: 'var(--cream2)', borderRadius: 'var(--r)', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                <label className="fl">Start date</label>
                <DatePicker value={vacStart} onChange={v => { setVacStart(v); if (!vacEnd) setVacEnd(v) }} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                <label className="fl">End date</label>
                <DatePicker value={vacEnd} onChange={setVacEnd} min={vacStart} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 8, marginBottom: 8 }}>
              <label className="fl">Note (optional)</label>
              <input type="text" value={vacNote} onChange={e => setVacNote(e.target.value)} placeholder="e.g. Family trip, Holiday" />
            </div>
            <button className="btn-primary btn-sm" onClick={addVacation} disabled={!vacStart || vacSaving}>
              {vacSaving ? 'Saving…' : 'Save Vacation'}
            </button>
          </div>
        )}

        {vacations.length === 0 && !showVacForm && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--mist)', fontSize: 13 }}>
            No vacation dates set. Click "+ Add Dates" to block off time.
          </div>
        )}

        {vacations.map(v => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--cream2)', borderRadius: 'var(--r)', marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: '#FAEEDA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
              ☀
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                {v.start_date === v.end_date ? fmtVacDate(v.start_date) : `${fmtVacDate(v.start_date)} – ${fmtVacDate(v.end_date)}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                {vacDays(v.start_date, v.end_date)} day{vacDays(v.start_date, v.end_date) !== 1 ? 's' : ''}
                {v.note ? ` · ${v.note}` : ''}
              </div>
            </div>
            <button className="btn-danger btn-xs" onClick={() => removeVacation(v.id)}>Remove</button>
          </div>
        ))}
      </CollapsibleCard>

      {/* Notifications */}
      <CollapsibleCard
        storageKey="settings-email-notifications"
        title="Email Notifications"
        subtitle="Receive email reports when buyers submit day data."
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--cream2)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>All Notifications</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>Master on/off switch</div>
          </div>
          <button onClick={toggleMasterNotify}
            style={{ width: 48, height: 24, borderRadius: 12, background: notifyMaster ? 'var(--green)' : 'var(--pearl)', position: 'relative', border: 'none', cursor: 'pointer', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 4, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s', left: notifyMaster ? 28 : 4 }} />
          </button>
        </div>

        {notifyMaster && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--mist)', marginBottom: 12 }}>Per Store</div>
            {loadingPrefs ? (
              <div style={{ fontSize: 13, color: 'var(--mist)' }}>Loading…</div>
            ) : stores.map(s => {
              const on = storePrefs[s.id] !== false
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--cream2)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)' }}>{s.city}, {s.state}</div>
                  </div>
                  <button onClick={() => toggleStoreNotify(s.id)}
                    style={{ width: 40, height: 20, borderRadius: 10, background: on ? 'var(--green)' : 'var(--pearl)', position: 'relative', border: 'none', cursor: 'pointer', transition: 'background .2s' }}>
                    <div style={{ position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s', left: on ? 22 : 2 }} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleCard>

      {/* SMS Notifications */}
      <CollapsibleCard
        storageKey="settings-sms-notifications"
        title="SMS Notifications"
        subtitle="Receive text message alerts when events are active."
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Text Alerts</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>
              {profile.phone
                ? <>Messages go to <strong>{formatPhoneDisplay(profile.phone)}</strong></>
                : <>Add your phone number above to receive SMS notifications.</>}
            </div>
          </div>
          <button onClick={toggleSmsNotify} disabled={!profile.phone}
            style={{ width: 48, height: 24, borderRadius: 12, background: notifySms ? 'var(--green)' : 'var(--pearl)', position: 'relative', border: 'none', cursor: profile.phone ? 'pointer' : 'not-allowed', transition: 'background .2s', opacity: profile.phone ? 1 : 0.5 }}>
            <div style={{ position: 'absolute', top: 4, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s', left: notifySms ? 28 : 4 }} />
          </button>
        </div>
      </CollapsibleCard>

      {/* Theme */}
      <CollapsibleCard storageKey="settings-appearance" title="Appearance">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {THEMES.map(t => (
            <button key={t.id} onClick={() => setTheme(t.id)}
              style={{ border: `2px solid ${theme === t.id ? t.color : 'var(--pearl)'}`, background: theme === t.id ? `${t.color}18` : 'var(--cream2)', borderRadius: 'var(--r)', padding: 16, textAlign: 'left', cursor: 'pointer', transition: 'all .15s' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: t.color, marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: theme === t.id ? t.color : 'var(--ash)' }}>{t.label}</div>
              {theme === t.id && <div style={{ fontSize: 11, color: t.color, marginTop: 2 }}>Active</div>}
            </button>
          ))}
        </div>
      </CollapsibleCard>

      {/* Active brand — synced across devices */}
      {user?.liberty_access && <ActiveBrandNote />}

      {/* Mobile center button — visible to everyone since it's a per-user UI pref */}
      <CenterButtonSetting />

      {/* Brand Logos (superadmin only) */}
      {user?.role === 'superadmin' && (
        <CollapsibleCard
          storageKey="settings-brand-logos"
          title="🏷️ Brand Logos"
          subtitle="Upload a logo for each brand. Used on the Expense Report PDF (and other branded surfaces over time)."
        >
          <BrandLogosPanel />
        </CollapsibleCard>
      )}

      {/* Role Manager (max@bebllp.com only — DB-side gate via can_manage_roles()) */}
      {user?.email?.toLowerCase() === 'max@bebllp.com' && (
        <CollapsibleCard
          storageKey="settings-role-manager"
          title="🛡️ Role Manager"
          subtitle="Create roles and choose which modules each one unlocks. Drives the sidebar + page guards (PRs C/D in this initiative wire them in)."
        >
          <RoleManagerPanel />
        </CollapsibleCard>
      )}

      {/* Expense Delegates (max@bebllp.com only — POST/revoke API
          hard-rejects others; same single-actor pattern as
          impersonation and Role Manager). Lets one user submit
          expense reports on behalf of another. */}
      {user?.email?.toLowerCase() === 'max@bebllp.com' && (
        <CollapsibleCard
          storageKey="settings-expense-delegates"
          title="🤝 Expense Delegates"
          subtitle="Let one user submit expense reports on behalf of another (e.g. Ryan files for Alan). Reports are owned by the principal; the delegate appears only on a small audit line. Soft-deleted on revoke so historical filings stay attributed."
        >
          <ExpenseDelegatesPanel />
        </CollapsibleCard>
      )}

      {/* QuickBooks account mapping — admin / superadmin / accounting
          / partner. Drives the IIF + CSV exports from the Accounting
          Queue (⬇ Export to QB). Same audience as the Accounting
          Queue itself. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'accounting' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-quickbooks-mapping"
          title="💼 QuickBooks Account Mapping"
          subtitle="Map each portal expense category to its QuickBooks account. The export reads this map when generating IIF (QBD) + CSV (QBO) files. Use Parent:Child syntax to match QB's sub-accounts."
        >
          <QuickBooksMappingPanel />
        </CollapsibleCard>
      )}

      {/* White Sheet Upload — admin / superadmin / partner. Per-brand
          "Review every page" toggle (escape hatch for new-model
          rollouts) + 30-day pipeline-health stats. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-white-sheets"
          title="📄 White Sheet Upload"
          subtitle="Per-brand 'Review every page' escape hatch + 30-day pipeline stats (uploads, auto-commit rate, cost). The toggle forces every OCR'd page into the review pile regardless of the 5-check filter — handy for stress-testing a new model version."
        >
          <WhiteSheetSettingsPanel />
        </CollapsibleCard>
      )}

      {/* Spiff config — admin / superadmin / partner. Single
          row in spiff_config drives the auto-spiff amount. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-spiff-config"
          title="💵 Spiff Config"
          subtitle="Default spiff amount paid to a store salesperson when a trunk-show appointment results in a purchase. v1: single global amount."
        >
          <SpiffConfigPanel />
        </CollapsibleCard>
      )}

      {/* Office Staff Notifications — admin / superadmin / partner.
          Configure who gets emailed when a trunk rep submits a
          special request on a trunk show. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-office-staff-recipients"
          title="📣 Office Staff Notifications"
          subtitle="Who gets emailed when a trunk rep submits a special request on a trunk show. Add portal users (uses their portal email) or external addresses."
        >
          <OfficeStaffRecipientsPanel />
        </CollapsibleCard>
      )}

      {/* Trunk Rep Territories — admin / superadmin / partner.
          Maps states → reps so newly-created leads with a
          matching state auto-assign on save. Existing leads
          aren't re-routed. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-sales-rep-territories"
          title="🗺️ Trunk Rep Territories"
          subtitle="Assign each state to a trunk rep so new leads with a matching state auto-route on creation. Existing leads keep their current rep."
        >
          <SalesRepTerritoriesPanel />
        </CollapsibleCard>
      )}

      {/* Booth Cost Categories — admin / superadmin / partner.
          Master list driving the dropdown on each trade show's
          booth cost breakdown. Custom lines on a show stay
          per-show; this list seeds the common ones. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <CollapsibleCard
          storageKey="settings-booth-cost-categories"
          title="🎪 Booth Cost Categories"
          subtitle="Master list of booth-cost categories (Booth Space, Lighting, Drayage, etc.). Drives the dropdown on each trade show's cost breakdown. Archive instead of delete to keep historical line items readable."
        >
          <BoothCostCategoriesPanel />
        </CollapsibleCard>
      )}

      {/* Impersonation history (max@bebllp.com only — server route hard-rejects others) */}
      {user?.email?.toLowerCase() === 'max@bebllp.com' && (
        <CollapsibleCard
          storageKey="settings-impersonation-log"
          title="👁️ View-As History"
          subtitle="Every time you've impersonated another user. Your own audit trail."
        >
          <ImpersonationLogPanel />
        </CollapsibleCard>
      )}

      {/* Google Calendar Sync (superadmin only) */}
      {user?.role === 'superadmin' && (
        <GCalSyncSettings brand="beb" />
      )}
      {user?.role === 'superadmin' && (
        <GCalSyncSettings brand="liberty" />
      )}
      {/* Ad-hoc Google Calendar events (superadmin only) — one-off
          entries pushed directly into either a brand buying-events
          calendar or a trunk-rep's personal calendar. */}
      {user?.role === 'superadmin' && (
        <AdHocGCalEvents />
      )}

      {/* Travel Email Integration */}
      {(user?.role === 'admin' || user?.role === 'superadmin') && (
        <PostmarkSettings />
      )}

      {/* Travel Match Radius (admin/superadmin only) */}
      {(user?.role === 'admin' || user?.role === 'superadmin') && (
        <TravelMatchSettings />
      )}

      {/* Expense Settings (admin/superadmin only) */}
      {(user?.role === 'admin' || user?.role === 'superadmin') && (
        <ExpenseSettings />
      )}

      {/* W-9 Requester Info (admin/superadmin/accounting/partner) —
          pre-fills the "Person requesting information" box on every
          W-9 sent through the Accounting Hub. */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'accounting' || user?.is_partner) && (
        <W9RequesterSettings />
      )}

      {/* My Documents — shown to everyone. Currently surfaces the
          user's completed W-9(s) so they can re-download. Future tax
          docs (1099s, etc.) can land here too. */}
      <MyDocumentsSection />


      {/* Trip Templates (partner only — see is_partner) */}
      {user?.is_partner && <TripTemplatesSettings />}

      {/* Trunk Communications domain verification (admin/superadmin/partner) */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.is_partner) && (
        <TrunkCommsDomainSection />
      )}
    </div>
  )
}

/* ── TRUNK COMMS DOMAIN VERIFICATION (phase 2) ── */
function TrunkCommsDomainSection() {
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<
    | { kind: 'ok'; messageId: string; from: string; to: string }
    | { kind: 'err'; error: string }
    | null
  >(null)

  // Kill switch — disabled by default; admin must explicitly
  // enable before any letters can be sent to real customers.
  const [sendingEnabled, setSendingEnabled] = useState<boolean | null>(null)
  const [busyToggle, setBusyToggle] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('settings').select('value').eq('key', 'trunk_comms_send_enabled').maybeSingle()
      if (cancelled) return
      const raw = ((data as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
      setSendingEnabled(raw === 'true')
    })()
    return () => { cancelled = true }
  }, [])
  async function toggleEnabled() {
    const next = !sendingEnabled
    if (next) {
      const ok = confirm(
        `Enable trunk-show sending?\n\n` +
        `This unlocks the Send Email button for everyone with comms access. ` +
        `Real customer emails on file will start receiving letters once a rep clicks Send.\n\n` +
        `Type-check that the Confirmation Letter template + recipient on the test trunk show is correct first.`
      )
      if (!ok) return
    }
    setBusyToggle(true)
    await supabase.from('settings').upsert({
      key: 'trunk_comms_send_enabled',
      value: JSON.stringify(next ? 'true' : 'false'),
    })
    setSendingEnabled(next)
    setBusyToggle(false)
  }

  async function send() {
    if (!to.includes('@')) { alert('Enter a valid recipient email'); return }
    setSending(true); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/comms-test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ to: to.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResult({ kind: 'err', error: json.error || `Failed (${res.status})` })
        return
      }
      setResult({ kind: 'ok', messageId: json.message_id, from: json.from, to: json.to })
    } finally {
      setSending(false)
    }
  }

  return (
    <CollapsibleCard
      storageKey="settings-trunk-comms-domain"
      title="📨 Trunk Comms — Domain Verification"
      subtitle={<>Verifies that Resend will send from the <strong>bebllp.com</strong> apex (e.g. <code>tom@bebllp.com</code>). Existing outbound uses <code>updates.bebllp.com</code>; the apex needs separate DKIM + SPF records on GoDaddy before phase 5 send pipeline works.</>}
    >
      {/* Kill switch — first thing shown, most important control. */}
      <div style={{
        padding: 14, borderRadius: 8, marginBottom: 14,
        background: sendingEnabled ? 'var(--green-pale)' : '#fdecea',
        border: `2px solid ${sendingEnabled ? 'var(--green)' : '#7a1f0f'}`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: sendingEnabled ? 'var(--green-dark)' : '#7a1f0f' }}>
              {sendingEnabled ? '✅ Sending is ENABLED' : '🔒 Sending is DISABLED'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ash)', marginTop: 4, lineHeight: 1.5 }}>
              {sendingEnabled
                ? 'The Send Email button is unlocked for everyone with comms access. Real customer emails on file will receive letters once a rep clicks Send.'
                : 'The Send Email button is locked. Drafting + PDF preview still work, but no email goes out. Default for new deployments — flip when the templates and recipients are reviewed.'}
            </div>
          </div>
          <button
            onClick={toggleEnabled}
            disabled={busyToggle || sendingEnabled === null}
            className={sendingEnabled ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}
            style={{ flexShrink: 0 }}
          >
            {busyToggle ? '…' : sendingEnabled ? '🔒 Disable sending' : '🔓 Enable sending'}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--cream2)', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--ink)' }}>One-time setup on GoDaddy DNS for bebllp.com:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>In Resend dashboard → Domains → <strong>Add Domain</strong> → <code>bebllp.com</code>.</li>
          <li>Resend will give you 3 records (DKIM TXT, MX for bounces, SPF TXT). Add all three to GoDaddy DNS.</li>
          <li><strong>SPF gotcha:</strong> if you already have an SPF record for Google Workspace etc., merge — don't add a second SPF. Keep one record with all <code>include:…</code> entries.</li>
          <li>DMARC isn't required by Resend but recommended: <code>v=DMARC1; p=none; rua=mailto:postmaster@bebllp.com</code>.</li>
          <li>Hit <strong>Verify</strong> in Resend (5–60 min for propagation).</li>
          <li>Use the test send below to confirm a real send from your <code>@bebllp.com</code> address goes through.</li>
        </ol>
      </div>

      <div className="field">
        <label className="fl">Test send to</label>
        <input type="email" value={to} onChange={e => setTo(e.target.value)}
          placeholder="someone@example.com" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Sends from <strong>your</strong> @bebllp.com address. Use a personal inbox you control.
        </div>
      </div>

      <button onClick={send} disabled={sending || !to} className="btn-primary btn-sm">
        {sending ? 'Sending…' : '📤 Send test email'}
      </button>

      {result?.kind === 'ok' && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: '#e8f5e9', color: '#1b5e20', fontSize: 12 }}>
          ✓ Sent from <strong>{result.from}</strong> to <strong>{result.to}</strong>. Resend message id: <code>{result.messageId}</code>. Check inbox (and spam) — it should arrive within a minute.
        </div>
      )}
      {result?.kind === 'err' && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: '#fdecea', color: '#7a1f0f', fontSize: 12 }}>
          ✗ {result.error}
          {result.error.toLowerCase().includes('domain') && (
            <div style={{ marginTop: 6 }}>
              Most likely the apex isn't verified yet. Re-check the DNS records you added on GoDaddy and click Verify in the Resend dashboard.
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  )
}

/* ── EXPENSE SETTINGS ── */
function ExpenseSettings() {
  const [accountantEmail, setAccountantEmail] = useState('')
  const [accountantEmail2, setAccountantEmail2] = useState('')
  const [irsMileageRate, setIrsMileageRate] = useState('0.67')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: ae }, { data: ae2 }, { data: rate }] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'accountant_email').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'accountant_email_2').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'irs_mileage_rate').maybeSingle(),
      ])
      setAccountantEmail((ae?.value || '').replace(/^"|"$/g, ''))
      setAccountantEmail2((ae2?.value || '').replace(/^"|"$/g, ''))
      const rateVal = rate?.value
      const rateStr = rateVal == null
        ? '0.67'
        : (typeof rateVal === 'number' ? String(rateVal) : String(rateVal).replace(/^"|"$/g, ''))
      setIrsMileageRate(rateStr || '0.67')
      setLoading(false)
    }
    load()
  }, [])

  const status = useAutosave(
    { accountantEmail, accountantEmail2, irsMileageRate },
    async ({ accountantEmail, accountantEmail2, irsMileageRate }) => {
      // settings.value is JSONB — JSON.stringify so a bare string /
      // number passes column validation.
      const rate = Number(irsMileageRate)
      await Promise.all([
        supabase.from('settings').upsert({
          key: 'accountant_email',
          value: JSON.stringify(accountantEmail.trim()),
        }),
        supabase.from('settings').upsert({
          key: 'accountant_email_2',
          value: JSON.stringify(accountantEmail2.trim()),
        }),
        supabase.from('settings').upsert({
          key: 'irs_mileage_rate',
          value: JSON.stringify(Number.isFinite(rate) && rate > 0 ? rate : 0.67),
        }),
      ])
    },
    { enabled: !loading, delay: 800 },
  )

  if (loading) return null

  return (
    <CollapsibleCard
      storageKey="settings-expense"
      title="🧾 Expense Settings"
      titleAccessory={<AutosaveIndicator status={status} />}
      subtitle="Settings used by the Expenses & Invoicing module."
    >
      <div className="field">
        <label className="fl">Accountant Email</label>
        <input type="email" value={accountantEmail}
          onChange={e => setAccountantEmail(e.target.value)}
          placeholder="accountant@example.com" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Recipient for the auto-generated expense report email when a report is approved.
        </div>
      </div>

      <div className="field">
        <label className="fl">Accountant Email 2 (optional)</label>
        <input type="email" value={accountantEmail2}
          onChange={e => setAccountantEmail2(e.target.value)}
          placeholder="second-accountant@example.com" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Optional second recipient. Receives the same expense + marketing accountant emails as the primary.
        </div>
      </div>

      <div className="field">
        <label className="fl">IRS Mileage Rate ($/mile)</label>
        <input type="number" step="0.001" min="0" value={irsMileageRate}
          onChange={e => setIrsMileageRate(e.target.value)}
          placeholder="0.67" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Used by the mileage calculator. The 2025 IRS standard rate is $0.67/mi.
        </div>
      </div>
    </CollapsibleCard>
  )
}

/* ── W-9 REQUESTER SETTINGS ──
   Pre-fills the "Person requesting information" box at the top-right
   of every W-9 sent via the Accounting Hub. Stored at
   `settings.w9.requester_info` as a JSONB blob — see PR 1's
   supabase-migration-w9-requests.sql for the schema. */
function W9RequesterSettings() {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Beneficial Estate Buyers, LLC')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setStateUS] = useState('')
  const [zip, setZip] = useState('')
  const [phone, setPhone] = useState('')
  const [tin, setTin] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'w9.requester_info').maybeSingle()
      const v = (data?.value as any) || {}
      setName(v.name || 'Beneficial Estate Buyers, LLC')
      setAddress(v.address || '')
      setCity(v.city || '')
      setStateUS(v.state || '')
      setZip(v.zip || '')
      setPhone(v.phone || '')
      setTin(v.tin || '')
      setContactName(v.contact_name || '')
      setContactEmail(v.contact_email || '')
      setLoading(false)
    }
    load()
  }, [])

  const status = useAutosave(
    { name, address, city, state, zip, phone, tin, contactName, contactEmail },
    async (d) => {
      await supabase.from('settings').upsert({
        key: 'w9.requester_info',
        value: {
          name: d.name.trim(),
          address: d.address.trim(),
          city: d.city.trim(),
          state: d.state.trim().toUpperCase(),
          zip: d.zip.trim(),
          phone: d.phone.trim() || null,
          tin: d.tin.trim() || null,
          contact_name: d.contactName.trim() || null,
          contact_email: d.contactEmail.trim() || null,
        },
      })
    },
    { enabled: !loading, delay: 800 },
  )

  if (loading) return null

  return (
    <CollapsibleCard
      storageKey="settings-w9-requester"
      title="📧 W-9 Requester Info"
      titleAccessory={<AutosaveIndicator status={status} />}
      subtitle="Pre-fills the 'Person requesting information' box on every W-9 sent from the Accounting Hub."
    >
      <div className="field">
        <label className="fl">Company name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Beneficial Estate Buyers, LLC" />
      </div>
      <div className="field">
        <label className="fl">Address</label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <div className="field">
          <label className="fl">City</label>
          <input value={city} onChange={e => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label className="fl">State</label>
          <input value={state} onChange={e => setStateUS(e.target.value.slice(0, 2).toUpperCase())} maxLength={2} />
        </div>
        <div className="field">
          <label className="fl">ZIP</label>
          <input value={zip} onChange={e => setZip(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label className="fl">Phone (optional)</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="555-123-4567" />
        </div>
        <div className="field">
          <label className="fl">EIN (optional)</label>
          <input value={tin} onChange={e => setTin(e.target.value)} placeholder="12-3456789" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label className="fl">Contact name (optional)</label>
          <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Diane Smith" />
        </div>
        <div className="field">
          <label className="fl">Contact email (optional)</label>
          <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="accounting@bebllp.com" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
        This block appears in the top-right "Person requesting information" box on each W-9 PDF.
      </div>
    </CollapsibleCard>
  )
}

/* ── MY DOCUMENTS ──
   Each user's completed W-9 (and future tax docs). Visible to
   everyone — recipient pulls their PDF from the same /api/w9/[id]/pdf
   endpoint that staff use, RLS / API gate identical. */
function MyDocumentsSection() {
  const { user } = useApp()
  const [rows, setRows] = useState<Array<{ id: string; signed_at: string | null; recipient_name: string; status: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('w9_requests')
        .select('id, signed_at, recipient_name, status')
        .eq('recipient_user_id', user.id)
        .eq('status', 'completed')
        .order('signed_at', { ascending: false })
      if (cancelled) return
      setRows((data as any) || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  if (loading) return null

  return (
    <CollapsibleCard
      storageKey="settings-my-documents"
      title="📄 My Documents"
      subtitle="Tax documents on file for you. Re-download anytime."
    >
      {rows.length === 0 ? (
        <p style={{ color: 'var(--mist)', fontSize: 13, margin: 0 }}>
          No documents yet. Submitted W-9 forms will appear here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map(r => (
            <li key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderTop: '1px solid var(--pearl)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>IRS Form W-9</div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  Signed {r.signed_at ? new Date(r.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </div>
              </div>
              <a
                href={`/api/w9/${r.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline btn-sm"
              >
                Download PDF ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}

/* ── POSTMARK SETTINGS ── */
function PostmarkSettings() {
  const [serverToken, setServerToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: tok }, { data: sec }] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'postmark_server_token').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'postmark_webhook_secret').maybeSingle(),
      ])
      setServerToken((tok?.value || '').replace(/^"|"$/g, '').replace('change_me', ''))
      setWebhookSecret((sec?.value || '').replace(/^"|"$/g, '').replace('change_me', ''))
      setLoading(false)
    }
    load()
  }, [])

  const status = useAutosave(
    { serverToken, webhookSecret },
    async ({ serverToken, webhookSecret }) => {
      await Promise.all([
        supabase.from('settings').upsert({ key: 'postmark_server_token', value: JSON.stringify(serverToken) }),
        supabase.from('settings').upsert({ key: 'postmark_webhook_secret', value: JSON.stringify(webhookSecret) }),
      ])
    },
    { enabled: !loading, delay: 1000 }
  )

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/inbound-travel-email` : ''

  if (loading) return null

  return (
    <CollapsibleCard
      storageKey="settings-postmark"
      title="✈️ Travel Email Integration (Postmark)"
      titleAccessory={<AutosaveIndicator status={status} />}
      subtitle={<>Forward travel confirmation emails to <strong>travel@bebllp.com</strong> and they'll be automatically parsed and added to the right event. Sign up at <a href="https://postmarkapp.com" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>postmarkapp.com</a> (~$15/mo).</>}
    >
      <div className="field">
        <label className="fl">Postmark Server API Token</label>
        <input type="password" value={serverToken} onChange={e => setServerToken(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>Found in Postmark → Server → API Tokens</div>
      </div>

      <div className="field">
        <label className="fl">Webhook Secret</label>
        <input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)}
          placeholder="Set any secret string" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>Set this in Postmark → Inbound webhook settings as a custom header value</div>
      </div>

      <div className="field">
        <label className="fl">Your Webhook URL (copy this into Postmark)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={webhookUrl} readOnly style={{ flex: 1, background: 'var(--cream2)', color: 'var(--mist)', fontSize: 12 }} />
          <button className="btn-outline btn-sm" onClick={() => { navigator.clipboard.writeText(webhookUrl); alert('Copied!') }}>Copy</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>In Postmark → Inbound → Settings, set this as the Webhook URL</div>
      </div>

      <div className="card" style={{ background: 'var(--cream2)', margin: '8px 0 16px', padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', marginBottom: 8 }}>Setup Steps</div>
        <ol style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 2, paddingLeft: 16, margin: 0 }}>
          <li>Sign up at postmarkapp.com and create a server</li>
          <li>Add <strong>travel@bebllp.com</strong> as an inbound email address</li>
          <li>Set the webhook URL above in Postmark → Inbound → Settings</li>
          <li>Paste your Server API Token and a webhook secret above</li>
          <li>Buyers forward confirmation emails to <strong>travel@bebllp.com</strong></li>
          <li>Reservations appear automatically in Travel Share</li>
        </ol>
      </div>

    </CollapsibleCard>
  )
}

/* ── TRAVEL MATCH RADIUS (admin) ── */
// Configures the hotel-to-store mile radius used by the inbound
// travel-email matcher (PR 3 of the travel-match initiative). Also
// surfaces the one-shot "Geocode all stores" backfill that
// populates stores.lat/lon for matching.
function TravelMatchSettings() {
  const [radius, setRadius] = useState<number>(25)
  const [savingRadius, setSavingRadius] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | { total: number; geocoded: number; skipped: number; failed: Array<{ id: string; name: string; reason: string }> }>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'travel.match_radius_miles').maybeSingle()
      if (cancelled) return
      const raw = data?.value
      const n = typeof raw === 'number' ? raw : parseInt(String(raw || '25').replace(/[^\d]/g, ''))
      if (!Number.isNaN(n) && n > 0) setRadius(n)
    })()
    return () => { cancelled = true }
  }, [])

  async function saveRadius(v: number) {
    setSavingRadius(true)
    try {
      await supabase.from('settings').upsert({ key: 'travel.match_radius_miles', value: v as any })
    } finally { setSavingRadius(false) }
  }

  async function runBackfill(endpoint: string, force: boolean) {
    setBusy(true); setErr(null); setResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ force }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setResult(json)
    } catch (e: any) {
      setErr(e?.message || 'Backfill failed')
    }
    setBusy(false)
  }

  return (
    <CollapsibleCard
      storageKey="settings-travel-match"
      title="📍 Travel Match Radius"
      subtitle="Maximum hotel-to-store distance for inbound travel emails to auto-match an event. Reservations outside the radius land in the unassigned queue."
    >
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="fl">Radius (miles)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" min={1} max={500} step={1}
            value={radius}
            onChange={e => setRadius(Math.max(1, Math.min(500, parseInt(e.target.value) || 25)))}
            onBlur={() => saveRadius(radius)}
            style={{ width: 120 }} />
          {savingRadius && <span style={{ fontSize: 12, color: 'var(--mist)' }}>Saving…</span>}
        </div>
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--pearl)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>One-time setup: geocode stores &amp; trade-show venues</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 10 }}>
          Distance matching needs lat/lon on each store and trade-show venue. Run the backfill once for each (~$0.005 per lookup, ~5 seconds per 100 rows).
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <button onClick={() => runBackfill('/api/admin/geocode-stores', false)} disabled={busy} className="btn-primary btn-sm">
            {busy ? '…' : 'Geocode missing stores'}
          </button>
          <button onClick={() => runBackfill('/api/admin/geocode-stores', true)} disabled={busy} className="btn-outline btn-sm">
            Force re-geocode stores
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => runBackfill('/api/admin/geocode-trade-shows', false)} disabled={busy} className="btn-primary btn-sm">
            {busy ? '…' : 'Geocode missing trade shows'}
          </button>
          <button onClick={() => runBackfill('/api/admin/geocode-trade-shows', true)} disabled={busy} className="btn-outline btn-sm">
            Force re-geocode trade shows
          </button>
        </div>
        {err && (
          <div style={{ marginTop: 10, background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>
            {err}
          </div>
        )}
        {result && (
          <div style={{ marginTop: 10, background: 'var(--green-pale)', border: '1px solid var(--green3)', color: 'var(--green-dark)', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>
            Geocoded <strong>{result.geocoded}</strong> of <strong>{result.total}</strong> rows.
            {result.failed.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer' }}>{result.failed.length} need attention</summary>
                <ul style={{ marginTop: 6, paddingLeft: 20, fontSize: 12 }}>
                  {result.failed.slice(0, 20).map(f => (
                    <li key={f.id}><strong>{f.name}</strong> — {f.reason}</li>
                  ))}
                  {result.failed.length > 20 && <li>+ {result.failed.length - 20} more</li>}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </CollapsibleCard>
  )
}

/* ── GOOGLE CALENDAR SYNC SETTINGS (per brand) ── */
function GCalSyncSettings({ brand }: { brand: 'beb' | 'liberty' }) {
  const brandLabel = brand === 'liberty' ? 'Liberty' : 'Beneficial'
  const [enabled, setEnabled] = useState(false)
  const [calendarId, setCalendarId] = useState('')
  const [includeBuyers, setIncludeBuyers] = useState(true)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  // Dedupe (one-shot cleanup of duplicates that already exist on
  // the Google Calendar but no longer have a DB link row).
  // dedupePreview holds the most-recent /api/gcal-sync/dedupe
  // response in preview mode; null until the user clicks "Find".
  const [dedupePreview, setDedupePreview] = useState<any | null>(null)
  const [dedupeWorking, setDedupeWorking] = useState(false)
  const [dedupeError, setDedupeError] = useState<string | null>(null)
  // Purge cancelled — sister to dedupe. Scans Google for events
  // whose DB row is status='cancelled' (or doesn't exist anymore)
  // and removes them. Catches the gap PR #552's SQL backfill left
  // (events with status='cancelled' but no gcal_event_links row).
  const [purgePreview, setPurgePreview] = useState<any | null>(null)
  const [purgeWorking, setPurgeWorking] = useState(false)
  const [purgeError, setPurgeError] = useState<string | null>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [failedCount, setFailedCount] = useState(0)
  // Recent activity is long; collapsed by default. Per-brand persistence
  // via localStorage so each card remembers its state independently.
  const [activityOpen, setActivityOpen] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`gcal-activity-open-${brand}`)
      if (saved === '1') setActivityOpen(true)
    } catch { /* ignore */ }
  }, [brand])
  function toggleActivity() {
    const next = !activityOpen
    setActivityOpen(next)
    try { localStorage.setItem(`gcal-activity-open-${brand}`, next ? '1' : '0') } catch { /* ignore */ }
  }

  const reload = async () => {
    const [{ data: settings }, { data: recent }, { count: failed }] = await Promise.all([
      supabase.from('gcal_integration_settings').select('*').eq('brand', brand).maybeSingle(),
      supabase.from('gcal_sync_queue').select('id, action, status, last_error, created_at, processed_at, attempts')
        .eq('brand', brand).order('created_at', { ascending: false }).limit(20),
      supabase.from('gcal_sync_queue').select('id', { count: 'exact', head: true })
        .eq('brand', brand).eq('status', 'failed'),
    ])
    if (settings) {
      setEnabled(!!settings.enabled)
      setCalendarId(settings.calendar_id || '')
      setIncludeBuyers(settings.include_buyer_names !== false)
      setLastSync(settings.last_full_sync_at || null)
    }
    setActivity((recent || []) as any[])
    setFailedCount(failed || 0)
    setLoaded(true)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [brand])

  const save = async () => {
    setSaving(true)
    setTestResult(null)
    const { error } = await supabase.from('gcal_integration_settings').update({
      enabled, calendar_id: calendarId.trim() || null,
      include_buyer_names: includeBuyers,
      updated_at: new Date().toISOString(),
    }).eq('brand', brand)
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    reload()
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await fetch('/api/gcal-sync/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand }),
      })
      const json = await res.json().catch(() => ({}))
      setTestResult(json.ok ? '✓ Connected' : `✗ ${json.error || 'Failed'}`)
    } catch (e: any) {
      setTestResult('✗ Network error: ' + (e?.message || 'unknown'))
    }
    setTesting(false)
  }

  const fullSync = async () => {
    if (!confirm(`Re-push every ${brandLabel} event to Google Calendar? This may take a few minutes for the cron to drain.`)) return
    setSyncing(true); setSyncResult(null)
    try {
      const res = await fetch('/api/gcal-sync/full', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand }),
      })
      const json = await res.json().catch(() => ({}))
      setSyncResult(res.ok ? `Enqueued ${json.enqueued} events` : `Failed: ${json.error}`)
      reload()
    } catch (e: any) {
      setSyncResult('Network error: ' + (e?.message || 'unknown'))
    }
    setSyncing(false)
  }

  const retryRow = async (id: string) => {
    const res = await fetch(`/api/gcal-sync/${id}/retry`, { method: 'POST' })
    if (!res.ok) { alert('Retry failed'); return }
    reload()
  }

  // Dedupe — preview shows what would be deleted; apply runs the
  // deletion. Always start with preview so the operator can sanity-
  // check before touching the live calendar.
  const dedupePreviewRun = async () => {
    setDedupeWorking(true); setDedupeError(null); setDedupePreview(null)
    try {
      const res = await fetch('/api/gcal-sync/dedupe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, mode: 'preview' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setDedupeError(json.error || `Preview failed (${res.status})`)
      else setDedupePreview(json)
    } catch (e: any) {
      setDedupeError('Network error: ' + (e?.message || 'unknown'))
    }
    setDedupeWorking(false)
  }
  const dedupeApply = async () => {
    if (!dedupePreview) return
    const n = dedupePreview.losers_to_delete || 0
    if (!confirm(`Delete ${n} duplicate Google Calendar event${n === 1 ? '' : 's'} for ${brandLabel}? This cannot be undone.`)) return
    setDedupeWorking(true); setDedupeError(null)
    try {
      const res = await fetch('/api/gcal-sync/dedupe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, mode: 'apply' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setDedupeError(json.error || `Apply failed (${res.status})`)
      else setDedupePreview(json)
    } catch (e: any) {
      setDedupeError('Network error: ' + (e?.message || 'unknown'))
    }
    setDedupeWorking(false)
  }

  // Purge cancelled — same two-step pattern.
  const purgePreviewRun = async () => {
    setPurgeWorking(true); setPurgeError(null); setPurgePreview(null)
    try {
      const res = await fetch('/api/gcal-sync/purge-cancelled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, mode: 'preview' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setPurgeError(json.error || `Preview failed (${res.status})`)
      else setPurgePreview(json)
    } catch (e: any) {
      setPurgeError('Network error: ' + (e?.message || 'unknown'))
    }
    setPurgeWorking(false)
  }
  const purgeApply = async () => {
    if (!purgePreview) return
    const n = purgePreview.to_delete || 0
    if (!confirm(`Delete ${n} cancelled / orphan Google Calendar event${n === 1 ? '' : 's'} for ${brandLabel}? This cannot be undone.`)) return
    setPurgeWorking(true); setPurgeError(null)
    try {
      const res = await fetch('/api/gcal-sync/purge-cancelled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, mode: 'apply' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setPurgeError(json.error || `Apply failed (${res.status})`)
      else setPurgePreview(json)
    } catch (e: any) {
      setPurgeError('Network error: ' + (e?.message || 'unknown'))
    }
    setPurgeWorking(false)
  }

  if (!loaded) return null

  const accent = brand === 'liberty' ? '#3B82F6' : '#1D6B44'
  const fmtRel = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
  const STATUS_BG: Record<string, string> = { done: 'var(--green-pale)', pending: '#FEF3C7', processing: '#E0E7FF', failed: '#FEE2E2' }
  const STATUS_FG: Record<string, string> = { done: 'var(--green-dark)', pending: '#92400E', processing: '#3730A3', failed: '#991B1B' }

  return (
    <CollapsibleCard
      storageKey={`settings-gcal-${brand}`}
      title={`📅 Google Calendar Sync — ${brandLabel}`}
      subtitle={`Pushes every ${brandLabel} event into a single Google Calendar (one-way).`}
      topAccent={accent}
      headerExtra={
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label={<span style={{ fontWeight: 700, color: enabled ? 'var(--green-dark)' : 'var(--mist)' }}>{enabled ? 'Enabled' : 'Disabled'}</span>}
        />
      }
    >
      <div className="field" style={{ marginTop: 12 }}>
        <label className="fl">Calendar ID</label>
        <input value={calendarId} onChange={e => setCalendarId(e.target.value)}
          placeholder="c_xxxxxxxxxx@group.calendar.google.com"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          From Google Calendar → Settings → Integrate calendar → Calendar ID. See GOOGLE_CALENDAR_SETUP.md.
        </div>
      </div>

      <Checkbox
        checked={includeBuyers}
        onChange={setIncludeBuyers}
        label={<span style={{ fontSize: 12, color: 'var(--mist)' }}>Include buyer names in event description</span>}
        labelStyle={{ marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={save} disabled={saving} className="btn-primary btn-sm">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={test} disabled={testing || !calendarId} className="btn-outline btn-sm">
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button onClick={fullSync} disabled={syncing || !enabled} className="btn-outline btn-sm">
          {syncing ? 'Enqueuing…' : 'Sync all events now'}
        </button>
        {testResult && (
          <span style={{ fontSize: 12, color: testResult.startsWith('✓') ? 'var(--green-dark)' : '#991B1B', fontWeight: 700 }}>
            {testResult}
          </span>
        )}
        {syncResult && (
          <span style={{ fontSize: 12, color: 'var(--ash)' }}>{syncResult}</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
        Last full sync: {fmtRel(lastSync)} · Failed in queue: <strong style={{ color: failedCount > 0 ? '#991B1B' : 'var(--mist)' }}>{failedCount}</strong>
      </div>

      {/* Dedupe — one-shot cleanup of duplicates that already
          exist on the calendar but no longer have a DB link row.
          Always preview first; apply requires explicit confirm. */}
      <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 10, marginTop: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Dedupe Google Calendar
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8, lineHeight: 1.45 }}>
          Scans the {brandLabel} calendar, groups by portal event ID, keeps the canonical event per group, and deletes the rest. Click <strong>Find</strong> first to see what would be removed.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <button onClick={dedupePreviewRun} disabled={dedupeWorking || !enabled} className="btn-outline btn-sm">
            {dedupeWorking && !dedupePreview ? 'Scanning…' : 'Find duplicates'}
          </button>
          {dedupePreview && dedupePreview.mode === 'preview' && (dedupePreview.losers_to_delete > 0 || dedupePreview.link_fix_only_count > 0) && (
            <button onClick={dedupeApply} disabled={dedupeWorking} className="btn-primary btn-sm">
              {dedupeWorking ? 'Deleting…' : `Delete ${dedupePreview.losers_to_delete} duplicate${dedupePreview.losers_to_delete === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        {dedupeError && (
          <div style={{ fontSize: 12, color: '#991B1B', background: '#FEE2E2', padding: '6px 10px', borderRadius: 6, marginBottom: 6 }}>
            {dedupeError}
          </div>
        )}
        {dedupePreview && (
          <div style={{ fontSize: 11, color: 'var(--ash)', background: 'var(--cream2)', padding: 8, borderRadius: 6, marginTop: 4 }}>
            <div>
              {dedupePreview.mode === 'apply' ? (
                <strong style={{ color: 'var(--green-dark)' }}>Done — deleted {dedupePreview.deleted}{dedupePreview.delete_errors?.length ? `, ${dedupePreview.delete_errors.length} error${dedupePreview.delete_errors.length === 1 ? '' : 's'}` : ''}.</strong>
              ) : dedupePreview.losers_to_delete === 0 && dedupePreview.link_fix_only_count === 0 ? (
                <strong>No duplicates found.</strong>
              ) : (
                <strong>{dedupePreview.dupe_groups} group{dedupePreview.dupe_groups === 1 ? '' : 's'} of duplicates · {dedupePreview.losers_to_delete} event{dedupePreview.losers_to_delete === 1 ? '' : 's'} would be deleted{dedupePreview.link_fix_only_count > 0 ? ` · ${dedupePreview.link_fix_only_count} link${dedupePreview.link_fix_only_count === 1 ? '' : 's'} would be repaired` : ''}.</strong>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              Scanned {dedupePreview.calendar_total_events} calendar event{dedupePreview.calendar_total_events === 1 ? '' : 's'} · {dedupePreview.events_without_our_url} skipped (not portal-created) · {dedupePreview.portal_event_groups} unique portal event{dedupePreview.portal_event_groups === 1 ? '' : 's'} on calendar.
            </div>
            {dedupePreview.sample && dedupePreview.sample.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Sample (first {dedupePreview.sample.length})</summary>
                <ul style={{ paddingLeft: 18, marginTop: 4, marginBottom: 0 }}>
                  {dedupePreview.sample.map((g: any, i: number) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <code style={{ fontSize: 10 }}>{g.event_id.slice(0, 8)}…</code>
                      {' '}— keep <em>{g.keeping.summary || '(no title)'}</em> ({g.keeping.startDate}), delete {g.deleting.length}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Purge cancelled — companion to Dedupe. Removes Google
          Calendar events whose DB row is status='cancelled' (or
          gone entirely). Catches cancellations that the trigger
          missed because they predate cancelled_at tracking, plus
          orphans left behind by delete-forever. */}
      <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 10, marginTop: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Purge cancelled from Google Calendar
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8, lineHeight: 1.45 }}>
          Scans the {brandLabel} calendar and removes events whose portal record is cancelled (or deleted entirely). Use this after a bulk cancellation if anything stuck around.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <button onClick={purgePreviewRun} disabled={purgeWorking || !enabled} className="btn-outline btn-sm">
            {purgeWorking && !purgePreview ? 'Scanning…' : 'Find cancelled'}
          </button>
          {purgePreview && purgePreview.mode === 'preview' && purgePreview.to_delete > 0 && (
            <button onClick={purgeApply} disabled={purgeWorking} className="btn-primary btn-sm">
              {purgeWorking ? 'Deleting…' : `Delete ${purgePreview.to_delete} cancelled / orphan`}
            </button>
          )}
        </div>
        {purgeError && (
          <div style={{ fontSize: 12, color: '#991B1B', background: '#FEE2E2', padding: '6px 10px', borderRadius: 6, marginBottom: 6 }}>
            {purgeError}
          </div>
        )}
        {purgePreview && (
          <div style={{ fontSize: 11, color: 'var(--ash)', background: 'var(--cream2)', padding: 8, borderRadius: 6, marginTop: 4 }}>
            <div>
              {purgePreview.mode === 'apply' ? (
                <strong style={{ color: 'var(--green-dark)' }}>Done — deleted {purgePreview.deleted}{purgePreview.delete_errors?.length ? `, ${purgePreview.delete_errors.length} error${purgePreview.delete_errors.length === 1 ? '' : 's'}` : ''}.</strong>
              ) : purgePreview.to_delete === 0 ? (
                <strong>Nothing to purge — calendar is clean.</strong>
              ) : (
                <strong>{purgePreview.to_delete} event{purgePreview.to_delete === 1 ? '' : 's'} would be deleted ({purgePreview.cancelled_in_db} cancelled · {purgePreview.orphan_in_db} orphan).</strong>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              Scanned {purgePreview.calendar_total_events} calendar event{purgePreview.calendar_total_events === 1 ? '' : 's'} · {purgePreview.events_without_our_url} skipped (not portal-created) · {purgePreview.portal_event_groups} unique portal event{purgePreview.portal_event_groups === 1 ? '' : 's'} on calendar.
            </div>
            {purgePreview.sample && purgePreview.sample.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Sample (first {purgePreview.sample.length})</summary>
                <ul style={{ paddingLeft: 18, marginTop: 4, marginBottom: 0 }}>
                  {purgePreview.sample.map((t: any, i: number) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <code style={{ fontSize: 10 }}>{t.event_id.slice(0, 8)}…</code>
                      {' '}— <em>{t.google.summary || '(no title)'}</em> ({t.google.startDate}) — <strong>{t.reason}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 10, marginTop: 10 }}>
        <button onClick={toggleActivity} style={{
          display: 'block', width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0, fontFamily: 'inherit',
          fontSize: 11, fontWeight: 800, color: 'var(--ash)',
          textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6,
          whiteSpace: 'normal',
        }}>
          <span style={{
            display: 'inline-block', width: 10, marginRight: 4,
            transition: 'transform .15s ease',
            transform: activityOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>▶</span>
          Recent activity
          <span style={{ marginLeft: 6, fontWeight: 600, color: 'var(--mist)' }}>
            ({activity.length}{failedCount > 0 ? `, ${failedCount} failed` : ''})
          </span>
        </button>
        {activityOpen && (
          activity.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>No syncs yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {activity.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                  <span style={{
                    display: 'inline-block', minWidth: 64, textAlign: 'center',
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 800,
                    background: STATUS_BG[r.status] || 'var(--cream2)',
                    color: STATUS_FG[r.status] || 'var(--mist)',
                    textTransform: 'uppercase',
                  }}>{r.status}</span>
                  <span style={{ minWidth: 60, color: 'var(--mist)', textTransform: 'uppercase', fontSize: 10, fontWeight: 700 }}>{r.action}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.last_error || ''}
                  </span>
                  <span style={{ color: 'var(--mist)', fontSize: 10 }}>{fmtRel(r.processed_at || r.created_at)}</span>
                  {r.status === 'failed' && (
                    <button onClick={() => retryRow(r.id)} style={{
                      background: 'transparent', border: 'none', color: 'var(--green-dark)',
                      cursor: 'pointer', fontSize: 11, fontWeight: 700, textDecoration: 'underline',
                    }}>Retry</button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </CollapsibleCard>
  )
}

/* ── CENTER BUTTON SETTING (mobile bottom nav) ── */
function CenterButtonSetting() {
  const [mode, setMode] = useState<CenterModeOverride>('auto')
  useEffect(() => { setMode(getCenterModeOverride()) }, [])

  const update = (next: CenterModeOverride) => {
    setMode(next)
    setCenterModeOverride(next)
  }

  const options: { v: CenterModeOverride; label: string; hint: string }[] = [
    { v: 'auto', label: 'Auto', hint: "Switches to Scan during events you're working" },
    { v: 'always-travel', label: 'Always Travel', hint: 'Center button is always Travel Share' },
    { v: 'always-scan', label: 'Always Scan', hint: 'Center button is always Scan ID' },
  ]

  return (
    <CollapsibleCard
      storageKey="settings-center-button"
      title="📱 Mobile center button"
      subtitle="Choose what the center button does. Auto switches to Scan during events you're working."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map(opt => {
          const sel = mode === opt.v
          return (
            <label key={opt.v} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 8,
              border: `1.5px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
              background: sel ? 'var(--green-pale)' : 'white',
              cursor: 'pointer', position: 'relative',
            }}>
              {/* Visually-hidden input — the global `input { width: 100% }`
                  rule in globals.css mauls a raw radio, so we hide it and
                  render a custom circle (mirroring the shared Checkbox
                  pattern). */}
              <input
                type="radio" name="center-mode"
                checked={sel}
                onChange={() => update(opt.v)}
                style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
              />
              <span aria-hidden="true" style={{
                width: 18, height: 18, flexShrink: 0, marginTop: 2,
                borderRadius: '50%',
                border: `2px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
                background: '#FFFFFF',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color .15s ease',
              }}>
                {sel && (
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', background: 'var(--green)',
                  }} />
                )}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: sel ? 'var(--green-dark)' : 'var(--ink)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{opt.hint}</div>
              </div>
            </label>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}

/* ── ACTIVE BRAND NOTE (synced across devices) ── */
function ActiveBrandNote() {
  const { brand } = useApp()
  const label = brand === 'liberty' ? 'Liberty' : 'Beneficial'
  const accent = brand === 'liberty' ? '#3B82F6' : '#1D6B44'
  return (
    <CollapsibleCard
      storageKey="settings-active-brand"
      title="Active brand"
      topAccent={accent}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
          padding: '6px 12px', borderRadius: 999, background: accent, color: '#fff',
        }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--mist)' }}>
          Switch from the sidebar (or top of mobile menu).
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 10 }}>
        🔗 This selection is synced across all your devices — when you switch on one device the others follow on next load.
      </div>
    </CollapsibleCard>
  )
}
