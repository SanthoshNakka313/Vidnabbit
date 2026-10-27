import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Test images; regenerate the non-sips ones with `node e2e/fixtures/make-fixtures.mjs`. */
const FIX = "e2e/fixtures/images";

async function convert(page: Page, files: string | { name: string; mimeType: string; buffer: Buffer }, format: string) {
  await page.getByLabel("Convert to").selectOption(format);
  await page.locator("input[type=file]").setInputFiles(files);
  const results = page.getByRole("region", { name: "Converted files" });
  const button = results.getByRole("button", { name: /^Download / }).first();
  const error = results.locator(".text-danger").first();
  await expect(button.or(error)).toBeVisible({ timeout: 60_000 });
  if (await error.isVisible()) throw new Error(`conversion failed: ${await error.innerText()}`);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const bytes = readFileSync((await download.path())!);
  const detail = await results.locator("li").first().innerText();
  await page.getByRole("button", { name: "Clear list" }).click();
  return { name: download.suggestedFilename(), bytes, detail };
}

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString("latin1");

/** File signatures ("magic bytes") for each output format. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => ascii(b, 1, 4) === "PNG",
  webp: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  avif: (b) => ascii(b, 4, 12) === "ftypavif",
  jxl: (b) => (b[0] === 0xff && b[1] === 0x0a) || ascii(b, 4, 8) === "JXL ",
  gif: (b) => ascii(b, 0, 4) === "GIF8",
  apng: (b) => ascii(b, 1, 4) === "PNG",
  tiff: (b) => ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*",
  bmp: (b) => ascii(b, 0, 2) === "BM",
  ico: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  svg: (b) => b.toString("utf8").startsWith("<svg") && b.toString("utf8").includes("<path"),
  eps: (b) => ascii(b, 0, 23) === "%!PS-Adobe-3.0 EPSF-3.0",
};

test.describe("image formats", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/convert/images");
    // RAW decoding needs cross-origin isolation (LibRaw uses threads).
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  });

  test("saves a PNG as every output format", async ({ page }) => {
    for (const [format, ok] of Object.entries(SIGNATURES)) {
      const out = await convert(page, `${FIX}/sample.png`, format);
      expect(ok(out.bytes), `${format} signature`).toBe(true);
    }
  });

  for (const input of ["sample.jpg", "sample.gif", "sample.bmp", "sample.tiff", "sample.heic", "sample.avif", "logo.svg", "artwork.ai", "camera.dng"]) {
    test(`opens ${input}`, async ({ page }) => {
      const out = await convert(page, `${FIX}/${input}`, "png");
      expect(SIGNATURES.png(out.bytes)).toBe(true);
      expect(out.detail).toMatch(/\d+×\d+/);
    });
  }

  test("JPEG XL and WebP round trip through the WebAssembly codecs", async ({ page }) => {
    for (const format of ["jxl", "webp", "avif"]) {
      const encoded = await convert(page, `${FIX}/sample.png`, format);
      const back = await convert(page, { name: encoded.name, mimeType: "", buffer: encoded.bytes }, "png");
      expect(SIGNATURES.png(back.bytes), `${format} -> png`).toBe(true);
      expect(back.detail).toContain("96×96");
    }
  });

  test("keeps animation between GIF and APNG", async ({ page }) => {
    const gif = await convert(page, `${FIX}/animated.png`, "gif");
    expect(gif.detail).toContain("3 frames");
    expect(SIGNATURES.gif(gif.bytes)).toBe(true);

    const apng = await convert(page, `${FIX}/animated.gif`, "apng");
    expect(apng.detail).toContain("3 frames");
    expect(apng.bytes.includes(Buffer.from("acTL"))).toBe(true);

    // Still formats take the first frame.
    const still = await convert(page, `${FIX}/animated.gif`, "png");
    expect(still.detail).not.toContain("frames");
  });

  test("explains that EPS can't be opened", async ({ page }) => {
    await page.locator("input[type=file]").setInputFiles(`${FIX}/drawing.eps`);
    await expect(page.getByText(/EPS files can be created here but not opened/)).toBeVisible();
  });
});
