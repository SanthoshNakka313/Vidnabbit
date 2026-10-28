import { describe, expect, it } from "vitest";
import { analyzeResume, dateStyles, employmentGaps, jobKeywords, matchKeywords } from "./ats";
import type { ResumeDoc } from "./extract";
import { countCliches, humanize, suggest } from "./humanize";

const doc = (text: string, extra: Partial<ResumeDoc> = {}): ResumeDoc => ({
  name: "cv.pdf",
  kind: "pdf",
  text,
  pages: 1,
  tables: 0,
  images: 0,
  textBoxes: 0,
  columns: false,
  contactInHeader: false,
  scanned: false,
  ...extra,
});

const GOOD = `Ada Lovelace
ada@example.com · +44 20 7946 0958 · linkedin.com/in/ada
Summary
Backend engineer with 6 years building payment systems in Python and AWS.
Experience
Senior Engineer, Paystack · Jan 2021 – Present
• Built a fraud model in Python that cut chargebacks by 32% across 4 markets
• Led a team of 5 engineers to migrate 40 services to AWS with zero downtime
• Reduced API latency from 900 ms to 180 ms by redesigning the PostgreSQL schema
• Launched a Kubernetes platform used by 120 developers
Engineer, Monzo · Jun 2018 – Dec 2020
• Shipped card controls used by 2 million customers in the first month
• Automated reconciliation with SQL and Airflow, saving 30 hours a week
• Mentored 3 graduate engineers
Education
BSc Computer Science, University of London, 2018
Skills
Python, Go, SQL, PostgreSQL, AWS, Kubernetes, Docker, Terraform, Airflow, CI/CD
${"Designed and ran load tests for payment flows handling peak traffic events. ".repeat(20)}`;

const JOB = `Senior Backend Engineer
We are hiring a Senior Backend Engineer to build payment APIs. You will use Python, AWS and Kubernetes.
Requirements: Python, PostgreSQL, AWS, Kubernetes, Terraform, CI/CD, payments experience.
Nice to have: Kafka, GraphQL, Kafka streaming. Python and AWS daily.`;

describe("humanize", () => {
  it("swaps stock phrases, keeps tense and capitals", () => {
    const r = humanize("• Spearheaded a project and leveraged Python in order to ship.\nSuccessfully utilized SQL.");
    expect(r.text).toBe("• Led a project and used Python to ship.\nUsed SQL.");
    expect(r.changes).toBe(5);
    expect(r.segments.filter((s) => s.change).map((s) => s.change!.before)).toContain("Spearheaded");
  });

  it("fixes a/an after a swap and turns em dashes into commas, but not in date ranges", () => {
    expect(humanize("Built a robust pipeline").text).toBe("Built a reliable pipeline");
    expect(humanize("Led a cutting-edge launch").text).toBe("Led a modern launch");
    expect(humanize("Fast—and cheap. 2019—2021").text).toBe("Fast, and cheap. 2019—2021");
    expect(humanize("Reporting — on a weekly basis").text).toBe("Reporting, weekly");
  });

  it("leaves words that only contain a phrase alone", () => {
    expect(humanize("Leveragedness? leverage-free robustness").text).toBe("Leveragedness? leverage-free robustness");
  });

  it("flags things only the writer can fix", () => {
    const tips = suggest("• Responsible for the team\n• I built a thing\n• Built x\n• Built y\n• Built z");
    expect(tips.map((t) => t.why).join(" ")).toMatch(/Start with what you did/);
    expect(tips.some((t) => /Drop "I"/.test(t.why))).toBe(true);
    expect(tips.some((t) => /3 bullets start with "built"/.test(t.excerpt))).toBe(true);
    expect(countCliches("A results-driven team player who leveraged synergy")).toBe(4);
  });
});

describe("ATS keywords", () => {
  it("pulls skills and repeated terms from a job ad", () => {
    const kws = jobKeywords(JOB);
    for (const k of ["python", "aws", "kubernetes", "postgresql", "ci/cd", "kafka"]) expect(kws).toContain(k);
    expect(kws).not.toContain("requirements");
    expect(kws).not.toContain("we");
  });

  it("counts skills an ad lists only once", () => {
    const kws = jobKeywords("Senior Backend Engineer\nYou know Python, AWS, Kubernetes, Kafka, Terraform and GraphQL.");
    for (const k of ["kubernetes", "kafka", "terraform", "graphql"]) expect(kws).toContain(k);
    expect(kws).not.toContain("you");
  });

  it("matches word forms and reports what's missing", () => {
    const m = matchKeywords(GOOD, JOB)!;
    expect(m.matched).toEqual(expect.arrayContaining(["python", "aws", "kubernetes"]));
    expect(m.missing).toEqual(expect.arrayContaining(["kafka", "graphql"]));
  });
});

