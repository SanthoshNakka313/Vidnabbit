/**
 * Lays a parsed resume out as a PDF with real, selectable text (pdf-lib with
 * the standard PDF fonts), so applicant tracking systems can read every word.
 * All templates are single-column on purpose: columns, tables and text boxes
 * are what trip ATS up.
 */
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { parseResume, type ParsedResume, type ResumeLine } from "./parse";

export type TemplateId = "classic" | "modern" | "compact" | "minimal";
export type Paper = "a4" | "letter";
export type TextSize = "s" | "m" | "l";

export interface PdfOptions {
  template: TemplateId;
  accent: string;
  paper: Paper;
  size: TextSize;
}

export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: "classic", name: "Classic", blurb: "Serif, centred name, ruled headings. Safe for any industry." },
  { id: "modern", name: "Modern", blurb: "Clean sans-serif with a colour accent on your name and headings." },
  { id: "compact", name: "Compact", blurb: "Tighter spacing to fit more on one page." },
  { id: "minimal", name: "Minimal", blurb: "Lots of white space, no lines. Calm and simple." },
];

export const ACCENTS = [
  { id: "#1E1B2E", name: "Ink" },
  { id: "#1D4ED8", name: "Blue" },
  { id: "#0F766E", name: "Teal" },
  { id: "#7C3AED", name: "Violet" },
  { id: "#BE123C", name: "Rose" },
] as const;

export const DEFAULT_OPTIONS: PdfOptions = { template: "modern", accent: "#1D4ED8", paper: "a4", size: "m" };

const PAPER: Record<Paper, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
const BASE: Record<TextSize, number> = { s: 9.5, m: 10.5, l: 11.5 };

interface Style {
  serif: boolean;
  margin: number;
  /** Multiplier on line height. */
  leading: number;
  centreHeader: boolean;
  colourName: boolean;
  heading: "rule" | "accent-rule" | "plain";
  headingCaps: boolean;
  sectionGap: number;
}

const STYLES: Record<TemplateId, Style> = {
  classic: { serif: true, margin: 54, leading: 1.32, centreHeader: true, colourName: false, heading: "rule", headingCaps: true, sectionGap: 1.1 },
  modern: { serif: false, margin: 50, leading: 1.36, centreHeader: false, colourName: true, heading: "accent-rule", headingCaps: false, sectionGap: 1.2 },
  compact: { serif: false, margin: 38, leading: 1.22, centreHeader: false, colourName: false, heading: "accent-rule", headingCaps: true, sectionGap: 0.7 },
  minimal: { serif: false, margin: 60, leading: 1.45, centreHeader: false, colourName: false, heading: "plain", headingCaps: false, sectionGap: 1.6 },
};

// The standard fonts only cover WinAnsi (Western European). Anything else becomes "?".
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function toWinAnsi(s: string): { text: string; lost: number } {
  let lost = 0;
  const text = Array.from(s.replace(/[‐‑‒]/g, "-").replace(/ /g, " "))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      if (c < 0x20) return " ";
      lost++;
      return "?";
    })
    .join("");
  return { text, lost };
}

function hex(h: string, rgbFn: (r: number, g: number, b: number) => RGB): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return rgbFn(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= width) line = tryLine;
    else {
      if (line) lines.push(line);
      // A single word longer than the line (a long URL): break it by characters.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let k = rest.length - 1;
        while (k > 1 && font.widthOfTextAtSize(rest.slice(0, k), size) > width) k--;
        lines.push(rest.slice(0, k));
        rest = rest.slice(k);
      }
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const WHEN = `(?:${MONTH}\\s*)?(?:(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2})`;
/** "Senior Engineer, Paystack · Jan 2021 – Present" -> ["Senior Engineer, Paystack", "Jan 2021 – Present"] */
const ROLE_DATE = new RegExp(`^(.*?)[\\s,·|–—-]*\\(?(${WHEN}(?:\\s*[–—-]+\\s*(?:${WHEN}|present|current|now))?|present)\\)?$`, "i");

export function splitRole(text: string): [string, string] {
  const m = text.match(ROLE_DATE);
  if (!m || !m[1].trim()) return [text, ""];
  return [m[1].trim().replace(/[,·|–—-]+$/, "").trim(), m[2].trim()];
}

export interface PdfResult {
  bytes: Uint8Array;
  pages: number;
  /** Characters the standard fonts can't show (non-Latin scripts, emoji). */
  lost: number;
}

