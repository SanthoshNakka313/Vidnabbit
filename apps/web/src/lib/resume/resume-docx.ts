/**
 * The same template as a Word document: real headings, bullets and a right
 * tab for dates, so it stays editable and ATS-friendly.
 */
import { parseResume, type ParsedResume } from "./parse";
import { splitRole, type PdfOptions } from "./resume-pdf";

const HALF_POINTS = { s: 19, m: 21, l: 23 } as const;

export async function resumeToDocx(input: string | ParsedResume, options: PdfOptions): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } = await import("docx");
  const r = typeof input === "string" ? parseResume(input) : input;
  const serif = options.template === "classic";
  const font = serif ? "Times New Roman" : "Arial";
  const size = HALF_POINTS[options.size];
  const accent = options.accent.replace("#", "");
  const centre = options.template === "classic";
  const ink = "1E1B2E";
  const muted = "5C5A70";
  // Page width minus 0.75" margins, in twentieths of a point.
  const pageW = options.paper === "letter" ? 12240 : 11906;
  const margin = 1080;
  const right = pageW - 2 * margin;

  const children: InstanceType<typeof Paragraph>[] = [];
  if (r.name) {
    children.push(
      new Paragraph({
        alignment: centre ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: r.name, bold: true, size: Math.round(size * 2.3), color: options.template === "modern" ? accent : ink })],
      }),
    );
  }
  if (r.headline) {
    children.push(new Paragraph({ alignment: centre ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: r.headline, size: size + 2, color: muted })] }));
  }
  if (r.contact.length) {
    children.push(
      new Paragraph({
        alignment: centre ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [new TextRun({ text: r.contact.join(serif ? "  |  " : "  ·  "), size: size - 1, color: muted })],
      }),
    );
  }
  for (const s of r.sections) {
    if (!s.lines.length) continue;
    const caps = options.template === "classic" || options.template === "compact";
    children.push(
      new Paragraph({
        spacing: { before: options.template === "compact" ? 160 : 260, after: 80 },
        border: options.template === "minimal" ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 6, color: options.template === "classic" ? ink : accent, space: 2 } },
        children: [new TextRun({ text: caps ? s.title.toUpperCase() : s.title, bold: true, size: size + 2, color: options.template === "modern" || options.template === "compact" ? accent : ink })],
      }),
    );
    for (const l of s.lines) {
      if (l.kind === "bullet") children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: l.text, size })] }));
      else if (l.kind === "role") {
        const [left, when] = splitRole(l.text);
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 40 },
            tabStops: [{ type: TabStopType.RIGHT, position: right }],
            children: [new TextRun({ text: left, bold: true, size }), ...(when ? [new TextRun({ text: `\t${when}`, italics: true, size: size - 1, color: muted })] : [])],
          }),
        );
      } else children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: l.text, size })] }));
    }
  }
  const doc = new Document({
    creator: "ResuNabbit",
    title: r.name ? `${r.name} - Resume` : "Resume",
    styles: { default: { document: { run: { font, color: ink } } } },
    sections: [
      {
        properties: {
          page: {
            size: options.paper === "letter" ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 },
            margin: { top: margin, bottom: margin, left: margin, right: margin },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
