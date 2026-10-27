import { describe, expect, it } from "vitest";
import { bodySize, familyOf, toParagraphs, type PdfText } from "./word-layout";

const t = (str: string, x: number, y: number, size = 11, font = "Helvetica"): PdfText => ({
  str,
  x,
  y,
  width: str.length * size * 0.5,
  size,
  font,
});

describe("familyOf", () => {
  it("cleans PDF font names into family names", () => {
    expect(familyOf("ABCDEF+Calibri-Bold")).toBe("Calibri");
    expect(familyOf("TimesNewRomanPSMT")).toBe("Times New Roman");
    expect(familyOf("ArialMT")).toBe("Arial");
    expect(familyOf("OpenSans-Italic")).toBe("Open Sans");
  });
});

describe("toParagraphs", () => {
  it("joins wrapped lines, splits on gaps and spots headings", () => {
    const items = [
      t("Annual review", 72, 700, 24, "Helvetica-Bold"),
      t("The first line of a paragraph that", 72, 660),
      t("wraps onto a second line.", 72, 646),
      t("A new paragraph after a gap.", 72, 610),
    ];
    const paras = toParagraphs(items, 612, 792);
    expect(paras).toHaveLength(3);
    expect(paras[0].heading).toBe(1);
    expect(paras[0].runs[0].bold).toBe(true);
    expect(paras[1].runs.map((r) => r.text).join("")).toBe("The first line of a paragraph that wraps onto a second line.");
    expect(paras[1].heading).toBe(0);
    expect(paras[2].runs[0].text).toBe("A new paragraph after a gap.");
  });

  it("keeps bold words as separate runs on one line, with spaces between pieces", () => {
    const items = [t("Total:", 72, 700, 11, "Arial-BoldMT"), t("1,200", 72 + 6 * 5.5 + 4, 700, 11, "ArialMT")];
    const [p] = toParagraphs(items, 612, 792);
    expect(p.runs).toHaveLength(2);
    expect(p.runs[0]).toMatchObject({ text: "Total:", bold: true });
    expect(p.runs[1]).toMatchObject({ text: " 1,200", bold: false });
  });

  it("rejoins words hyphenated across lines and keeps centred titles centred", () => {
    const items = [t("Title", 286, 740), t("an extra-", 72, 700), t("ordinary result", 72, 686)];
    const paras = toParagraphs(items, 612, 792);
    expect(paras[0].align).toBe("center");
    expect(paras[1].runs.map((r) => r.text).join("")).toBe("an extraordinary result");
  });

  it("uses the most common size as body text", () => {
    expect(bodySize([t("short", 0, 0, 20), t("a much longer body line", 0, 0, 10)])).toBe(10);
  });
});
