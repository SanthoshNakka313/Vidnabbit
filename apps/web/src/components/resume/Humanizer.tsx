"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { RESUME_ACCEPT, ResumeError, readResume } from "@/lib/resume/extract";
import { humanize } from "@/lib/resume/humanize";
import { IconAlert, IconArrowRight, IconCheckCircle, IconCopy, IconDownload, IconSparkle, IconUpload } from "../icons";
import { buttonGhost, buttonPrimary, buttonSecondary, inputBase } from "../ui/styles";
import { giveHandoff, takeHandoff } from "./ResumeInput";

const SAMPLE = `• Spearheaded a cross-functional initiative to streamline onboarding, leveraging data in order to reduce churn.
• Responsible for managing a wide range of client accounts in a fast-paced environment.
• Successfully utilized cutting-edge tools to deliver robust, seamless reporting — on a weekly basis.`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One paragraph per line; "•" lines become real Word bullets. */
async function toDocx(text: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const children = text.split("\n").map((line) => {
    const bullet = /^\s*[•●▪◦‣\-–*]\s+/.test(line);
    const body = line.replace(/^\s*[•●▪◦‣\-–*]\s+/, "");
    return new Paragraph({ children: [new TextRun(body)], ...(bullet ? { bullet: { level: 0 } } : {}) });
  });
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

export function Humanizer() {
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const deferred = useDeferredValue(input);

  // Text handed over from the ATS checker.
  useEffect(() => {
    const t = takeHandoff();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of sessionStorage, which the server render can't see
    if (t) setInput(t);
  }, []);

  const result = useMemo(() => (deferred.trim() ? humanize(deferred) : null), [deferred]);
  // One card per line, with every tip for that line.
  const tips = useMemo(() => {
    const byLine = new Map<string, { line: number; excerpt: string; whys: string[] }>();
    for (const s of result?.suggestions ?? []) {
      const key = `${s.line}|${s.excerpt}`;
      const t = byLine.get(key) ?? { line: s.line, excerpt: s.excerpt, whys: [] };
      if (!t.whys.includes(s.why)) t.whys.push(s.why);
      byLine.set(key, t);
    }
    return [...byLine.values()];
  }, [result]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const doc = await readResume(file);
      if (doc.scanned || !doc.text.trim()) throw new ResumeError(`${file.name} has no text we can read (it looks like a scan).`);
      setInput(doc.text);
    } catch (e) {
      setError(e instanceof ResumeError ? e.message : `${file.name} couldn't be read.`);
    } finally {
      setReading(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy didn't work in this browser. Select the text and copy it instead.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input */}
        <div className="flex flex-col gap-3">
          <div className="flex min-h-tap flex-wrap items-center justify-between gap-2">
            <label htmlFor={inputId} className="text-lg font-black">
              Your resume text
            </label>
            <div className="flex gap-1">
              {!input && (
                <button type="button" className={`${buttonGhost} min-h-tap px-3 text-sm`} onClick={() => setInput(SAMPLE)}>
                  Try an example
                </button>
              )}
              <button type="button" className={`${buttonGhost} min-h-tap px-3 text-sm`} onClick={() => fileRef.current?.click()} disabled={reading}>
                <IconUpload size={16} /> {reading ? "Reading…" : "Upload PDF or Word"}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={RESUME_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            id={inputId}
            rows={16}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your resume, or just a few bullet points…"
            className={`${inputBase} min-h-80 flex-1 resize-y py-3 leading-relaxed`}
          />
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-subtle p-3 text-sm font-bold text-danger">
              <IconAlert size={18} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Output */}
        <section aria-label="Humanized text" className="flex flex-col gap-3">
          <div className="flex min-h-tap flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg">Humanized</h2>
            {result && (
              <label className="inline-flex min-h-tap cursor-pointer items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="size-4 accent-[#7C3AED]" />
                Highlight changes
              </label>
            )}
          </div>
          <div
            className="min-h-80 flex-1 whitespace-pre-wrap rounded-md border-2 border-border bg-surface-2/50 px-4 py-3 leading-relaxed"
            data-testid="humanized"
            aria-live="polite"
          >
            {result ? (
              result.segments.map((s, i) =>
                !s.change || !highlight ? (
                  <span key={i}>{s.text}</span>
                ) : s.text ? (
                  <mark key={i} title={`Was: "${s.change.before}" · ${s.change.why}`} className="rounded bg-sun/45 px-0.5 text-text dark:bg-sun/30">
                    {s.text}
                    <span className="sr-only"> (was {s.change.before})</span>
                  </mark>
                ) : (
                  <del key={i} title={s.change.why} className="text-muted decoration-danger decoration-2">
                    {s.change.before}
                  </del>
                ),
              )
            ) : (
              <span className="text-muted">Your rewritten text appears here as you type.</span>
            )}
          </div>
          {result && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={buttonPrimary} onClick={copy}>
                {copied ? <IconCheckCircle /> : <IconCopy />} {copied ? "Copied" : "Copy text"}
              </button>
              <button type="button" aria-label="Download as Word" className={buttonSecondary} onClick={async () => save(await toDocx(result.text), "resume-humanized.docx")}>
                <IconDownload /> Word
              </button>
              <Link href="/resume/pdf" onClick={() => giveHandoff(result.text)} className={buttonSecondary}>
                <IconDownload /> Make a PDF
              </Link>
              <button type="button" aria-label="Download as text" className={buttonGhost} onClick={() => save(new Blob([result.text], { type: "text/plain" }), "resume-humanized.txt")}>
                .txt
              </button>
            </div>
          )}
        </section>
      </div>

      {result && (
        <div className="flex flex-col gap-4 border-t border-border pt-6">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
            <span className="inline-flex items-center gap-1.5">
              <IconSparkle size={18} className="text-accent-strong" />
              {result.changes} phrase{result.changes === 1 ? "" : "s"} rewritten
            </span>
            <span className="text-muted">·</span>
            <span>
              {result.suggestions.length} tip{result.suggestions.length === 1 ? "" : "s"} only you can fix
            </span>
          </p>
          {tips.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Tips">
              {tips.map((t) => (
                <li key={`${t.line}-${t.excerpt}`} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Line {t.line}</p>
                  <p className="font-bold">“{t.excerpt}”</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted">
                    {t.whys.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-center gap-3 rounded-lg bg-accent-subtle p-5 text-center sm:flex-row sm:text-left">
            <p className="flex-1">
              <strong>Done editing?</strong> See how your resume scores with an applicant tracking system.
            </p>
            <Link
              href="/resume/ats-checker"
              onClick={() => giveHandoff(result.text)}
              className="inline-flex min-h-control items-center gap-2 rounded-md bg-brand-gradient px-5 text-lg font-bold text-white shadow-cta transition-transform hover:-translate-y-px"
            >
              Check ATS score <IconArrowRight size={20} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
