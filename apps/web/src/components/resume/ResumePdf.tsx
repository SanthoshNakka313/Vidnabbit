"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { RESUME_ACCEPT, ResumeError, readResume } from "@/lib/resume/extract";
import { parseResume } from "@/lib/resume/parse";
import { ACCENTS, DEFAULT_OPTIONS, TEMPLATES, resumeFileName, resumeToPdf, type PdfOptions, type TemplateId } from "@/lib/resume/resume-pdf";
import { IconAlert, IconArrowRight, IconCheck, IconDownload, IconSpinner, IconUpload } from "../icons";
import { buttonGhost, buttonPrimary, buttonSecondary, inputBase } from "../ui/styles";
import { giveHandoff, takeHandoff } from "./ResumeInput";

const SAMPLE = `Ada Lovelace
Senior Backend Engineer
ada@example.com | +44 20 7946 0958 | linkedin.com/in/ada | London
Summary
Backend engineer with 6 years building payment systems used by millions. I like simple designs, clear metrics and teams that ship.
Experience
Senior Engineer, Paystack · Jan 2021 – Present
• Built a fraud model in Python that cut chargebacks by 32% across 4 markets
• Led a team of 5 engineers to move 40 services to AWS with zero downtime
• Reduced API latency from 900 ms to 180 ms by redesigning the PostgreSQL schema
Engineer, Monzo · Jun 2018 – Dec 2020
• Shipped card controls used by 2 million customers in the first month
• Automated reconciliation with SQL and Airflow, saving 30 hours a week
Education
BSc Computer Science, University of London · 2018
Skills
Python, Go, SQL, PostgreSQL, AWS, Kubernetes, Docker, Terraform`;

const OPTIONS_KEY = "resunabbit:pdf-options";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Tiny drawing of each template's layout for the picker (decorative). */
function TemplateThumb({ id, accent }: { id: TemplateId; accent: string }) {
  const centre = id === "classic";
  const colourName = id === "modern";
  const rule = id !== "minimal";
  const gap = id === "compact" ? 9 : id === "minimal" ? 15 : 12;
  const ruleColour = id === "classic" ? "#1E1B2E" : accent;
  const rows = [0, 1, 2];
  return (
    <svg viewBox="0 0 84 108" className="h-auto w-full rounded-md border border-border bg-white" aria-hidden="true">
      <rect x={centre ? 22 : 10} y="10" width="40" height="6" rx="1.5" fill={colourName ? accent : "#1E1B2E"} />
      <rect x={centre ? 17 : 10} y="20" width="50" height="2.5" rx="1" fill="#9B98AE" />
      {rows.map((r) => {
        const y = 32 + r * (gap + 14);
        return (
          <g key={r}>
            <rect x="10" y={y} width="22" height="3.5" rx="1" fill={id === "classic" || id === "minimal" ? "#1E1B2E" : accent} />
            {rule && <rect x="10" y={y + 5.5} width="64" height="0.8" fill={ruleColour} />}
            <rect x="10" y={y + 9} width="58" height="2" rx="1" fill="#C9C6D6" />
            <rect x="10" y={y + 13} width="50" height="2" rx="1" fill="#C9C6D6" />
          </g>
        );
      })}
    </svg>
  );
}

