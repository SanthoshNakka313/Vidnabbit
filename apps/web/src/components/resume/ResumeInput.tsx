"use client";

import { useId, useState } from "react";
import { MAX_RESUME_BYTES, RESUME_ACCEPT, ResumeError, fromPaste, readResume, type ResumeDoc } from "@/lib/resume/extract";
import { IconAlert, IconFileText, IconSpinner, IconX } from "../icons";
import { buttonGhost, inputBase } from "../ui/styles";
import { FileDrop } from "../convert/FileDrop";

/** Text handed from one resume tool to the other (same tab only; never leaves the browser). */
export const HANDOFF_KEY = "resunabbit:text";

export function takeHandoff(): string | null {
  try {
    const t = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    return t;
  } catch {
    return null;
  }
}

export function giveHandoff(text: string) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, text);
  } catch {
    /* private mode: the next tool just starts empty */
  }
}

/**
 * Resume upload (PDF, Word, text) with a "paste instead" switch. Reports the
 * parsed resume upwards; parsing happens entirely in the browser.
 */
export function ResumeInput({ value, onChange }: { value: ResumeDoc | null; onChange: (doc: ResumeDoc | null) => void }) {
  const [chosen, setMode] = useState<"file" | "paste">("file");
  // Pasted text (typed, or handed over from the other tool) always shows in the text box.
  const mode = value?.kind === "paste" ? "paste" : chosen;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pasteId = useId();

  async function take(files: File[]) {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await readResume(file));
    } catch (e) {
      setError(e instanceof ResumeError ? e.message : `${file.name} couldn't be read.`);
      onChange(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg">Your resume</h2>
        <button
          type="button"
          className={`${buttonGhost} min-h-tap px-3 text-sm`}
          onClick={() => {
            setMode(mode === "file" ? "paste" : "file");
            setError(null);
            onChange(null);
          }}
        >
          {mode === "file" ? "Paste text instead" : "Upload a file instead"}
        </button>
      </div>

      {mode === "paste" ? (
        <div>
          <label htmlFor={pasteId} className="sr-only">
            Paste your resume
          </label>
          <textarea
            id={pasteId}
            rows={12}
            placeholder="Paste the full text of your resume here…"
            className={`${inputBase} min-h-64 resize-y py-3 leading-relaxed`}
            value={value?.kind === "paste" ? value.text : ""}
            onChange={(e) => onChange(e.target.value.trim() ? fromPaste(e.target.value) : null)}
          />
        </div>
      ) : value && value.kind !== "paste" ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/60 p-4">
          <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-strong">
            <IconFileText size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{value.name}</p>
            <p className="text-sm text-muted">
              {value.kind === "pdf" ? "PDF" : value.kind === "docx" ? "Word document" : "Text file"}
              {value.pages ? ` · ${value.pages} page${value.pages > 1 ? "s" : ""}` : ""} · read on your device
            </p>
          </div>
          <button type="button" onClick={() => onChange(null)} className={`${buttonGhost} min-w-tap px-2`} aria-label={`Remove ${value.name}`}>
            <IconX />
          </button>
        </div>
      ) : busy ? (
        <div className="flex min-h-48 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-strong/50 bg-surface-2/60 font-bold" role="status">
          <IconSpinner className="animate-spin" /> Reading your resume…
        </div>
      ) : (
        <FileDrop
          accept={RESUME_ACCEPT}
          multiple={false}
          hint={`PDF, Word (.docx) or text, up to ${MAX_RESUME_BYTES / 1e6} MB.`}
          buttonLabel="Choose your resume"
          onFiles={take}
        />
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-subtle p-3 text-sm font-bold text-danger">
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
