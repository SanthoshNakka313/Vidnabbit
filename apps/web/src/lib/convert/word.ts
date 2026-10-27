/**
 * Word <-> PDF in the browser.
 *
 * Word -> PDF: docx-preview lays the document out as HTML inside a hidden,
 * script-free frame (public/frames/docx.html); each page is then captured
 * (html2canvas) into a PDF, or printed so the browser saves it with real text.
 *
 * PDF -> Word: PDF.js reads each page's text with its position, size and
 * font; word-layout.ts rebuilds paragraphs and headings; the docx library
 * writes the .docx. Pages with no text (scans) go in as images.
 */
import type { IParagraphOptions } from "docx";
import { extOf } from "./formats";
import { outputName } from "./image";
import { MAX_PDF_BYTES, openPdf, renderPage } from "./pdf";
import { ConvertError, canvasToBlob } from "./raster";
import { toParagraphs, type PdfText } from "./word-layout";

export const WORD_ACCEPT =
  ".docx,.docm,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_WORD_BYTES = 50 * 1000 * 1000;
const FRAME_URL = "/frames/docx.html";
const CAPTURE_SCALE = 2; // about 144 dpi
const PX_PER_PT = 96 / 72;

function checkWord(file: File) {
  const ext = extOf(file.name);
  if (ext === "doc") {
    throw new ConvertError(`${file.name} is an old .doc file. Open it in Word or LibreOffice, save it as .docx, then try again.`);
  }
  if (!["docx", "docm", "dotx"].includes(ext)) throw new ConvertError(`${file.name} isn't a Word (.docx) file.`);
  if (file.size > MAX_WORD_BYTES) throw new ConvertError(`${file.name} is over 50 MB.`);
}

/** Opens the script-free render frame off-screen and waits for it to load. */
async function openFrame(): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  // No allow-scripts: nothing in the document can run. allow-same-origin lets us fill it;
  // allow-modals lets it open the print dialog.
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "Document preview";
  Object.assign(frame.style, { position: "fixed", left: "-20000px", top: "0", width: "1400px", height: "1000px", border: "0" });
  await new Promise<void>((resolve, reject) => {
    frame.onload = () =>
      frame.contentDocument?.body ? resolve() : reject(new ConvertError("Your browser blocked the document preview. Try reloading the page."));
    frame.onerror = () => reject(new ConvertError("Couldn't prepare the document."));
    frame.src = FRAME_URL;
    document.body.appendChild(frame);
  });
  return frame;
}

/** Lays a .docx out in the frame. Returns the frame and its page elements. */
async function renderWord(file: File): Promise<{ frame: HTMLIFrameElement; pages: HTMLElement[] }> {
  checkWord(file);
  const frame = await openFrame();
  try {
    const doc = frame.contentDocument!;
    const { renderAsync } = await import("docx-preview");
    try {
      await renderAsync(await file.arrayBuffer(), doc.body, doc.head, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        renderComments: false,
        experimental: true,
        // Data URLs (not blob:) so images and fonts survive being drawn as an SVG image.
        useBase64URL: true,
      });
    } catch {
      throw new ConvertError(`${file.name} couldn't be read. It may be damaged or password-protected.`);
    }
    // Links in the document must never run code.
    for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
      if (!/^(https?:|mailto:|#)/i.test(a.getAttribute("href") ?? "")) a.removeAttribute("href");
    }
    await doc.fonts?.ready;
    const pages = Array.from(doc.querySelectorAll<HTMLElement>("section.docx"));
    if (!pages.length) throw new ConvertError(`${file.name} has no pages.`);
    return { frame, pages };
  } catch (e) {
    frame.remove();
    throw e;
  }
}

/** Page size in points from the section's own min-height (docx-preview sets it from the Word page size). */
function pageSizePt(section: HTMLElement): { w: number; h: number } {
  const win = section.ownerDocument.defaultView!;
  const cs = win.getComputedStyle(section);
  const w = section.offsetWidth / PX_PER_PT;
  const h = (parseFloat(cs.minHeight) || section.offsetHeight) / PX_PER_PT;
  return { w, h: Math.max(h, 72) };
}

/**
 * Draws a laid-out page exactly as the browser rendered it: the page's HTML and
 * CSS go into an SVG <foreignObject>, which is loaded as an image and painted
 * onto a canvas. Throws if the browser won't let the canvas be read back.
 */
async function drawWithBrowser(section: HTMLElement, css: string, scale: number): Promise<HTMLCanvasElement> {
  const width = section.offsetWidth;
  const height = Math.max(section.scrollHeight, section.offsetHeight);
  const html = new XMLSerializer().serializeToString(section);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="docx-wrapper" style="background:none;padding:0;display:block">` +
    `<style>${css.replace(/]]>/g, "")}</style>${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  ctx.getImageData(0, 0, 1, 1); // throws SecurityError if the canvas is tainted
  return canvas;
}

