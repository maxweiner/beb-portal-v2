'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/types'

const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'original',   label: 'Original',        color: '#1D6B44' },
  { id: 'salesforce', label: 'Salesforce Style', color: '#0070D2' },
  { id: 'apple',      label: 'Apple Style',      color: '#007AFF' },
]

export default function Settings() {
  const { user, stores, theme, setTheme, reload } = useApp()
  const [profile, setProfile] = useState({ name: user?.name || '', phone: user?.phone || '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notifyMaster, setNotifyMaster] = useState(user?.notify || false)
  const [storePrefs, setStorePrefs] = useState<Record<string, boolean>>({})
  const [loadingPrefs, setLoadingPrefs] = useState(true)
  const [photoUrl, setPhotoUrl] = useState(user?.photo_url || '')
  const photoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    supabase.from('settings').select('value').eq('key', `notify_stores_${user.id}`).maybeSingle()
      .then(({ data }) => {
        setStorePrefs(data?.value || {})
        setLoadingPrefs(false)
      })
  }, [user])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile.name.trim() || !user) return
    setSaving(true)
    await supabase.from('users').update({ name: profile.name.trim(), phone: profile.phone.trim() }).eq('id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    reload()
  }

  const uploadPhoto = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      await supabase.from('users').update({ photo_url: dataUrl }).eq('id', user!.id)
      setPhotoUrl(dataUrl)
      reload()
    }
    reader.readAsDataURL(file)
  }

  const toggleMasterNotify = async () => {
    if (!user) return
    const next = !notifyMaster
    setNotifyMaster(next)
    await supabase.from('users').update({ notify: next }).eq('id', user.id)
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

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Settings</h1>

      {/* Profile */}
      <div className="card">
        <div className="card-title">Profile</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => photoRef.current?.click()}>
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--pearl)' }} />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: '#fff' }}>
                {user?.name?.charAt(0) || 'U'}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--green)', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', border: '2px solid var(--cream)' }}>✎</div>
          </div>
          <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]) }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: 'var(--mist)' }}>{user?.email}</div>
            <span className={`badge badge-${user?.role === 'superadmin' ? 'ruby' : user?.role === 'admin' ? 'gold' : 'sapph'}`} style={{ marginTop: 4 }}>
              {user?.role}
            </span>
          </div>
        </div>
        <form onSubmit={saveProfile}>
          <div className="field">
            <label className="fl">Display Name</label>
            <input type="text" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="field">
            <label className="fl">Phone</label>
            <input type="tel" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary btn-sm"
            style={{ background: saved ? '#22c55e' : undefined }}>
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Profile'}
          </button>
        </form>
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
    </div>
  )
}
