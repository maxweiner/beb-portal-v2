// Server-side W-9 PDF filler. Loads the official IRS W-9 template
// (public/forms/fw9.pdf, downloaded from irs.gov), fills AcroForm
// fields, embeds the signature, and returns the bytes for upload.
//
// IRS field-name reference (from `pdf-lib` form.getFields() on the
// Oct-2018+ revision shipped in this repo):
//
//   f1_01  — Line 1 name
//   f1_02  — Line 2 business name
//   c1_1[0..6] — tax classification checkboxes
//                (Individual / C corp / S corp / Partnership /
//                 Trust-estate / LLC / Other)
//   f1_03  — LLC sub-code (C/S/P) when LLC checked
//   f1_04  — "Other" free text when Other checked
//   c1_2   — Note 3b checkbox (foreign-partnered LLC; rarely used)
//   f1_05  — Exempt payee code (Line 4a)
//   f1_06  — Exemption from FATCA reporting code (Line 4b)
//   f1_07  — Address (Line 5)
//   f1_08  — City / State / Zip (Line 6)
//   f1_09  — Account numbers (Line 7; usually blank)
//   f1_10  — Requester name & address (top-right box)
//   f1_11/12/13 — SSN (xxx / xx / xxxx)
//   f1_14/15 — EIN (xx / xxxxxxx)
//
// Signature isn't an AcroForm field — we drawImage it onto the
// signature line at approximate coords. If the IRS revises and the
// coords drift, adjust the constants at the bottom of this file.

import fs from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { W9FormData, W9RequesterInfo } from '@/types'

export interface GenerateW9Input {
  formData: W9FormData
  /** Raw 9-digit TIN string (SSN or EIN). Lives only in memory +
   *  the rendered PDF — not persisted to DB form_data. */
  tin: string
  requester: W9RequesterInfo
  /** One of these must be present. */
  signatureDrawnDataUrl?: string | null
  signatureTypedName?: string | null
}

const SIG_X = 110          // signature line left edge, page 1
const SIG_Y = 175          // signature line baseline, page 1 (from bottom)
const SIG_WIDTH = 230
const SIG_HEIGHT = 28
const SIG_DATE_X = 410     // date column on the same signature row
const SIG_DATE_Y = 178

/** Generates a filled + signed W-9 PDF. Returns raw bytes ready
 *  for Supabase Storage upload. */
