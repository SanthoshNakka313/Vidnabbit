import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { Document, Header, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "./fixtures";

const LINES = [
  "Ada Lovelace",
  "ada@example.com  +44 20 7946 0958  linkedin.com/in/ada",
  "Summary",
  "Backend engineer building payment systems in Python and AWS.",
  "Experience",
  "Senior Engineer, Paystack  Jan 2021 - Present",
  "• Built a fraud model in Python that cut chargebacks by 32%",
  "• Led a team of 5 engineers to migrate 40 services to AWS",
  "• Spearheaded a Kubernetes platform used by 120 developers",
  "Education",
  "BSc Computer Science, 2018",
  "Skills",
  "Python, SQL, PostgreSQL, AWS, Kubernetes, Docker",
];
const JOB = "Senior Backend Engineer\nPython, AWS, Kubernetes, Kafka, Terraform. Kafka streaming. Python and AWS daily.";

async function resumePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  // Helvetica (WinAnsi) has no "•": draw bullets as hyphens like many exports do.
  LINES.forEach((l, i) => page.drawText(l.replace("•", "-"), { x: 72, y: 720 - i * 18, size: 11, font }));
  return Buffer.from(await pdf.save());
}

test.describe("ResuNabbit", () => {
  test("ATS checker scores a PDF against a job ad, without uploading it", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => r.method() !== "GET" && posts.push(r.url()));
    await page.goto("/resume/ats-checker");
    await page.locator("input[type=file]").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: await resumePdf() });
    await expect(page.getByText("cv.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText(`File name "cv.pdf" is generic`)).toBeVisible();
    await expect(page.getByTestId("ats-verdict")).toBeVisible();
    await page.getByLabel(/Job description/).fill(JOB);
    const missing = page.getByRole("list", { name: "Missing keywords" });
    await expect(missing.getByText("kafka", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Matched keywords" }).getByText("python", { exact: true })).toBeVisible();
    await expect(page.getByText('"Experience" section found')).toBeVisible({ visible: false });
    expect(posts).toEqual([]);
  });

  test("ATS checker flags contact details hidden in a Word header and tables", async ({ page }) => {
    const doc = new Document({
      sections: [
        {
          headers: { default: new Header({ children: [new Paragraph("ada@example.com · +44 20 7946 0958")] }) },
          children: [
            new Paragraph("Experience"),
            new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Engineer 2020")] })] })] }),
            new Paragraph("Education"),
          ],
        },
      ],
    });
    await page.goto("/resume/ats-checker");
    await page.locator("input[type=file]").setInputFiles({
      name: "cv.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(await Packer.toBuffer(doc)),
    });
    await expect(page.getByText("Contact details are only in the page header")).toBeVisible();
    await expect(page.getByText(/1 table used for layout/)).toBeVisible();
  });

  test("humanizer rewrites, downloads Word and hands the text to the checker", async ({ page }) => {
    await page.goto("/resume/humanizer");
    await page.getByRole("button", { name: "Try an example" }).click();
    const out = page.getByTestId("humanized");
    await expect(out.locator("mark").first()).toBeVisible();
    await expect(out.locator("mark").first()).toContainText("(was Spearheaded)"); // for screen readers
    await page.getByLabel("Highlight changes").uncheck();
    await expect(out).toContainText("Led a cross-functional");
    await expect(page.getByText(/phrases rewritten/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Tips" })).toContainText("Start with what you did");

    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download as Word" }).click()]);
    const xml = await (await JSZip.loadAsync(readFileSync((await d.path())!))).file("word/document.xml")!.async("string");
    expect(xml).toContain("Led a cross-functional");
    expect(xml).not.toContain("Spearheaded");

    await page.getByRole("link", { name: /Check ATS score/ }).click();
    await expect(page).toHaveURL(/\/resume\/ats-checker$/);
    await expect(page.getByLabel("Paste your resume")).toHaveValue(/Led a cross-functional/);
    await expect(page.getByTestId("ats-verdict")).toBeVisible();
  });

  test("home has a ResuNabbit card that opens the checker", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { name: "ResuNabbit" }).getByRole("link").click();
    await expect(page).toHaveURL(/\/resume\/ats-checker$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ATS resume checker");
  });

  test("resume to PDF: pick a template, preview, download PDF and Word", async ({ page }) => {
    await page.goto("/resume/pdf");
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(page.getByTestId("detected")).toContainText("Name: Ada Lovelace");
    await expect(page.getByAltText(/Preview of the first page/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pdf-pages")).toHaveText(/^1 page/);

    await page.locator("label", { hasText: "Classic" }).click();
    await page.locator("label", { hasText: "US Letter" }).click();
    const [pdfDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
    expect(pdfDl.suggestedFilename()).toBe("Ada-Lovelace-Resume.pdf");
    const pdf = await PDFDocument.load(readFileSync((await pdfDl.path())!));
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(612);
    expect(pdf.getTitle()).toBe("Ada Lovelace - Resume");

    const [docDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Word" }).click()]);
    expect(docDl.suggestedFilename()).toBe("Ada-Lovelace-Resume.docx");
    const xml = await (await JSZip.loadAsync(readFileSync((await docDl.path())!))).file("word/document.xml")!.async("string");
    expect(xml).toContain("Ada Lovelace");
    expect(xml).toContain("Jan 2021 – Present");
  });

  test("humanizer hands its text to the PDF maker", async ({ page }) => {
    await page.goto("/resume/humanizer");
    await page.getByRole("button", { name: "Try an example" }).click();
    await page.getByRole("link", { name: "Make a PDF" }).click();
    await expect(page).toHaveURL(/\/resume\/pdf$/);
    await expect(page.getByLabel("Your resume text")).toHaveValue(/Led a cross-functional/);
  });

  test("ATS view shows the fields an ATS fills in", async ({ page }) => {
    await page.goto("/resume/ats-checker");
    await page.locator("input[type=file]").setInputFiles({ name: "Ada-Lovelace-Resume.pdf", mimeType: "application/pdf", buffer: await resumePdf() });
    const view = page.getByTestId("ats-view");
    await view.locator("summary").first().click();
    await expect(view).toContainText("ada@example.com");
    await expect(view).toContainText("Experience");
  });

  test("header menu lists every ResuNabbit tool", async ({ page, isMobile }) => {
    await page.goto("/");
    if (isMobile) {
      await page.getByRole("button", { name: "Menu" }).click();
    } else {
      const button = page.getByRole("button", { name: "ResuNabbit" });
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
    }
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    for (const name of ["ATS score checker", "Resume humanizer", "Resume to PDF"]) {
      await expect(nav.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
    await nav.getByRole("link", { name: /Resume to PDF/ }).click();
    await expect(page).toHaveURL(/\/resume\/pdf$/);
  });
});

