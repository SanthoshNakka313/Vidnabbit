/**
 * ATS score: how well a resume will survive an applicant tracking system and a
 * recruiter's first skim. Pure and deterministic: the same resume and job ad
 * always get the same score, and every point lost has a check that says why.
 */
import type { ResumeDoc } from "./extract";
import { EMAIL_RE, PHONE_RE } from "./patterns";
import { countCliches } from "./humanize";

export type Status = "pass" | "warn" | "fail";
export type CategoryId = "keywords" | "sections" | "format" | "impact" | "language";

export interface Check {
  id: string;
  category: CategoryId;
  status: Status;
  title: string;
  detail: string;
  /** Relative weight inside its category. */
  weight: number;
}

export interface Category {
  id: CategoryId;
  label: string;
  score: number;
  weight: number;
}

export interface KeywordCount {
  keyword: string;
  inJob: number;
  inResume: number;
  soft: boolean;
}

export interface KeywordResult {
  matched: string[];
  missing: string[];
  coverage: number;
  /** Every keyword with how often it appears in the ad and in the resume. */
  counts: KeywordCount[];
}

export interface Gap {
  from: string;
  to: string;
  months: number;
}

export interface AtsReport {
  score: number;
  verdict: string;
  categories: Category[];
  checks: Check[];
  keywords: KeywordResult | null;
  gaps: Gap[];
  stats: { words: number; bullets: number; quantified: number; pages: number | null };
}

const LABELS: Record<CategoryId, string> = {
  keywords: "Job match",
  sections: "Sections",
  format: "ATS-friendly format",
  impact: "Impact",
  language: "Clear language",
};

const WEIGHTS_WITH_JOB: Record<CategoryId, number> = { keywords: 35, sections: 20, format: 20, impact: 15, language: 10 };
const WEIGHTS_NO_JOB: Record<CategoryId, number> = { keywords: 0, sections: 30, format: 30, impact: 25, language: 15 };

// ---------------------------------------------------------------- text helpers

const BULLET = /^\s*[•●▪◦‣\-–*]\s+/;
const HEADINGS: Record<"summary" | "experience" | "education" | "skills", RegExp> = {
  summary: /^(professional |career |executive )?(summary|profile|objective|about( me)?|overview)$/,
  experience: /^((work|professional|relevant|employment|career) )?(experience|history|employment( history)?)$|^work history$/,
  education: /^(education|academic (background|history)|qualifications|education (and|&) training)$/,
  skills: /^((technical|core|key|relevant) )?(skills|competencies|technologies|tech stack|expertise|skills (and|&) \w+)$/,
};

function headingKey(line: string): string | null {
  const t = line.replace(BULLET, "").replace(/[:|]+$/, "").trim().toLowerCase();
  if (!t || t.split(/\s+/).length > 4) return null;
  for (const [k, re] of Object.entries(HEADINGS)) if (re.test(t)) return k;
  return null;
}

const ACTION_VERBS = new Set(
  (
    "accelerated achieved acquired adapted added addressed administered advised analyzed analysed architected " +
    "arranged assembled assessed audited authored automated balanced boosted briefed budgeted built calculated " +
    "championed changed coached collaborated combined completed composed conceived conducted configured consolidated " +
    "constructed consulted converted coordinated created cultivated cut debugged decreased defined delivered " +
    "deployed designed developed devised diagnosed directed discovered doubled drafted drove earned edited " +
    "eliminated enabled engineered enhanced established evaluated exceeded executed expanded expedited " +
    "facilitated finalized fixed forecasted formed founded generated grew guided halved handled headed hired " +
    "identified implemented improved increased initiated inspected installed instituted integrated interviewed " +
    "introduced invented investigated launched led lowered maintained managed mapped maximized mentored " +
    "merged migrated minimized modeled modelled modernized monitored motivated negotiated onboarded opened operated " +
    "optimized orchestrated organized organised overhauled oversaw partnered performed pioneered planned prepared " +
    "presented prevented prioritized processed produced programmed promoted proposed prototyped published " +
    "raised ran rebuilt recruited redesigned reduced refactored refined reorganized replaced reported researched " +
    "resolved restructured revamped reviewed revised saved scaled scheduled secured selected served shipped " +
    "simplified solved sourced standardized started streamlined strengthened structured supervised supported " +
    "surpassed taught tested trained transformed translated tripled troubleshot tuned unified upgraded validated " +
    "won wrote"
  ).split(" "),
);
const WEAK_START = /^(responsible for|duties included|tasked with|worked on|helped( with)?|assisted( with)?|involved in|participated in)\b/i;
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|double|half)\b/i;
const DATE = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? ?(19|20)?\d{2}\b|\b(present|current|now)\b/i;

