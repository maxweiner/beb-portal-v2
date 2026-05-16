// Server-side HTML builder for broadcast emails. Wraps the rich-text
// body the operator wrote in a BEB letterhead, optional CTA button,
// and brand-aware footer. Keeps everything inline-styled because
// Gmail / Outlook / Apple Mail strip <style> blocks.
//
// The body_html stored in the broadcasts table is the user's raw
// rich-text output (b/strong, i/em, ul/ol/li, a). We DO NOT trust
// it for arbitrary tags — the editor is restricted, and the
// build also strips <script>/<iframe> defensively.

const BRANDS = {
  beb: {
    label: 'Beneficial Estate Buyers',
    fromAddress: 'noreply@updates.bebllp.com',
    fromName: 'Beneficial Estate Buyers',
    accent: '#1D6B44',
    accentDark: '#11432B',
  },
  liberty: {
    label: 'Liberty Estate Buyers',
    fromAddress: 'hello@libertyjewels.estate',
    fromName: 'Liberty Estate Buyers',
    accent: '#1E3A8A',
    accentDark: '#1E3A8A',
  },
} as const

export type BroadcastBrand = keyof typeof BRANDS

export function brandConfig(brand: BroadcastBrand) {
  return BRANDS[brand]
}

/** Strip script + iframe + on-handlers defensively. The editor
 *  doesn't expose those, but database round-trips warrant a guard. */
export function sanitizeBodyHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '')
}

interface BuildArgs {
  brand: BroadcastBrand
  subject: string
  bodyHtml: string
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** Public URL for the bundled BEB logo. The web app serves
   *  /beb-wordmark.png; emails need an absolute URL so any client
   *  can fetch it. */
  logoAbsoluteUrl: string
  /** Optional Resend-set "{{recipient_id}}" placeholder URL —
   *  tracking pixel injected at the bottom of the email body.
   *  Resend handles open/click tracking via the API config, so we
   *  don't need to manually add a pixel. */
}

export function buildBroadcastHtml(args: BuildArgs): string {
  const cfg = brandConfig(args.brand)
  const safeBody = sanitizeBodyHtml(args.bodyHtml)
  const cta = args.ctaLabel && args.ctaUrl
    ? `<div style="margin:28px 0 8px;">
         <a href="${escapeAttr(args.ctaUrl)}" target="_blank" style="display:inline-block;background:${cfg.accent};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px;letter-spacing:.02em;">
           ${escapeHtml(args.ctaLabel)}
         </a>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="padding:32px 32px 16px;text-align:center;border-bottom:1px solid #EDE7DA;">
        <img src="${escapeAttr(args.logoAbsoluteUrl)}" alt="${escapeAttr(cfg.label)}" style="max-width:240px;height:auto;display:inline-block;">
      </div>
      <div style="padding:24px 32px 32px;color:#1a1a16;font-size:15px;line-height:1.6;">
        ${safeBody}
        ${cta}
      </div>
      <div style="padding:18px 32px;background:#F5F0E8;border-top:1px solid #EDE7DA;text-align:center;font-size:11px;color:#8a8a7a;">
        ${escapeHtml(cfg.label)}
      </div>
    </div>
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}
function escapeAttr(s: string): string {
  return s.replace(/["']/g, '')
}
