import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { headingOf, parseResume } from "./parse";
import { DEFAULT_OPTIONS, TEMPLATES, resumeFileName, resumeToPdf, splitRole, toWinAnsi } from "./resume-pdf";

const CV = `Ada Lovelace
Backend engineer
ada@example.com | +44 20 7946 0958 | linkedin.com/in/ada
SUMMARY
Engineer who builds payment systems.
Experience
Senior Engineer, Paystack · Jan 2021 – Present
• Built a fraud model that cut chargebacks by 32%
• Led a team of 5
Education
BSc Computer Science, University of London, 2018
Skills
Python, SQL, AWS
VOLUNTEER LEADERSHIP
Mentor at Code Club`;

describe("parseResume", () => {
  it("finds the name, headline, contact items and sections", () => {
    const r = parseResume(CV);
    expect(r.name).toBe("Ada Lovelace");
    expect(r.headline).toBe("Backend engineer");
    expect(r.contact).toEqual(["ada@example.com", "+44 20 7946 0958", "linkedin.com/in/ada"]);
    expect(r.email).toBe("ada@example.com");
    expect(r.sections.map((s) => s.key)).toEqual(["summary", "experience", "education", "skills", "other"]);
    const exp = r.sections[1].lines;
    expect(exp[0]).toEqual({ kind: "role", text: "Senior Engineer, Paystack · Jan 2021 – Present" });
    expect(exp.slice(1).every((l) => l.kind === "bullet")).toBe(true);
  });

  it("knows headings but not sentences", () => {
    expect(headingOf("Work Experience:")?.key).toBe("experience");
    expect(headingOf("Licenses & Certifications")?.key).toBe("certifications");
    expect(headingOf("Built the skills platform for 4 teams")).toBeNull();
  });
});

describe("resume PDF", () => {
  it("splits a role line from its dates", () => {
    expect(splitRole("Senior Engineer, Paystack · Jan 2021 – Present")).toEqual(["Senior Engineer, Paystack", "Jan 2021 – Present"]);
    expect(splitRole("BSc Computer Science, University of London, 2018")).toEqual(["BSc Computer Science, University of London", "2018"]);
    expect(splitRole("Engineer (06/2019 - 12/2020)")).toEqual(["Engineer", "06/2019 - 12/2020"]);
    expect(splitRole("No dates here")).toEqual(["No dates here", ""]);
  });

  it("keeps Western characters and counts the ones the fonts can't show", () => {
    expect(toWinAnsi("Café – “quoted” • €5")).toEqual({ text: "Café – “quoted” • €5", lost: 0 });
    expect(toWinAnsi("Zoë 李 🙂").lost).toBe(2);
  });

  it("builds a PDF for every template, named and with metadata", async () => {
    for (const t of TEMPLATES) {
      const r = await resumeToPdf(CV, { ...DEFAULT_OPTIONS, template: t.id, paper: t.id === "classic" ? "letter" : "a4" });
      expect(r.pages).toBe(1);
      const doc = await PDFDocument.load(r.bytes);
      expect(doc.getTitle()).toBe("Ada Lovelace - Resume");
      expect(Math.round(doc.getPage(0).getWidth())).toBe(t.id === "classic" ? 612 : 595);
    }
  });

  it("flows long resumes onto more pages", async () => {
    const long = CV + "\n" + Array.from({ length: 120 }, (_, i) => `• Achievement number ${i} with a long enough description to wrap`).join("\n");
    expect((await resumeToPdf(long, DEFAULT_OPTIONS)).pages).toBeGreaterThan(1);
  });

  it("names files the way recruiters expect", () => {
    expect(resumeFileName("Ada Lovelace")).toBe("Ada-Lovelace-Resume.pdf");
    expect(resumeFileName("")).toBe("My-Resume.pdf");
    expect(resumeFileName("José García", "docx")).toBe("Jose-Garcia-Resume.docx");
  });
});
