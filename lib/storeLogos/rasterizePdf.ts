// Client-side PDF → PNG rasterizer used by StoreLogoManager when the
// user picks a PDF file. Renders page 1 of the PDF to a canvas at
// 1200px on the longest edge and returns a PNG Blob.
//
// pdfjs-dist is dynamically imported so it only loads when a user
// actually drops a PDF — keeps the main bundle clean for the 99%
// of uploads that are already images.
//
// Worker setup: the worker is served as a static asset from
// `public/pdf.worker.min.mjs` (copied from node_modules by the
// `prebuild` npm script, and committed for local dev). Bundling
// the worker via `new URL(..., import.meta.url)` fails Next.js's
// production build (Terser chokes on `import.meta` in the worker
// source), and CDN URLs add a runtime dependency we don't need.

const MAX_DIMENSION = 1200
const WORKER_SRC = '/pdf.worker.min.mjs'

/** Rasterize page 1 of a PDF File to a PNG Blob at up to 1200px on
 *  the longest edge. Throws if the PDF can't be parsed (caller
 *  shows the error to the user). */
export async function rasterizePdfToPng(file: File): Promise<Blob> {
  // Dynamic import — pdfjs-dist is ~3MB and only needed when the
  // user actually picks a PDF.
  const pdfjs = await import('pdfjs-dist')

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC
  }

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise

  try {
    const page = await pdf.getPage(1)

    // Compute scale so the longest edge becomes MAX_DIMENSION. PDF
    // viewport at scale=1 is in CSS pixels; we want a crisp raster.
    const baseViewport = page.getViewport({ scale: 1 })
    const longest = Math.max(baseViewport.width, baseViewport.height)
    const scale = MAX_DIMENSION / longest
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context for PDF rasterization')

    // Many logo PDFs have a transparent background; fill with white
    // so the rendered logo doesn't look broken when displayed on a
    // dark surface (e.g. the QR-code center). This matches what most
    // browsers do when printing a PDF with no background.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
        'image/png',
      )
    })
  } finally {
    await pdf.destroy()
  }
}
