// Generates the converter's test images that macOS `sips` can't make:
// animated GIF and APNG, JPEG XL, a LinearRaw DNG, an Illustrator-style .ai
// (PDF-compatible), an SVG and an EPS. Run: node e2e/fixtures/make-fixtures.mjs
import { writeFileSync } from "node:fs";
import gifenc from "gifenc";
import { PDFDocument, rgb } from "pdf-lib";
import UPNG from "upng-js";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const out = new URL("./images/", import.meta.url);
const W = 64;
const H = 48;

/** A solid frame of one colour with a transparent 8 px border. */
function frame(r, g, b) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = x >= 8 && y >= 8 && x < W - 8 && y < H - 8;
      px.set(inside ? [r, g, b, 255] : [0, 0, 0, 0], i);
    }
  return px;
}
const frames = [frame(255, 90, 40), frame(40, 120, 255), frame(30, 200, 90)];

// Animated GIF, 3 frames
const gif = GIFEncoder();
for (const f of frames) {
  const palette = quantize(f, 256, { format: "rgba4444", oneBitAlpha: true });
  gif.writeFrame(applyPalette(f, palette, "rgba4444"), W, H, {
    palette,
    delay: 200,
    repeat: 0,
    transparent: true,
    transparentIndex: palette.findIndex((c) => c[3] === 0),
  });
}
gif.finish();
writeFileSync(new URL("animated.gif", out), gif.bytes());

// Animated PNG, 3 frames
writeFileSync(new URL("animated.png", out), Buffer.from(UPNG.encode(frames.map((f) => f.buffer), W, H, 0, [200, 200, 200])));

// "Illustrator" file: modern .ai files are PDFs inside
const pdf = await PDFDocument.create();
const page = pdf.addPage([200, 100]);
page.drawRectangle({ x: 20, y: 20, width: 160, height: 60, color: rgb(1, 0.35, 0.15) });
writeFileSync(new URL("artwork.ai", out), await pdf.save());

// SVG without width/height (tests the default size)
writeFileSync(
  new URL("logo.svg", out),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="10" y="10" width="80" height="30" fill="#ff5a28"/></svg>\n',
);

// EPS (we save EPS but don't open it; the test checks the message)
writeFileSync(new URL("drawing.eps", out), "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n%%EOF\n");

