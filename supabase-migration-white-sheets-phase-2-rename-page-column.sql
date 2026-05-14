-- ============================================================
-- White Sheet OCR — PHASE 2: rename white_sheet_pages.image_path
--                            → page_pdf_path
--
-- Phase 1 named the column `image_path` assuming we'd render each
-- page to PNG server-side. Implementation pivot: Claude vision
-- accepts PDF document blocks natively, so the splitter stores
-- per-page single-page PDFs instead — no rasterization, no canvas
-- dependency on Vercel, smaller storage footprint. Browser-side
-- review-pile renders the PDF via pdfjs-dist when displayed.
--
-- Rename keeps the codebase honest about what's actually stored.
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'white_sheet_pages'
      AND column_name  = 'image_path'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'white_sheet_pages'
      AND column_name  = 'page_pdf_path'
  ) THEN
    ALTER TABLE public.white_sheet_pages
      RENAME COLUMN image_path TO page_pdf_path;
  END IF;
END $$;

COMMENT ON COLUMN public.white_sheet_pages.page_pdf_path IS
  'Storage path to the per-page single-page PDF in the white-sheets bucket. Path scheme: white-sheets/{brand}/{event_id}/{upload_id}/page-{n}.pdf. Sent verbatim to Claude vision as a document block by the OCR worker; rendered browser-side via pdfjs-dist for the review pile UI.';

DO $$ BEGIN
  RAISE NOTICE 'White Sheets Phase 2: white_sheet_pages.image_path → page_pdf_path. Splitter writes per-page PDFs.';
END $$;
