import { describe, expect, it } from "vitest";
import { outputName } from "./image";
import { fitWithin } from "./raster";
import { pngToIco } from "./writers";
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

describe("rgbaToBmp", () => {
  it("writes a bottom-up 24-bit BMP with padded rows", async () => {
    const { rgbaToBmp } = await import("./writers");
    // 3x2: top row red, bottom row blue
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const px = new Uint8Array([...red, ...red, ...red, ...blue, ...blue, ...blue]);
    const bmp = rgbaToBmp(px, 3, 2);
    const v = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(v.getUint32(2, true)).toBe(bmp.length);
    expect(v.getUint16(28, true)).toBe(24);
    const rowSize = 12; // 9 bytes padded to 12
    expect(bmp.length).toBe(54 + rowSize * 2);
    expect(Array.from(bmp.slice(54, 57))).toEqual([255, 0, 0]); // first stored row = bottom (blue), BGR
    expect(Array.from(bmp.slice(54 + rowSize, 57 + rowSize))).toEqual([0, 0, 255]); // top row red, BGR
  });
});

describe("ascii85 and EPS", () => {
  it("encodes like the reference implementation", async () => {
    const { ascii85 } = await import("./writers");
    expect(ascii85(new TextEncoder().encode("Man "))).toBe("9jqo^~>");
    expect(ascii85(new Uint8Array([0, 0, 0, 0]))).toBe("z~>");
    expect(ascii85(new Uint8Array([0xff]))).toBe("rr~>");
  });

  it("writes an EPS header with the image size", async () => {
    const { jpegToEps } = await import("./writers");
    const eps = jpegToEps(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 120, 80, "a (b).jpg");
    expect(eps.startsWith("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 120 80\n")).toBe(true);
    expect(eps).toContain("%%Title: (a _b_.jpg)");
    expect(eps).toContain("/DCTDecode filter");
    expect(eps.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("detectInput", () => {
  const bytes = (s: string, prefix: number[] = []) => new Uint8Array([...prefix, ...Array.from(s, (c) => c.charCodeAt(0))]);

  it("trusts the file's bytes over its name", async () => {
    const { detectInput } = await import("./formats");
    expect(detectInput(bytes("ftypheic", [0, 0, 0, 24]), "photo.jpg")).toBe("heic");
    expect(detectInput(bytes("ftypavif", [0, 0, 0, 24]), "x.png")).toBe("avif");
    expect(detectInput(bytes("ftypcrx ", [0, 0, 0, 24]), "IMG.CR3")).toBe("raw");
    expect(detectInput(new Uint8Array([0xff, 0x0a, 0, 0]), "a.bin")).toBe("jxl");
    expect(detectInput(bytes("%PDF-1.7"), "logo.ai")).toBe("pdf");
    expect(detectInput(bytes("%!PS-Adobe-3.0 EPSF-3.0"), "a.eps")).toBe("eps");
    expect(detectInput(new Uint8Array([0x49, 0x49, 0x2a, 0]), "scan.tif")).toBe("tiff");
    expect(detectInput(new Uint8Array([0x49, 0x49, 0x2a, 0]), "DSC_1.NEF")).toBe("raw");
    expect(detectInput(new Uint8Array([0xff, 0xd8, 0xff]), "a.jpg")).toBe("native");
  });
});
