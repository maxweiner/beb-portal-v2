'use client'

import type { InputHTMLAttributes } from 'react'
import { formatPhonePartial, rawDigits } from '@/lib/phone'

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** Raw 10-digit string. Empty string when blank. */
  value: string
  /** Called with the raw 10-digit string on every keystroke. */
  onChange: (raw: string) => void
}

/**
 * Phone input that formats `XXX-XXX-XXXX` as the user types and yields the
 * raw digits to the parent. DB always sees raw, UI always sees formatted.
 *
 * Cursor management is intentionally simple — we don't try to preserve the
 * caret on mid-string edits because the formatter only inserts non-digit
 * characters at predictable positions (after the 3rd and 6th digit). Edge
 * cases (paste, backspace across hyphens) feel correct because we re-derive
 * from raw digits each render.
 */
export default function PhoneInput({ value, onChange, ...rest }: PhoneInputProps) {
  return (
    <input
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      value={formatPhonePartial(value)}
      onChange={e => onChange(rawDigits(e.target.value))}
      placeholder={rest.placeholder ?? '555-123-4567'}
      {...rest}
    />
  )
}
