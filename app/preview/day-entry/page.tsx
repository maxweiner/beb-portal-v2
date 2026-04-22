'use client'

/**
 * PREVIEW ROUTE — 5 mobile "Enter Day Data" design options.
 * View at /preview/day-entry on a phone-sized viewport.
 * Self-contained: no Supabase, no context. Pick one to promote
 * into components/mobile/MobileDayEntry.tsx.
 */

import { useEffect, useState } from 'react'

/* ───────── shared types (future-proofed for barcode scanning) ───────── */

interface ScanBuy {
  id: string
  timestamp: string
  checkNumber: string
  amount: number
  commissionRate: 10 | 5
  source?: string
}

interface ScanSession {
  active: boolean
  buys: ScanBuy[]
  totalFromScans: number
  checksScanned: number
}

interface Check {
  checkNumber: string
  amount: string
}

interface FormState {
  customers: string
  purchases: string
  tenPct: string
  fivePct: string
  sources: { vdp: string; postcard: string; social: string; word: string; other: string }
  checks: Check[] // Option 1 uses the structured shape; other variants use checkNumbers.
  checkNumbers: string // newline-delimited; used by options 2-5 only
}

const EMPTY: FormState = {
  customers: '', purchases: '', tenPct: '', fivePct: '',
  sources: { vdp: '', postcard: '', social: '', word: '', other: '' },
  checks: [{ checkNumber: '', amount: '' }],
  checkNumbers: '',
}

// Given the current rows, return the auto-filled check # for the NEXT row.
// Returns '' if the last row's number isn't a clean integer (don't guess).
function nextCheckNumber(checks: Check[]): string {
  const last = checks[checks.length - 1]?.checkNumber.trim() || ''
  if (!last) return ''
  const n = parseInt(last, 10)
  if (isNaN(n) || String(n) !== last) return ''
  return String(n + 1)
}

const FAKE_EVENT = { store: 'Alan Miller Jewelers', city: 'Cleveland, OH' }

/* ───────── helpers ───────── */

const n = (s: string) => parseFloat(s) || 0
const calcStats = (f: FormState) => {
  const total = n(f.tenPct) + n(f.fivePct)
  const close = n(f.customers) > 0 ? Math.round((n(f.purchases) / n(f.customers)) * 100) : 0
  const commission = n(f.tenPct) * 0.1 + n(f.fivePct) * 0.05
  return { total, close, commission }
}

const fmtMoney = (v: number) =>
  '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// Turn the manual check rows into ScanBuy-shaped pending rows.
// Once real scanning lands, the scanner writes into the same array.
const checksToPendingBuys = (checks: Check[]): ScanBuy[] =>
  checks
    .filter(c => c.checkNumber.trim() || parseFloat(c.amount) > 0)
    .map((c, i) => ({
      id: `manual-${i}-${c.checkNumber}`,
      timestamp: '',
      checkNumber: c.checkNumber.trim(),
      amount: parseFloat(c.amount) || 0,
      commissionRate: 10 as const,
    }))

// For options 2-5 that still use the newline-string shape.
const linesToPendingBuys = (text: string): ScanBuy[] =>
  text.split('\n').map(l => l.trim()).filter(Boolean).map((checkNumber, i) => ({
    id: `manual-${i}-${checkNumber}`,
    timestamp: '',
    checkNumber,
    amount: 0,
    commissionRate: 10 as const,
  }))

/* ───────── success overlay (shared) ───────── */

function SuccessOverlay({ visible, day, tone = 'light' }: { visible: boolean; day: number; tone?: 'light' | 'dark' | 'gold' }) {
  if (!visible) return null
  const palette = tone === 'dark'
    ? { bg: 'rgba(10,14,20,.92)', card: '#131821', ink: '#F0F3F8', accent: '#58E4A4' }
    : tone === 'gold'
    ? { bg: 'rgba(12,10,6,.92)', card: '#161210', ink: '#F4E8CE', accent: '#D4AF37' }
    : { bg: 'rgba(26,26,22,.78)', card: '#FFFFFF', ink: '#1A1A16', accent: '#1D6B44' }
  return (
    <div style={{
      position: 'absolute', inset: 0, background: palette.bg, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn .2s ease-out',
    }}>
      <div style={{
        background: palette.card, color: palette.ink,
        padding: '32px 36px', borderRadius: 20,
        textAlign: 'center', maxWidth: 300,
        animation: 'popIn .3s cubic-bezier(.2,1.4,.4,1)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: palette.accent, margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 38, color: '#fff', fontWeight: 900,
        }}>✓</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>Day {day} Submitted!</div>
        <div style={{ fontSize: 13, opacity: .7 }}>Admins have been notified</div>
      </div>
    </div>
  )
}

/* ───────── scan coming-soon button (shared) ───────── */

