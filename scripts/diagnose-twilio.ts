// Local-only Twilio diagnostic. Pulls the settings.value row, validates
// credentials with Twilio's API, and dumps the most recent
// notification_log SMS rows so we can see actual failure messages.
//
// Run: set -a && source .env.local && set +a && npx tsx scripts/diagnose-twilio.ts

import { createClient } from '@supabase/supabase-js'

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── 1. Read the settings row ────────────────────────────
  const { data: row, error } = await sb.from('settings')
    .select('value, updated_at')
    .eq('key', 'sms').maybeSingle()
  if (error) { console.error('settings read failed:', error.message); process.exit(1) }
  if (!row) {
    console.error('❌ No settings row with key="sms". Twilio config is missing.')
    process.exit(1)
  }

  const cfg = (row.value || {}) as { accountSid?: string; authToken?: string; fromNumber?: string }
  console.log('settings.value (key="sms"):')
  console.log(`  accountSid:  ${cfg.accountSid ? cfg.accountSid.slice(0, 8) + '…' + cfg.accountSid.slice(-4) : '(missing)'}`)
  console.log(`  authToken:   ${cfg.authToken ? '(present, ' + cfg.authToken.length + ' chars)' : '(missing)'}`)
  console.log(`  fromNumber:  ${cfg.fromNumber ?? '(missing)'}`)
  console.log(`  updated_at:  ${row.updated_at}`)

  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
    console.error('\n❌ Required field missing — sendSMS would silently no-op.')
  }

  // ── 2. Validate creds against Twilio ────────────────────
  if (cfg.accountSid && cfg.authToken) {
    const basic = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}.json`, {
      headers: { Authorization: `Basic ${basic}` },
    })
    if (r.ok) {
      const acct = await r.json() as any
      console.log('\n✓ Twilio account fetch succeeded.')
      console.log(`  status:   ${acct.status}`)
      console.log(`  type:     ${acct.type}`)
      console.log(`  friendly: ${acct.friendly_name}`)
      if (acct.status !== 'active') {
        console.error(`  ⚠ Account status is "${acct.status}" — not active.`)
      }
    } else {
      console.error(`\n❌ Twilio auth failed: ${r.status} ${r.statusText}`)
      console.error('   ' + (await r.text()).slice(0, 300))
    }
  }

  // ── 3. Verify the From-number ───────────────────────────
  if (cfg.accountSid && cfg.authToken && cfg.fromNumber) {
    const basic = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
    const enc = encodeURIComponent(cfg.fromNumber)
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${enc}`,
      { headers: { Authorization: `Basic ${basic}` } },
    )
    if (r.ok) {
      const data = await r.json() as any
      const numbers = data.incoming_phone_numbers || []
      if (numbers.length === 0) {
        console.error(`\n❌ ${cfg.fromNumber} is NOT an active number on this Twilio account.`)
      } else {
        const n = numbers[0]
        console.log(`\n✓ ${cfg.fromNumber} is owned by this account.`)
        console.log(`  full capabilities object:`, JSON.stringify(n.capabilities))
        console.log(`  status: ${n.status}, sms_application_sid: ${n.sms_application_sid || '(none)'}`)
        console.log(`  origin: ${n.origin}, beta: ${n.beta}`)
      }
    }
  }

  // ── 4b. Try a no-op Twilio Messages API request to get a recent error ─
  if (cfg.accountSid && cfg.authToken) {
    const basic = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json?PageSize=5`,
      { headers: { Authorization: `Basic ${basic}` } },
    )
    if (r.ok) {
      const data = await r.json() as any
      console.log(`\nLast ${data.messages?.length ?? 0} Twilio messages from this account:`)
      for (const m of data.messages ?? []) {
        console.log(`  ${m.date_sent || m.date_created} · ${m.status}`
          + ` · ${m.from} → ${m.to}`
          + (m.error_code ? ` · ⚠ error_code=${m.error_code}: ${m.error_message}` : ''))
      }
    }
  }

  // ── 4. Recent notification_log SMS rows ─────────────────
  const { data: logs } = await sb.from('notification_log')
    .select('id, recipient, status, error, created_at, kind, channel')
    .eq('channel', 'sms')
    .order('created_at', { ascending: false })
    .limit(15)
  console.log(`\nLast ${logs?.length ?? 0} notification_log SMS rows:`)
  for (const l of (logs as any[]) ?? []) {
    const err = l.error ? ` · ${l.error.slice(0, 200)}` : ''
    console.log(`  ${l.created_at} · ${l.status} · ${l.recipient} · ${l.kind}${err}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
