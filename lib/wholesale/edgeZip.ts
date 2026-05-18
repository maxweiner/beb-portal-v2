// Server-side ZIP streamer for Edge wholesale batches.
//
// Builds a single .zip containing every photo for a batch + the
// batch's CSV. Streamed via `archiver` so a 200-photo batch doesn't
// have to fit in function memory — bytes flow from Supabase Storage
// → archiver → response stream as they're downloaded.
//
// Two route shapes call this:
//   - /api/wholesale/edge/batch/[id]/zip       (authed, History tab)
//   - /api/wholesale/edge/public/[token]/zip   (public, batch share page)
//
// Both share `buildBatchZipStream` for the actual archive work; the
// only difference is which lookup field they use to resolve the
// batch row (id vs public_token).

import { Readable } from 'stream'
import { pdfAdmin, PHOTO_BUCKET } from './pdfHelpers'

// archiver is a CommonJS module that exports its factory function as
// `module.exports = fn`. Next.js 14's webpack bundles it with the
// ESM-default-import wrapper anyway (despite `archiver` being listed
// in next.config.js `serverComponentsExternalPackages`), producing
// the runtime error `TypeError: (0, r.default) is not a function` on
// the prod build of /api/wholesale/edge/public/[token]/zip.
//
// Switching to a plain `require` sidesteps the wrapper entirely and
// loads the function directly from node_modules at runtime. The
// `typeof import('archiver')` cast preserves the same type as the
// previous default import would have given us.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver') as typeof import('archiver')

export interface BatchZipResolution {
  ok: true
  batch_code: string
  /** Storage paths for every photo, in stable position order. */
  photo_paths: string[]
  /** Storage path for the batch CSV (if uploaded — it almost always is). */
  csv_path: string | null
}
export interface BatchZipError {
  ok: false
  status: number
  error: string
}

/**
 * Resolve the batch + child rows by batch row id. SECURITY: caller
 * MUST have already authed the requester (e.g. wholesale-access
 * check). This helper is dumb about who can call it.
 */
export async function resolveBatchById(batchId: string): Promise<BatchZipResolution | BatchZipError> {
  const sb = pdfAdmin()
  const { data: batch } = await sb
    .from('edge_batches')
    .select('id, batch_code, csv_path')
    .eq('id', batchId)
    .maybeSingle()
  if (!batch) return { ok: false, status: 404, error: 'Batch not found' }
  return loadPhotos(sb, batch)
}

/**
 * Resolve the batch by public_token (revocation-aware). For the
 * unauthenticated public download endpoint.
 */
export async function resolveBatchByPublicToken(token: string): Promise<BatchZipResolution | BatchZipError> {
  const sb = pdfAdmin()
  const { data: batch } = await sb
    .from('edge_batches')
    .select('id, batch_code, csv_path, revoked_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!batch) return { ok: false, status: 404, error: 'Batch not found' }
  if ((batch as any).revoked_at) return { ok: false, status: 410, error: 'Link revoked' }
  return loadPhotos(sb, batch)
}

async function loadPhotos(sb: any, batch: any): Promise<BatchZipResolution | BatchZipError> {
  const { data: items } = await sb
    .from('edge_batch_items')
    .select('position, photo_paths')
    .eq('batch_id', batch.id)
    .order('position', { ascending: true })
  const photoPaths: string[] = []
  for (const it of (items || []) as any[]) {
    for (const p of (it.photo_paths || []) as string[]) photoPaths.push(p)
  }
  return {
    ok: true,
    batch_code: batch.batch_code,
    photo_paths: photoPaths,
    csv_path: batch.csv_path || null,
  }
}

/**
 * Build a streaming ZIP of every photo + the CSV for the given batch.
 * Returns a Web ReadableStream so NextResponse can pipe it back to
 * the client without buffering the whole archive in function memory.
 *
 * Why a Web ReadableStream and not just `archive.pipe(res)`: the
 * App Router's NextResponse takes a Web stream, not a Node stream.
 * We bridge with Readable.toWeb() + a manual data/end/error pump.
 */
export function buildBatchZipStream(resolution: BatchZipResolution): ReadableStream<Uint8Array> {
  const sb = pdfAdmin()
  // Best balance of compression speed vs. ratio for jpeg-heavy
  // payloads. Photos are already lossy-compressed so the gain over
  // store-only is small; we still set level=6 for any text/csv
  // entries.
  const archive = archiver('zip', { zlib: { level: 6 } })

  // ── Append work runs in the background as the stream is read.
  ;(async () => {
    try {
      // 1. CSV first so Mary can find it at the top of the zip.
      if (resolution.csv_path) {
        try {
          const { data, error } = await sb.storage.from(PHOTO_BUCKET).download(resolution.csv_path)
          if (!error && data) {
            const buf = Buffer.from(await data.arrayBuffer())
            archive.append(buf, { name: `${resolution.batch_code}.csv` })
          }
        } catch (e) {
          console.warn('[edgeZip] csv download failed', resolution.csv_path, e)
        }
      }

      // 2. Photos, in stable batch order.
      for (const path of resolution.photo_paths) {
        try {
          const { data, error } = await sb.storage.from(PHOTO_BUCKET).download(path)
          if (error || !data) {
            console.warn('[edgeZip] photo download failed', path, error?.message)
            continue
          }
          const buf = Buffer.from(await data.arrayBuffer())
          // Strip the storage prefix so the zip mirrors what Mary
          // would see if she'd downloaded files individually —
          // filenames like `EDGE-20260516-A4F2_L-1042_1.jpg`.
          const filename = path.split('/').pop() || path
          archive.append(buf, { name: filename })
        } catch (e) {
          console.warn('[edgeZip] photo append failed', path, e)
        }
      }

      await archive.finalize()
    } catch (e) {
      console.error('[edgeZip] archive failed', e)
      archive.abort()
    }
  })()

  // Bridge Node Readable → Web ReadableStream so NextResponse can
  // stream the body without buffering.
  return Readable.toWeb(archive as unknown as Readable) as ReadableStream<Uint8Array>
}
