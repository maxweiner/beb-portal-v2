'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import type { Theme, BuyerVacation } from '@/types'
import AvatarPicker from './AvatarPicker'
import Checkbox from '@/components/ui/Checkbox'
import AddressAutocompleteInput from '@/components/ui/AddressAutocompleteInput'
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
    home_address: user?.home_address || '',
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
      await supabase.from('users').update({
        name: p.name.trim(),
        phone: p.phone.trim(),
        home_address: p.home_address.trim() || null,
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
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
          Profile
          <AutosaveIndicator status={profileStatus} />
        </div>
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
          <label className="fl">Home Address</label>
          <AddressAutocompleteInput
            value={profile.home_address}
            placeholder="Start typing your address…"
            onChange={v => setProfile(p => ({ ...p, home_address: v }))} />
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
            Used by the mileage calculator (home → store → home). Pick from the suggestions to lock in a clean, geocodable address.
          </div>
        </div>
      </div>

      {showAvatarPicker && (
        <AvatarPicker
          currentPhoto={photoUrl}
          userName={user?.name || ''}
          onSave={saveAvatar}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}

      {/* Vacation Dates */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>Vacation Dates</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>You won't be assigned to events on these days</div>
          </div>
          <button className="btn-outline btn-xs" onClick={() => setShowVacForm(!showVacForm)}>
            {showVacForm ? 'Cancel' : '+ Add Dates'}
          </button>
        </div>

        {showVacForm && (
          <div style={{ padding: 14, background: 'var(--cream2)', borderRadius: 'var(--r)', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                <label className="fl">Start date</label>
                <input type="date" value={vacStart} onChange={e => { setVacStart(e.target.value); if (!vacEnd) setVacEnd(e.target.value) }} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                <label className="fl">End date</label>
                <input type="date" value={vacEnd} onChange={e => setVacEnd(e.target.value)} min={vacStart} />
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
      </div>

      {/* Notifications */}
      <div className="card">
        <div className="card-title">Email Notifications</div>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 20 }}>Receive email reports when buyers submit day data.</p>

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
      </div>

      {/* SMS Notifications */}
      <div className="card">
        <div className="card-title">SMS Notifications</div>
        <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 20 }}>Receive text message alerts when events are active.</p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Text Alerts</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>
              {profile.phone
                ? <>Messages go to <strong>{profile.phone}</strong></>
                : <>Add your phone number above to receive SMS notifications.</>}
            </div>
          </div>
          <button onClick={toggleSmsNotify} disabled={!profile.phone}
            style={{ width: 48, height: 24, borderRadius: 12, background: notifySms ? 'var(--green)' : 'var(--pearl)', position: 'relative', border: 'none', cursor: profile.phone ? 'pointer' : 'not-allowed', transition: 'background .2s', opacity: profile.phone ? 1 : 0.5 }}>
            <div style={{ position: 'absolute', top: 4, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s', left: notifySms ? 28 : 4 }} />
          </button>
        </div>
      </div>

      {/* Theme */}
      <div className="card">
        <div className="card-title">Appearance</div>
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
      </div>

      {/* Active brand — synced across devices */}
      {user?.liberty_access && <ActiveBrandNote />}

      {/* Mobile center button — visible to everyone since it's a per-user UI pref */}
      <CenterButtonSetting />

      {/* Google Calendar Sync (superadmin only) */}
      {user?.role === 'superadmin' && (
        <GCalSyncSettings brand="beb" />
      )}
      {user?.role === 'superadmin' && (
        <GCalSyncSettings brand="liberty" />
      )}

      {/* Travel Email Integration */}
      {(user?.role === 'admin' || user?.role === 'superadmin') && (
        <PostmarkSettings />
      )}

      {/* Expense Settings (admin/superadmin only) */}
      {(user?.role === 'admin' || user?.role === 'superadmin') && (
        <ExpenseSettings />
      )}

      {/* Trip Templates (partner only — see is_partner) */}
      {user?.is_partner && <TripTemplatesSettings />}
    </div>
  )
}

/* ── EXPENSE SETTINGS ── */
function ExpenseSettings() {
  const [accountantEmail, setAccountantEmail] = useState('')
  const [irsMileageRate, setIrsMileageRate] = useState('0.67')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: ae }, { data: rate }] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'accountant_email').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'irs_mileage_rate').maybeSingle(),
      ])
      setAccountantEmail((ae?.value || '').replace(/^"|"$/g, ''))
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
    { accountantEmail, irsMileageRate },
    async ({ accountantEmail, irsMileageRate }) => {
      // settings.value is JSONB — JSON.stringify so a bare string /
      // number passes column validation.
      const rate = Number(irsMileageRate)
      await Promise.all([
        supabase.from('settings').upsert({
          key: 'accountant_email',
          value: JSON.stringify(accountantEmail.trim()),
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
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
        🧾 Expense Settings
        <AutosaveIndicator status={status} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.6 }}>
        Settings used by the Expenses & Invoicing module.
      </p>

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
        <label className="fl">IRS Mileage Rate ($/mile)</label>
        <input type="number" step="0.001" min="0" value={irsMileageRate}
          onChange={e => setIrsMileageRate(e.target.value)}
          placeholder="0.67" />
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
          Used by the mileage calculator. The 2025 IRS standard rate is $0.67/mi.
        </div>
      </div>
    </div>
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
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
        ✈️ Travel Email Integration (Postmark)
        <AutosaveIndicator status={status} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.6 }}>
        Forward travel confirmation emails to <strong>travel@bebllp.com</strong> and they'll be automatically parsed and added to the right event.
        Sign up at <a href="https://postmarkapp.com" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>postmarkapp.com</a> (~$15/mo).
      </p>

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

    </div>
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
  const [activity, setActivity] = useState<any[]>([])
  const [failedCount, setFailedCount] = useState(0)

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

  if (!loaded) return null

  const accent = brand === 'liberty' ? '#3B82F6' : '#1D6B44'
  const fmtRel = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
  const STATUS_BG: Record<string, string> = { done: 'var(--green-pale)', pending: '#FEF3C7', processing: '#E0E7FF', failed: '#FEE2E2' }
  const STATUS_FG: Record<string, string> = { done: 'var(--green-dark)', pending: '#92400E', processing: '#3730A3', failed: '#991B1B' }

  return (
    <div className="card" style={{ marginTop: 18, borderTop: `4px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div className="card-title" style={{ margin: 0 }}>📅 Google Calendar Sync — {brandLabel}</div>
          <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
            Pushes every {brandLabel} event into a single Google Calendar (one-way).
          </div>
        </div>
        <Checkbox
          checked={enabled}
          onChange={setEnabled}
          label={<span style={{ fontWeight: 700, color: enabled ? 'var(--green-dark)' : 'var(--mist)' }}>{enabled ? 'Enabled' : 'Disabled'}</span>}
        />
      </div>

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

      <div style={{ borderTop: '1px solid var(--cream2)', paddingTop: 10, marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Recent activity
        </div>
        {activity.length === 0 ? (
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
        )}
      </div>
    </div>
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
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-title">📱 Mobile center button</div>
      <p style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 14 }}>
        Choose what the center button does. Auto switches to Scan during events you're working.
      </p>
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
    </div>
  )
}

/* ── ACTIVE BRAND NOTE (synced across devices) ── */
function ActiveBrandNote() {
  const { brand } = useApp()
  const label = brand === 'liberty' ? 'Liberty' : 'Beneficial'
  const accent = brand === 'liberty' ? '#3B82F6' : '#1D6B44'
  return (
    <div className="card" style={{ marginTop: 18, borderTop: `4px solid ${accent}` }}>
      <div className="card-title">Active brand</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
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
    </div>
  )
}
