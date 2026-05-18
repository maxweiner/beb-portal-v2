// One-off: migrate legacy base64 data URLs in store_logos JSONB to the
// public `store-logos` bucket so the column shrinks from ~100KB/row
// (inline base64) to ~50 bytes/row (Storage path).
//
// Why
// ────
// PR #728 shipped the multi-logo system but left legacy single-logo
// rows in place with `legacy_data_url: TRUE` flags. They keep rendering
// because publicLogoUrl() passes `data:` URLs through unchanged. But
// the bloat ships to every consumer (boot fetch, Stores page list,
// public booking, OG image) — measured 11.8 MB / 8.7s on BEB's boot
// fetch before PR #737 trimmed the columns. The Stores module list
// still feels the same pain (PR #759).
//
// What this does
// ──────────────
// For every stores / trunk_show_stores row whose store_logos[0].
// legacy_data_url = TRUE:
//   1. Parse `data:<mime>;base64,<data>`
//   2. Upload bytes to `store-logos/{kind}/{parent_id}/{uuid}.{ext}`
//   3. UPDATE store_logos with a fresh entry (path = Storage key,
//      no legacy_data_url flag). The DB trigger re-fires and syncs
//      store_image_url to the new short path.
//
// Idempotent: the WHERE filter on legacy_data_url=TRUE means
// already-migrated rows are skipped on re-run.
//
// Usage
// ─────
//   npx tsx scripts/migrate-legacy-store-logos.ts             # real run
//   npx tsx scripts/migrate-legacy-store-logos.ts --dry-run   # report only
//
// Requires SUPABASE_SERVICE_KEY (RLS bypass).

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

interface LegacyLogoEntry {
  path: string
  mime?: string
  uploaded_at?: string
  uploaded_by?: string | null
  legacy_data_url?: boolean
}

interface Row {
  id: string
  store_logos: LegacyLogoEntry[] | null
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+)(?:;([^,]+))?,([\s\S]+)$/.exec(dataUrl)
  if (!match) return null
  const mime = match[1] || 'image/png'
  const params = (match[2] || '').toLowerCase()
  const payload = match[3]
  if (params.includes('base64')) {
    return { mime, bytes: Buffer.from(payload, 'base64') }
  }
  // Rare: URL-encoded (e.g. svg). Decode to bytes.
  return { mime, bytes: Buffer.from(decodeURIComponent(payload), 'utf8') }
}

async function migrateTable(table: 'stores' | 'trunk_show_stores', kind: 'buying' | 'trunk') {
  console.log(`\n=== ${table} ===`)

  const { data, error } = await sb
    .from(table)
    .select('id, store_logos')
    .eq('store_logos->0->>legacy_data_url', 'true')

  if (error) {
    console.error(`  ERROR fetching ${table}:`, error.message)
    return { migrated: 0, skipped: 0, failed: 0 }
  }

  const rows = (data ?? []) as Row[]
  console.log(`  found ${rows.length} legacy row(s)`)

  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const logos = row.store_logos
    if (!logos || logos.length === 0) { skipped++; continue }

    const legacy = logos[0]
    if (!legacy.legacy_data_url || !legacy.path?.startsWith('data:')) {
      skipped++
      continue
    }

    const parsed = parseDataUrl(legacy.path)
    if (!parsed) {
      console.warn(`  [${row.id}] could not parse data URL — skipping`)
      failed++
      continue
    }

    const ext = EXT_BY_MIME[parsed.mime] ?? 'png'
    const objectKey = `${kind}/${row.id}/${randomUUID()}.${ext}`

    if (DRY_RUN) {
      console.log(`  [${row.id}] would upload ${parsed.bytes.length}B as ${objectKey}`)
      migrated++
      continue
    }

    const { error: uploadErr } = await sb.storage
      .from('store-logos')
      .upload(objectKey, parsed.bytes, { contentType: parsed.mime, upsert: false })

    if (uploadErr) {
      console.error(`  [${row.id}] upload failed:`, uploadErr.message)
      failed++
      continue
    }

    const newEntry: LegacyLogoEntry = {
      path: objectKey,
      mime: parsed.mime,
      uploaded_at: new Date().toISOString(),
      uploaded_by: null,
    }
    const nextLogos = [newEntry, ...logos.slice(1)]

    const { error: updateErr } = await sb
      .from(table)
      .update({ store_logos: nextLogos })
      .eq('id', row.id)

    if (updateErr) {
      console.error(`  [${row.id}] update failed:`, updateErr.message)
      // Best-effort cleanup of the orphaned upload.
      await sb.storage.from('store-logos').remove([objectKey])
      failed++
      continue
    }

    console.log(`  [${row.id}] ✓ ${parsed.bytes.length}B → ${objectKey}`)
    migrated++
  }

  return { migrated, skipped, failed }
}

;(async () => {
  if (DRY_RUN) console.log('=== DRY RUN — no writes ===')

  const buying = await migrateTable('stores', 'buying')
  const trunk = await migrateTable('trunk_show_stores', 'trunk')

  console.log('\n=== summary ===')
  console.log(`  stores             — migrated ${buying.migrated}  skipped ${buying.skipped}  failed ${buying.failed}`)
  console.log(`  trunk_show_stores  — migrated ${trunk.migrated}  skipped ${trunk.skipped}  failed ${trunk.failed}`)

  process.exit((buying.failed + trunk.failed) > 0 ? 1 : 0)
})()