const STOP = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between both " +
    "but by can could did do does doing down during each few for from further had has have having he her here hers him his " +
    "how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own " +
    "same she should so some such than that the their them then there these they this those through to too under until up " +
    "very was we were what when where which while who whom why will with would you your yours etc via per within across " +
    // job-ad boilerplate that isn't a skill
    "ability able applicant apply benefits best candidate candidates company culture day days degree environment equal " +
    "employer excellent experience experienced great help ideal including job join knowledge looking must new offer " +
    "opportunity opportunities plus position preferred qualifications related required requirements responsibilities " +
    "role salary skills strong team teams understanding using well work working year years will world value values " +
    "make making based like across ensure within part full time support provide good high level key etc us we're you'll"
  ).split(" "),
);

/** Skills that are two or three words, so they count as one keyword. */
const PHRASES = [
  "machine learning", "deep learning", "data analysis", "data science", "data engineering", "data visualization",
  "project management", "product management", "program management", "stakeholder management", "change management",
  "customer service", "customer success", "business development", "account management", "supply chain",
  "financial analysis", "financial modeling", "financial modelling", "user research", "user experience", "ux design",
  "ui design", "front end", "front-end", "back end", "back-end", "full stack", "full-stack", "continuous integration",
  "ci/cd", "unit testing", "test automation", "cloud computing", "google cloud", "google analytics", "power bi",
  "microsoft excel", "microsoft office", "social media", "content marketing", "digital marketing", "email marketing",
  "search engine optimization", "lead generation", "sales operations", "public speaking", "problem solving",
  "time management", "quality assurance", "risk management", "agile methodologies", "scrum master", "rest api",
  "rest apis", "computer vision", "natural language processing", "large language models", "react native",
  "node.js", "next.js", "vue.js", "sql server", "data warehouse", "data pipelines", "version control", "a/b testing",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9+#./\s'-]/g, " ")
    .replace(/\s+/g, " ");

/** Light stemming so "managed", "manages" and "managing" match "manage". */
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
const words = (s: string) =>
  norm(s)
    .split(" ")
    .map((w) => w.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ""))
    .filter(Boolean);

/**
 * The job ad's keywords: known multi-word skills, tech-looking terms (C++, Node.js,
 * AWS), and words the ad repeats. Ranked by how often they appear.
 */
