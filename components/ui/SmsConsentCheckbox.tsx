'use client'

// Standalone, optional, unchecked-by-default SMS opt-in checkbox
// for every public-facing form that collects a phone number.
//
// Twilio toll-free verification (2026-05-14 rejection) requires
// SMS consent to be:
//   1. Explicit — a real checkbox, not implicit-by-providing-number
//   2. Standalone — only mentions SMS, NOT bundled with TOS or
//      Privacy or any other agreement
//   3. Optional — the form must submit whether or not it's checked
//   4. Unchecked by default — no pre-checked boxes
//
// Replaces the older SmsConsentNotice (a paragraph below the phone
// input). That implicit pattern violated reason codes 30475 +
// 30498 + 30513 — see the rejection email.
//
// Callers MUST pass `checked` + `onChange` so the form state can
// thread the opt-in flag through to the server submit.

import type { CSSProperties } from 'react'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  /** Optional inline style override; mostly used to match each
   *  form's label sizing. */
  style?: CSSProperties
  /** Tailwind class hook for the tailwind-styled booking pages. */
  className?: string
  /** Optional id for label association; defaults to a stable
   *  literal so multiple checkboxes on one page must opt in to
   *  override. */
  id?: string
}

export default function SmsConsentCheckbox({
  checked, onChange,
  style, className,
  id = 'sms-opt-in-checkbox',
}: Props) {
  return (
    <label
      htmlFor={id}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: 8,
        fontSize: 12,
        lineHeight: 1.45,
        color: '#374151',
        cursor: 'pointer',
        ...style,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        // Touch-friendly hit target. Margin-top compensates for the
        // 1.45-line label so the box aligns visually with the first
        // line of text.
        style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, cursor: 'pointer' }}
      />
      <span>
        Send me text messages from Beneficial Estate Buyers about my
        appointment — confirmations, reminders, and reschedules.
        Message frequency varies. Msg &amp; data rates may apply.
        Reply <strong>STOP</strong> to opt out, <strong>HELP</strong> for help.
        See our{' '}
        <a
          href="/sms-terms"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1D6B44', fontWeight: 700, textDecoration: 'underline' }}
          onClick={e => e.stopPropagation()}
        >SMS Terms</a>.
      </span>
    </label>
  )
}
