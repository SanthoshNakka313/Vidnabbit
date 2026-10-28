/**
 * Resume humanizer: swaps stock resume phrases and AI-sounding words for plain
 * ones, and flags claims that need evidence. Pure and rule-based, so it runs in
 * the browser, gives the same answer every time and never invents facts.
 */

export interface Segment {
  text: string;
  /** Set when this text replaced something. */
  change?: { before: string; why: string };
}

export interface Suggestion {
  /** 1-based line number in the input. */
  line: number;
  excerpt: string;
  why: string;
}

export interface HumanizeResult {
  text: string;
  segments: Segment[];
  changes: number;
  suggestions: Suggestion[];
}

type Swap = [from: string, to: string];

/** Word-form tables keep tense right: "spearheaded" -> "led", "spearheading" -> "leading". */
const SWAPS: { why: string; pairs: Swap[] }[] = [
  {
    why: "Plain verb",
    pairs: [
      ["spearheaded", "led"], ["spearheading", "leading"], ["spearheads", "leads"], ["spearhead", "lead"],
      ["leveraged", "used"], ["leveraging", "using"], ["leverages", "uses"], ["leverage", "use"],
      ["utilized", "used"], ["utilised", "used"], ["utilizing", "using"], ["utilising", "using"], ["utilizes", "uses"], ["utilize", "use"], ["utilise", "use"],
      ["utilization", "use"], ["utilisation", "use"],
      ["orchestrated", "coordinated"], ["orchestrating", "coordinating"],
      ["showcased", "showed"], ["showcasing", "showing"], ["showcases", "shows"], ["showcase", "show"],
      ["fostered", "built"], ["fostering", "building"], ["fosters", "builds"], ["foster", "build"],
      ["honed", "built"], ["honing", "building"],
      ["harnessed", "used"], ["harnessing", "using"], ["harness", "use"],
      ["bolstered", "strengthened"], ["bolstering", "strengthening"], ["bolster", "strengthen"],
      ["elevated", "improved"], ["elevating", "improving"], ["elevates", "improves"],
      ["underscored", "showed"], ["underscores", "shows"], ["underscoring", "showing"],
      ["embarked on", "started"], ["embarking on", "starting"],
      ["delved into", "dug into"], ["delving into", "digging into"], ["delve into", "dig into"],
      ["commenced", "started"], ["commencing", "starting"],
      ["endeavored", "tried"], ["endeavoured", "tried"],
      ["navigated the complexities of", "handled"], ["navigating the complexities of", "handling"],
      ["played a pivotal role in", "helped"], ["played a key role in", "helped"], ["played a crucial role in", "helped"],
    ],
  },
  {
    why: "Shorter",
    pairs: [
      ["in order to", "to"], ["with the goal of", "to"], ["for the purpose of", "to"], ["so as to", "to"],
      ["due to the fact that", "because"], ["in the event that", "if"], ["at this point in time", "now"],
      ["on a daily basis", "daily"], ["on a weekly basis", "weekly"], ["on a monthly basis", "monthly"], ["on a regular basis", "regularly"],
      ["in a timely manner", "on time"], ["prior to", "before"], ["a number of", "several"], ["the majority of", "most"],
      ["a wide range of", "many"], ["a wide variety of", "many"], ["a broad range of", "many"], ["a plethora of", "many"],
      ["a myriad of", "many"], ["a multitude of", "many"], ["myriad", "many"],
    ],
  },
  {
    why: "Less hype",
    pairs: [
      ["cutting-edge", "modern"], ["state-of-the-art", "modern"], ["best-in-class", "leading"], ["world-class", "strong"],
      ["seamlessly", "smoothly"], ["seamless", "smooth"], ["robust", "reliable"], ["pivotal", "key"],
      ["meticulously", "carefully"], ["meticulous", "careful"], ["adept at", "skilled at"], ["adept in", "skilled in"],
      ["utmost", "great"], ["paramount", "essential"],
    ],
  },
  {
    // "Successfully delivered" says no more than "delivered".
    why: "Filler word",
    pairs: [["successfully ", ""], ["effectively ", ""], ["very ", ""], ["extremely ", ""], ["highly ", ""]],
  },
];

