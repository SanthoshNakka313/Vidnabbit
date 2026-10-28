/**
 * Turns plain resume text into structure: name, contact line, sections, and
 * bullet / role / text lines. Used to lay out the PDF templates and to show
 * "what the ATS sees". Pure, so it is unit-tested.
 */
import { EMAIL_RE, PHONE_RE } from "./patterns";

export type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "awards"
  | "languages"
  | "volunteering"
  | "publications"
  | "interests"
  | "other";

export interface ResumeLine {
  kind: "bullet" | "role" | "text";
  text: string;
}

export interface ResumeSection {
  key: SectionKey;
  title: string;
  lines: ResumeLine[];
}

export interface ParsedResume {
  name: string;
  headline: string;
  contact: string[];
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  sections: ResumeSection[];
}

const HEADINGS: [SectionKey, RegExp][] = [
  ["summary", /^(professional |career |executive )?(summary|profile|objective|about( me)?|overview)$/],
  ["experience", /^((work|professional|relevant|employment|career) )?(experience|history|employment( history)?)$|^work history$/],
  ["education", /^(education|academic (background|history)|qualifications|education (and|&) training)$/],
  ["skills", /^((technical|core|key|relevant) )?(skills|competencies|technologies|tech stack|expertise|skills (and|&) \w+)$/],
  ["projects", /^((key|selected|personal|side) )?projects$/],
  ["certifications", /^(certifications?|licenses?( (and|&) certifications)?|courses|training)$/],
  ["awards", /^(awards?|honou?rs( (and|&) awards)?|achievements)$/],
  ["languages", /^languages?$/],
  ["volunteering", /^(volunteer(ing)?( experience| work)?|community( involvement)?)$/],
  ["publications", /^(publications?|papers|talks|speaking)$/],
  ["interests", /^(interests|hobbies( (and|&) interests)?)$/],
];

export const BULLET_RE = /^\s*[•●▪◦‣\-–*]\s+/;
const DATE_RE = /\b(19|20)\d{2}\b|\b(present|current)\b/i;
const LINKEDIN_RE = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?/i;

/** The section a heading line names, or null if the line isn't a heading. */
export function headingOf(line: string): { key: SectionKey; title: string } | null {
  const raw = line.replace(BULLET_RE, "").replace(/[:|]+$/, "").trim();
  if (!raw || raw.length > 40) return null;
  const t = raw.toLowerCase();
  if (t.split(/\s+/).length > 4) return null;
  for (const [key, re] of HEADINGS) if (re.test(t)) return { key, title: raw };
  // An unknown short line in capitals ("VOLUNTEER LEADERSHIP") is still a heading.
  if (/^[A-Z][A-Z &/-]{2,}$/.test(raw) && !EMAIL_RE.test(raw)) return { key: "other", title: raw };
  return null;
}

const isContact = (s: string) => EMAIL_RE.test(s) || PHONE_RE.test(s) || LINKEDIN_RE.test(s) || /https?:\/\/|www\./i.test(s);

export function parseResume(text: string): ParsedResume {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t+/g, "  ").trimEnd());
  const out: ParsedResume = { name: "", headline: "", contact: [], email: null, phone: null, linkedin: null, sections: [] };
  const all = text;
  out.email = all.match(EMAIL_RE)?.[0] ?? null;
  out.phone = all.match(PHONE_RE)?.[0]?.trim() ?? null;
  out.linkedin = all.match(LINKEDIN_RE)?.[0] ?? null;

  let i = 0;
  const next = () => {
    while (i < lines.length && !lines[i].trim()) i++;
    return i < lines.length ? lines[i].trim() : null;
  };
  // Header block: name, an optional headline, then contact lines, until the first heading.
  const first = next();
  if (first && !headingOf(first) && !isContact(first) && first.split(/\s+/).length <= 6) {
    out.name = first.replace(BULLET_RE, "");
    i++;
  }
  for (let n = 0; n < 4; n++) {
    const l = next();
    if (!l || headingOf(l)) break;
    if (isContact(l)) {
      out.contact.push(
        ...l
          .split(/\s*[|·•]\s*|\s{2,}/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      i++;
    } else if (!out.headline && l.length <= 90 && !BULLET_RE.test(l)) {
      out.headline = l;
      i++;
    } else break;
  }

  let current: ResumeSection | null = null;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const h = headingOf(l);
    if (h) {
      current = { key: h.key, title: h.title, lines: [] };
      out.sections.push(current);
      continue;
    }
    if (!current) {
      current = { key: "summary", title: "Summary", lines: [] };
      out.sections.push(current);
    }
    if (BULLET_RE.test(l)) current.lines.push({ kind: "bullet", text: l.replace(BULLET_RE, "") });
    else if (DATE_RE.test(l) && l.length <= 120 && ["experience", "education", "projects", "volunteering", "other"].includes(current.key))
      current.lines.push({ kind: "role", text: l });
    else current.lines.push({ kind: "text", text: l });
  }
  return out;
}
