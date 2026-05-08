// Reply-token utilities for chat threads.
//
// Email replies route via Reply-To: replies+<TOKEN>@<replies-host>.
// SMS outbound prepends "[ref: TOKEN]" so a kept-token reply can be
// matched back to its thread; the inbound webhook also falls back
// to "most-recent thread for this phone" if the token is dropped.
//
// 8 chars × Crockford alphabet (no I/L/O/U) = ~1 trillion possible
// values. Collisions are practically impossible at our scale, but
// the chat_threads.reply_token UNIQUE constraint catches any anyway.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 minus ambiguous chars

export function generateReplyToken(length = 8): string {
  let out = ''
  if (typeof crypto !== 'undefined' && (crypto as any).getRandomValues) {
    const buf = new Uint8Array(length)
    ;(crypto as any).getRandomValues(buf)
    for (let i = 0; i < length; i++) out += ALPHABET[buf[i] % ALPHABET.length]
  } else {
    for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

const TOKEN_RE = /^[0-9A-Z]{6,12}$/

/** Parse a token from a Postmark inbound `To` address like
 *  "Beneficial Estate Buyers <replies+ABC123@replies.bebllp.com>".
 *  Returns null when no plus-address segment is present or the
 *  token doesn't match the expected shape. */
export function parseReplyTokenFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null
  // Pull just the email part out of any "Name <email>" wrapping.
  const m = addr.match(/<([^>]+)>/) || [, addr]
  const email = (m[1] || '').toLowerCase()
  // Look for "+TOKEN@" where TOKEN is the alphanum bit between + and @.
  const plus = email.match(/\+([0-9a-z]+)@/i)
  if (!plus) return null
  const token = plus[1].toUpperCase()
  return TOKEN_RE.test(token) ? token : null
}

/** Pull a "[ref: TOKEN]" or "[ref:TOKEN]" out of the body of an
 *  inbound SMS. Case-insensitive on the bracket prefix. */
export function parseReplyTokenFromSmsBody(body: string | null | undefined): string | null {
  if (!body) return null
  const m = body.match(/\[\s*ref\s*:?\s*([0-9A-Z]{6,12})\s*\]/i)
  if (!m) return null
  return m[1].toUpperCase()
}
