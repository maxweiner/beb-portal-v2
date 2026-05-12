// Code/token minting for Edge wholesale-export batches.
//
//   batch_code   = `EDGE-YYYYMMDD-XXXX`  (human-readable, in the email subject)
//   public_token = ~24-char url-safe random (unguessable, used in the public batch URL)
//
// The batch_code's XXXX suffix is for readability, not security — never
// route by it alone. The public_token is what authenticates Mary's
// link without a login.

import { randomBytes } from 'crypto'

/** 4-char uppercase alphanumeric, ambiguity-free (no I/1/O/0). */
function shortSuffix(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = randomBytes(4)
  let out = ''
  for (let i = 0; i < 4; i++) out += alphabet[buf[i] % alphabet.length]
  return out
}

export function mintBatchCode(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `EDGE-${y}${m}${d}-${shortSuffix()}`
}

/** ~24 url-safe characters (18 bytes base64url). */
export function mintPublicToken(): string {
  return randomBytes(18)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
