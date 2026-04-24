// Helpers for QR-code identifiers and the canonical /q/{code} URL.

// 32-char alphabet, no confusing characters (no 0/O, 1/I/l).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateQrCode(length = 8): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

export function bookingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (typeof window !== 'undefined' ? window.location.origin : 'https://beb-portal-v2.vercel.app')
}

export function qrShortUrl(code: string): string {
  return `${bookingBaseUrl()}/q/${code}`
}

// Filename-safe slug for downloads (e.g. "Smith Jewelers — Large Postcard"
// → "smith-jewelers-large-postcard").
export function fileSlug(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    || 'qr-code'
}