/** Phrases a reader skims past: flagged with a tip, not rewritten (only you know the facts). */
const FLAGS: { re: RegExp; why: string }[] = [
  { re: /\bresponsible for\b|\bduties included\b|\btasked with\b/i, why: "Start with what you did (Built, Ran, Cut…), not your duties." },
  { re: /\b(assisted|helped) (with|in)\b|\bworked on\b|\binvolved in\b/i, why: "Say what you did yourself, and the result." },
  {
    re: /\b(results[- ](driven|oriented)|detail[- ]oriented|self[- ]starter|team player|go[- ]getter|hard[- ]working|hardworking|strong work ethic|think(ing)? outside the box|fast[- ]paced environment|excellent communication skills|proven track record|dynamic|passionate|motivated)\b/i,
    why: "A cliché recruiters skip. Show it with an example or a number instead.",
  },
  {
    re: /\b(synerg(y|ies|ize)|tapestry|testament to|landscape|realm|transformative|unparalleled|innovative|game[- ]chang(er|ing)|thought leader|visionary|holistic|empower(ed|ing)?)\b/i,
    why: "Reads like AI or marketing copy. Name the actual thing you did.",
  },
  { re: /\bvarious\b|\bnumerous\b|\bmultiple\b/i, why: "Vague. Give the number if you know it." },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RULES = SWAPS.map(({ why, pairs }) => {
  const map = new Map(pairs.map(([f, t]) => [f.toLowerCase(), t]));
  // Each entry must end at a word boundary, except filler words that carry their trailing space ("very ").
  const alts = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map((k) => escape(k) + (k.endsWith(" ") ? "" : "(?![\\w-])"));
  return { why, map, re: new RegExp(`\\b(?:${alts.join("|")})`, "gi") };
});

function matchCase(source: string, replacement: string): string {
  if (!replacement) return replacement;
  if (source.length > 1 && source === source.toUpperCase() && /[A-Z]/.test(source)) return replacement.toUpperCase();
  if (/^[A-Z]/.test(source)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** Em dashes between words are a strong AI tell in resumes; a comma reads naturally. */
const DASH = /(?<=[A-Za-z)]) ?— ?(?=[A-Za-z(])/g;

function applyRule(segments: Segment[], re: RegExp, replace: (m: string) => string, why: string): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.change) {
      out.push(seg);
      continue;
    }
    let last = 0;
    for (const m of seg.text.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ text: seg.text.slice(last, at) });
      out.push({ text: replace(m[0]), change: { before: m[0], why } });
      last = at + m[0].length;
    }
    if (last < seg.text.length) out.push({ text: seg.text.slice(last) });
  }
  return out;
}

/** "a" before a vowel sound becomes "an" and the reverse, after a swap changed the next word. */
function fixArticles(segments: Segment[]) {
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const prev = segments[i - 1];
    if (!seg.change || prev.change) continue;
    const m = prev.text.match(/\b(a|an|A|An) $/);
    if (!m || !seg.text) continue;
    const vowel = /^[aeiou]/i.test(seg.text);
    const want = vowel ? "an" : "a";
    if (m[1].toLowerCase() !== want) {
      const fixed = /^[A]/.test(m[1]) ? want[0].toUpperCase() + want.slice(1) : want;
      prev.text = prev.text.slice(0, -m[0].length) + fixed + " ";
    }
  }
}

const BULLET = /^\s*[•●▪◦‣\-–*]\s*/;

export function humanize(input: string): HumanizeResult {
  let segments: Segment[] = [{ text: input.replace(/\r\n?/g, "\n") }];
  // Dashes first: a later swap could take the word the dash rule needs to see.
  segments = applyRule(segments, DASH, () => ", ", "Comma instead of a dash");
  for (const rule of RULES) {
    segments = applyRule(segments, rule.re, (m) => matchCase(m, rule.map.get(m.toLowerCase()) ?? m), rule.why);
  }
  fixArticles(segments);
  // A deleted filler word at the start of a line or sentence leaves the next word lower-case.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.change && seg.text === "" && /^[A-Z]/.test(seg.change.before)) {
      const next = segments[i + 1];
      if (next) next.text = next.text.replace(/^[a-z]/, (c) => c.toUpperCase());
    }
  }
  const text = segments.map((s) => s.text).join("");
  return { text, segments, changes: segments.filter((s) => s.change).length, suggestions: suggest(text) };
}

const excerptOf = (line: string) => {
  const t = line.replace(BULLET, "").trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
};

/** Tips for things only the writer can fix: clichés, first person, long or repetitive bullets. */
export function suggest(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  const lines = text.split("\n");
  const starts = new Map<string, number[]>();
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    for (const f of FLAGS) {
      if (f.re.test(line)) out.push({ line: i + 1, excerpt: excerptOf(line), why: f.why });
    }
    const isBullet = BULLET.test(line);
    const body = line.replace(BULLET, "").trim();
    if (isBullet && /^(I|I'm|I've|My)\b/.test(body)) {
      out.push({ line: i + 1, excerpt: excerptOf(line), why: "Drop \"I\" and \"my\": resume bullets start with the action." });
    }
    const words = body.split(/\s+/).filter(Boolean);
    if (isBullet && words.length > 35) {
      out.push({ line: i + 1, excerpt: excerptOf(line), why: `Long bullet (${words.length} words). Aim for one line or two: split it or cut the setup.` });
    }
    if (isBullet && words[0]) {
      const verb = words[0].toLowerCase().replace(/[^a-z]/g, "");
      if (verb) starts.set(verb, [...(starts.get(verb) ?? []), i]);
    }
  });
  for (const [verb, at] of starts) {
    if (at.length >= 3) {
      out.push({
        line: at[0] + 1,
        excerpt: `${at.length} bullets start with "${verb}"`,
        why: "Vary your opening verbs so each bullet stands out (Built, Cut, Launched, Grew, Ran, Fixed…).",
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** How many stock phrases a text uses (the ATS checker's language score uses this). */
export function countCliches(text: string): number {
  const swaps = RULES.reduce((n, r) => n + (text.match(r.re)?.length ?? 0), 0);
  const flags = FLAGS.reduce((n, f) => n + (text.match(new RegExp(f.re.source, "gi"))?.length ?? 0), 0);
  return swaps + flags;
}