function ScanBanner({ tone = 'light' }: { tone?: 'light' | 'dark' | 'gold' }) {
  const palette = tone === 'dark'
    ? { bg: '#1A2030', border: '#2A3245', ink: '#8B95AA', badge: '#58E4A4', badgeInk: '#0A0E14' }
    : tone === 'gold'
    ? { bg: '#1F1A12', border: '#3A2F1E', ink: '#8B7A5A', badge: '#D4AF37', badgeInk: '#161210' }
    : { bg: '#F5F0E8', border: '#D8D3CA', ink: '#737368', badge: '#1D6B44', badgeInk: '#fff' }
  return (
    <button disabled style={{
      width: '100%', padding: '14px 16px', borderRadius: 12,
      background: palette.bg, border: `1.5px dashed ${palette.border}`,
      color: palette.ink, fontWeight: 700, fontSize: 14,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      cursor: 'not-allowed', opacity: .75,
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="15" width="6" height="6" rx="1" /><path d="M13 13h2v2h-2z M17 13h2M13 17h2m2 0h2m-4 2h2" />
      </svg>
      Scan Mode — Coming Soon
      <span style={{
        fontSize: 9, fontWeight: 900, letterSpacing: '.1em',
        padding: '2px 6px', borderRadius: 4,
        background: palette.badge, color: palette.badgeInk,
      }}>BETA</span>
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 1 — CARD STACK (brand-matched: cream + forest green, Fraunces)
   ══════════════════════════════════════════════════════════════════════ */

function Option1({ form, setForm, mode, setMode, day, onSubmit, submitted }: {
  form: FormState; setForm: (f: FormState) => void
  mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void
  day: number; onSubmit: () => void; submitted: boolean
}) {
  const { total, close, commission } = calcStats(form)
  const touched = n(form.customers) + n(form.purchases) + n(form.tenPct) + n(form.fivePct) > 0

  return (
    <div style={{ fontFamily: '"Fraunces", Georgia, serif', background: '#F5F0E8', minHeight: '100%', position: 'relative', paddingBottom: 96 }}>
      <SuccessOverlay visible={submitted} day={day} tone="light" />

      {/* Header */}
      <div style={{ background: '#FFFFFF', padding: '16px 18px 14px', borderBottom: '1px solid #EDE8DF' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#737368', letterSpacing: '.1em', textTransform: 'uppercase' }}>Entering Data For</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1A16', marginTop: 2, lineHeight: 1.15 }}>{FAKE_EVENT.store}</div>
        <div style={{ fontSize: 13, color: '#737368', marginTop: 2 }}>{FAKE_EVENT.city}</div>
        <DayPills day={day} />
      </div>

      <ModeToggle mode={mode} setMode={setMode} tone="light" />

      <div style={{ padding: '14px 14px 0' }}>
        {/* Core card */}
        <div style={cardStyle('light')}>
          <SectionLabel tone="light">Today's Numbers</SectionLabel>
          <FieldRow label="Customers Seen" value={form.customers} onChange={v => setForm({ ...form, customers: v })} tone="light" />
          <FieldRow label="Purchases Made" value={form.purchases} onChange={v => setForm({ ...form, purchases: v })} required tone="light" />
          <FieldRow label="$ @ 10% Commission" value={form.tenPct} onChange={v => setForm({ ...form, tenPct: v })} money required tone="light" />
          <FieldRow label="$ @ 5% Commission" value={form.fivePct} onChange={v => setForm({ ...form, fivePct: v })} money tone="light" />
        </div>

        {/* Live summary */}
        {touched && (
          <div style={{ ...cardStyle('light'), background: '#F0FDF4', borderColor: '#86EFAC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Total" value={fmtMoney(total)} tone="light" />
              <Stat label="Close Rate" value={`${close}%`} tone="light" />
              <Stat label="Commission" value={fmtMoney(commission)} tone="light" />
            </div>
          </div>
        )}

        {/* Detailed-only sections */}
        <div style={{
          maxHeight: mode === 'detailed' ? 2000 : 0, opacity: mode === 'detailed' ? 1 : 0,
          overflow: 'hidden', transition: 'max-height .35s ease, opacity .25s ease',
        }}>
          <div style={cardStyle('light')}>
            <SectionLabel tone="light">Lead Sources</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['vdp', 'postcard', 'social', 'word', 'other'] as const).map(k => (
                <MiniField key={k} label={sourceLabel(k)}
                  value={form.sources[k]}
                  onChange={v => setForm({ ...form, sources: { ...form.sources, [k]: v } })}
                  tone="light" />
              ))}
            </div>
          </div>

          <div style={cardStyle('light')}>
            <SectionLabel tone="light">Checks</SectionLabel>
            {form.checks.map((c, i) => {
              const isAuto = i > 0 && !!c.checkNumber && !c.amount
              return (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: form.checks.length > 1 ? '1fr 1.2fr 36px' : '1fr 1.2fr',
                  gap: 8, alignItems: 'end',
                  marginBottom: 10,
                }}>
                  <div>
                    <label style={{
                      fontSize: 10, fontWeight: 700, color: '#737368',
                      letterSpacing: '.08em', textTransform: 'uppercase',
                      display: 'block', marginBottom: 4,
                    }}>
                      Check # {isAuto && <span style={{ color: '#1D6B44', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>auto</span>}
                    </label>
                    <input type="text" inputMode="numeric" value={c.checkNumber}
                      onChange={e => setForm({
                        ...form,
                        checks: form.checks.map((x, idx) => idx === i ? { ...x, checkNumber: e.target.value } : x),
                      })}
                      placeholder={i === 0 ? '1045' : ''}
                      style={{
                        width: '100%', minHeight: 44, padding: '0 12px',
                        fontSize: 17, fontWeight: 800,
                        borderRadius: 10,
                        border: `1.5px solid ${isAuto ? '#86EFAC' : '#D8D3CA'}`,
                        background: isAuto ? '#F0FDF4' : '#FFFFFF',
                        color: '#1A1A16', outline: 'none', fontFamily: 'inherit',
                      }} />
                  </div>
                  <div>
                    <label style={{
                      fontSize: 10, fontWeight: 700, color: '#737368',
                      letterSpacing: '.08em', textTransform: 'uppercase',
                      display: 'block', marginBottom: 4,
                    }}>Amount</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                        color: '#737368', fontWeight: 700, fontSize: 17,
                      }}>$</span>
                      <input type="number" inputMode="decimal" value={c.amount}
                        onChange={e => setForm({
                          ...form,
                          checks: form.checks.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x),
                        })}
                        placeholder="0"
                        style={{
                          width: '100%', minHeight: 44, padding: '0 12px 0 24px',
                          fontSize: 17, fontWeight: 800,
                          borderRadius: 10, border: '1.5px solid #D8D3CA',
                          background: '#FFFFFF', color: '#1A1A16',
                          outline: 'none', fontFamily: 'inherit',
                        }} />
                    </div>
                  </div>
                  {form.checks.length > 1 && (
                    <button
                      onClick={() => setForm({ ...form, checks: form.checks.filter((_, idx) => idx !== i) })}
                      aria-label={`Remove check ${i + 1}`}
                      style={{
                        width: 36, height: 44, borderRadius: 10,
                        border: '1px solid #EDE8DF', background: '#FFFFFF',
                        color: '#A8A89A', fontSize: 22, cursor: 'pointer',
                        padding: 0, lineHeight: 1,
                      }}>×</button>
                  )}
                </div>
              )
            })}

            <button
              onClick={() => setForm({
                ...form,
                checks: [...form.checks, { checkNumber: nextCheckNumber(form.checks), amount: '' }],
              })}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                border: '1.5px dashed #D8D3CA', background: 'transparent',
                color: '#1D6B44', fontWeight: 700, fontSize: 14,
                cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
              }}>
              + Add Check
            </button>

            {checksToPendingBuys(form.checks).length > 0 && (
              <div style={{
                fontSize: 12, color: '#14532D', marginTop: 10,
                fontWeight: 700, textAlign: 'right',
              }}>
                {checksToPendingBuys(form.checks).length} check{checksToPendingBuys(form.checks).length === 1 ? '' : 's'} ·
                {' '}{fmtMoney(checksToPendingBuys(form.checks).reduce((s, b) => s + b.amount, 0))}
              </div>
            )}
          </div>

          <div style={{ padding: '0 2px 14px' }}><ScanBanner tone="light" /></div>
        </div>
      </div>

      <StickySubmit day={day} onSubmit={onSubmit} tone="light" />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 2 — STEPPER / WIZARD (dark, Space Grotesk)
   ══════════════════════════════════════════════════════════════════════ */

function Option2({ form, setForm, mode, setMode, day, onSubmit, submitted }: {
  form: FormState; setForm: (f: FormState) => void
  mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void
  day: number; onSubmit: () => void; submitted: boolean
}) {
  const [step, setStep] = useState(0)
  const steps = mode === 'quick' ? ['Sales'] : ['Sales', 'Sources', 'Checks']
  const { total, close, commission } = calcStats(form)
  const isLast = step === steps.length - 1

  useEffect(() => { if (step >= steps.length) setStep(0) }, [mode])

  return (
    <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', background: '#0A0E14', minHeight: '100%', color: '#F0F3F8', position: 'relative', paddingBottom: 96 }}>
      <SuccessOverlay visible={submitted} day={day} tone="dark" />

      <div style={{ padding: '16px 18px 10px', borderBottom: '1px solid #1A2030' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#58E4A4', letterSpacing: '.2em' }}>DAY {day} · {FAKE_EVENT.store.toUpperCase()}</div>
        <div style={{ fontSize: 12, color: '#8B95AA', marginTop: 4 }}>{FAKE_EVENT.city}</div>

        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= step ? '#58E4A4' : '#1A2030',
              transition: 'background .2s',
            }} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#8B95AA', marginTop: 8, fontWeight: 600 }}>
          STEP {step + 1} OF {steps.length} · {steps[step].toUpperCase()}
        </div>
      </div>

      <ModeToggle mode={mode} setMode={setMode} tone="dark" />

      <div style={{ padding: 18 }}>
        {steps[step] === 'Sales' && (
          <>
            <DarkField label="Customers Seen" value={form.customers} onChange={v => setForm({ ...form, customers: v })} />
            <DarkField label="Purchases Made" value={form.purchases} onChange={v => setForm({ ...form, purchases: v })} required />
            <DarkField label="$ @ 10% Commission" value={form.tenPct} onChange={v => setForm({ ...form, tenPct: v })} money required />
            <DarkField label="$ @ 5% Commission" value={form.fivePct} onChange={v => setForm({ ...form, fivePct: v })} money />
            {(n(form.tenPct) + n(form.fivePct)) > 0 && (
              <div style={{
                marginTop: 18, padding: 14, borderRadius: 12,
                background: 'linear-gradient(135deg,#0F1822,#1A2030)',
                border: '1px solid #2A3245',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <Stat label="Total" value={fmtMoney(total)} tone="dark" />
                  <Stat label="Close" value={`${close}%`} tone="dark" />
                  <Stat label="Commission" value={fmtMoney(commission)} tone="dark" />
                </div>
              </div>
            )}
          </>
        )}
        {steps[step] === 'Sources' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {(['vdp', 'postcard', 'social', 'word', 'other'] as const).map(k => (
              <DarkMini key={k} label={sourceLabel(k)}
                value={form.sources[k]}
                onChange={v => setForm({ ...form, sources: { ...form.sources, [k]: v } })} />
            ))}
          </div>
        )}
        {steps[step] === 'Checks' && (
          <>
            <textarea value={form.checkNumbers}
              onChange={e => setForm({ ...form, checkNumbers: e.target.value })}
              rows={8} placeholder="One check # per line"
              style={{
                width: '100%', padding: 14, borderRadius: 12,
                border: '1.5px solid #2A3245', background: '#131821', color: '#F0F3F8',
                fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 17, outline: 'none',
                marginBottom: 12,
              }} />
            <div style={{ fontSize: 12, color: '#58E4A4', fontWeight: 700, marginBottom: 14 }}>
              {linesToPendingBuys(form.checkNumbers).length} CHECK{linesToPendingBuys(form.checkNumbers).length === 1 ? '' : 'S'} RECORDED
            </div>
            <ScanBanner tone="dark" />
          </>
        )}
      </div>

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: 14, background: 'linear-gradient(to top, #0A0E14 70%, transparent)',
        display: 'flex', gap: 10,
      }}>
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} style={{
            flex: 1, padding: 14, borderRadius: 12, border: '1.5px solid #2A3245',
            background: 'transparent', color: '#F0F3F8', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>← Back</button>
        )}
        <button
          onClick={() => isLast ? onSubmit() : setStep(s => s + 1)}
          style={{
            flex: 2, padding: 14, borderRadius: 12, border: 'none',
            background: '#58E4A4', color: '#0A0E14', fontWeight: 800, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '.02em',
          }}>
          {isLast ? `✓ Submit Day ${day}` : 'Next →'}
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 3 — COMPACT ROWS (luxury black + gold, Playfair + JetBrains Mono)
   ══════════════════════════════════════════════════════════════════════ */

function Option3({ form, setForm, mode, setMode, day, onSubmit, submitted }: {
  form: FormState; setForm: (f: FormState) => void
  mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void
  day: number; onSubmit: () => void; submitted: boolean
}) {
  const { total, close, commission } = calcStats(form)
  const GOLD = '#D4AF37'

  return (
    <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', background: '#0C0A06', minHeight: '100%', color: '#F4E8CE', position: 'relative', paddingBottom: 96 }}>
      <SuccessOverlay visible={submitted} day={day} tone="gold" />

      <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${GOLD}33` }}>
        <div style={{ fontSize: 10, color: GOLD, letterSpacing: '.3em', fontWeight: 700 }}>✦ DAILY ENTRY</div>
        <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 24, fontWeight: 900, marginTop: 4, letterSpacing: '-.01em' }}>{FAKE_EVENT.store}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#8B7A5A' }}>{FAKE_EVENT.city}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3].map(d => (
              <div key={d} style={{
                width: 26, height: 26, borderRadius: 4,
                border: `1px solid ${d === day ? GOLD : '#3A2F1E'}`,
                background: d < day ? GOLD : d === day ? `${GOLD}22` : 'transparent',
                color: d < day ? '#0C0A06' : d === day ? GOLD : '#5C4F36',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>{d < day ? '✓' : d}</div>
            ))}
          </div>
        </div>
      </div>

      <ModeToggle mode={mode} setMode={setMode} tone="gold" />

      <div style={{ padding: 16 }}>
        <div style={{ border: `1px solid ${GOLD}33`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
          <GoldRow label="Customers" value={form.customers} onChange={v => setForm({ ...form, customers: v })} gold={GOLD} />
          <GoldRow label="Purchases" value={form.purchases} onChange={v => setForm({ ...form, purchases: v })} gold={GOLD} required />
          <GoldRow label="$ 10%" value={form.tenPct} onChange={v => setForm({ ...form, tenPct: v })} gold={GOLD} money required />
          <GoldRow label="$ 5%" value={form.fivePct} onChange={v => setForm({ ...form, fivePct: v })} gold={GOLD} money last />
        </div>

        <div style={{
          padding: '12px 14px', border: `1px solid ${GOLD}66`,
          background: `linear-gradient(90deg, transparent, ${GOLD}11, transparent)`,
          borderRadius: 6, marginBottom: 14,
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
        }}>
          <Stat label="TOTAL" value={fmtMoney(total)} tone="gold" />
          <Stat label="CLOSE" value={`${close}%`} tone="gold" />
          <Stat label="COMM" value={fmtMoney(commission)} tone="gold" />
        </div>

        <div style={{
          maxHeight: mode === 'detailed' ? 2000 : 0, opacity: mode === 'detailed' ? 1 : 0,
          overflow: 'hidden', transition: 'all .3s ease',
        }}>
          <div style={{ fontSize: 10, letterSpacing: '.25em', color: GOLD, margin: '6px 2px 8px' }}>SOURCES</div>
          <div style={{ border: `1px solid ${GOLD}33`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            {(['vdp', 'postcard', 'social', 'word', 'other'] as const).map((k, i, arr) => (
              <GoldRow key={k} label={sourceLabel(k)}
                value={form.sources[k]}
                onChange={v => setForm({ ...form, sources: { ...form.sources, [k]: v } })}
                gold={GOLD} last={i === arr.length - 1} />
            ))}
          </div>

          <div style={{ fontSize: 10, letterSpacing: '.25em', color: GOLD, margin: '6px 2px 8px' }}>CHECK NUMBERS</div>
          <textarea value={form.checkNumbers}
            onChange={e => setForm({ ...form, checkNumbers: e.target.value })}
            rows={4} placeholder="1045&#10;1046&#10;…"
            style={{
              width: '100%', padding: 12, borderRadius: 6,
              border: `1px solid ${GOLD}33`, background: '#161210', color: '#F4E8CE',
              fontFamily: 'inherit', fontSize: 15, outline: 'none', marginBottom: 12,
            }} />
          <ScanBanner tone="gold" />
        </div>
      </div>

      <StickySubmit day={day} onSubmit={onSubmit} tone="gold" />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 4 — BIG TILE GRID (color-coded, Archivo)
   ══════════════════════════════════════════════════════════════════════ */

function Option4({ form, setForm, mode, setMode, day, onSubmit, submitted }: {
  form: FormState; setForm: (f: FormState) => void
  mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void
  day: number; onSubmit: () => void; submitted: boolean
}) {
  const { total, close, commission } = calcStats(form)
  const tiles = [
    { key: 'customers', label: 'Customers', bg: '#4F46E5', value: form.customers, set: (v: string) => setForm({ ...form, customers: v }) },
    { key: 'purchases', label: 'Purchases', bg: '#10B981', value: form.purchases, set: (v: string) => setForm({ ...form, purchases: v }) },
    { key: 'tenPct', label: '$ @ 10%', bg: '#F59E0B', value: form.tenPct, set: (v: string) => setForm({ ...form, tenPct: v }), money: true },
    { key: 'fivePct', label: '$ @ 5%', bg: '#EC4899', value: form.fivePct, set: (v: string) => setForm({ ...form, fivePct: v }), money: true },
  ]

  return (
    <div style={{ fontFamily: '"Archivo", system-ui, sans-serif', background: '#FAFAF7', minHeight: '100%', position: 'relative', paddingBottom: 96 }}>
      <SuccessOverlay visible={submitted} day={day} tone="light" />

      <div style={{ padding: '14px 14px 10px', background: '#FFFFFF', borderBottom: '1px solid #EEEEE6' }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: '#737368', letterSpacing: '.14em' }}>DAY {day} · {FAKE_EVENT.store.toUpperCase()}</div>
        <DayPills day={day} />
      </div>

      <ModeToggle mode={mode} setMode={setMode} tone="light" />

      <div style={{ padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {tiles.map(t => (
            <Tile key={t.key} label={t.label} bg={t.bg} value={t.value} onChange={t.set} money={t.money} />
          ))}
        </div>

        {(n(form.tenPct) + n(form.fivePct)) > 0 && (
          <div style={{
            marginTop: 10, padding: 14, borderRadius: 14,
            background: '#1A1A16', color: '#FFF',
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          }}>
            <Stat label="Total" value={fmtMoney(total)} tone="dark" />
            <Stat label="Close" value={`${close}%`} tone="dark" />
            <Stat label="Comm" value={fmtMoney(commission)} tone="dark" />
          </div>
        )}

        <div style={{
          maxHeight: mode === 'detailed' ? 2000 : 0, opacity: mode === 'detailed' ? 1 : 0,
          overflow: 'hidden', transition: 'all .35s ease', marginTop: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#737368', letterSpacing: '.1em', margin: '10px 4px 8px' }}>SOURCES</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {(['vdp', 'postcard', 'social', 'word', 'other'] as const).map((k, i) => {
              const colors = ['#6366F1', '#EF4444', '#06B6D4', '#84CC16', '#A855F7']
              return (
                <MiniTile key={k} label={sourceLabel(k)} bg={colors[i]}
                  value={form.sources[k]}
                  onChange={v => setForm({ ...form, sources: { ...form.sources, [k]: v } })} />
              )
            })}
          </div>

          <div style={{ fontSize: 12, fontWeight: 900, color: '#737368', letterSpacing: '.1em', margin: '16px 4px 8px' }}>CHECK NUMBERS</div>
          <textarea value={form.checkNumbers}
            onChange={e => setForm({ ...form, checkNumbers: e.target.value })}
            rows={4} placeholder="One per line"
            style={{
              width: '100%', padding: 14, borderRadius: 14,
              border: '2px solid #E6E4DD', background: '#FFF',
              fontFamily: 'inherit', fontSize: 17, fontWeight: 700, outline: 'none',
              marginBottom: 10,
            }} />
          <ScanBanner tone="light" />
        </div>
      </div>

      <StickySubmit day={day} onSubmit={onSubmit} tone="light" />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   OPTION 5 — ACCORDION (dark header w/ live stats + light content, Manrope)
   ══════════════════════════════════════════════════════════════════════ */

function Option5({ form, setForm, mode, setMode, day, onSubmit, submitted }: {
  form: FormState; setForm: (f: FormState) => void
  mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void
  day: number; onSubmit: () => void; submitted: boolean
}) {
  const { total, close, commission } = calcStats(form)
  const [open, setOpen] = useState<'core' | 'sources' | 'checks'>('core')
  const BLUE = '#3B82F6'

  return (
    <div style={{ fontFamily: '"Manrope", system-ui, sans-serif', background: '#F6F8FC', minHeight: '100%', position: 'relative', paddingBottom: 96 }}>
      <SuccessOverlay visible={submitted} day={day} tone="dark" />

      {/* Dark header with live stats */}
      <div style={{ background: 'linear-gradient(135deg,#0F172A,#1E293B)', color: '#FFF', padding: '16px 16px 20px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '.18em' }}>
          DAY {day} · {FAKE_EVENT.store.toUpperCase()}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{FAKE_EVENT.city}</div>

        <div style={{
          marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
        }}>
          {[
            { l: 'Total', v: fmtMoney(total) },
            { l: 'Close', v: `${close}%` },
            { l: 'Commission', v: fmtMoney(commission) },
          ].map(s => (
            <div key={s.l} style={{
              background: 'rgba(255,255,255,.08)', borderRadius: 10, padding: '10px 10px',
              border: '1px solid rgba(255,255,255,.08)',
            }}>
              <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 700, letterSpacing: '.12em' }}>{s.l.toUpperCase()}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <ModeToggle mode={mode} setMode={setMode} tone="light" />

      <div style={{ padding: 12 }}>
        <AccSection title="Core Numbers" open={open === 'core'} onToggle={() => setOpen(open === 'core' ? 'core' : 'core')} forceOpen accent={BLUE}>
          <FieldRow label="Customers Seen" value={form.customers} onChange={v => setForm({ ...form, customers: v })} tone="light" />
          <FieldRow label="Purchases Made" value={form.purchases} onChange={v => setForm({ ...form, purchases: v })} required tone="light" />
          <FieldRow label="$ @ 10% Commission" value={form.tenPct} onChange={v => setForm({ ...form, tenPct: v })} money required tone="light" />
          <FieldRow label="$ @ 5% Commission" value={form.fivePct} onChange={v => setForm({ ...form, fivePct: v })} money tone="light" />
        </AccSection>

        {mode === 'detailed' && (
          <>
            <AccSection title="Lead Sources" open={open === 'sources'} onToggle={() => setOpen(open === 'sources' ? 'core' : 'sources')} accent={BLUE}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {(['vdp', 'postcard', 'social', 'word', 'other'] as const).map(k => (
                  <MiniField key={k} label={sourceLabel(k)}
                    value={form.sources[k]}
                    onChange={v => setForm({ ...form, sources: { ...form.sources, [k]: v } })}
                    tone="light" />
                ))}
              </div>
            </AccSection>
            <AccSection title="Check Numbers" open={open === 'checks'} onToggle={() => setOpen(open === 'checks' ? 'core' : 'checks')} accent={BLUE}>
              <textarea value={form.checkNumbers}
                onChange={e => setForm({ ...form, checkNumbers: e.target.value })}
                rows={4} placeholder="One check # per line"
                style={{
                  width: '100%', padding: 12, borderRadius: 10, border: '1.5px solid #CBD5E1',
                  fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 16, outline: 'none',
                  background: '#FFF', marginBottom: 10,
                }} />
              <ScanBanner tone="light" />
            </AccSection>
          </>
        )}
      </div>

      <StickySubmit day={day} onSubmit={onSubmit} tone="light" accent={BLUE} />
    </div>
  )
}

/* ───────── small shared UI primitives ───────── */

function DayPills({ day }: { day: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      {[1, 2, 3].map(d => {
        const done = d < day, cur = d === day
        return (
          <div key={d} style={{
            flex: 1, padding: '6px 0', borderRadius: 8,
            background: cur ? '#1D6B44' : done ? '#86EFAC' : '#EDE8DF',
            color: cur ? '#FFF' : done ? '#14532D' : '#737368',
            fontSize: 11, fontWeight: 800, textAlign: 'center', letterSpacing: '.08em',
          }}>
            {done ? '✓ ' : ''}DAY {d}{cur ? ' · TODAY' : ''}
          </div>
        )
      })}
    </div>
  )
}

function ModeToggle({ mode, setMode, tone }: { mode: 'quick' | 'detailed'; setMode: (m: 'quick' | 'detailed') => void; tone: 'light' | 'dark' | 'gold' }) {
  const palette = tone === 'dark'
    ? { bg: '#131821', on: '#58E4A4', onInk: '#0A0E14', off: '#8B95AA' }
    : tone === 'gold'
    ? { bg: '#161210', on: '#D4AF37', onInk: '#0C0A06', off: '#8B7A5A' }
    : { bg: '#FFFFFF', on: '#1D6B44', onInk: '#FFFFFF', off: '#737368' }
  return (
    <div style={{
      margin: '10px 14px 0', padding: 4, borderRadius: 12,
      background: palette.bg, display: 'flex',
      border: tone === 'light' ? '1px solid #EDE8DF' : 'none',
    }}>
      {(['quick', 'detailed'] as const).map(m => {
        const active = mode === m
        return (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
            background: active ? palette.on : 'transparent',
            color: active ? palette.onInk : palette.off,
            fontWeight: 800, fontSize: 13, cursor: 'pointer',
            fontFamily: 'inherit', letterSpacing: '.02em',
            transition: 'all .2s',
          }}>
            {m === 'quick' ? '⚡ Quick' : '📋 Detailed'}
          </button>
        )
      })}
    </div>
  )
}

function cardStyle(tone: 'light' | 'dark'): React.CSSProperties {
  return tone === 'dark'
    ? { background: '#131821', borderRadius: 14, padding: 14, marginBottom: 12, border: '1px solid #1A2030' }
    : { background: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 12, border: '1px solid #EDE8DF' }
}

function SectionLabel({ children, tone }: { children: React.ReactNode; tone: 'light' | 'dark' }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
      color: tone === 'dark' ? '#8B95AA' : '#737368', marginBottom: 10,
    }}>{children}</div>
  )
}

function FieldRow({ label, value, onChange, money, required, tone }: {
  label: string; value: string; onChange: (v: string) => void
  money?: boolean; required?: boolean; tone: 'light' | 'dark'
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderBottom: `1px solid ${tone === 'dark' ? '#1A2030' : '#F0EDE6'}`,
    }}>
      <label style={{
        flex: 1, fontSize: 13, fontWeight: 600,
        color: tone === 'dark' ? '#C2CBDB' : '#4A4A42',
      }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <div style={{ position: 'relative', width: 140 }}>
        {money && (
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontWeight: 700, color: tone === 'dark' ? '#8B95AA' : '#737368',
          }}>$</span>
        )}
        <input type="number" inputMode={money ? 'decimal' : 'numeric'}
          value={value} onChange={e => onChange(e.target.value)} placeholder="0"
          style={{
            width: '100%', minHeight: 44, textAlign: 'right',
            padding: money ? '0 10px 0 22px' : '0 10px',
            fontSize: 20, fontWeight: 800,
            borderRadius: 10,
            border: `1.5px solid ${tone === 'dark' ? '#2A3245' : '#D8D3CA'}`,
            background: tone === 'dark' ? '#0A0E14' : '#F5F0E8',
            color: tone === 'dark' ? '#F0F3F8' : '#1A1A16',
            outline: 'none', fontFamily: 'inherit',
          }} />
      </div>
    </div>
  )
}

function MiniField({ label, value, onChange, tone }: { label: string; value: string; onChange: (v: string) => void; tone: 'light' | 'dark' }) {
  return (
    <div>
      <label style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
        color: tone === 'dark' ? '#8B95AA' : '#737368',
        display: 'block', marginBottom: 4,
      }}>{label}</label>
      <input type="number" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" style={{
          width: '100%', minHeight: 44, padding: '0 10px',
          fontSize: 18, fontWeight: 700,
          borderRadius: 10,
          border: `1.5px solid ${tone === 'dark' ? '#2A3245' : '#D8D3CA'}`,
          background: tone === 'dark' ? '#0A0E14' : '#FFFFFF',
          color: tone === 'dark' ? '#F0F3F8' : '#1A1A16',
          outline: 'none', fontFamily: 'inherit',
        }} />
    </div>
  )
}

function DarkField({ label, value, onChange, money, required }: { label: string; value: string; onChange: (v: string) => void; money?: boolean; required?: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: '#8B95AA',
        display: 'block', marginBottom: 6, textTransform: 'uppercase',
      }}>{label}{required && <span style={{ color: '#EF4444' }}> *</span>}</label>
      <div style={{ position: 'relative' }}>
        {money && (
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#58E4A4', fontWeight: 800, fontSize: 20 }}>$</span>
        )}
        <input type="number" inputMode={money ? 'decimal' : 'numeric'} value={value} onChange={e => onChange(e.target.value)}
          placeholder="0" style={{
            width: '100%', minHeight: 52, padding: money ? '0 14px 0 30px' : '0 14px',
            fontSize: 24, fontWeight: 800,
            borderRadius: 12, border: '1.5px solid #2A3245',
            background: '#131821', color: '#F0F3F8',
            outline: 'none', fontFamily: 'inherit',
          }} />
      </div>
    </div>
  )
}

function DarkMini({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: '#8B95AA',
        display: 'block', marginBottom: 4, textTransform: 'uppercase',
      }}>{label}</label>
      <input type="number" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" style={{
          width: '100%', minHeight: 48, padding: '0 12px',
          fontSize: 20, fontWeight: 800,
          borderRadius: 10, border: '1.5px solid #2A3245',
          background: '#131821', color: '#F0F3F8',
          outline: 'none', fontFamily: 'inherit',
        }} />
    </div>
  )
}

function GoldRow({ label, value, onChange, gold, money, required, last }: {
  label: string; value: string; onChange: (v: string) => void; gold: string
  money?: boolean; required?: boolean; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '12px 14px',
      borderBottom: last ? 'none' : `1px solid ${gold}22`,
      background: '#0C0A06',
    }}>
      <div style={{ flex: 1, fontSize: 11, letterSpacing: '.14em', color: '#8B7A5A', textTransform: 'uppercase' }}>
        {label}{required && <span style={{ color: gold }}> *</span>}
      </div>
      <div style={{ position: 'relative', width: 130 }}>
        {money && (
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: gold, fontWeight: 700 }}>$</span>
        )}
        <input type="number" inputMode={money ? 'decimal' : 'numeric'} value={value} onChange={e => onChange(e.target.value)}
          placeholder="0" style={{
            width: '100%', minHeight: 44, textAlign: 'right',
            padding: money ? '0 10px 0 22px' : '0 10px',
            fontSize: 20, fontWeight: 900,
            fontFamily: '"Playfair Display", Georgia, serif',
            borderRadius: 4, border: `1px solid ${gold}33`,
            background: '#161210', color: '#F4E8CE',
            outline: 'none',
          }} />
      </div>
    </div>
  )
}

function Tile({ label, bg, value, onChange, money }: {
  label: string; bg: string; value: string; onChange: (v: string) => void; money?: boolean
}) {
  return (
    <label style={{
      background: bg, borderRadius: 18, padding: 14, color: '#FFF',
      minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      cursor: 'text', boxShadow: '0 6px 16px rgba(0,0,0,.1)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', opacity: .9 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        {money && (
          <span style={{ fontSize: 24, fontWeight: 900, opacity: .8, marginRight: 2 }}>$</span>
        )}
        <input type="number" inputMode={money ? 'decimal' : 'numeric'} value={value} onChange={e => onChange(e.target.value)}
          placeholder="0" style={{
            background: 'transparent', border: 'none', color: '#FFF',
            fontSize: 36, fontWeight: 900, width: '100%', outline: 'none',
            padding: 0, fontFamily: 'inherit',
          }} />
      </div>
    </label>
  )
}

function MiniTile({ label, bg, value, onChange }: { label: string; bg: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{
      background: bg, borderRadius: 12, padding: '10px 12px', color: '#FFF',
      minHeight: 74, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      cursor: 'text', boxShadow: '0 4px 10px rgba(0,0,0,.08)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', opacity: .92 }}>{label}</div>
      <input type="number" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" style={{
          background: 'transparent', border: 'none', color: '#FFF',
          fontSize: 22, fontWeight: 900, width: '100%', outline: 'none',
          padding: 0, fontFamily: 'inherit',
        }} />
    </label>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'light' | 'dark' | 'gold' }) {
  const palette = tone === 'dark'
    ? { label: '#8B95AA', value: '#58E4A4' }
    : tone === 'gold'
    ? { label: '#8B7A5A', value: '#D4AF37' }
    : { label: '#14532D', value: '#1D6B44' }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: palette.label, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: palette.value, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function AccSection({ title, open, onToggle, children, forceOpen, accent }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode; forceOpen?: boolean; accent: string
}) {
  const isOpen = forceOpen || open
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, marginBottom: 10,
      border: '1px solid #E2E8F0', overflow: 'hidden',
    }}>
      <button onClick={onToggle} disabled={forceOpen} style={{
        width: '100%', padding: '14px 14px', border: 'none',
        background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: forceOpen ? 'default' : 'pointer', fontFamily: 'inherit',
      }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>{title}</span>
        {!forceOpen && <span style={{ color: accent, fontSize: 14 }}>{isOpen ? '−' : '+'}</span>}
      </button>
      {isOpen && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  )
}

function StickySubmit({ day, onSubmit, tone, accent }: { day: number; onSubmit: () => void; tone: 'light' | 'gold'; accent?: string }) {
  const palette = tone === 'gold'
    ? { grad: 'linear-gradient(to top, #0C0A06 75%, transparent)', btn: '#D4AF37', ink: '#0C0A06' }
    : { grad: 'linear-gradient(to top, rgba(245,240,232,1) 75%, rgba(245,240,232,0))', btn: accent || '#1D6B44', ink: '#FFFFFF' }
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '24px 14px 14px', background: palette.grad,
    }}>
      <button onClick={onSubmit} style={{
        width: '100%', minHeight: 52, borderRadius: 14, border: 'none',
        background: palette.btn, color: palette.ink,
        fontWeight: 900, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit',
        letterSpacing: '.02em',
        boxShadow: '0 6px 16px rgba(0,0,0,.15)',
      }}>
        ✓ Submit Day {day}
      </button>
    </div>
  )
}

function sourceLabel(k: 'vdp' | 'postcard' | 'social' | 'word' | 'other') {
  return { vdp: 'VDP', postcard: 'Postcard', social: 'Social', word: 'Word of Mouth', other: 'Other' }[k]
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE — variant switcher + phone frame
   ══════════════════════════════════════════════════════════════════════ */

const VARIANTS = [
  { n: 1, name: 'Card Stack' },
  { n: 2, name: 'Stepper' },
  { n: 3, name: 'Compact' },
  { n: 4, name: 'Tiles' },
  { n: 5, name: 'Accordion' },
]

export default function Page() {
  const [variant, setVariant] = useState(1)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [mode, setMode] = useState<'quick' | 'detailed'>('quick')
  const [submitted, setSubmitted] = useState(false)
  const day = 2

  // Load Google Fonts once.
  useEffect(() => {
    if (document.querySelector('#day-entry-preview-fonts')) return
    const link = document.createElement('link')
    link.id = 'day-entry-preview-fonts'
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;800;900&family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@700;900&family=JetBrains+Mono:wght@400;600;700&family=Archivo:wght@600;800;900&family=Manrope:wght@400;600;700;800&display=swap'
    document.head.appendChild(link)
  }, [])

  // Remember mode preference per variant.
  useEffect(() => {
    const saved = localStorage.getItem(`dayentry-preview-mode-${variant}`)
    if (saved === 'quick' || saved === 'detailed') setMode(saved)
    else if (window.innerWidth <= 820) setMode('quick')
  }, [variant])
  useEffect(() => {
    localStorage.setItem(`dayentry-preview-mode-${variant}`, mode)
  }, [mode, variant])

  const handleSubmit = () => {
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 2200)
  }

  const Variant = [Option1, Option2, Option3, Option4, Option5][variant - 1]

  return (
    <div style={{
      minHeight: '100vh', background: '#1F1F1C',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '12px 12px 40px',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn {
          from { transform: scale(.85); opacity: 0 }
          to { transform: scale(1); opacity: 1 }
        }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* Top switcher */}
      <div style={{
        width: '100%', maxWidth: 840, color: '#E0DED7',
        marginBottom: 12, textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#8A8880', letterSpacing: '.2em', marginBottom: 8 }}>
          DAY-ENTRY MOBILE · 5 OPTIONS
        </div>
        <div style={{
          display: 'inline-flex', background: '#2B2B27', padding: 4, borderRadius: 10, gap: 2,
          flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {VARIANTS.map(v => (
            <button key={v.n} onClick={() => setVariant(v.n)} style={{
              padding: '8px 14px', border: 'none', borderRadius: 7,
              background: variant === v.n ? '#F5F0E8' : 'transparent',
              color: variant === v.n ? '#1A1A16' : '#A8A89A',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>
              {v.n}. {v.name}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#8A8880' }}>
          Form state is shared — fill once, compare across options. Submit is a no-op (shows success overlay only).
        </div>
      </div>

      {/* Phone frame */}
      <div style={{
        width: '100%', maxWidth: 390, height: 844,
        background: '#000', borderRadius: 42, padding: 10,
        boxShadow: '0 30px 70px rgba(0,0,0,.5), 0 0 0 1px #3A3A33',
        position: 'relative',
      }}>
        <div style={{
          width: '100%', height: '100%', borderRadius: 32, overflow: 'hidden',
          position: 'relative', background: '#FFF',
        }}>
          <div style={{ width: '100%', height: '100%', overflowY: 'auto', position: 'relative' }}>
            <Variant
              form={form} setForm={setForm}
              mode={mode} setMode={setMode}
              day={day}
              onSubmit={handleSubmit}
              submitted={submitted}
            />
          </div>
        </div>
      </div>

      <button
        onClick={() => setForm(EMPTY)}
        style={{
          marginTop: 16, padding: '8px 14px', borderRadius: 8,
          background: 'transparent', border: '1px solid #3A3A33',
          color: '#A8A89A', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
        Reset form data
      </button>
    </div>
  )
}