function Segmented<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-bold">{legend}</legend>
      <div className="inline-flex rounded-full border border-border bg-surface p-1">
        {options.map((o) => (
          <label key={o.id} className="cursor-pointer">
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="peer sr-only" />
            <span className="inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-bold text-text/80 transition-colors hover:bg-surface-2 peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-accent-strong/30 dark:peer-checked:bg-white dark:peer-checked:text-ink">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ResumePdf() {
  const [text, setText] = useState("");
  const [opts, setOpts] = useState<PdfOptions>(DEFAULT_OPTIONS);
  const [rendered, setPreview] = useState<{ src: string; pages: number; lost: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const accentName = useId();
  const deferredText = useDeferredValue(text);

  // Text from the humanizer or checker, and the template this visitor used last.
  useEffect(() => {
    const t = takeHandoff();
    let saved: PdfOptions | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage, which the server render can't see
    if (t) setText(t);
    if (saved && TEMPLATES.some((x) => x.id === saved.template)) setOpts({ ...DEFAULT_OPTIONS, ...saved });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts));
    } catch {
      /* storage blocked */
    }
  }, [opts]);

  const parsed = useMemo(() => (deferredText.trim() ? parseResume(deferredText) : null), [deferredText]);

  // Live preview: build the real PDF and draw its first page.
  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRendering(true);
      try {
        const [{ openPdf, renderPage }, result] = await Promise.all([import("@/lib/convert/pdf"), resumeToPdf(parsed, opts)]);
        const { task, doc } = await openPdf(result.bytes, "resume.pdf");
        try {
          const canvas = await renderPage(doc, 1, 1.6);
          if (!cancelled) setPreview({ src: canvas.toDataURL("image/png"), pages: result.pages, lost: result.lost });
        } finally {
          await task.destroy();
        }
      } catch {
        if (!cancelled) setError("The preview couldn't be drawn. You can still download the PDF.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parsed, opts]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const doc = await readResume(file);
      if (doc.scanned || !doc.text.trim()) throw new ResumeError(`${file.name} has no text we can read (it looks like a scan).`);
      setText(doc.text);
    } catch (e) {
      setError(e instanceof ResumeError ? e.message : `${file.name} couldn't be read.`);
    } finally {
      setReading(false);
    }
  }

  async function download(kind: "pdf" | "docx") {
    if (!parsed) return;
    setBusy(kind);
    try {
      if (kind === "pdf") {
        const r = await resumeToPdf(parsed, opts);
        save(new Blob([r.bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }), resumeFileName(parsed.name));
      } else {
        const { resumeToDocx } = await import("@/lib/resume/resume-docx");
        save(await resumeToDocx(parsed, opts), resumeFileName(parsed.name, "docx"));
      }
    } finally {
      setBusy(null);
    }
  }

  // An emptied text box hides the last preview.
  const preview = parsed ? rendered : null;
  const set = <K extends keyof PdfOptions>(k: K, v: PdfOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Text */}
      <div className="flex flex-col gap-3">
        <div className="flex min-h-tap flex-wrap items-center justify-between gap-2">
          <label htmlFor={textId} className="text-lg font-black">
            Your resume text
          </label>
          <div className="flex gap-1">
            {!text && (
              <button type="button" className={`${buttonGhost} min-h-tap px-3 text-sm`} onClick={() => setText(SAMPLE)}>
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
          id={textId}
          rows={20}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Your Name\nJob title\nemail · phone · LinkedIn\nExperience\nRole, Company · Jan 2022 – Present\n• What you achieved, with a number"}
          className={`${inputBase} min-h-96 flex-1 resize-y py-3 font-mono text-sm leading-relaxed`}
          aria-describedby={`${textId}-help`}
        />
        <p id={`${textId}-help`} className="text-sm text-muted">
          Put each heading (Experience, Education, Skills…) on its own line and start bullets with •. Dates after a job title line up on the
          right.
        </p>
        {parsed && (
          <div className="rounded-lg border border-border bg-surface-2/50 p-4" data-testid="detected">
            <p className="mb-2 text-sm font-bold">We found</p>
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {parsed.name && <li className="rounded-full bg-success-subtle px-2.5 py-0.5 font-bold text-success">Name: {parsed.name}</li>}
              {parsed.contact.length > 0 && <li className="rounded-full bg-success-subtle px-2.5 py-0.5 font-bold text-success">{parsed.contact.length} contact details</li>}
              {parsed.sections.map((s, i) => (
                <li key={`${s.title}-${i}`} className="rounded-full bg-surface px-2.5 py-0.5 font-bold shadow-sm">
                  {s.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-subtle p-3 text-sm font-bold text-danger">
            <IconAlert size={18} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      {/* Design + preview */}
      <div className="flex flex-col gap-5">
        <fieldset>
          <legend className="mb-2 text-lg font-black">Choose a template</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEMPLATES.map((t) => (
              <label key={t.id} className="group cursor-pointer">
                <input type="radio" name="template" value={t.id} checked={opts.template === t.id} onChange={() => set("template", t.id)} className="peer sr-only" />
                <span className="relative flex flex-col gap-2 rounded-lg border-2 border-border bg-surface p-2 transition-[border-color,box-shadow] group-hover:border-strong peer-checked:border-accent-strong peer-checked:shadow-md peer-focus-visible:ring-4 peer-focus-visible:ring-accent-strong/30">
                  <TemplateThumb id={t.id} accent={opts.accent} />
                  <span className="px-1 text-sm font-bold">{t.name}</span>
                  {opts.template === t.id && (
                    <span className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-accent-strong text-white">
                      <IconCheck size={14} strokeWidth={3} />
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{TEMPLATES.find((t) => t.id === opts.template)?.blurb} Every template is single-column, which ATS read best.</p>
        </fieldset>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-bold">Accent colour</legend>
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <label key={a.id} className="cursor-pointer" title={a.name}>
                  <input type="radio" name={accentName} value={a.id} checked={opts.accent === a.id} onChange={() => set("accent", a.id)} className="peer sr-only" />
                  <span className="sr-only">{a.name}</span>
                  <svg viewBox="0 0 32 32" className="size-9 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-text peer-focus-visible:ring-4 peer-focus-visible:ring-accent-strong/40" aria-hidden="true">
                    <circle cx="16" cy="16" r="15" fill={a.id} />
                  </svg>
                </label>
              ))}
            </div>
          </fieldset>
          <Segmented legend="Paper" value={opts.paper} onChange={(v) => set("paper", v)} options={[{ id: "a4", label: "A4" }, { id: "letter", label: "US Letter" }]} />
          <Segmented legend="Text size" value={opts.size} onChange={(v) => set("size", v)} options={[{ id: "s", label: "Small" }, { id: "m", label: "Medium" }, { id: "l", label: "Large" }]} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-lg border border-border bg-surface-2 p-3 sm:p-5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URL of the rendered PDF page
              <img src={preview.src} alt="Preview of the first page of your resume PDF" className={`mx-auto w-full max-w-md rounded bg-white shadow-lg transition-opacity ${rendering ? "opacity-60" : ""}`} />
            ) : (
              <div className="flex aspect-[1/1.3] w-full items-center justify-center text-center text-muted">
                {rendering ? (
                  <span className="inline-flex items-center gap-2 font-bold">
                    <IconSpinner className="animate-spin" /> Drawing your resume…
                  </span>
                ) : (
                  "Your PDF preview appears here."
                )}
              </div>
            )}
          </div>
          {preview && (
            <p className="text-sm text-muted" data-testid="pdf-pages">
              {preview.pages} page{preview.pages > 1 ? "s" : ""}
              {preview.pages > 2 && " · try the Compact template or a smaller text size to fit two pages"}
            </p>
          )}
          {preview && preview.lost > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-warning-subtle p-3 text-sm font-bold text-warning">
              <IconAlert size={18} className="mt-0.5 shrink-0" />
              {preview.lost} character{preview.lost > 1 ? "s" : ""} (non-Latin letters or emoji) can&apos;t be shown in these fonts and appear as “?”. Use the Word download for those.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} onClick={() => download("pdf")} disabled={!parsed || busy !== null}>
              {busy === "pdf" ? <IconSpinner className="animate-spin" /> : <IconDownload />} Download PDF
            </button>
            <button type="button" className={buttonSecondary} onClick={() => download("docx")} disabled={!parsed || busy !== null}>
              {busy === "docx" ? <IconSpinner className="animate-spin" /> : <IconDownload />} Download Word
            </button>
          </div>
          {parsed && (
            <p className="text-sm text-muted">
              Want a second opinion?{" "}
              <Link href="/resume/ats-checker" onClick={() => giveHandoff(text)} className="inline-flex items-center gap-1 font-bold text-link hover:text-text">
                Check its ATS score <IconArrowRight size={14} />
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
