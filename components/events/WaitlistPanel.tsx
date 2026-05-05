'use client'

// Staff waitlist panel — embedded in each live event card on the
// During-Event tab.
//
//   • Shows the active queue (status='waiting' AND expires_at > now())
//   • Per-row actions: Call Up · Served · No-Show
//   • "Add Walk-In" form for staff to add someone manually
//   • "Show QR" modal with the public signup URL + a QR for printing

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { Event, EventWaitlistEntry, EventWaitlistNotifyPref } from '@/types'

interface Props {
  ev: Event
}

const portalUrl = (() => {
  if (typeof window !== 'undefined') return window.location.origin
  return (process.env.NEXT_PUBLIC_PORTAL_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://beb-portal-v2.vercel.app')
})()

export default function WaitlistPanel({ ev }: Props) {
  const { user, stores } = useApp()
  const [entries, setEntries] = useState<EventWaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showQr, setShowQr] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const signupUrl = `${portalUrl}/waitlist/${ev.id}`

  async function reload() {
    setLoading(true)
    const nowIso = new Date().toISOString()
    const { data } = await supabase
      .from('event_waitlist')
      .select('*')
      .eq('event_id', ev.id)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
    setEntries((data || []) as EventWaitlistEntry[])
    setLoading(false)
  }
  useEffect(() => { reload() }, [ev.id])

  const active = entries.filter(e => e.status === 'waiting')
  const called = entries.filter(e => e.status === 'called')

  async function callUp(entryId: string) {
    if (!confirm("Mark this customer as up next?\n(Sends SMS if they chose 'Text me'.)")) return
    setBusy(entryId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/waitlist/entry/${entryId}/call`, {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { alert(json.error || `Failed (${res.status})`); return }
      reload()
    } finally { setBusy(null) }
  }

  async function setStatus(entryId: string, status: 'served' | 'no_show' | 'waiting') {
    setBusy(entryId)
    const update: any = { status }
    if (status === 'served') update.served_at = new Date().toISOString()
    if (status === 'waiting') { update.called_at = null; update.called_by_user_id = null }
    const { error } = await supabase.from('event_waitlist').update(update).eq('id', entryId)
    setBusy(null)
    if (error) { alert(error.message); return }
    reload()
  }

  return (
    <div style={{ marginTop: 14, padding: 12, background: 'var(--cream2)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          🪑 Waitlist · {active.length} waiting{called.length > 0 ? ` · ${called.length} called` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowQr(true)} className="btn-outline btn-xs">📱 Show QR</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary btn-xs">+ Add walk-in</button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>Loading…</div>
      ) : active.length === 0 && called.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', padding: '8px 0', textAlign: 'center' }}>
          No one on the waitlist yet. Customers can scan the QR to add themselves.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...called, ...active].map((e, idx) => (
            <WaitlistRow
              key={e.id}
              entry={e}
              position={e.status === 'called' ? null : (idx + 1 - called.length)}
              busy={busy === e.id}
              onCallUp={() => callUp(e.id)}
              onServed={() => setStatus(e.id, 'served')}
              onNoShow={() => setStatus(e.id, 'no_show')}
              onUndo={() => setStatus(e.id, 'waiting')}
            />
          ))}
        </div>
      )}

      {showQr && <QrModal url={signupUrl} storeName={stores.find(s => s.id === ev.store_id)?.name || ev.store_name || ''} onClose={() => setShowQr(false)} />}
      {showAdd && <AddWalkInModal eventId={ev.id} userId={user?.id} onClose={() => setShowAdd(false)} onAdded={reload} />}
    </div>
  )
}

function WaitlistRow({
  entry, position, busy, onCallUp, onServed, onNoShow, onUndo,
}: {
  entry: EventWaitlistEntry
  position: number | null
  busy: boolean
  onCallUp: () => void
  onServed: () => void
  onNoShow: () => void
  onUndo: () => void
}) {
  const isCalled = entry.status === 'called'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '6px 10px', borderRadius: 6,
      background: isCalled ? '#fff8e1' : '#fff',
      border: `1px solid ${isCalled ? '#ffd54f' : 'var(--cream2)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <span style={{
          minWidth: 24, height: 24, borderRadius: '50%',
          background: isCalled ? '#d4a017' : 'var(--green)',
          color: '#fff', fontSize: 11, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{isCalled ? '!' : position}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entry.name}
            {entry.notify_pref === 'sms' && <span style={{ marginLeft: 6, fontSize: 10, color: '#1e40af' }}>📱 Text</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>
            <a href={`tel:${entry.phone}`} style={{ color: 'var(--mist)', textDecoration: 'none' }}>{entry.phone}</a>
            {' · '}{entry.item_count} item{entry.item_count === 1 ? '' : 's'}
            {entry.how_heard && <> · {entry.how_heard}</>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {!isCalled && (
          <button onClick={onCallUp} disabled={busy} className="btn-primary btn-xs">Call Up</button>
        )}
        {isCalled && (
          <>
            <button onClick={onServed} disabled={busy} className="btn-primary btn-xs">✓ Served</button>
            <button onClick={onNoShow} disabled={busy} className="btn-outline btn-xs">No-show</button>
            <button onClick={onUndo} disabled={busy} className="btn-outline btn-xs" title="Move back to waiting">↺</button>
          </>
        )}
      </div>
    </div>
  )
}

function QrModal({ url, storeName, onClose }: { url: string; storeName: string; onClose: () => void }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
          Waitlist QR — {storeName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 16 }}>
          Scan to put yourself on today's list
        </div>
        <div style={{ background: '#fff', padding: 16, display: 'inline-block', border: '1px solid var(--cream2)', borderRadius: 8 }}>
          <QRCodeSVG value={url} size={220} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 12, wordBreak: 'break-all' }}>{url}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => navigator.clipboard.writeText(url).then(() => alert('Copied!'))} className="btn-outline btn-sm">Copy URL</button>
          <button onClick={onClose} className="btn-primary btn-sm">Close</button>
        </div>
      </div>
    </div>
  )
}

