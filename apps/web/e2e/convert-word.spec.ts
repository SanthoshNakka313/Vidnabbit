import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const FIX = "e2e/fixtures/images";

async function pickTool(page: Page, label: string) {
  await page.goto("/convert/documents");
  await page.locator("label", { hasText: label }).click();
}

async function downloadResult(page: Page, name: RegExp) {
  const results = page.getByRole("region", { name: "Converted files" });
  const button = results.getByRole("button", { name });
  const error = results.locator(".text-danger").first();
  await expect(button.or(error)).toBeVisible({ timeout: 60_000 });
  if (await error.isVisible()) throw new Error(`conversion failed: ${await error.innerText()}`);
  const [d] = await Promise.all([page.waitForEvent("download"), button.click()]);
  return readFileSync((await d.path())!);
}

test.describe("Word and PDF", () => {
  test.describe.configure({ timeout: 90_000 });

  test("Word to PDF keeps the page break and never uploads", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => r.method() !== "GET" && posts.push(r.url()));
    await pickTool(page, "Word to PDF");
    await page.locator("input[type=file]").setInputFiles(`${FIX}/report.docx`);
    const pdf = await downloadResult(page, /^Download report\.pdf$/);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBeGreaterThan(580); // Letter or A4
    expect(Math.round(height)).toBeGreaterThan(780);
    expect(posts).toEqual([]);
  });

  test("PDF to Word gives editable text, headings, bold and a page per page", async ({ page }) => {
    await pickTool(page, "PDF to Word");
    await page.locator("input[type=file]").setInputFiles(`${FIX}/text.pdf`);
    const docx = await downloadResult(page, /^Download text\.docx$/);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const xml = await (await JSZip.loadAsync(docx)).file("word/document.xml")!.async("string");
    const text = xml.replace(/<[^>]+>/g, "");
    expect(text).toContain("Project summary");
    // Two PDF lines joined into one paragraph:
    expect(text).toContain("so the converter joins them into one paragraph.");
    expect(text).toContain("Page two text.");
    expect(xml).toMatch(/<w:pStyle w:val="Heading\d"\/>/);
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:pageBreakBefore/>");
  });

  test("PDF to Word keeps a page with no text as a picture", async ({ page }) => {
    // The images->PDF output has no text layer, like a scan.
    await pickTool(page, "PDF to Word");
    const { PDFDocument: Doc } = await import("pdf-lib");
    const scan = await Doc.create();
    const png = await scan.embedPng(readFileSync(`${FIX}/sample.png`));
    scan.addPage([300, 300]).drawImage(png, { x: 0, y: 0, width: 300, height: 300 });
    await page.locator("input[type=file]").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await scan.save()) });
    const docx = await downloadResult(page, /^Download scan\.docx$/);
    const zip = await JSZip.loadAsync(docx);
    expect(Object.keys(zip.files).some((f) => /^word\/media\/.+\.(jpg|jpeg)$/.test(f))).toBe(true);
  });

  test("explains that old .doc files need saving as .docx", async ({ page }) => {
    await pickTool(page, "Word to PDF");
    await page.locator("input[type=file]").setInputFiles({ name: "old.doc", mimeType: "application/msword", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) });
    await expect(page.getByRole("region", { name: "Converted files" }).getByText(/is an old \.doc file/)).toBeVisible();
  });
});
