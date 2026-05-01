'use client'

// Per-campaign detail view. Phase 3 scope: phase indicator (rough),
// budget input, "Notify Marketing Team" button, mail-by date display.
// Planning / Proofing / Payment / Done sections land in Phases 4-8.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign, MarketingStatus, Event } from '@/types'
import PhaseTimeline from './PhaseTimeline'
import PhaseStepCard from './PhaseStepCard'
import VDPPlanningSection from './VDPPlanningSection'
import PostcardPlanningSection from './PostcardPlanningSection'
import NewspaperPlanningSection from './NewspaperPlanningSection'
import ProofingSection from './ProofingSection'
import PaymentSection from './PaymentSection'
import DoneSection from './DoneSection'
import MarketingQrSection from './MarketingQrSection'
import FilesArtifactsSection from './FilesArtifactsSection'
import RoleLabel from './RoleLabel'

const FLOW_LABELS = {
  vdp: '📬 VDP Mailers',
  postcard: '📮 Postcards',
  newspaper: '📰 Newspaper',
} as const

export default function CampaignDetail({ campaign, onBack, onChanged, onDeleted }: {
  campaign: MarketingCampaign
  onBack: () => void
  onChanged: (next: MarketingCampaign) => void
  onDeleted: (id: string) => void
}) {
  const { events, stores, user, users } = useApp()
  const event = useMemo(() => events.find(e => e.id === campaign.event_id), [events, campaign.event_id])
  const store = useMemo(() => stores.find(s => s.id === event?.store_id), [stores, event?.store_id])
  const storeName = store?.name || event?.store_name || '(unknown store)'
  const isMarketingRole = user?.role === 'marketing'

  // Smart-collapse state: phases the user has manually expanded.
  // Active phase is always expanded regardless of this set.
  const [expandedOverride, setExpandedOverride] = useState<Set<MarketingStatus>>(new Set())
  function toggleOverride(p: MarketingStatus) {
    setExpandedOverride(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p); else n.add(p)
      return n
    })
  }
  // Refs for scroll-into-view from the sticky stepper. Declared one
  // per phase (must be unconditional hooks) then bundled into a map.
  const setupRef    = useRef<HTMLDivElement>(null)
  const planningRef = useRef<HTMLDivElement>(null)
  const proofingRef = useRef<HTMLDivElement>(null)
  const paymentRef  = useRef<HTMLDivElement>(null)
  const doneRef     = useRef<HTMLDivElement>(null)
  const phaseRefs: Record<MarketingStatus, React.RefObject<HTMLDivElement>> = {
    setup: setupRef, planning: planningRef, proofing: proofingRef,
    payment: paymentRef, done: doneRef,
  }
  function jumpToPhase(p: MarketingStatus) {
    setExpandedOverride(prev => { const n = new Set(prev); n.add(p); return n })
    // Wait a tick so the (potentially newly-expanded) section is in the DOM.
    setTimeout(() => {
      phaseRefs[p].current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  // Done-summary text per phase. Pulled from campaign fields so no
  // extra queries are needed; "—" for fields not yet populated.
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const fmtDate = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
  const fmtMoney = (n: number | null | undefined) => n != null
    ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '—'
  const setupSummary = `${fmtMoney(campaign.marketing_budget)} budget · Notified ${fmtDate(campaign.team_notified_at)}`
  const paymentSummary = campaign.paid_at
    ? `Paid via ${campaign.payment_method_label || 'card'} on ${fmtDate(campaign.paid_at)}${campaign.paid_by ? ` by ${userById.get(campaign.paid_by)?.name || ''}` : ''}`
    : 'Paid'

  // Local edit state for budget
  const [budgetInput, setBudgetInput] = useState<string>(
    campaign.marketing_budget != null ? String(campaign.marketing_budget) : ''
  )
  const [savingBudget, setSavingBudget] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [notifyResult, setNotifyResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBudgetInput(campaign.marketing_budget != null ? String(campaign.marketing_budget) : '')
  }, [campaign.id, campaign.marketing_budget])

  const hasBudget = !!(campaign.marketing_budget && Number(campaign.marketing_budget) > 0)

  async function saveBudget() {
    const n = Number(budgetInput)
    if (!Number.isFinite(n) || n < 0) {
      setError('Budget must be a non-negative number.'); return
    }
    setSavingBudget(true); setError(null)
    const patch = {
      marketing_budget: n,
      budget_set_by: user?.id ?? null,
      budget_set_at: new Date().toISOString(),
    }
    const { data, error: upErr } = await supabase
      .from('marketing_campaigns')
      .update(patch)
      .eq('id', campaign.id)
      .select('*').single()
    setSavingBudget(false)
    if (upErr || !data) { setError(upErr?.message || 'Save failed'); return }
    onChanged(data as MarketingCampaign)
  }

  async function notifyTeam() {
    if (!hasBudget) { setError('Set a marketing budget first.'); return }
    if (campaign.team_notified_at && !confirm('You\'ve already notified the team for this campaign. Send again?')) return
    setNotifying(true); setNotifyResult(null); setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(`/api/marketing/campaigns/${campaign.id}/notify-team`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`)
      } else {
        setNotifyResult(`✓ Notified ${json.sent} recipient${json.sent === 1 ? '' : 's'}${json.failed ? ` · ${json.failed} failed` : ''}`)
        // Refresh the campaign so team_notified_at + sub_status reflect
        const { data } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
        if (data) onChanged(data as MarketingCampaign)
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setNotifying(false)
  }

  async function deleteCampaign() {
    if (!confirm(`Delete the ${campaign.flow_type.toUpperCase()} campaign for ${storeName}? This is irreversible.`)) return
    const { error: delErr } = await supabase.from('marketing_campaigns').delete().eq('id', campaign.id)
    if (delErr) { setError(delErr.message); return }
    onDeleted(campaign.id)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <button className="btn-outline btn-sm" onClick={onBack}>← All campaigns</button>
        <button onClick={deleteCampaign} style={{
          background: 'transparent', border: 'none', color: 'var(--red)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline',
          fontFamily: 'inherit', padding: 0,
        }}>Delete this campaign</button>
      </div>

      {/* Header */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {FLOW_LABELS[campaign.flow_type]} · Campaign
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginTop: 4 }}>
          {storeName}
        </h2>
        <EventMeta event={event} />
      </div>

      {/* Sticky phase indicator. position: sticky pins it to the top
          of the scroll container as the user scrolls through phases. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        marginLeft: -2, marginRight: -2,
        paddingTop: 2,
        background: 'var(--page-bg, transparent)',
      }}>
        <PhaseTimeline campaign={campaign} onPhaseClick={jumpToPhase} />
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* ── 1. Setup ───────────────────────────────────────── */}
      <PhaseStepCard ref={setupRef}
        phase="setup" campaignStatus={campaign.status}
        number={1} title="Setup" roleSuffix="Buyers"
        doneSummary={setupSummary}
        forceOpen={expandedOverride.has('setup')}
        onToggle={() => toggleOverride('setup')}>
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
          1. Setup <RoleLabel>(Buyers)</RoleLabel>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
          {isMarketingRole
            ? 'The buyer sets the budget here and notifies your team. Read-only for the marketing team.'
            : 'Set the marketing budget for this campaign, then notify the team to start planning.'}
        </div>

        {isMarketingRole ? (
          <div style={{
            background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
            padding: '10px 14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Marketing budget
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>
                {hasBudget
                  ? `$${Number(campaign.marketing_budget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'Not set yet'}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--mist)', textAlign: 'right' }}>
              {campaign.team_notified_at
                ? <>✓ Notified {new Date(campaign.team_notified_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</>
                : 'Not notified yet'}
            </div>
          </div>
        ) : (
          <>
            {/* Budget */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
              <div>
                <label className="fl">Marketing Budget <RoleLabel>(Buyers)</RoleLabel></label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontWeight: 700 }}>$</span>
                  <input type="number" min={0} step="0.01" value={budgetInput}
                    onChange={e => setBudgetInput(e.target.value)}
                    placeholder="0.00" style={{ paddingLeft: 24 }} />
                </div>
              </div>
              <button className="btn-primary btn-sm" onClick={saveBudget} disabled={savingBudget}>
                {savingBudget ? 'Saving…' : 'Save Budget'}
              </button>
              {campaign.budget_set_at && (
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  Last set {new Date(campaign.budget_set_at).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Notify Marketing Team */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary btn-sm"
                onClick={notifyTeam}
                disabled={!hasBudget || notifying}
                title={!hasBudget ? 'Set a marketing budget first.' : ''}
                style={!hasBudget ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                {notifying ? 'Sending…' : campaign.team_notified_at ? '↻ Re-notify Marketing Team' : '📧 Notify Marketing Team'}
              </button>
              {campaign.team_notified_at && (
                <span style={{ fontSize: 12, color: 'var(--mist)' }}>
                  Last notified {new Date(campaign.team_notified_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
              {notifyResult && (
                <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>{notifyResult}</span>
              )}
            </div>
          </>
        )}
      </div>
      </PhaseStepCard>

      {/* Mail-by date — always visible when set, regardless of phase */}
      {campaign.mail_by_date && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <MailByLine mailByDate={campaign.mail_by_date} status={campaign.status} />
        </div>
      )}

      {/* ── 2. Planning (flow-specific) ────────────────────── */}
      <PhaseStepCard ref={planningRef}
        phase="planning" campaignStatus={campaign.status}
        number={2} title={`Planning — ${campaign.flow_type.toUpperCase()}`} roleSuffix="Marketing Team"
        doneSummary={campaign.mail_by_date ? `Mail-by ${fmtDate(campaign.mail_by_date)}` : 'Plan submitted + approved'}
        lockedHint="Unlocks once the buyer notifies the marketing team."
        forceOpen={expandedOverride.has('planning')}
        onToggle={() => toggleOverride('planning')}>
        {campaign.flow_type === 'vdp' && <VDPPlanningSection campaign={campaign} onChanged={onChanged} />}
        {campaign.flow_type === 'postcard' && <PostcardPlanningSection campaign={campaign} onChanged={onChanged} />}
        {campaign.flow_type === 'newspaper' && <NewspaperPlanningSection campaign={campaign} onChanged={onChanged} />}
      </PhaseStepCard>

      {/* ── 3. Proofing ────────────────────────────────────── */}
      <PhaseStepCard ref={proofingRef}
        phase="proofing" campaignStatus={campaign.status}
        number={3} title="Proofing" roleSuffix="Marketing Team"
        doneSummary="Proof approved"
        lockedHint="Unlocks once planning is approved."
        forceOpen={expandedOverride.has('proofing')}
        onToggle={() => toggleOverride('proofing')}>
        <ProofingSection campaign={campaign} onChanged={onChanged} />
      </PhaseStepCard>

      {/* ── 4. Payment ─────────────────────────────────────── */}
      <PhaseStepCard ref={paymentRef}
        phase="payment" campaignStatus={campaign.status}
        number={4} title="Payment" roleSuffix="Marketing Team"
        doneSummary={paymentSummary}
        lockedHint="Unlocks once the proof is approved."
        forceOpen={expandedOverride.has('payment')}
        onToggle={() => toggleOverride('payment')}>
        <PaymentSection campaign={campaign} onChanged={onChanged} />
      </PhaseStepCard>

      {/* ── 5. Done ────────────────────────────────────────── */}
      <PhaseStepCard ref={doneRef}
        phase="done" campaignStatus={campaign.status}
        number={5} title="Done"
        lockedHint="Unlocks once payment is marked paid."
        forceOpen={expandedOverride.has('done')}
        onToggle={() => toggleOverride('done')}>
        <DoneSection campaign={campaign} onChanged={onChanged} />
      </PhaseStepCard>

      {/* QR codes (read-only) — surfaced on every campaign page so
          marketing partners can grab the short URLs for proofs. */}
      <MarketingQrSection campaignId={campaign.id} />

      {/* Unified Files & Artifacts — proofs, postcard CSV uploads,
          accountant receipt PDF in one place. */}
      <FilesArtifactsSection
        campaignId={campaign.id}
        flowType={campaign.flow_type}
        accountantReceiptSentAt={campaign.accountant_receipt_sent_at}
      />
    </div>
  )
}

function EventMeta({ event }: { event: Event | undefined }) {
  if (!event?.start_date) return null
  return (
    <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>
      {new Date(event.start_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
    </div>
  )
}

function MailByLine({ mailByDate, status }: { mailByDate: string; status: string }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const mailBy = new Date(mailByDate + 'T12:00:00')
  const days = Math.round((mailBy.getTime() - today.getTime()) / 86400000)
  const atRisk = days <= 3 && status !== 'payment' && status !== 'done'
  const past = days < 0 && status !== 'payment' && status !== 'done'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        Mail by
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: past ? '#dc2626' : atRisk ? '#dc2626' : 'var(--ink)' }}>
        {mailBy.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        {days >= 0 && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600, color: 'var(--mist)' }}>
          ({days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})
        </span>}
      </div>
      {atRisk && (
        <span style={{
          background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
          padding: '3px 10px', borderRadius: 99,
          fontSize: 11, fontWeight: 800,
        }}>
          ⚠ {past ? 'Past mail-by date' : 'Mail-by approaching'}
        </span>
      )}
    </div>
  )
}