export function jobKeywords(job: string, limit = 25): string[] {
  const text = norm(job);
  const counts = new Map<string, number>();
  const bump = (k: string, n = 1) => counts.set(k, (counts.get(k) ?? 0) + n);
  for (const p of PHRASES) {
    const n = text.split(p).length - 1;
    if (n) bump(p, n * 2);
  }
  const original = job.split(/[\s,;()/]+/);
  for (const w of words(job)) {
    if (STOP.has(w) || w.length < 2 || /^\d+$/.test(w)) continue;
    if (PHRASES.some((p) => p.split(" ").includes(w) && counts.has(p))) continue; // part of a phrase already counted
    bump(w);
  }
  // Capitalised words mid-sentence ("Python, AWS and Kubernetes") are names of skills and tools.
  for (const sentence of job.split(/[.!?\n]+/)) {
    const tokens = sentence.split(/[\s,;()/]+/).filter(Boolean);
    for (const raw of tokens.slice(1)) {
      const w = raw.replace(/^[^A-Za-z0-9+#]+|[^A-Za-z0-9+#]+$/g, "");
      const k = norm(w).trim();
      if (/^[A-Z][A-Za-z0-9+#.]+$/.test(w) && !STOP.has(k) && k.length > 1) bump(k);
    }
  }
  // Words written as Acronyms or CamelCase in the ad are almost always skills or tools.
  for (const raw of original) {
    const w = raw.replace(/^[^A-Za-z0-9+#]+|[^A-Za-z0-9+#]+$/g, "");
    if (/^[A-Z][A-Za-z0-9+#.]*[A-Z0-9+#]/.test(w) || /[+#]/.test(w) || /\.[a-z]{2,}$/i.test(w)) {
      const k = norm(w).trim();
      if (k && !STOP.has(k)) bump(k, 2);
    }
  }
  return [...counts.entries()]
    .filter(([k, n]) => n >= 2 || k.includes(" ") || /[+#.]/.test(k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k]) => k);
}

function countKeyword(ws: string[], text: string, kw: string): number {
  if (kw.includes(" ") || /[+#./]/.test(kw)) return text.split(kw).length - 1;
  const s = stem(kw);
  return ws.filter((w) => stem(w) === s).length;
}

const SOFT = new Set(
  (
    "communication collaboration leadership teamwork mentoring mentorship ownership adaptability creativity " +
    "empathy negotiation presentation organization organisation initiative accountability curiosity " +
    "problem solving time management critical thinking attention to detail stakeholder management " +
    "public speaking interpersonal multitasking prioritization prioritisation flexibility"
  ).split(" "),
);
const isSoft = (k: string) => SOFT.has(k) || ["problem solving", "time management", "stakeholder management", "public speaking"].includes(k);

export function matchKeywords(resume: string, job: string): KeywordResult | null {
  const kws = jobKeywords(job);
  if (kws.length < 3) return null;
  const text = norm(resume);
  const ws = words(resume);
  const jobText = norm(job);
  const jobWs = words(job);
  const counts = kws.map((k) => ({ keyword: k, inJob: countKeyword(jobWs, jobText, k), inResume: countKeyword(ws, text, k), soft: isSoft(k) }));
  const matched = counts.filter((c) => c.inResume > 0).map((c) => c.keyword);
  const missing = counts.filter((c) => c.inResume === 0).map((c) => c.keyword);
  return { matched, missing, coverage: matched.length / kws.length, counts };
}

// ---------------------------------------------------------------- dates

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const POINT = `(?:${MON}\\s*|(\\d{1,2})/)?((?:19|20)\\d{2})`;
const RANGE = new RegExp(`${POINT}\\s*(?:[–—-]+|to)\\s*(?:${POINT}|(present|current|now|today))`, "gi");

/** Month number (year * 12 + month) of a date; a bare year counts as January (start) or December (end). */
function monthOf(mon: string | undefined, num: string | undefined, year: string, end: boolean): number {
  const m = mon ? MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) : num ? Number(num) - 1 : end ? 11 : 0;
  return Number(year) * 12 + Math.max(0, Math.min(11, m));
}
const label = (n: number) => `${MONTHS[n % 12][0].toUpperCase()}${MONTHS[n % 12].slice(1)} ${Math.floor(n / 12)}`;

/** Gaps of more than six months between the jobs' date ranges. */
export function employmentGaps(text: string, now = new Date()): Gap[] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(RANGE)) {
    const start = monthOf(m[1], m[2], m[3], false);
    const end = m[7] ? now.getFullYear() * 12 + now.getMonth() : monthOf(m[4], m[5], m[6], true);
    if (end >= start) ranges.push([start, end]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const gaps: Gap[] = [];
  let reach = -Infinity;
  for (const [s, e] of ranges) {
    if (reach !== -Infinity && s - reach > 6) gaps.push({ from: label(reach), to: label(s), months: s - reach - 1 });
    reach = Math.max(reach, e);
  }
  return gaps;
}

/** Which date styles a resume uses: "Jan 2021", "01/2021" or a bare "2021". */
export function dateStyles(text: string): string[] {
  const styles = new Set<string>();
  for (const m of text.matchAll(RANGE)) {
    for (const [mon, num] of [[m[1], m[2]], [m[4], m[5]]]) {
      if (mon) styles.add("Jan 2021");
      else if (num) styles.add("01/2021");
    }
    if (!m[1] && !m[2] && (m[7] || (!m[4] && !m[5]))) styles.add("2021");
  }
  return [...styles];
}

// ---------------------------------------------------------------- scoring

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function analyzeResume(doc: ResumeDoc, jobDescription = ""): AtsReport {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const text = doc.text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((l) => l.trimEnd());
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const bullets = lines.filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "").trim());
  const quantified = bullets.filter((b) => NUMBER.test(b)).length;

  // ---- Job match
  const keywords = jobDescription.trim() ? matchKeywords(text, jobDescription) : null;
  if (keywords) {
    const c = keywords.coverage;
    add({
      id: "keywords",
      category: "keywords",
      weight: 3,
      status: c >= 0.65 ? "pass" : c >= 0.4 ? "warn" : "fail",
      title: `${pct(c)} of the job's keywords appear in your resume`,
      detail:
        c >= 0.65
          ? "Good match. ATS rank resumes by how many of the ad's terms they contain."
          : "ATS rank resumes by how many of the ad's terms they contain. Add the missing ones you really have, in your own words.",
    });
    const titleLine = jobDescription.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    if (titleLine && titleLine.split(/\s+/).length <= 8) {
      const inResume = norm(text).includes(norm(titleLine).trim());
      add({
        id: "job-title",
        category: "keywords",
        weight: 1,
        status: inResume ? "pass" : "warn",
        title: inResume ? `The job title "${titleLine}" is in your resume` : `The job title "${titleLine}" isn't in your resume`,
        detail: "Recruiters often search by job title. Use it in your summary if it fits your experience.",
      });
    }
  } else if (jobDescription.trim()) {
    add({
      id: "keywords",
      category: "keywords",
      weight: 1,
      status: "warn",
      title: "The job description is too short to compare",
      detail: "Paste the full ad, including the requirements, for a keyword match.",
    });
  }

  // ---- Sections
  const found = new Set(lines.map(headingKey).filter(Boolean));
  const email = EMAIL_RE.test(text);
  const phone = PHONE_RE.test(text);
  add({
    id: "contact",
    category: "sections",
    weight: 2,
    status: email && phone ? "pass" : email || phone ? "warn" : "fail",
    title: email && phone ? "Email and phone found" : email ? "No phone number found" : phone ? "No email address found" : "No email or phone found",
    detail: "Put your email and phone in the body near the top, as plain text.",
  });
  add({
    id: "linkedin",
    category: "sections",
    weight: 0.5,
    status: /linkedin\.com\/in\//i.test(text) ? "pass" : "warn",
    title: /linkedin\.com\/in\//i.test(text) ? "LinkedIn profile link found" : "No LinkedIn profile link",
    detail: "Most recruiters check LinkedIn. Add linkedin.com/in/your-name.",
  });
  for (const [key, label, weight] of [
    ["experience", "Experience", 2],
    ["education", "Education", 1.5],
    ["skills", "Skills", 1.5],
    ["summary", "Summary", 0.75],
  ] as const) {
    add({
      id: `section-${key}`,
      category: "sections",
      weight,
      status: found.has(key) ? "pass" : key === "summary" ? "warn" : "fail",
      title: found.has(key) ? `"${label}" section found` : `No "${label}" section found`,
      detail: `ATS look for standard headings. Use a plain "${label}" heading on its own line.`,
    });
  }
  const datesFound = lines.filter((l) => DATE.test(l)).length;
  add({
    id: "dates",
    category: "sections",
    weight: 1,
    status: datesFound >= 2 ? "pass" : "warn",
    title: datesFound >= 2 ? "Dates found for your roles" : "Few or no dates found",
    detail: "Give each job a start and end date (e.g. Jan 2022 – Present) so ATS can work out your experience.",
  });

  const gaps = employmentGaps(text);
  if (gaps.length) {
    add({
      id: "gaps",
      category: "sections",
      weight: 0.75,
      status: "warn",
      title: `${gaps.length} gap${gaps.length > 1 ? "s" : ""} over six months: ${gaps.map((g) => `${g.from} to ${g.to}`).join(", ")}`,
      detail: "Gaps are normal, but a one-line reason (study, caring, travel, a career break) stops a recruiter wondering.",
    });
  }
  const styles = dateStyles(text);
  if (styles.length > 1) {
    add({
      id: "date-format",
      category: "sections",
      weight: 0.5,
      status: "warn",
      title: `Dates are written ${styles.length} different ways (${styles.join(", ")})`,
      detail: "Pick one style, ideally \"Jan 2021 – Present\", and use it everywhere so ATS read every date the same way.",
    });
  }
  const summary = text.match(/\n\s*(professional |career )?(summary|profile|about me|objective)\s*:?\s*\n([\s\S]*?)(\n\s*\n|\n[A-Z][A-Za-z &]{2,30}\s*\n)/i)?.[3] ?? "";
  const summaryWords = summary.split(/\s+/).filter(Boolean).length;
  if (summaryWords > 80) {
    add({
      id: "summary-length",
      category: "sections",
      weight: 0.5,
      status: "warn",
      title: `Summary is ${summaryWords} words`,
      detail: "Keep it to 2 to 4 lines (under 60 words): who you are, what you're best at, and one proof point.",
    });
  }
  const personal = text.match(/\b(date of birth|d\.o\.b|dob|marital status|religion|nationality|gender|sex:|age:|father'?s name|passport (no|number))\b/gi);
  if (personal) {
    add({
      id: "personal",
      category: "sections",
      weight: 0.75,
      status: "warn",
      title: `Personal details found (${[...new Set(personal.map((p) => p.toLowerCase()))].join(", ")})`,
      detail: "Most employers in the US, UK, EU and Canada advise leaving these out: they aren't needed and can lead to bias. Check what's normal where you're applying.",
    });
  }

  // ---- Format
  if (doc.scanned) {
    add({
      id: "scanned",
      category: "format",
      weight: 6,
      status: "fail",
      title: "No readable text: this looks like a scan or a picture",
      detail: "An ATS sees a blank page. Export your resume from Word or Google Docs as a PDF or .docx instead.",
    });
  }
  add({
    id: "file-type",
    category: "format",
    weight: 1,
    status: doc.kind === "pdf" || doc.kind === "docx" ? "pass" : "warn",
    title: doc.kind === "pdf" || doc.kind === "docx" ? `${doc.kind === "pdf" ? "PDF" : "Word"} file: every ATS accepts it` : "Plain text checked",
    detail: doc.kind === "pdf" || doc.kind === "docx" ? "Send .docx when the ad doesn't say; otherwise PDF is fine." : "Upload your actual file to check its layout too.",
  });
  if (doc.kind === "pdf" || doc.kind === "docx") {
    add({
      id: "columns",
      category: "format",
      weight: 2,
      status: doc.columns ? "warn" : "pass",
      title: doc.columns ? "Two-column layout" : "Single-column layout",
      detail: doc.columns
        ? "Some ATS read across both columns and jumble your text. One column is safest."
        : "Reads top to bottom, the way ATS parse it.",
    });
  }
  if (doc.kind === "docx") {
    add({
      id: "tables",
      category: "format",
      weight: 1.5,
      status: doc.tables ? "warn" : "pass",
      title: doc.tables ? `${doc.tables} table${doc.tables > 1 ? "s" : ""} used for layout` : "No tables",
      detail: doc.tables ? "Older ATS skip or scramble table cells. Use plain lines and tabs." : "Plain paragraphs parse reliably.",
    });
    add({
      id: "text-boxes",
      category: "format",
      weight: 1.5,
      status: doc.textBoxes ? "fail" : "pass",
      title: doc.textBoxes ? `${doc.textBoxes} text box${doc.textBoxes > 1 ? "es" : ""}` : "No text boxes",
      detail: doc.textBoxes ? "Many ATS ignore text boxes completely. Move that text into the body." : "All your text is in the body.",
    });
    add({
      id: "header-contact",
      category: "format",
      weight: 2,
      status: doc.contactInHeader ? "fail" : "pass",
      title: doc.contactInHeader ? "Contact details are only in the page header" : "Contact details are in the body",
      detail: doc.contactInHeader ? "Many ATS skip headers and footers. Repeat your email and phone in the body." : "ATS can find how to reach you.",
    });
  }
  if (doc.images) {
    add({
      id: "images",
      category: "format",
      weight: 1,
      status: "warn",
      title: `${doc.images} picture${doc.images > 1 ? "s" : ""} or icon${doc.images > 1 ? "s" : ""}`,
      detail: "ATS ignore images, so any text in them is lost. Skip photos unless the job asks for one.",
    });
  }
  if (doc.pages !== null) {
    add({
      id: "length-pages",
      category: "format",
      weight: 1,
      status: doc.pages <= 2 ? "pass" : doc.pages === 3 ? "warn" : "fail",
      title: `${doc.pages} page${doc.pages > 1 ? "s" : ""}`,
      detail: doc.pages <= 2 ? "A good length." : "Recruiters skim. Keep to two pages unless you're in academia or very senior.",
    });
  }
  if (doc.kind === "pdf" || doc.kind === "docx") {
    const base = doc.name.replace(/\.[^.]+$/, "");
    const generic = /^(resume|cv|my[ _-]?(resume|cv)|document\d*|untitled\d*|final|new|copy|scan)([ _-]*(final|new|v?\d+|copy))*$/i.test(base);
    add({
      id: "file-name",
      category: "format",
      weight: 0.5,
      status: generic ? "warn" : "pass",
      title: generic ? `File name "${doc.name}" is generic` : `File name "${doc.name}"`,
      detail: "Name the file after yourself, like Firstname-Lastname-Resume.pdf, so it's easy to find in a recruiter's downloads.",
    });
  }
  // Private-use glyphs (icon fonts) and U+FFFD, the replacement character, built from code points.
  const oddRe = new RegExp(`[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}${String.fromCharCode(0xfffd)}]`, "g");
  const odd = (text.match(oddRe) ?? []).length;
  if (odd > 3) {
    add({
      id: "glyphs",
      category: "format",
      weight: 1,
      status: "warn",
      title: `${odd} characters didn't come through`,
      detail: "Icon fonts and unusual symbols turn into gibberish in an ATS. Use plain text labels (Email, Phone).",
    });
  }

  // ---- Impact
  add({
    id: "bullets",
    category: "impact",
    weight: 1,
    status: bullets.length >= 6 ? "pass" : bullets.length >= 3 ? "warn" : "fail",
    title: `${bullets.length} bullet point${bullets.length === 1 ? "" : "s"}`,
    detail: "List achievements as bullets under each job: 3 to 6 per role is typical.",
  });
  if (bullets.length) {
    const q = quantified / bullets.length;
    add({
      id: "numbers",
      category: "impact",
      weight: 2,
      status: q >= 0.4 ? "pass" : q >= 0.2 ? "warn" : "fail",
      title: `${quantified} of ${bullets.length} bullets have a number`,
      detail: "Numbers prove impact: users, money, time saved, percentages, team size. Aim for at least 4 in 10.",
    });
    const firstWords = bullets.map((b) => b.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "");
    const strong = firstWords.filter((w) => ACTION_VERBS.has(w)).length;
    const s = strong / bullets.length;
    add({
      id: "verbs",
      category: "impact",
      weight: 1.5,
      status: s >= 0.6 ? "pass" : s >= 0.35 ? "warn" : "fail",
      title: `${strong} of ${bullets.length} bullets start with an action verb`,
      detail: "Start bullets with what you did: Built, Led, Cut, Grew, Launched.",
    });
    const weak = bullets.filter((b) => WEAK_START.test(b)).length;
    if (weak) {
      add({
        id: "weak-starts",
        category: "impact",
        weight: 1,
        status: weak > 2 ? "fail" : "warn",
        title: `${weak} bullet${weak > 1 ? "s" : ""} start with "Responsible for" or similar`,
        detail: "Those describe a job, not what you achieved in it. The humanizer can point them out.",
      });
    }
  }
  add({
    id: "length-words",
    category: "impact",
    weight: 1,
    status: wordCount >= 350 && wordCount <= 1000 ? "pass" : wordCount >= 200 && wordCount <= 1400 ? "warn" : "fail",
    title: `${wordCount} words`,
    detail:
      wordCount < 350
        ? "On the short side. Add results to your recent roles."
        : wordCount > 1000
          ? "On the long side. Cut older or less relevant detail."
          : "A good amount of detail.",
  });

  // ---- Language
  const cliches = countCliches(text);
  add({
    id: "cliches",
    category: "language",
    weight: 2,
    status: cliches <= 3 ? "pass" : cliches <= 8 ? "warn" : "fail",
    title: cliches ? `${cliches} buzzword${cliches > 1 ? "s" : ""} or stock phrase${cliches > 1 ? "s" : ""}` : "No buzzwords",
    detail: "Phrases like \"results-driven\" or \"leveraged\" read as filler or AI. Use the Resume humanizer to fix them.",
  });
  const firstPerson = (text.match(/\b(I|I'm|I've|my|me)\b/g) ?? []).length;
  add({
    id: "first-person",
    category: "language",
    weight: 1,
    status: firstPerson <= 2 ? "pass" : firstPerson <= 6 ? "warn" : "fail",
    title: firstPerson <= 2 ? "No first person" : `"I" or "my" used ${firstPerson} times`,
    detail: "Resumes leave out \"I\": write \"Led a team of 5\", not \"I led a team of 5\".",
  });
  // Overused words (skills from the job ad are allowed to repeat).
  const allowed = new Set(keywords?.counts.map((c) => stem(c.keyword)) ?? []);
  const freq = new Map<string, number>();
  for (const w of words(text)) {
    if (w.length < 5 || STOP.has(w) || /\d/.test(w)) continue;
    const s = stem(w);
    if (!allowed.has(s)) freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  const overused = [...freq.entries()].filter(([, n]) => n >= 5).sort((x, y) => y[1] - x[1]).slice(0, 3);
  if (overused.length) {
    add({
      id: "repeats",
      category: "language",
      weight: 0.75,
      status: "warn",
      title: `Repeated words: ${overused.map(([w, n]) => `"${w}" ×${n}`).join(", ")}`,
      detail: "Vary your wording so each bullet reads fresh. The humanizer suggests alternatives.",
    });
  }
  const long = bullets.filter((b) => b.split(/\s+/).length > 35).length;
  add({
    id: "long-bullets",
    category: "language",
    weight: 1,
    status: long === 0 ? "pass" : long <= 2 ? "warn" : "fail",
    title: long ? `${long} bullet${long > 1 ? "s are" : " is"} over 35 words` : "Bullets are a readable length",
    detail: "Keep each bullet to one or two lines so it can be skimmed.",
  });

  // ---- Totals
  const weights = keywords || jobDescription.trim() ? WEIGHTS_WITH_JOB : WEIGHTS_NO_JOB;
  const value: Record<Status, number> = { pass: 1, warn: 0.5, fail: 0 };
  const categories: Category[] = (Object.keys(LABELS) as CategoryId[])
    .filter((id) => weights[id] > 0)
    .map((id) => {
      const own = checks.filter((c) => c.category === id);
      const total = own.reduce((s, c) => s + c.weight, 0);
      let score = total ? own.reduce((s, c) => s + c.weight * value[c.status], 0) / total : 1;
      if (id === "keywords" && keywords) score = Math.min(1, (score + Math.min(1, keywords.coverage / 0.75)) / 2);
      return { id, label: LABELS[id], score: Math.round(score * 100), weight: weights[id] };
    });
  const sum = categories.reduce((s, c) => s + c.weight, 0);
  let score = Math.round(categories.reduce((s, c) => s + c.score * c.weight, 0) / sum);
  if (doc.scanned) score = Math.min(score, 15);

  return {
    score,
    verdict:
      score >= 85
        ? "Excellent. Ready to send."
        : score >= 70
          ? "Good. A few fixes will lift it."
          : score >= 50
            ? "Needs work before you apply."
            : "Most ATS will struggle with this resume.",
    categories,
    checks,
    keywords,
    gaps,
    stats: { words: wordCount, bullets: bullets.length, quantified, pages: doc.pages },
  };
}