describe("analyzeResume", () => {
  it("scores a solid resume highly, with every section found", () => {
    const r = analyzeResume(doc(GOOD), JOB);
    expect(r.score).toBeGreaterThanOrEqual(75);
    for (const id of ["contact", "section-experience", "section-education", "section-skills", "dates"]) {
      expect(r.checks.find((c) => c.id === id)?.status).toBe("pass");
    }
    expect(r.categories.map((c) => c.id)).toContain("keywords");
  });

  it("drops the job-match category when there's no job ad", () => {
    const r = analyzeResume(doc(GOOD));
    expect(r.categories.map((c) => c.id)).not.toContain("keywords");
    expect(r.keywords).toBeNull();
  });

  it("caps a scanned resume and explains why", () => {
    const r = analyzeResume(doc("", { scanned: true }));
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.checks.find((c) => c.id === "scanned")?.status).toBe("fail");
  });

  it("penalises ATS-hostile Word layouts and weak bullets", () => {
    const weak = "Me\nme@x.com\nExperience\n• Responsible for sales\n• Helped with marketing\n• Worked on reports";
    const r = analyzeResume(doc(weak, { kind: "docx", pages: null, tables: 2, textBoxes: 1, contactInHeader: true }));
    expect(r.score).toBeLessThan(50);
    expect(r.checks.find((c) => c.id === "text-boxes")?.status).toBe("fail");
    expect(r.checks.find((c) => c.id === "weak-starts")?.status).toBe("fail");
  });
});

describe("ATS deeper checks", () => {
  it("finds gaps over six months between jobs", () => {
    const text = "Engineer · Jan 2016 – Dec 2017\nEngineer · Jan 2019 – Present\nIntern · Jun 2015 – Aug 2015";
    const gaps = employmentGaps(text, new Date(2026, 9, 1));
    expect(gaps).toEqual([{ from: "Dec 2017", to: "Jan 2019", months: 12 }]);
    expect(employmentGaps("A · 2018 – 2020\nB · 2021 – Present", new Date(2026, 0, 1))).toEqual([]);
  });

  it("notices mixed date styles", () => {
    expect(dateStyles("A · Jan 2020 – Mar 2021\nB · 04/2021 - 05/2022").sort()).toEqual(["01/2021", "Jan 2021"]);
    expect(dateStyles("A · Jan 2020 – Present\nB · Feb 2018 – Dec 2019")).toEqual(["Jan 2021"]);
  });

  it("counts keywords in the ad and the resume, and spots soft skills", () => {
    const m = matchKeywords(GOOD, JOB + "\nStrong communication. Communication with leadership.")!;
    const py = m.counts.find((c) => c.keyword === "python")!;
    expect(py.inJob).toBeGreaterThanOrEqual(3);
    expect(py.inResume).toBeGreaterThanOrEqual(2);
    expect(m.counts.find((c) => c.keyword === "communication")?.soft).toBe(true);
  });

  it("flags generic file names, personal details and repeated words", () => {
    const text = `${GOOD}\nDate of birth: 1 Jan 1990\nMarital status: single\n${"Coordinated the coordination. ".repeat(5)}`;
    const r = analyzeResume(doc(text, { name: "resume_final.pdf" }));
    expect(r.checks.find((c) => c.id === "file-name")?.status).toBe("warn");
    expect(r.checks.find((c) => c.id === "personal")?.title).toMatch(/date of birth, marital status/);
    expect(r.checks.find((c) => c.id === "repeats")?.title).toMatch(/"payment" ×\d+/);
    const short = analyzeResume(doc("Experience\n• Coordinated launches\n• Coordinated hiring\n• Coordinated budgets\n• Coordinated events\n• Coordinated travel"));
    expect(short.checks.find((c) => c.id === "repeats")?.title).toMatch(/"coordinat" ×5/);
    expect(analyzeResume(doc(GOOD, { name: "Ada-Lovelace-Resume.pdf" })).checks.find((c) => c.id === "file-name")?.status).toBe("pass");
  });
});
