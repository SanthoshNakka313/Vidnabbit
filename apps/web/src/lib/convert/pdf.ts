/**
 * In-browser PDF tools: images -> PDF, merge PDFs (pdf-lib) and PDF -> images
 * (PDF.js, loaded only when used). Nothing is uploaded.
 */
import { ConvertError, decodeImage, drawToCanvas, fitWithin, outputName } from "./image";

export const MAX_PDF_BYTES = 100 * 1000 * 1000;
export const MAX_PDF_PAGES = 300;
/** Longest side for images placed in a PDF; keeps files reasonable. */
const PDF_IMAGE_MAX_SIDE = 4000;
/** Served from public/vendor/pdfjs (copied from pdfjs-dist by scripts/copy-pdf-worker.mjs). */
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

const KEEPS_ALPHA = new Set(["image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

export async function imagesToPdf(files: File[], pageSize: PageSize): Promise<Blob> {
  if (!files.length) throw new ConvertError("Add at least one image.");
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setProducer("VidNabbit");
  doc.setCreator("VidNabbit");
  for (const file of files) {
    // Re-encode through a canvas so phone photos keep their EXIF rotation and every
    // input format (WebP, GIF, HEIC in Safari...) becomes PNG or JPEG for the PDF.
    const img = await decodeImage(file);
    const size = fitWithin(img.naturalWidth, img.naturalHeight, PDF_IMAGE_MAX_SIDE);
    const alpha = KEEPS_ALPHA.has(file.type);
    const canvas = drawToCanvas(img, size, alpha ? undefined : "#ffffff");
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new ConvertError("Couldn't read an image."))),
        alpha ? "image/png" : "image/jpeg", 0.92),
    );
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

/** Renders each page of a PDF to PNG or JPG. Scale 2 is about 144 dpi. */
export async function pdfToImages(
  file: File,
  format: "png" | "jpeg",
  onProgress?: (done: number, total: number) => void,
  scale = 2,
): Promise<RenderedPage[]> {
  checkPdfSize(file);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  // PDF.js 6 never uses eval; XFA forms stay off.
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
    cMapUrl: `${PDFJS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    wasmUrl: `${PDFJS}/wasm/`,
    iccUrl: `${PDFJS}/iccs/`,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    const name = (e as { name?: string })?.name;
    throw new ConvertError(
      name === "PasswordException"
        ? `${file.name} is password-protected. Remove the password first.`
        : `${file.name} isn't a PDF we can read.`,
    );
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new ConvertError(`This PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    const ext = format === "png" ? "png" : "jpg";
    const base = outputName(file.name, "").replace(/\.$/, "");
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ConvertError("Your browser couldn't create a canvas.");
      ctx.fillStyle = "#ffffff"; // PDFs assume a white page
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new ConvertError("Couldn't save a page."))),
          format === "png" ? "image/png" : "image/jpeg", 0.92),
      );
      pages.push({ blob, name: `${base}-page-${String(n).padStart(3, "0")}.${ext}`, page: n });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
