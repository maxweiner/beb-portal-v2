// One-shot cleanup of orphaned marketing Storage objects after the
// rework migration drops every campaign. Service role bypasses bucket
// policies. Safe to re-run; idempotent.
//
// Usage:
//   npx tsx scripts/wipe-marketing-storage.ts
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY from your
// shell env (or .env.local via dotenv if you load it manually).

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  const { data: items, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) {
    console.error(`  list error in ${bucket}/${prefix}:`, error.message)
    return out
  }
  for (const it of items || []) {
    const path = prefix ? `${prefix}/${it.name}` : it.name
    // Folders have null id + null metadata. Files have id set.
    const isFolder = !it.id && !it.metadata
    if (isFolder) {
      const nested = await listAll(bucket, path)
      out.push(...nested)
    } else {
      out.push(path)
    }
  }
  return out
}

async function wipe(bucket: string) {
  console.log(`\n→ ${bucket}`)
  const paths = await listAll(bucket, '')
  if (paths.length === 0) {
    console.log('  (empty)')
    return
  }
  console.log(`  ${paths.length} object(s) to remove`)
  // Supabase remove() accepts up to 1000 paths per call; chunk to be safe
  const CHUNK = 100
  for (let i = 0; i < paths.length; i += CHUNK) {
    const slice = paths.slice(i, i + CHUNK)
    const { error } = await sb.storage.from(bucket).remove(slice)
    if (error) {
      console.error(`  remove error (chunk starting ${i}):`, error.message)
    } else {
      console.log(`  removed ${i + slice.length}/${paths.length}`)
    }
  }
}

;(async () => {
  await wipe('marketing-proofs')
  await wipe('marketing-pdfs')
  console.log('\nDone.')
})().catch(err => {
  console.error(err)
  process.exit(1)
})
