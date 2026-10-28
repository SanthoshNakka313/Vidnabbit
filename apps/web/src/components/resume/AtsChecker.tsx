"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { analyzeResume, type AtsReport, type Check, type KeywordCount, type Status } from "@/lib/resume/ats";
import { parseResume } from "@/lib/resume/parse";
import { fromPaste, type ResumeDoc } from "@/lib/resume/extract";
import { IconAlert, IconArrowRight, IconCheck, IconCheckCircle, IconInfo, IconX } from "../icons";
import { buttonSecondary, inputBase } from "../ui/styles";
import { ResumeInput, giveHandoff, takeHandoff } from "./ResumeInput";

const tone = (score: number) => (score >= 70 ? "text-success" : score >= 50 ? "text-warning" : "text-danger");

/** The overall score as a ring (SVG attributes, so no inline styles under the CSP). */
function ScoreRing({ score }: { score: number }) {
  const gradient = useId();
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF4D6D" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="11" className="stroke-surface-2" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="11"
          strokeLinecap="round"
          stroke={`url(#${gradient})`}
          strokeDasharray={`${(c * score) / 100} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-vn"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tabular-nums leading-none">{score}</span>
        <span className="text-sm font-bold text-muted">out of 100</span>
      </div>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
      <rect width="100" height="8" rx="4" className="fill-surface-2" />
      <rect width={Math.max(4, value)} height="8" rx="4" className={`${tone(value)} fill-current transition-[width] duration-700`} />
    </svg>
  );
}

const STATUS: Record<Status, { Icon: typeof IconCheck; cls: string; label: string }> = {
  fail: { Icon: IconX, cls: "bg-danger-subtle text-danger", label: "Fix" },
  warn: { Icon: IconAlert, cls: "bg-warning-subtle text-warning", label: "Improve" },
  pass: { Icon: IconCheck, cls: "bg-success-subtle text-success", label: "Good" },
};

function CheckRow({ check }: { check: Check }) {
  const { Icon, cls, label } = STATUS[check.status];
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ${cls}`}>
        <Icon size={16} strokeWidth={2.5} />
        <span className="sr-only">{label}:</span>
      </span>
      <div>
        <p className="font-bold">{check.title}</p>
        {check.status !== "pass" && <p className="text-sm text-muted">{check.detail}</p>}
      </div>
    </li>
  );
}

