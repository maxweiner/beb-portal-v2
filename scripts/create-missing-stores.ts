// One-shot: create the 9 stores from the SimplyBook export that don't
// exist in beb-portal-v2 yet. Idempotent — skips stores whose name
// already exists.
//
// Names + addresses are pulled from the SimplyBook locations array.
// (Marc Robinson's lat/lng in the source data is incorrect — points
// to NC instead of TX — so we omit lat/lng for all of these. They
// can be backfilled via geocoding later.)
//
// Run:
//   set -a && . ./.env.local && set +a
//   npx tsx scripts/create-missing-stores.ts            # dry run
//   npx tsx scripts/create-missing-stores.ts --execute  # actually insert

import { createClient } from '@supabase/supabase-js'

const EXECUTE = process.argv.includes('--execute')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

type StoreInsert = {
  name: string
  address: string
  city: string
  state: string
  zip: string
  owner_phone: string
  brand: string
  active: boolean
}

const STORES: StoreInsert[] = [
  { name: "Blocher Jewelers",        address: "283 PA Route 288",          city: "Ellwood City", state: "PA", zip: "16117", owner_phone: "7247583248", brand: "beb", active: true },
  { name: "Dem's Fine Jewelers",     address: "1068 Lake Murray Blvd",     city: "Irmo",         state: "SC", zip: "29063", owner_phone: "8034075290", brand: "beb", active: true },
  { name: "Godwin - Bainbridge",     address: "400 East Shotwell St",      city: "Bainbridge",   state: "GA", zip: "39819", owner_phone: "2292467900", brand: "beb", active: true },
  { name: "Godwin - Thomasville",    address: "202 S Broad St",            city: "Thomasville",  state: "GA", zip: "31792", owner_phone: "2292338536", brand: "beb", active: true },
  { name: "Gray's Jewelers Bespoke", address: "429 N County Rd",           city: "St James",     state: "NY", zip: "11780", owner_phone: "6312509489", brand: "beb", active: true },
  { name: "Gwen's Fine Jewelers",    address: "841 B Eastern Bypass",      city: "Richmond",     state: "KY", zip: "40475", owner_phone: "8596249600", brand: "beb", active: true },
  { name: "Marc Robinson Jewelers",  address: "4401 N Interstate Hwy 35, Suite 824", city: "Round Rock", state: "TX", zip: "78664", owner_phone: "5128680300", brand: "beb", active: true },
  { name: "Thigpen Jewelers",        address: "442 N Wilmot Rd",           city: "Tucson",       state: "AZ", zip: "85711", owner_phone: "5208865557", brand: "beb", active: true },
  { name: "Vaughan's Jewelry",       address: "311 Broad Street",          city: "Edenton",      state: "NC", zip: "27932", owner_phone: "2524823525", brand: "beb", active: true },
]

;(async () => {
  // 1. Find which already exist (so re-runs are safe).
  const { data: existing, error } = await sb
    .from('stores').select('name').in('name', STORES.map(s => s.name))
  if (error) { console.error(error); process.exit(1) }
  const have = new Set((existing ?? []).map(r => r.name))
  const toInsert = STORES.filter(s => !have.has(s.name))

  console.log(`Stores in target list: ${STORES.length}`)
  console.log(`Already exist:         ${have.size}`)
  console.log(`To create:             ${toInsert.length}`)
  for (const s of toInsert) console.log(`  + ${s.name}  (${s.city}, ${s.state})`)

  if (!EXECUTE) {
    console.log(`\nDRY RUN — pass --execute to actually insert.`)
    return
  }
  if (toInsert.length === 0) { console.log('Nothing to do.'); return }

  const { data: inserted, error: insErr } = await sb
    .from('stores').insert(toInsert).select('id, name')
  if (insErr) { console.error(insErr); process.exit(1) }
  console.log(`\nInserted ${inserted!.length} stores:`)
  for (const r of inserted!) console.log(`  ${r.id}  ${r.name}`)
})().catch(err => { console.error(err); process.exit(1) })