export async function generateSignedW9Pdf(input: GenerateW9Input): Promise<Uint8Array> {
  const templatePath = path.join(process.cwd(), 'public', 'forms', 'fw9.pdf')
  const templateBytes = await fs.readFile(templatePath)
  const pdf = await PDFDocument.load(templateBytes)
  const form = pdf.getForm()
  const f = input.formData

  // ── Line 1: Name ────────────────────────────────────────────
  setText(form, 'topmostSubform[0].Page1[0].f1_01[0]', f.name)

  // ── Line 2: Business name (optional) ────────────────────────
  if (f.business_name) setText(form, 'topmostSubform[0].Page1[0].f1_02[0]', f.business_name)

  // ── Line 3: Tax classification ──────────────────────────────
  // c1_1[0..6] = Individual, C corp, S corp, Partnership, Trust-estate, LLC, Other
  const classToIndex: Record<string, number> = {
    individual: 0, c_corp: 1, s_corp: 2, partnership: 3,
    trust_estate: 4, llc: 5, other: 6,
  }
  const idx = classToIndex[f.tax_classification]
  if (idx != null) {
    checkBox(form, `topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[${idx}]`)
  }
  if (f.tax_classification === 'llc' && f.llc_classification) {
    setText(form, 'topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].f1_03[0]', f.llc_classification)
  }
  if (f.tax_classification === 'other' && f.other_classification) {
    setText(form, 'topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].f1_04[0]', f.other_classification)
  }

  // ── Line 4: Exemption codes (optional) ──────────────────────
  if (f.exempt_payee_code) setText(form, 'topmostSubform[0].Page1[0].f1_05[0]', f.exempt_payee_code)
  if (f.exempt_fatca_code) setText(form, 'topmostSubform[0].Page1[0].f1_06[0]', f.exempt_fatca_code)

  // ── Lines 5-6: Address + city/state/zip ─────────────────────
  setText(form, 'topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_07[0]', f.address)
  setText(
    form,
    'topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_08[0]',
    [f.city, f.state, f.zip].filter(Boolean).join(', '),
  )

  // ── Requester info (top-right box) ──────────────────────────
  const req = input.requester
  const requesterBlock = [
    req.name,
    req.address,
    [req.city, req.state, req.zip].filter(Boolean).join(', '),
    req.phone ? `Phone: ${req.phone}` : null,
  ].filter(Boolean).join('\n')
  setText(form, 'topmostSubform[0].Page1[0].f1_10[0]', requesterBlock, { multiline: true })

  // ── TIN ─────────────────────────────────────────────────────
  // pdf-lib comb-fills the multi-digit boxes if we just dump the
  // full string in. SSN: 9 digits across f1_11/12/13. EIN: 9 digits
  // across f1_14/15. Use the field-set matching the user's choice.
  const tinDigits = (input.tin || '').replace(/\D/g, '')
  if (f.tin_type === 'ssn' && tinDigits.length === 9) {
    setText(form, 'topmostSubform[0].Page1[0].f1_11[0]', tinDigits.slice(0, 3))
    setText(form, 'topmostSubform[0].Page1[0].f1_12[0]', tinDigits.slice(3, 5))
    setText(form, 'topmostSubform[0].Page1[0].f1_13[0]', tinDigits.slice(5, 9))
  } else if (f.tin_type === 'ein' && tinDigits.length === 9) {
    setText(form, 'topmostSubform[0].Page1[0].f1_14[0]', tinDigits.slice(0, 2))
    setText(form, 'topmostSubform[0].Page1[0].f1_15[0]', tinDigits.slice(2, 9))
  }
  // (If neither slot matches, we still render the rest of the form
  // and let the recipient annotate at their accountant's request —
  // but the submit handler validates length before we ever reach
  // here, so this is dead code in practice.)

  // ── Signature + date — drawn on the PDF page itself ─────────
  const page = pdf.getPages()[0]

  if (input.signatureDrawnDataUrl) {
    // Drawn signature: embed the canvas PNG as an image.
    const b64 = input.signatureDrawnDataUrl.split(',')[1]
    if (b64) {
      const pngBytes = Uint8Array.from(Buffer.from(b64, 'base64'))
      try {
        const img = await pdf.embedPng(pngBytes)
        page.drawImage(img, { x: SIG_X, y: SIG_Y, width: SIG_WIDTH, height: SIG_HEIGHT })
      } catch (e) {
        console.warn('[w9 pdf] drawn signature embed failed; falling back to typed:', e)
        await drawTypedSignature(pdf, page, f.signed_name || f.name)
      }
    }
  } else if (input.signatureTypedName) {
    await drawTypedSignature(pdf, page, input.signatureTypedName)
  }

  // Date column — always rendered next to whichever signature path
  // we took. Format: MM/DD/YYYY in plain Helvetica.
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const dateStr = formatSignedDate(f.signed_at)
  page.drawText(dateStr, {
    x: SIG_DATE_X, y: SIG_DATE_Y,
    size: 11, font: helvetica, color: rgb(0, 0, 0),
  })

  // Flatten so accountant + IRS see exactly what was signed.
  form.flatten()

  return pdf.save()
}


// ── helpers ─────────────────────────────────────────────────────

function setText(form: ReturnType<PDFDocument['getForm']>, name: string, value: string, opts?: { multiline?: boolean }) {
  try {
    const field = form.getTextField(name)
    field.setText(value)
    if (opts?.multiline) field.enableMultiline()
  } catch (e) {
    console.warn('[w9 pdf] field not found:', name, (e as Error).message)
  }
}

function checkBox(form: ReturnType<PDFDocument['getForm']>, name: string) {
  try {
    form.getCheckBox(name).check()
  } catch (e) {
    console.warn('[w9 pdf] checkbox not found:', name, (e as Error).message)
  }
}

async function drawTypedSignature(pdf: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number], name: string) {
  // Use Helvetica-Oblique so it visually reads as a signature even
  // though it's just typed text. (StandardFonts.TimesItalicBold
  // would also work; oblique-helvetica is more universal.)
  const font = await pdf.embedFont(StandardFonts.HelveticaOblique)
  page.drawText(name, {
    x: SIG_X, y: SIG_Y + 8,
    size: 14, font, color: rgb(0, 0, 0.5),
  })
}

function formatSignedDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}