// Minimal LinearRaw DNG: 8-bit RGB, uncompressed, little-endian TIFF.
function dng() {
  const pixels = Buffer.from(frames[0].filter((_, i) => i % 4 !== 3).map((v) => v || 128));
  const tags = [];
  const extra = [];
  let extraOffset = 0;
  const tag = (id, type, values) => tags.push({ id, type, values });
  // types: 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 10 SRATIONAL
  tag(254, 4, [0]);
  tag(256, 4, [W]);
  tag(257, 4, [H]);
  tag(258, 3, [8, 8, 8]);
  tag(259, 3, [1]);
  tag(262, 3, [34892]); // LinearRaw
  tag(271, 2, "VidNabbit\0");
  tag(272, 2, "Test Camera\0");
  tag(273, 4, [0]); // strip offset, patched below
  tag(274, 3, [1]);
  tag(277, 3, [3]);
  tag(278, 4, [H]);
  tag(279, 4, [pixels.length]);
  tag(284, 3, [1]);
  tag(50706, 1, [1, 4, 0, 0]); // DNGVersion
  tag(50707, 1, [1, 1, 0, 0]);
  tag(50708, 2, "VidNabbit Test Camera\0");
  // ColorMatrix1 maps XYZ to camera colour; using XYZ->sRGB (D65) makes the "camera" sRGB.
  const xyzToSrgb = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];
  tag(50721, 10, xyzToSrgb.flatMap((v) => [Math.round(v * 10000), 10000]));
  tag(50728, 5, [1, 1, 1, 1, 1, 1]); // AsShotNeutral
  tag(50778, 3, [21]); // D65
  tags.sort((a, b) => a.id - b.id);

  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
  const ifdStart = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  extraOffset = ifdStart + ifdSize;
  const entries = tags.map((t) => {
    const count = t.type === 2 ? t.values.length : t.type >= 5 ? t.values.length / 2 : t.values.length;
    const bytes = Buffer.alloc(count * size[t.type]);
    if (t.type === 2) bytes.write(t.values, "latin1");
    else
      t.values.forEach((v, i) => {
        if (t.type === 1) bytes.writeUInt8(v, i);
        else if (t.type === 3) bytes.writeUInt16LE(v, i * 2);
        else if (t.type === 4 || t.type === 5) bytes.writeUInt32LE(v, i * 4);
        else bytes.writeInt32LE(v, i * 4);
      });
    let offset = null;
    if (bytes.length > 4) {
      offset = extraOffset;
      extra.push(bytes);
      extraOffset += bytes.length + (bytes.length % 2);
      if (bytes.length % 2) extra.push(Buffer.alloc(1));
    }
    return { t, count, bytes, offset };
  });
  const stripOffset = extraOffset;
  const head = Buffer.alloc(ifdStart + ifdSize);
  head.write("II", 0, "latin1");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(ifdStart, 4);
  head.writeUInt16LE(tags.length, ifdStart);
  entries.forEach(({ t, count, bytes, offset }, i) => {
    const at = ifdStart + 2 + i * 12;
    head.writeUInt16LE(t.id, at);
    head.writeUInt16LE(t.type, at + 2);
    head.writeUInt32LE(count, at + 4);
    if (t.id === 273) head.writeUInt32LE(stripOffset, at + 8);
    else if (offset !== null) head.writeUInt32LE(offset, at + 8);
    else bytes.copy(head, at + 8);
  });
  head.writeUInt32LE(0, ifdStart + ifdSize - 4);
  return Buffer.concat([head, ...extra, pixels]);
}
writeFileSync(new URL("camera.dng", out), dng());
console.log("fixtures written");

// Word document: heading, bold/italic text, a list, a table, an image and a second page.
const docx = await import("docx");
const { Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun } = docx;
const { readFileSync } = await import("node:fs");
const logo = readFileSync(new URL("./images/sample.png", import.meta.url));
const word = new Document({
  creator: "VidNabbit tests",
  sections: [
    {
      children: [
        new Paragraph({ text: "Quarterly report", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("Sales grew by "), new TextRun({ text: "twelve percent", bold: true }), new TextRun({ text: " this quarter.", italics: true })] }),
        new Paragraph({ text: "First point", bullet: { level: 0 } }),
        new Paragraph({ text: "Second point", bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph("Region")] }), new TableCell({ children: [new Paragraph("Total")] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph("North")] }), new TableCell({ children: [new Paragraph("1,200")] })] }),
          ],
        }),
        new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 96, height: 96 } })] }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ text: "Second page", heading: HeadingLevel.HEADING_2 }),
        new Paragraph("The end."),
      ],
    },
  ],
});
writeFileSync(new URL("report.docx", out), await Packer.toBuffer(word));

// Text PDF: a bold heading and two paragraphs on page 1, one line on page 2.
{
  const { StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("Project summary", { x: 72, y: 700, size: 24, font: bold });
  p1.drawText("This document explains the plan for the new website.", { x: 72, y: 660, size: 11, font: regular });
  p1.drawText("It runs over two lines so the converter joins them", { x: 72, y: 646, size: 11, font: regular });
  p1.drawText("into one paragraph.", { x: 72, y: 632, size: 11, font: regular });
  p1.drawText("A second paragraph starts after a gap.", { x: 72, y: 600, size: 11, font: regular });
  const p2 = doc.addPage([612, 792]);
  p2.drawText("Page two text.", { x: 72, y: 700, size: 11, font: regular });
  writeFileSync(new URL("text.pdf", out), await doc.save());
}
console.log("word fixtures written");