export async function resumeToPdf(input: string | ParsedResume, options: PdfOptions): Promise<PdfResult> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const resume = typeof input === "string" ? parseResume(input) : input;
  const st = STYLES[options.template];
  const base = BASE[options.size] * (options.template === "compact" ? 0.95 : 1);
  const [pw, ph] = PAPER[options.paper];
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(st.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await doc.embedFont(st.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(st.serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  const ink = rgb(0.12, 0.11, 0.18);
  const muted = rgb(0.36, 0.35, 0.44);
  const accent = hex(options.accent, rgb);
  const m = st.margin;
  const width = pw - 2 * m;
  let lost = 0;
  const clean = (s: string) => {
    const r = toWinAnsi(s);
    lost += r.lost;
    return r.text;
  };

  let page: PDFPage = doc.addPage([pw, ph]);
  let y = ph - m;
  const lh = (size: number) => size * st.leading;
  const ensure = (needed: number) => {
    if (y - needed < m) {
      page = doc.addPage([pw, ph]);
      y = ph - m;
    }
  };
  const draw = (text: string, x: number, size: number, font: PDFFont, color: RGB) => {
    page.drawText(text, { x, y: y - size, size, font, color });
  };
  const paragraph = (text: string, size: number, font: PDFFont, color: RGB, indent = 0, align: "left" | "center" = "left") => {
    for (const line of wrap(clean(text), font, size, width - indent)) {
      ensure(lh(size));
      const x = align === "center" ? m + (width - font.widthOfTextAtSize(line, size)) / 2 : m + indent;
      draw(line, x, size, font, color);
      y -= lh(size);
    }
  };

  // ---- Header
  const nameSize = base * (options.template === "compact" ? 2.1 : 2.4);
  const align = st.centreHeader ? "center" : "left";
  if (resume.name) {
    paragraph(resume.name, nameSize, bold, st.colourName ? accent : ink, 0, align);
    y -= base * 0.15;
  }
  if (resume.headline) paragraph(resume.headline, base * 1.12, regular, muted, 0, align);
  if (resume.contact.length) {
    y -= base * 0.2;
    paragraph(resume.contact.join(st.serif ? "  |  " : "  ·  "), base * 0.95, regular, muted, 0, align);
  }
  y -= base * 0.6;

  // ---- Sections
  const lineOf = (l: ResumeLine) => {
    if (l.kind === "bullet") {
      const lines = wrap(clean(l.text), regular, base, width - 14);
      lines.forEach((t, i) => {
        ensure(lh(base));
        // Bullets pick up the accent only where headings do (Modern, Compact).
        if (i === 0) draw("•", m + 3, base, regular, st.heading === "accent-rule" ? accent : ink);
        draw(t, m + 14, base, regular, ink);
        y -= lh(base);
      });
      y -= base * 0.12;
    } else if (l.kind === "role") {
      const [left, when] = splitRole(clean(l.text));
      const dateW = when ? italic.widthOfTextAtSize(when, base * 0.95) : 0;
      const lines = wrap(left, bold, base * 1.02, width - dateW - 12);
      y -= base * 0.25;
      lines.forEach((t, i) => {
        ensure(lh(base) * 2);
        draw(t, m, base * 1.02, bold, ink);
        if (i === 0 && when) draw(when, m + width - dateW, base * 0.95, italic, muted);
        y -= lh(base);
      });
      y -= base * 0.08;
    } else {
      paragraph(l.text, base, regular, ink);
      y -= base * 0.1;
    }
  };

  for (const section of resume.sections) {
    if (!section.lines.length) continue;
    const hs = base * (st.heading === "plain" ? 1.18 : 1.08);
    ensure(lh(hs) + lh(base) * 3);
    y -= base * st.sectionGap;
    const title = clean(st.headingCaps ? section.title.toUpperCase() : section.title.replace(/^[a-z]/, (c) => c.toUpperCase()));
    const colour = st.heading === "accent-rule" ? accent : ink;
    draw(title, m, hs, bold, colour);
    y -= lh(hs);
    if (st.heading !== "plain") {
      page.drawLine({ start: { x: m, y: y + base * 0.15 }, end: { x: m + width, y: y + base * 0.15 }, thickness: st.heading === "rule" ? 0.8 : 1.1, color: colour });
      y -= base * 0.45;
    } else {
      y -= base * 0.2;
    }
    for (const l of section.lines) lineOf(l);
  }

  doc.setTitle(resume.name ? `${clean(resume.name)} - Resume` : "Resume");
  if (resume.name) doc.setAuthor(clean(resume.name));
  doc.setCreator("ResuNabbit (vidnabbit.com)");
  doc.setProducer("ResuNabbit");
  return { bytes: await doc.save(), pages: doc.getPageCount(), lost };
}

/** "Ada Lovelace" -> "Ada-Lovelace-Resume.pdf" (the file name recruiters expect). */
export function resumeFileName(name: string, ext: "pdf" | "docx" = "pdf"): string {
  const clean = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
  return `${clean || "My"}-Resume.${ext}`;
}
