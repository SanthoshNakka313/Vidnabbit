/**
 * In-browser PDF tools: images -> PDF, merge PDFs (pdf-lib) and PDF -> images
 * (PDF.js, loaded only when used). Nothing is uploaded.
 */
import { decodeFile } from "./decode";
import { outputName } from "./image";
import { ConvertError, canvasToBlob, fitWithin, frameToCanvas, newCanvas, resizeRaster, type Raster } from "./raster";

export const MAX_PDF_BYTES = 100 * 1000 * 1000;
export const MAX_PDF_PAGES = 300;
/** Longest side for images placed in a PDF; keeps files reasonable. */
const PDF_IMAGE_MAX_SIDE = 4000;
/** Served from public/vendor/pdfjs (copied from pdfjs-dist by scripts/copy-vendor.mjs). */
const PDFJS = "/vendor/pdfjs";
export const PDF_WORKER_URL = `${PDFJS}/pdf.worker.min.mjs`;

export type PageSize = "a4" | "letter" | "fit";

/** Page sizes in PDF points (1/72 inch). */
export const PAGE_SIZES: Record<Exclude<PageSize, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MARGIN = 36; // 0.5 inch

/** Where an image of (w, h) goes on a (pw, ph) page: centred, scaled to fit inside the margins. */
export function placeOnPage(w: number, h: number, pw: number, ph: number, margin = MARGIN) {
  const s = Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h, 1);
  const width = w * s;
  const height = h * s;
  return { x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}

function checkPdfSize(file: File) {
  if (file.size > MAX_PDF_BYTES) throw new ConvertError(`${file.name} is over 100 MB.`);
}

const hasAlpha = (r: Raster) => {
  const d = r.frames[0].data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
};

export async function imagesToPdf(files: File[], pageSize: PageSize): Promise<Blob> {
  if (!files.length) throw new ConvertError("Add at least one image.");
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setProducer("VidNabbit");
  doc.setCreator("VidNabbit");
  for (const file of files) {
    // Decode every input format (HEIC, TIFF, RAW, WebP...) and re-encode as PNG
    // (transparent images) or JPEG (everything else) for the PDF.
    let raster: Raster;
    try {
      raster = resizeRaster(await decodeFile(file), PDF_IMAGE_MAX_SIDE);
    } catch (e) {
      throw new ConvertError(`${file.name}: ${(e as Error).message}`);
    }
    const size = { width: raster.width, height: raster.height };
    const alpha = hasAlpha(raster);
    const blob = await canvasToBlob(frameToCanvas(raster), alpha ? "image/png" : "image/jpeg", 0.92);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = alpha ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // "fit": one image per page at 96 dpi, so the page matches the picture.
    const [pw, ph] =
      pageSize === "fit" ? [size.width * 0.75, size.height * 0.75] : PAGE_SIZES[pageSize];
    const landscape = pageSize !== "fit" && size.width > size.height;
    const page = doc.addPage(landscape ? [ph, pw] : [pw, ph]);
    const { width: W, height: H } = page.getSize();
    const at = pageSize === "fit" ? { x: 0, y: 0, width: W, height: H } : placeOnPage(size.width, size.height, W, H);
    page.drawImage(embedded, at);
  }
  return new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
}

export async function mergePdfs(files: File[]): Promise<Blob> {
  if (files.length < 2) throw new ConvertError("Add at least two PDFs to merge.");
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  out.setProducer("VidNabbit");
  for (const file of files) {
    checkPdfSize(file);
    let src;
    try {
      src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      const msg = String((e as Error)?.message ?? "");
      throw new ConvertError(
        /encrypt/i.test(msg)
          ? `${file.name} is password-protected. Remove the password first.`
          : `${file.name} isn't a PDF we can read.`,
      );
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    if (out.getPageCount() > MAX_PDF_PAGES * 3) throw new ConvertError("That's too many pages to merge in the browser.");
  }
  return new Blob([(await out.save()) as BlobPart], { type: "application/pdf" });
}

export interface RenderedPage {
  blob: Blob;
  name: string;
  page: number;
}

/** fontNames: also send real font names (for bold/italic detection in PDF to Word). */
export async function openPdf(data: Uint8Array, name: string, fontNames = false) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  // PDF.js 6 never uses eval; XFA forms stay off.
  const task = pdfjs.getDocument({
    data,
    enableXfa: false,
    cMapUrl: `${PDFJS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    wasmUrl: `${PDFJS}/wasm/`,
    iccUrl: `${PDFJS}/iccs/`,
    fontExtraProperties: fontNames,
  });
  try {
    return { task, doc: await task.promise };
  } catch (e) {
    await task.destroy();
    const err = (e as { name?: string })?.name;
    throw new ConvertError(
      err === "PasswordException" ? `${name} is password-protected. Remove the password first.` : `${name} isn't a PDF we can read.`,
    );
  }
}

/** Renders a PDF page onto a white canvas. */
export async function renderPage(doc: Awaited<ReturnType<typeof openPdf>>["doc"], n: number, scale: number) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale });
  const [canvas, ctx] = newCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  ctx.fillStyle = "#ffffff"; // PDFs assume a white page
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** First page as pixels, longest side maxSide (used to open .ai files as images). */
export async function renderFirstPage(data: Uint8Array, maxSide: number): Promise<Raster> {
  const { task, doc } = await openPdf(data, "This file");
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const { width } = fitWithin(base.width * 4, base.height * 4, maxSide);
    const canvas = await renderPage(doc, 1, width / base.width);
    const ctx = canvas.getContext("2d")!;
    return { width: canvas.width, height: canvas.height, frames: [{ delay: 0, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }] };
  } finally {
    await task.destroy();
  }
}

/** Renders each page of a PDF to PNG or JPG. Scale 2 is about 144 dpi. */
export async function pdfToImages(
  file: File,
  format: "png" | "jpeg",
  onProgress?: (done: number, total: number) => void,
  scale = 2,
): Promise<RenderedPage[]> {
  checkPdfSize(file);
  const { task, doc } = await openPdf(new Uint8Array(await file.arrayBuffer()), file.name);
  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new ConvertError(`This PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    const ext = format === "png" ? "png" : "jpg";
    const base = outputName(file.name, "").replace(/\.$/, "");
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const canvas = await renderPage(doc, n, scale);
      const blob = await canvasToBlob(canvas, format === "png" ? "image/png" : "image/jpeg", 0.92);
      pages.push({ blob, name: `${base}-page-${String(n).padStart(3, "0")}.${ext}`, page: n });
      onProgress?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
