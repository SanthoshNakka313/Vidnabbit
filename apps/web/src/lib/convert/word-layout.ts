/**
 * Turns positioned text from a PDF page into paragraphs for a Word document.
 * Pure functions (no PDF.js, no DOM) so they can be unit-tested.
 */

/** One run of text as PDF.js reports it, in PDF points (origin bottom-left). */
export interface PdfText {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: string;
  /** PDF.js marks the last item before a line break. */
  eol?: boolean;
}

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
  font: string;
}

export interface Para {
  runs: Run[];
  /** 1-3 for headings, 0 for body text. */
  heading: 0 | 1 | 2 | 3;
  align: "left" | "center";
  /** Space before this paragraph, in points (for blank areas on the page). */
  spaceBefore: number;
}

const isBold = (font: string) => /bold|black|heavy|semibold|demi/i.test(font);
const isItalic = (font: string) => /italic|oblique/i.test(font);

/** "ABCDEF+Calibri-BoldItalic" -> "Calibri"; "TimesNewRomanPSMT" -> "Times New Roman". */
export function familyOf(font: string): string {
  let name = font.replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0];
  name = name.replace(/(PSMT|PS|MT|Std|Pro)$/g, "").replace(/(Bold|Italic|Oblique|Regular|Medium|Light)+$/i, "");
  if (/^TimesNewRoman/i.test(name)) return "Times New Roman";
  if (/^CourierNew/i.test(name)) return "Courier New";
  if (/^Arial/i.test(name)) return "Arial";
  // Split CamelCase: "SegoeUI" stays, "OpenSans" -> "Open Sans"
  return name.replace(/([a-z])([A-Z][a-z])/g, "$1 $2") || "Calibri";
}

interface Line {
  y: number;
  size: number;
  left: number;
  right: number;
  items: PdfText[];
}

/** Groups text items into lines (same baseline), left to right. */
export function toLines(items: PdfText[]): Line[] {
  const sorted = items.filter((i) => i.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.size) * 0.5));
    if (line) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
      line.left = Math.min(line.left, it.x);
      line.right = Math.max(line.right, it.x + it.width);
    } else {
      lines.push({ y: it.y, size: it.size, left: it.x, right: it.x + it.width, items: [it] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/** Text of a line as runs, inserting spaces where PDF.js left gaps. */
function lineRuns(line: Line): Run[] {
  const runs: Run[] = [];
  let prevEnd: number | null = null;
  for (const it of line.items) {
    const gap = prevEnd === null ? 0 : it.x - prevEnd;
    const needsSpace = prevEnd !== null && gap > it.size * 0.15 && !/^\s/.test(it.str);
    const text = (needsSpace ? " " : "") + it.str;
    const style = { bold: isBold(it.font), italic: isItalic(it.font), size: Math.round(it.size * 2) / 2, font: familyOf(it.font) };
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic && last.size === style.size && last.font === style.font) {
      last.text += text;
    } else {
      runs.push({ text, ...style });
    }
    prevEnd = it.x + it.width;
  }
  return runs;
}

/** The most common text size on the page, weighted by characters: the body text size. */
export function bodySize(items: PdfText[]): number {
  const counts = new Map<number, number>();
  for (const it of items) {
    const s = Math.round(it.size * 2) / 2;
    counts.set(s, (counts.get(s) ?? 0) + it.str.length);
  }
  let best = 11;
  let max = -1;
  for (const [s, n] of counts) if (n > max) [best, max] = [s, n];
  return best;
}

/**
 * Builds paragraphs: lines close together with the same size join into one
 * paragraph; bigger text becomes a heading; centred lines stay centred.
 */
export function toParagraphs(items: PdfText[], pageWidth: number, pageHeight: number): Para[] {
  const lines = toLines(items);
  if (!lines.length) return [];
  const body = bodySize(items);
  const paras: Para[] = [];
  let current: { para: Para; lastY: number; size: number } | null = null;
  let prevY = pageHeight;

  for (const line of lines) {
    const runs = lineRuns(line);
    const text = runs.map((r) => r.text).join("");
    if (!text.trim()) continue;
    const ratio = line.size / body;
    const heading: Para["heading"] = ratio >= 1.9 ? 1 : ratio >= 1.45 ? 2 : ratio >= 1.18 ? 3 : 0;
    const leftGap = line.left;
    const rightGap = pageWidth - line.right;
    const centred = Math.abs(leftGap - rightGap) < pageWidth * 0.04 && line.right - line.left < pageWidth * 0.75;
    const align: Para["align"] = centred ? "center" : "left";
    const gap = prevY - line.y; // baseline to baseline

    const continues =
      current &&
      heading === current.para.heading &&
      align === current.para.align &&
      Math.abs(line.size - current.size) < 0.6 &&
      gap < line.size * 1.75;

    if (continues && current) {
      const lastRun = current.para.runs[current.para.runs.length - 1];
      // Rejoin words hyphenated across lines; otherwise lines meet with a space.
      if (/[A-Za-z]-$/.test(lastRun.text) && /^[a-z]/.test(text)) lastRun.text = lastRun.text.slice(0, -1);
      else if (!/\s$/.test(lastRun.text)) runs[0] = { ...runs[0], text: ` ${runs[0].text.replace(/^\s+/, "")}` };
      for (const r of runs) {
        const l = current.para.runs[current.para.runs.length - 1];
        if (l.bold === r.bold && l.italic === r.italic && l.size === r.size && l.font === r.font) l.text += r.text;
        else current.para.runs.push(r);
      }
      current.lastY = line.y;
    } else {
      const extra = paras.length === 0 ? Math.max(0, pageHeight - line.y - line.size - 72) : gap - line.size * 1.6;
      const para: Para = { runs, heading, align, spaceBefore: Math.max(0, Math.round(Math.min(extra, 200))) };
      paras.push(para);
      current = { para, lastY: line.y, size: line.size };
    }
    prevY = line.y;
  }
  return paras;
}
