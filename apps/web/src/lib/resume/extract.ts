/**
 * Reads a resume file in the browser: PDF (PDF.js), Word .docx (the XML inside
 * the zip) or plain text. Besides the text, it notes the layout features that
 * trip up applicant tracking systems: tables, text boxes, pictures, two
 * columns, contact details hidden in the page header, and scanned pages.
 */
import { extOf } from "../convert/formats";
import { openPdf } from "../convert/pdf";
import { lineText, toLines, type PdfText } from "../convert/word-layout";
import { EMAIL_RE, PHONE_RE } from "./patterns";

export const RESUME_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
export const MAX_RESUME_BYTES = 10 * 1000 * 1000;
const MAX_PAGES = 10;

export class ResumeError extends Error {}

export interface ResumeDoc {
  name: string;
  kind: "pdf" | "docx" | "txt" | "paste";
  text: string;
  /** PDF page count (Word files don't know theirs until laid out). */
  pages: number | null;
  tables: number;
  images: number;
  textBoxes: number;
  /** Text laid out side by side in two columns. */
  columns: boolean;
  /** Email or phone only in the Word page header/footer (many ATS skip those). */
  contactInHeader: boolean;
  /** A PDF with no text layer: a scan or a picture of a resume. */
  scanned: boolean;
}

const blank = (name: string, kind: ResumeDoc["kind"], text: string): ResumeDoc => ({
  name,
  kind,
  text,
  pages: null,
  tables: 0,
  images: 0,
  textBoxes: 0,
  columns: false,
  contactInHeader: false,
  scanned: false,
});

export function fromPaste(text: string): ResumeDoc {
  return blank("Pasted text", "paste", text);
}

export async function readResume(file: File): Promise<ResumeDoc> {
  if (file.size > MAX_RESUME_BYTES) throw new ResumeError(`${file.name} is over 10 MB. Resumes are usually far smaller.`);
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK
  if (isPdf) return readPdf(file);
  if (isZip && ext !== "txt") return readDocx(file);
  if (ext === "doc") throw new ResumeError(`${file.name} is an old .doc file. Open it in Word and save it as .docx or PDF.`);
  if (ext === "txt" || file.type.startsWith("text/")) return blank(file.name, "txt", await file.text());
  throw new ResumeError(`${file.name} isn't a PDF, Word (.docx) or text file.`);
}

async function readPdf(file: File): Promise<ResumeDoc> {
  const data = new Uint8Array(await file.arrayBuffer());
  const { task, doc } = await openPdf(data, file.name).catch((e: Error) => {
    throw new ResumeError(e.message);
  });
  try {
    const out = blank(file.name, "pdf", "");
    out.pages = doc.numPages;
    const pageTexts: string[] = [];
    let lineCount = 0;
    let splitLines = 0;
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const width = page.getViewport({ scale: 1 }).width;
      const content = await page.getTextContent();
      const items: PdfText[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        const [a, b, , d, e, f] = it.transform as number[];
        items.push({ str: it.str, x: e, y: f, width: it.width, size: Math.hypot(a, b) || Math.abs(d) || 11, font: it.fontName });
      }
      const lines = toLines(items);
      for (const line of lines) {
        // A wide empty gap in the middle of a line means a second column.
        const sorted = line.items;
        for (let i = 1; i < sorted.length; i++) {
          const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
          if (gap > width * 0.12 && sorted[i].x > width * 0.3 && sorted[i].x < width * 0.75) {
            splitLines++;
            break;
          }
        }
      }
      lineCount += lines.length;
      pageTexts.push(lines.map(lineText).join("\n"));
      page.cleanup();
    }
    out.text = pageTexts.join("\n\n");
    out.scanned = out.text.replace(/\s/g, "").length < 40;
    out.columns = lineCount > 12 && splitLines / lineCount > 0.25;
    return out;
  } finally {
    await task.destroy();
  }
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Text of a Word XML part: one line per paragraph, bullets marked with "• ". */
function wordXmlText(xml: Document): string {
  const lines: string[] = [];
  for (const p of Array.from(xml.getElementsByTagNameNS(W, "p"))) {
    let line = "";
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W) {
          walk(child);
          continue;
        }
        if (child.localName === "t") line += child.textContent ?? "";
        else if (child.localName === "tab") line += "\t";
        else if (child.localName === "br" || child.localName === "cr") line += "\n";
        else if (child.localName !== "p") walk(child); // nested paragraphs are visited by the outer loop
      }
    };
    walk(p);
    const bullet = p.getElementsByTagNameNS(W, "numPr").length > 0;
    if (line.trim()) lines.push((bullet ? "• " : "") + line);
  }
  return lines.join("\n");
}

async function readDocx(file: File): Promise<ResumeDoc> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) || f.name.startsWith("word/media/"),
    });
  } catch {
    throw new ResumeError(`${file.name} isn't a Word file we can read.`);
  }
  const main = parts["word/document.xml"];
  if (!main) throw new ResumeError(`${file.name} isn't a Word (.docx) document.`);
  const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  const doc = parse(main);
  const out = blank(file.name, "docx", wordXmlText(doc));
  out.tables = doc.getElementsByTagNameNS(W, "tbl").length;
  out.textBoxes = doc.getElementsByTagNameNS(W, "txbxContent").length;
  out.images = Object.keys(parts).filter((n) => n.startsWith("word/media/")).length;
  out.columns = Array.from(doc.getElementsByTagNameNS(W, "cols")).some((c) => Number(c.getAttributeNS(W, "num") ?? 1) > 1);
  const headerText = Object.keys(parts)
    .filter((n) => /header|footer/.test(n))
    .map((n) => wordXmlText(parse(parts[n])))
    .join("\n");
  out.contactInHeader = hasContact(headerText) && !hasContact(out.text);
  return out;
}

const hasContact = (s: string) => EMAIL_RE.test(s) || PHONE_RE.test(s);