/** Word -> PDF with each page as a high-resolution image (looks exactly as laid out). */
export async function wordToPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { frame, pages } = await renderWord(file);
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = frame.contentDocument!;
    // The page's own CSS travels inside each SVG image.
    const css =
      Array.from(doc.querySelectorAll("style"), (s) => s.textContent ?? "").join("\n") +
      // Drop the on-screen page shadow and gaps; the PDF page is just the paper.
      "\n.docx-wrapper>section.docx{box-shadow:none!important;margin:0!important}";
    let browserDraws = true;
    const pdf = await PDFDocument.create();
    pdf.setProducer("VidNabbit");
    pdf.setTitle(outputName(file.name, "").replace(/\.$/, ""));
    for (let i = 0; i < pages.length; i++) {
      const section = pages[i];
      const { w, h } = pageSizePt(section);
      let canvas: HTMLCanvasElement | null = null;
      if (browserDraws) {
        canvas = await drawWithBrowser(section, css, CAPTURE_SCALE).catch(() => null);
        browserDraws = !!canvas;
      }
      // Fallback (browsers that won't read back SVG images): redraw with html2canvas.
      canvas ??= await (await import("html2canvas")).default(section, {
        scale: CAPTURE_SCALE,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: false,
        windowWidth: frame.clientWidth,
        // html2canvas mispositions collapsed table borders; separate borders draw in the right place.
        onclone: (clone) => {
          for (const t of Array.from(clone.querySelectorAll<HTMLTableElement>("table"))) {
            t.style.borderCollapse = "separate";
            t.style.borderSpacing = "0";
          }
        },
      });
      // Content longer than one page (no saved page break) continues on further pages.
      const slicePx = Math.round(h * PX_PER_PT * CAPTURE_SCALE);
      for (let top = 0; top < canvas.height - 4; top += slicePx) {
        const height = Math.min(slicePx, canvas.height - top);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = slicePx;
        const ctx = slice.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
        const jpg = new Uint8Array(await (await canvasToBlob(slice, "image/jpeg", 0.9)).arrayBuffer());
        const image = await pdf.embedJpg(jpg);
        pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
      }
      onProgress?.(i + 1, pages.length);
    }
    return new Blob([(await pdf.save()) as BlobPart], { type: "application/pdf" });
  } finally {
    frame.remove();
  }
}

/** Word -> PDF through the browser's print dialog ("Save as PDF"), keeping real, selectable text. */
export async function printWord(file: File): Promise<void> {
  const { frame } = await renderWord(file);
  const win = frame.contentWindow!;
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", done, { once: true });
  win.focus();
  win.print();
  // Some browsers don't fire afterprint for frames; clean up eventually.
  setTimeout(() => frame.isConnected && frame.remove(), 10 * 60_000);
}

/** PDF -> editable Word document. */
export async function pdfToWord(file: File, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  if (file.size > MAX_PDF_BYTES) throw new ConvertError(`${file.name} is over 100 MB.`);
  const { task, doc } = await openPdf(new Uint8Array(await file.arrayBuffer()), file.name, true);
  try {
    if (doc.numPages > 300) throw new ConvertError(`This PDF has ${doc.numPages} pages; the limit is 300.`);
    const docx = await import("docx");
    const { AlignmentType, HeadingLevel, ImageRun, Paragraph, TextRun } = docx;
    const HEADINGS = [undefined, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
    // Plain options first, so the first paragraph of each page can take a page break.
    const paras: IParagraphOptions[] = [];
    let pageW = 612;
    let pageH = 792;

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      if (n === 1) [pageW, pageH] = [vp.width, vp.height];
      // Loading the operator list makes the real font names (bold/italic) available.
      await page.getOperatorList();
      const content = await page.getTextContent();
      const items: PdfText[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        const [a, b, , d, e, f] = it.transform as number[];
        let font = it.fontName;
        try {
          font = (page.commonObjs.get(it.fontName) as { name?: string })?.name ?? font;
        } catch {
          /* font not loaded; keep the internal name */
        }
        const size = Math.hypot(a, b) || Math.abs(d) || 11;
        items.push({ str: it.str, x: e, y: f, width: it.width, size, font, eol: it.hasEOL });
      }
      const textChars = items.reduce((s, i) => s + i.str.trim().length, 0);
      const first = paras.length;

      if (textChars === 0) {
        // A scan or a picture: keep the page as an image so nothing is lost.
        const canvas = await renderPage(doc, n, 2);
        const jpg = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", 0.88)).arrayBuffer());
        const maxW = pageW - 72; // inside 0.5" margins, in points
        const w = Math.min(maxW, vp.width);
        const h = (w / vp.width) * vp.height;
        paras.push({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: "jpg", data: jpg, transformation: { width: w * PX_PER_PT, height: h * PX_PER_PT } })],
        });
      } else {
        for (const p of toParagraphs(items, vp.width, vp.height)) {
          paras.push({
            heading: HEADINGS[p.heading],
            alignment: p.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { before: Math.round(p.spaceBefore * 20), after: 120 },
            children: p.runs.map(
              (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: Math.round(r.size * 2), font: r.font }),
            ),
          });
        }
      }
      // Each PDF page starts a new Word page.
      if (n > 1 && paras.length > first) paras[first] = { ...paras[first], pageBreakBefore: true };
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }

    const document = new docx.Document({
      creator: "VidNabbit",
      title: outputName(file.name, "").replace(/\.$/, ""),
      sections: [
        {
          properties: {
            page: {
              size: { width: Math.round(pageW * 20), height: Math.round(pageH * 20) },
              margin: { top: 720, bottom: 720, left: 720, right: 720 },
            },
          },
          children: paras.length ? paras.map((o) => new Paragraph(o)) : [new Paragraph("")],
        },
      ],
    });
    return await docx.Packer.toBlob(document);
  } finally {
    await task.destroy();
  }
}
