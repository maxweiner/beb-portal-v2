/**
 * Recipient formatter for trunk-comms / communication_sends rows.
 *
 * communication_sends.to_email + to_name store comma-separated values
 * when the user picked multiple flagged contacts in SendFlow. Resend
 * rejects "a@x.com, b@y.com" as a single string — it wants either
 * one bare email or an array. This helper splits + pairs name to
 * email by index and produces the right shape.
 */

export interface FormatRecipientsResult {
  /** Either a single "Name <email>" / bare email string, or an array
   *  when there are multiple recipients. Pass straight to sendEmail's
   *  `to` field. */
  toForResend: string | string[]
  /** Plain emails only — useful for logging / dedup. */
  emails: string[]
}

export function formatRecipients(
  toEmail: string | null | undefined,
  toName: string | null | undefined,
): FormatRecipientsResult {
  const emails = String(toEmail || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const names = String(toName || '')
    .split(',')
    .map(s => s.trim())

  if (emails.length === 0) {
    return { toForResend: '', emails: [] }
  }
  if (emails.length === 1) {
    const name = names[0]
    return {
      toForResend: name ? `${name} <${emails[0]}>` : emails[0],
      emails,
    }
  }
  return {
    toForResend: emails.map((e, i) => (names[i] ? `${names[i]} <${e}>` : e)),
    emails,
  }
}
