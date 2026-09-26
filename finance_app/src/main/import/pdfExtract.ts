import type { PdfTextPage } from '../../domain/import/pdfStatement';

/**
 * Extracts positioned text from a PDF using Mozilla PDF.js.
 * Hardening: XFA forms, network fetching and font loading are disabled — only the
 * text layer is read. Nothing in the PDF is executed or rendered. PDF.js must stay at
 * 6.2.108 or later (GHSA-hq66-cqwq-w95j: script execution from malicious PDFs).
 */
export interface PdfExtraction {
  pages: PdfTextPage[];
  pageCount: number;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  // Kept as a real dynamic import (PDF.js is an ES module).
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

export class PdfPasswordError extends Error {
  constructor() {
    super('This PDF is password-protected. Open it in a PDF viewer and save or export an unprotected copy, or import a CSV/OFX export instead.');
  }
}

export async function extractPdfText(data: Uint8Array, maxPages = 200): Promise<PdfExtraction> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), // PDF.js takes ownership of the buffer it is given
    // PDF.js 6 no longer evaluates font code (the old isEvalSupported option is gone).
    useWorkerFetch: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'PasswordException') throw new PdfPasswordError();
    throw new Error('This file could not be opened as a PDF.');
  }
  const pages: PdfTextPage[] = [];
  const count = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const [, , , d, e, f] = it.transform as number[];
      items.push({ str: it.str, x: e, y: f, width: it.width, height: it.height || Math.abs(d) });
    }
    pages.push({ pageNumber: n, width: viewport.width, height: viewport.height, items });
    page.cleanup();
  }
  await task.destroy();
  return { pages, pageCount: doc.numPages };
}
