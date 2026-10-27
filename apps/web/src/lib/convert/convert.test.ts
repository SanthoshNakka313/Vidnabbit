import { describe, expect, it } from "vitest";
import { fitWithin, outputName, pngToIco } from "./image";
import { PAGE_SIZES, placeOnPage } from "./pdf";
import { uniqueName } from "./zip";

describe("outputName", () => {
  it("swaps the extension and keeps dots in the name", () => {
    expect(outputName("holiday.photo.HEIC", "jpg")).toBe("holiday.photo.jpg");
    expect(outputName("scan", "pdf")).toBe("scan.pdf");
    expect(outputName(".png", "webp")).toBe(".png.webp");
    expect(outputName("  .", "png")).toBe("image.png");
  });
});

describe("fitWithin", () => {
  it("never upscales and keeps the aspect ratio", () => {
    expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000, 256)).toEqual({ width: 192, height: 256 });
    expect(fitWithin(5000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(fitWithin(500, 500, null)).toEqual({ width: 500, height: 500 });
  });
});

describe("pngToIco", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it("writes a one-image ICO header pointing at the PNG", () => {
    const ico = pngToIco(png, 32, 48);
    const v = new DataView(ico.buffer);
    expect([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7]]).toEqual([32, 48]);
    expect(v.getUint16(12, true)).toBe(32); // bits per pixel
    expect(v.getUint32(14, true)).toBe(png.length);
    expect(v.getUint32(18, true)).toBe(22);
    expect(Array.from(ico.slice(22))).toEqual(Array.from(png));
  });

  it("stores 256 px as 0, as the format requires", () => {
    const ico = pngToIco(png, 256, 256);
    expect([ico[6], ico[7]]).toEqual([0, 0]);
  });
});

describe("placeOnPage", () => {
  const [w, h] = PAGE_SIZES.a4;

  it("centres a small image without upscaling", () => {
    const at = placeOnPage(100, 50, w, h);
    expect(at.width).toBe(100);
    expect(at.x).toBeCloseTo((w - 100) / 2);
  });

  it("shrinks a large image to fit inside the margins", () => {
    const at = placeOnPage(4000, 3000, w, h);
    expect(at.width).toBeLessThanOrEqual(w - 72 + 1e-6);
    expect(at.height).toBeLessThanOrEqual(h - 72 + 1e-6);
    expect(at.width / at.height).toBeCloseTo(4 / 3);
  });
});

describe("uniqueName", () => {
  it("numbers duplicates before the extension", () => {
    expect(uniqueName("a.png", {})).toBe("a.png");
    expect(uniqueName("a.png", { "a.png": 1 })).toBe("a (2).png");
    expect(uniqueName("a.png", { "a.png": 1, "a (2).png": 1 })).toBe("a (3).png");
    expect(uniqueName("notes", { notes: 1 })).toBe("notes (2)");
  });
});
