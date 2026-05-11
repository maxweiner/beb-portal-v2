// SMS opt-in disclosure shown directly under every public phone
// input. Twilio toll-free verification requires the consent language
// to be visible at the point of collection (not buried in a privacy
// policy). Keep the wording in sync with /sms-terms — the dedicated
// disclosures page Twilio reviewers link to.
//
// All copy is here in one place so a future Twilio resubmission can
// update every surface by editing one file.

import type { CSSProperties } from 'react'

interface SmsConsentNoticeProps {
  /** Optional inline style override; mostly used to tune fontSize to
   *  match each form's labelSize. */
  style?: CSSProperties
  /** Tailwind class hook for the booking pages that use tailwind. */
  className?: string
}

export default function SmsConsentNotice({ style, className }: SmsConsentNoticeProps) {
  return (
    <p
      className={className}
      style={{
        fontSize: 11,
        lineHeight: 1.45,
        color: '#6B7280',
        marginTop: 4,
        ...style,
      }}
    >
      By providing your mobile number you agree to receive SMS
      messages from Beneficial Estate Buyers about your appointment
      (confirmations, reminders, and reschedules). Frequency varies.
      Msg &amp; data rates may apply. Reply STOP to opt out, HELP
      for help. See our{' '}
      <a href="/sms-terms" target="_blank" rel="noopener noreferrer"
        style={{ color: '#1D6B44', fontWeight: 700, textDecoration: 'underline' }}>
        SMS Terms
      </a>{' '}
      and{' '}
      <a href="/privacy" target="_blank" rel="noopener noreferrer"
        style={{ color: '#1D6B44', fontWeight: 700, textDecoration: 'underline' }}>
        Privacy Policy
      </a>.
    </p>
  )
}
