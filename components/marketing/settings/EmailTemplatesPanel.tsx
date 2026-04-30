'use client'

// Editable email template subjects + bodies for the marketing module.
// Reuses the existing report_templates table (subject/greeting/header_
// subtitle/footer/shoutout_fallback) to avoid a new schema for what is
// essentially the same shape. Marketing IDs prefixed with "marketing-"
// so they don't collide with the Reports tile catalogue.
//
// Templates are upserted on first save (mirrors the Reports editor).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'

interface TemplateDef {
  id: string
  title: string
  description: string
  varHint: string
  defaults: Partial<TemplateRow>
}

interface TemplateRow {
  id: string
  subject: string
  greeting: string
  header_subtitle: string
  footer: string
  shoutout_fallback: string
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'marketing-team-notification',
    title: 'Marketing Team Notification',
    description: 'Sent when "Notify Marketing Team" is clicked on a campaign with a budget set.',
    varHint: '{store_name}, {full_address}, {date_range}, {budget_amount}, {magic_link_url}',
    defaults: {
      subject: 'New event at {store_name} — marketing setup',
      greeting: 'Dear Collected Team,',
      header_subtitle: '{store_name} · {date_range}',
      shoutout_fallback:
        'There is a new event at {store_name}. The address is {full_address}. Our dates for the buying event are {date_range}. Our marketing budget is ${budget_amount}.\n\nPlease use the link below to set up the campaign: {magic_link_url}',
      footer: 'Beneficial Estate Buyers · Marketing',
    },
  },
  {
    id: 'marketing-approver-planning',
    title: 'Approver — Planning Submitted',
    description: 'Sent to all active approvers when Collected submits planning (zips for VDP, list selection for Postcard).',
    varHint: '{store_name}, {date_range}, {flow_type}, {campaign_url}',
    defaults: {
      subject: 'Approval needed: {flow_type} planning for {store_name}',
      greeting: 'Hi team,',
      header_subtitle: '{store_name} · {date_range}',
      shoutout_fallback: 'A {flow_type} campaign for {store_name} ({date_range}) is awaiting your planning approval. Open the campaign to review and approve: {campaign_url}',
      footer: 'Beneficial Estate Buyers · Marketing',
    },
  },
  {
    id: 'marketing-approver-proof',
    title: 'Approver — Proof Uploaded',
    description: 'Sent to all active approvers when Collected uploads a new proof. Includes the proof artwork inline so reply-with-"approve" works.',
    varHint: '{store_name}, {date_range}, {flow_type}, {version_number}, {campaign_url}',
    defaults: {
      subject: 'Proof v{version_number} ready: {flow_type} for {store_name}',
      greeting: 'Hi team,',
      header_subtitle: '{store_name} · {date_range}',
      shoutout_fallback: 'Version {version_number} of the {flow_type} proof for {store_name} is ready for review. Reply "approve" to approve, or open the campaign for comments + revisions: {campaign_url}',
      footer: 'Beneficial Estate Buyers · Marketing',
    },
  },
  {
    id: 'marketing-approver-payment',
    title: 'Approver — Payment Requested',
    description: 'Sent to all active approvers when Collected requests payment after a proof is approved.',
    varHint: '{store_name}, {date_range}, {budget_amount}, {flow_type}, {campaign_url}',
    defaults: {
      subject: 'Payment authorization needed: ${budget_amount} for {store_name}',
      greeting: 'Hi team,',
      header_subtitle: '{store_name} · {date_range}',
      shoutout_fallback: 'Collected has requested payment authorization of ${budget_amount} for the {flow_type} campaign at {store_name}. Open the campaign to pick a payment method: {campaign_url}',
      footer: 'Beneficial Estate Buyers · Marketing',
    },
  },
  {
    id: 'marketing-accountant-receipt',
    title: 'Accountant Receipt Cover',
    description: 'Body of the email that goes to the configured accountant address when a campaign is marked Paid. PDF receipt is attached automatically.',
    varHint: '{store_name}, {date_range}, {amount_paid}, {payment_method_label}, {paid_at}',
    defaults: {
      subject: 'Marketing receipt: {store_name} ({date_range}) · ${amount_paid}',
      greeting: 'Receipt attached.',
      header_subtitle: '{store_name} · {date_range}',
      shoutout_fallback: 'Marketing for {store_name} ({date_range}) has been paid: ${amount_paid} on {payment_method_label} on {paid_at}. PDF attached.',
      footer: 'Beneficial Estate Buyers',
    },
  },
]

export default function EmailTemplatesPanel() {
  const { user } = useApp()
  const [activeId, setActiveId] = useState<string>(TEMPLATES[0].id)
  const def = useMemo(() => TEMPLATES.find(t => t.id === activeId)!, [activeId])
  const [tpl, setTpl] = useState<TemplateRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSavedAt(null)
    ;(async () => {
      const { data } = await supabase.from('report_templates')
        .select('*').eq('id', def.id).maybeSingle()
      if (cancelled) return
      if (data) {
        setTpl(data as TemplateRow)
      } else {
        // First-time editor: load defaults; row gets upserted on Save
        setTpl({
          id: def.id,
          subject: def.defaults.subject ?? '',
          greeting: def.defaults.greeting ?? '',
          header_subtitle: def.defaults.header_subtitle ?? '',
          footer: def.defaults.footer ?? '',
          shoutout_fallback: def.defaults.shoutout_fallback ?? '',
        })
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [def.id])

  async function save() {
    if (!tpl) return
    setSaving(true)
    const { error } = await supabase.from('report_templates').upsert({
      id: tpl.id,
      subject: tpl.subject,
      greeting: tpl.greeting,
      header_subtitle: tpl.header_subtitle,
      footer: tpl.footer,
      shoutout_fallback: tpl.shoutout_fallback,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    }, { onConflict: 'id' })
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSavedAt(new Date())
  }

  function setField<K extends keyof TemplateRow>(k: K, v: TemplateRow[K]) {
    setTpl(p => p ? { ...p, [k]: v } : p)
    setSavedAt(null)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, alignItems: 'start' }}>
      {/* Template picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {TEMPLATES.map(t => {
          const sel = activeId === t.id
          return (
            <button key={t.id} onClick={() => setActiveId(t.id)} style={{
              textAlign: 'left', padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--pearl)',
              background: sel ? 'var(--green-pale)' : '#fff',
              color: sel ? 'var(--green-dark)' : 'var(--ink)',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
            }}>{t.title}</button>
          )
        })}
      </div>

      {/* Editor */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{def.title}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2, marginBottom: 14 }}>
          {def.description}
        </div>

        {loading || !tpl ? (
          <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div className="field">
              <label className="fl">Subject line</label>
              <input value={tpl.subject} onChange={e => setField('subject', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Greeting</label>
              <input value={tpl.greeting} onChange={e => setField('greeting', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Header subtitle</label>
              <input value={tpl.header_subtitle} onChange={e => setField('header_subtitle', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Body</label>
              <textarea rows={6} value={tpl.shoutout_fallback}
                onChange={e => setField('shoutout_fallback', e.target.value)} />
            </div>
            <div className="field">
              <label className="fl">Footer</label>
              <input value={tpl.footer} onChange={e => setField('footer', e.target.value)} />
            </div>

            <p style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
              <strong>Variables:</strong> {def.varHint}
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                {saving ? 'Saving…' : 'Save template'}
              </button>
              {savedAt && (
                <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>
                  ✓ Saved {savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
