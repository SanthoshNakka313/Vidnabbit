import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { Download, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const IMAGES = ["public/brand/vidnabbit-icon-512.png", "public/brand/vidnabbit-logo-stacked.png"];

async function bytesOf(d: Download): Promise<Buffer> {
  return readFileSync((await d.path())!);
}

/** Fails the test if anything is sent over the network after the page has loaded. */
function forbidUploads(page: Page) {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) sent.push(`${r.method()} ${r.url()}`);
  });
  return () => expect(sent, "files must never leave the browser").toEqual([]);
}

async function downloadFirst(page: Page, name: RegExp) {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name }).first().click(),
  ]);
  return d;
}

test.describe("image converter", () => {
  test("converts to JPG, WebP and ICO with real file signatures, and zips a batch", async ({ page }) => {
    await page.goto("/convert/images");
    const noUploads = forbidUploads(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("image converter");

    await page.getByLabel("Convert to").selectOption("jpeg");
    await page.locator("input[type=file]").setInputFiles(IMAGES);
    await expect(page.getByRole("button", { name: /^Download .*\.jpg$/ })).toHaveCount(2);
    const jpg = await downloadFirst(page, /^Download .*\.jpg$/);
    expect(jpg.suggestedFilename()).toMatch(/\.jpg$/);
    expect((await bytesOf(jpg)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const zip = await downloadFirst(page, /Download all \(2\) as ZIP/);
    expect((await bytesOf(zip)).subarray(0, 2).toString()).toBe("PK");

    await page.getByRole("button", { name: "Clear list" }).click();
    await page.getByLabel("Convert to").selectOption("webp");
    await page.locator("input[type=file]").setInputFiles(IMAGES[0]);
    const webp = await bytesOf(await downloadFirst(page, /^Download .*\.webp$/));
    expect(webp.subarray(0, 4).toString()).toBe("RIFF");
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");

    await page.getByRole("button", { name: "Clear list" }).click();
    await page.getByLabel("Convert to").selectOption("ico");
    await page.locator("input[type=file]").setInputFiles(IMAGES[0]);
    const ico = await bytesOf(await downloadFirst(page, /^Download .*\.ico$/));
    expect(Array.from(ico.subarray(0, 4))).toEqual([0, 0, 1, 0]);
    expect(ico[6]).toBe(0); // 256 px wide, capped from 512

    noUploads();
  });

  test("shows a clear error for a file that isn't an image", async ({ page }) => {
    await page.goto("/convert/images");
    await page.locator("input[type=file]").setInputFiles({
      name: "notes.png",
      mimeType: "image/png",
      buffer: Buffer.from("not really a png"),
    });
    await expect(page.getByText(/can't open this image/)).toBeVisible();
  });
});

test.describe("document tools", () => {
  test("images to PDF, PDF to PNG, and merge, all in the browser", async ({ page }) => {
    await page.goto("/convert/documents");
    const noUploads = forbidUploads(page);

    // Images -> PDF (one page per image, in the chosen order)
    await page.locator("input[type=file]").setInputFiles(IMAGES);
    await page.getByRole("button", { name: `Move ${IMAGES[1].split("/").pop()} up` }).click();
    await page.getByRole("button", { name: "Create PDF (2 pages)" }).click();
    const pdfDl = await downloadFirst(page, /^Download vidnabbit-logo-stacked\.pdf$/);
    const pdf = await bytesOf(pdfDl);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const pdfPath = (await pdfDl.path())!;

    // PDF -> PNG pages
    await page.locator("label", { hasText: "PDF to JPG / PNG" }).click();
    await page.getByLabel("Image format").selectOption("png");
    await page.locator("input[type=file]").setInputFiles({ name: "two-pages.pdf", mimeType: "application/pdf", buffer: readFileSync(pdfPath) });
    await expect(page.getByRole("button", { name: /^Download two-pages-page-00\d\.png$/ })).toHaveCount(2, { timeout: 30_000 });
    const png = await bytesOf(await downloadFirst(page, /^Download two-pages-page-001\.png$/));
    expect(png.subarray(1, 4).toString()).toBe("PNG");

    // Merge two copies -> 4 pages
    await page.locator("label", { hasText: "Merge PDFs" }).click();
    await page.locator("input[type=file]").setInputFiles([
      { name: "a.pdf", mimeType: "application/pdf", buffer: readFileSync(pdfPath) },
      { name: "b.pdf", mimeType: "application/pdf", buffer: readFileSync(pdfPath) },
    ]);
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    const merged = await bytesOf(await downloadFirst(page, /^Download a-merged\.pdf$/));
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(4);

    noUploads();
  });

  test("refuses a broken PDF with a helpful message", async ({ page }) => {
    await page.goto("/convert/documents");
    await page.locator("label", { hasText: "PDF to JPG / PNG" }).click();
    await page.locator("input[type=file]").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 nope") });
    await expect(page.getByText("broken.pdf isn't a PDF we can read.")).toBeVisible({ timeout: 20_000 });
  });

  test("Convert is in the main navigation and /convert redirects", async ({ page }) => {
    await page.goto("/convert");
    await expect(page).toHaveURL(/\/convert\/images$/);
    await page.getByRole("link", { name: "Documents" }).click();
    await expect(page).toHaveURL(/\/convert\/documents$/);
  });
});
