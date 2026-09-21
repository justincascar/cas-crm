import { createCanvas } from "@napi-rs/canvas";
import { getDocument as getPdfJsDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_PREVIEW_PAGES = 12;
export const PDF_PREVIEW_SCALE = 1.4;
const OPEN_TIMEOUT_MS = 12_000;
const RENDER_TIMEOUT_MS = 20_000;

export class PdfPreviewRangeError extends Error {
  pages: number;
  constructor(pages: number) {
    super("That page is not in this PDF.");
    this.name = "PdfPreviewRangeError";
    this.pages = pages;
  }
}

export class PdfPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfPreviewError";
  }
}

type OpenedPdf = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (params: { scale: number }) => { width: number; height: number };
    render: (params: { canvasContext: unknown; viewport: { width: number; height: number }; canvas: unknown }) => {
      promise: Promise<void>;
    };
  }>;
  cleanup?: () => Promise<void> | void;
};

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PdfPreviewError(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const owned = Uint8Array.from(data);
  if (owned.byteLength < 5 || Buffer.from(owned.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new PdfPreviewError("This stored file is not a PDF that can be drawn on screen.");
  }
  const pdf = (await withTimeout(
    getPdfJsDocument({ data: owned, disableWorker: true, isEvalSupported: false, verbosity: 0 }).promise as Promise<OpenedPdf>,
    OPEN_TIMEOUT_MS,
    "Timed out reading this PDF.",
  )) as OpenedPdf;
  return pdf;
}

async function closePdf(pdf: OpenedPdf) {
  try {
    if (typeof pdf.cleanup === "function") await pdf.cleanup();
  } catch {
    // Preview cleanup must not mask a successful draw.
  }
}

export async function countPdfPages(data: Uint8Array): Promise<number> {
  const pdf = await openPdf(data);
  try {
    return Math.min(Math.max(0, Number(pdf.numPages) || 0), MAX_PDF_PREVIEW_PAGES);
  } finally {
    await closePdf(pdf);
  }
}

export async function renderPdfPage(
  data: Uint8Array,
  pageNumber: number,
): Promise<{ mimeType: string; bytes: Buffer }> {
  const pdf = await openPdf(data);
  try {
    const pages = Math.min(Math.max(0, Number(pdf.numPages) || 0), MAX_PDF_PREVIEW_PAGES);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages) {
      throw new PdfPreviewRangeError(pages);
    }
    const page = await withTimeout(pdf.getPage(pageNumber), OPEN_TIMEOUT_MS, "Timed out opening a PDF page.");
    const viewport = page.getViewport({ scale: PDF_PREVIEW_SCALE });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const canvasContext = canvas.getContext("2d");
    await withTimeout(
      page.render({ canvasContext, viewport, canvas }).promise,
      RENDER_TIMEOUT_MS,
      "Timed out drawing a PDF page.",
    );
    return { mimeType: "image/jpeg", bytes: Buffer.from(canvas.toBuffer("image/jpeg", 80)) };
  } finally {
    await closePdf(pdf);
  }
}