function KeywordTable({ title, rows }: { title: string; rows: KeywordCount[] }) {
  if (!rows.length) return null;
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left font-bold">{title}</caption>
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th scope="col" className="py-1.5 font-bold">Keyword</th>
          <th scope="col" className="py-1.5 text-right font-bold">In the ad</th>
          <th scope="col" className="py-1.5 text-right font-bold">In your resume</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.keyword} className="border-b border-border/60 last:border-0">
            <th scope="row" className="py-1.5 text-left font-bold">{r.keyword}</th>
            <td className="py-1.5 text-right tabular-nums">{r.inJob}</td>
            <td className={`py-1.5 text-right font-bold tabular-nums ${r.inResume ? "text-success" : "text-danger"}`}>
              {r.inResume || "missing"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What an ATS pulls out of the resume: the fields it fills in and the plain text it reads. */
function AtsView({ text }: { text: string }) {
  const parsed = useMemo(() => parseResume(text), [text]);
  const fields: [string, string | null][] = [
    ["Name", parsed.name || null],
    ["Email", parsed.email],
    ["Phone", parsed.phone],
    ["LinkedIn", parsed.linkedin],
  ];
  return (
    <details className="group rounded-lg border border-border px-4" data-testid="ats-view">
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 font-bold">
        <IconInfo size={20} className="text-accent-strong" />
        What the ATS sees
        <span aria-hidden="true" className="ml-auto text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border py-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {fields.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">{k}</dt>
              <dd className={`min-w-0 break-words font-bold ${v ? "" : "text-danger"}`}>{v ?? "Not found"}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="mb-1.5 text-sm font-bold">Sections, in order</p>
          <ol className="flex flex-wrap gap-1.5 text-sm">
            {parsed.sections.map((s, i) => (
              <li key={`${s.title}-${i}`} className="rounded-full bg-surface-2 px-2.5 py-0.5 font-bold">
                {s.title} <span className="font-normal text-muted">· {s.lines.length} line{s.lines.length === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ol>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-bold text-link">Show the plain text an ATS reads</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed">{text}</pre>
        </details>
      </div>
    </details>
  );
}

function Report({ report, text, onHumanize }: { report: AtsReport; text: string; onHumanize: () => void }) {
  const fails = report.checks.filter((c) => c.status === "fail");
  const warns = report.checks.filter((c) => c.status === "warn");
  const passes = report.checks.filter((c) => c.status === "pass");
  return (
    <section aria-label="Your ATS report" className="flex flex-col gap-6 border-t border-border pt-6" aria-live="polite">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <ScoreRing score={report.score} />
        <div className="flex flex-1 flex-col gap-3 text-center sm:text-left">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-muted">ATS score</p>
            <h2 className={`text-2xl ${tone(report.score)}`} data-testid="ats-verdict">
              {report.verdict}
            </h2>
          </div>
          <dl className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm sm:justify-start">
            {[
              ["Words", report.stats.words],
              ["Bullets", report.stats.bullets],
              ["With numbers", report.stats.quantified],
              ...(report.stats.pages ? [["Pages", report.stats.pages] as const] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {report.categories.map((c) => (
          <li key={c.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-bold">{c.label}</span>
              <span className={`font-black tabular-nums ${tone(c.score)}`}>{c.score}</span>
            </div>
            <Bar value={c.score} />
          </li>
        ))}
      </ul>

      {report.keywords && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2/50 p-4 sm:p-5">
          <div>
            <h3 className="text-lg">Keywords from the job ad</h3>
            <p className="text-sm text-muted">
              {report.keywords.matched.length} of {report.keywords.counts.length} found. Add the missing ones you genuinely have, in your own words.
            </p>
          </div>
          {report.keywords.missing.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Missing keywords">
              {report.keywords.missing.map((k) => (
                <li key={k} className="rounded-full border-2 border-dashed border-danger/40 px-2.5 py-0.5 text-sm font-bold">
                  {k}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <KeywordTable title="Hard skills and tools" rows={report.keywords.counts.filter((c) => !c.soft)} />
            <KeywordTable title="Soft skills" rows={report.keywords.counts.filter((c) => c.soft)} />
          </div>
          {report.keywords.matched.length > 0 && (
            <ul className="sr-only" aria-label="Matched keywords">
              {report.keywords.matched.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AtsView text={text} />

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          ["Fix these first", fails],
          ["Worth improving", warns],
        ].map(([title, list]) =>
          (list as Check[]).length ? (
            <div key={title as string}>
              <h3 className="text-lg">{title as string}</h3>
              <ul className="divide-y divide-border">
                {(list as Check[]).map((c) => (
                  <CheckRow key={c.id} check={c} />
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>

      {passes.length > 0 && (
        <details className="group rounded-lg border border-border px-4">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 font-bold">
            <IconCheckCircle size={20} className="text-success" />
            {passes.length} thing{passes.length > 1 ? "s" : ""} you got right
            <span aria-hidden="true" className="ml-auto text-muted transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {passes.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-col items-center gap-3 rounded-lg bg-accent-subtle p-5 text-center sm:flex-row sm:text-left">
        <IconInfo size={22} className="shrink-0 text-accent-strong" />
        <p className="flex-1">
          <strong>Next:</strong> rewrite buzzwords and stock phrases so your resume sounds like you.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/resume/humanizer"
            onClick={onHumanize}
            className="inline-flex min-h-control items-center gap-2 rounded-md bg-brand-gradient px-5 text-lg font-bold text-white shadow-cta transition-transform hover:-translate-y-px"
          >
            Humanize it <IconArrowRight size={20} />
          </Link>
          <Link href="/resume/pdf" onClick={onHumanize} className={buttonSecondary}>
            Make a PDF
          </Link>
        </div>
      </div>
    </section>
  );
}

export function AtsChecker() {
  const [resume, setResume] = useState<ResumeDoc | null>(null);
  const [job, setJob] = useState("");
  const jobId = useId();
  const deferredJob = useDeferredValue(job);

  // Text handed over from the humanizer opens straight into the checker.
  useEffect(() => {
    const t = takeHandoff();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of sessionStorage, which the server render can't see
    if (t) setResume(fromPaste(t));
  }, []);

  const report = useMemo(() => (resume && resume.text.trim() || resume?.scanned ? analyzeResume(resume, deferredJob) : null), [resume, deferredJob]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ResumeInput value={resume} onChange={setResume} />
        <div className="flex flex-col gap-3">
          <div className="flex min-h-tap items-center">
            <label htmlFor={jobId} className="text-lg font-black">
              Job description <span className="text-base font-bold text-muted">(optional)</span>
            </label>
          </div>
          <textarea
            id={jobId}
            rows={12}
            value={job}
            onChange={(e) => setJob(e.target.value)}
            placeholder="Paste the job ad to see which keywords you're missing…"
            className={`${inputBase} min-h-64 flex-1 resize-y py-3 leading-relaxed`}
          />
        </div>
      </div>
      {report ? (
        <Report report={report} text={resume?.text ?? ""} onHumanize={() => resume && giveHandoff(resume.text)} />
      ) : (
        <p className="text-center text-muted">Add your resume and your score appears here instantly.</p>
      )}
    </div>
  );
}