function AddWalkInModal({
  eventId, userId, onClose, onAdded,
}: { eventId: string; userId?: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState('')
  const [howHeard, setHowHeard] = useState('')
  const [notifyPref, setNotifyPref] = useState<EventWaitlistNotifyPref>('wait')
  const [saving, setSaving] = useState(false)
  const [heardOptions, setHeardOptions] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Look up the store's how-heard list via the same path the public form uses.
      const { data: ev } = await supabase.from('events').select('store_id').eq('id', eventId).maybeSingle()
      if (!ev) return
      const { data: cfg } = await supabase.from('booking_config').select('hear_about_options').eq('store_id', ev.store_id).maybeSingle()
      if (cancelled) return
      setHeardOptions(Array.isArray(cfg?.hear_about_options) && cfg!.hear_about_options.length > 0
        ? cfg!.hear_about_options as string[]
        : ['Postcard', 'VDP', 'Newspaper', 'Social media', 'Word of mouth', 'Repeat customer', 'Other'])
    })()
    return () => { cancelled = true }
  }, [eventId])

  async function save() {
    if (!name.trim() || !phone.trim() || !items.trim()) { alert('Name, phone, and # items required'); return }
    const itemCount = Number(items)
    if (!Number.isFinite(itemCount) || itemCount < 0) { alert('Items must be a non-negative number'); return }
    setSaving(true)
    // Compute today's 7pm via a quick tz heuristic — match the API logic.
    const expiresAt = computeExpiresAt()
    const { error } = await supabase.from('event_waitlist').insert({
      event_id: eventId,
      name: name.trim(),
      phone: phone.trim(),
      item_count: itemCount,
      how_heard: howHeard || null,
      notify_pref: notifyPref,
      expires_at: expiresAt,
      added_by_user_id: userId || null,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    onAdded()
    onClose()
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto',
      }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 400, width: '100%', marginTop: 60 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>+ Add walk-in</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input label="Name" value={name} onChange={setName} />
          <Input label="Phone" value={phone} onChange={setPhone} />
          <Input label="# Items" value={items} onChange={setItems} type="number" />
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            How did they hear?
            <select value={howHeard} onChange={e => setHowHeard(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }}>
              <option value="">— Select —</option>
              {heardOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
            Notify when up
            <select value={notifyPref} onChange={e => setNotifyPref(e.target.value as EventWaitlistNotifyPref)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2 }}>
              <option value="wait">Wait here — call name</option>
              <option value="sms">Text them</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn-outline btn-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
      {label}
      <input value={value} onChange={e => onChange(e.target.value)} type={type}
        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--cream2)', borderRadius: 6, fontFamily: 'inherit', marginTop: 2, minHeight: 36 }} />
    </label>
  )
}

function computeExpiresAt(): string {
  // Today's 7pm in browser-local time. Server enforces store-local;
  // this client-side approximation is fine for staff-added entries
  // since they're already at the event.
  const d = new Date()
  d.setHours(19, 0, 0, 0)
  if (d <= new Date()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}
