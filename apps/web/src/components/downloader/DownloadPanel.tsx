"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ExtractResponse, JobResponse, MediaFormat } from "@/lib/api";
import type { ErrorAction } from "@/lib/error-messages";
import { downloadLabel, formatSize } from "@/lib/format";
import { IconCheckCircle, IconDownload, IconSpinner } from "../icons";
import { buttonGhost, buttonPrimary } from "../ui/styles";
import { CopyrightNotice } from "./CopyrightNotice";
import { ErrorCallout } from "./ErrorCallout";
import { ProgressBar } from "./ProgressBar";
import { Turnstile } from "./Turnstile";
import type { JobState } from "./useDownloadJob";

interface DownloadPanelProps {
  data: ExtractResponse;
  format: MediaFormat | null;
  state: JobState;
  onStart: () => void;
  onToken: (token: string) => void;
  onChallengeError: () => void;
  onCancel: () => void;
  onErrorAction: (action: ErrorAction) => void;
  onAnotherFormat: () => void;
  onNewLink: () => void;
}

export function stageText(job: JobResponse | null, data: ExtractResponse, format: MediaFormat | null) {
  if (!job || job.status === "queued") return "Waiting in line…";
  const pct = Math.round(job.progress * 100);
  if (job.progress < 0.9) {
    return `Downloading from ${data.source.site || "the site"}… ${pct}%`;
  }
  if (format?.kind === "video" && format.has_audio && format.has_video) {
    return "Merging video and audio…";
  }
  if (format?.ext === "mp3") return "Converting to MP3…";
  return "Preparing your file…";
}

function minutesLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 60000));
}

function DoneView({
  job,
  format,
  onAgain,
  onAnotherFormat,
  onNewLink,
}: {
  job: JobResponse;
  format: MediaFormat | null;
  onAgain: () => void;
  onAnotherFormat: () => void;
  onNewLink: () => void;
}) {
  const saveRef = useRef<HTMLAnchorElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    saveRef.current?.focus();
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // The contract promises a 1 hour TTL; fall back to that if expires_at is missing.
  const left = minutesLeft(job.expires_at, now) ?? 60;
  const expired = left <= 0;

  if (expired) {
    return (
      <div className="rounded-lg border-2 border-sun bg-warning-subtle p-5 text-warning sm:p-6">
        <h2 className="text-lg">This file has been deleted.</h2>
        <p className="mt-1 text-text">Start the download again.</p>
        <button type="button" onClick={onAgain} className={`${buttonPrimary} mt-4`}>
          Download again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-[#10b981] bg-success-subtle p-5 sm:p-6" data-testid="job-done">
      <h2 className="flex items-center gap-2 text-xl text-success">
        <IconCheckCircle size={24} />
        Nabbed! Your file is ready
      </h2>
      <p className="mt-1 break-all font-mono text-sm text-text">
        {job.filename ?? "download"}
        {format && <span className="font-sans text-muted"> · {formatSize(format)}</span>}
      </p>
      <div className="mt-4">
        <CopyrightNotice />
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          ref={saveRef}
          href={job.download_url ?? "#"}
          download={job.filename ?? true}
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className={`${buttonPrimary} w-full sm:w-auto`}
        >
          <IconDownload />
          Save file
        </a>
        <p className="tabular text-sm text-text">
          Expires in 1 hour
          <span className="text-muted"> ({left} min left)</span>
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-2">
        <button type="button" onClick={onAnotherFormat} className={buttonGhost}>
          Download another format
        </button>
        <button type="button" onClick={onNewLink} className={buttonGhost}>
          Paste a new link
        </button>
      </div>
    </div>
  );
}

/** The action area under the format list: notice + button → check → progress → done. */
export function DownloadPanel({
  data,
  format,
  state,
  onStart,
  onToken,
  onChallengeError,
  onCancel,
  onErrorAction,
  onAnotherFormat,
  onNewLink,
}: DownloadPanelProps) {
  const stageId = useId();

  switch (state.phase) {
    case "idle":
      return (
        <div className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-3 border-t border-border bg-surface/95 px-5 py-3 shadow-md backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
          <CopyrightNotice />
          <button
            type="button"
            onClick={onStart}
            disabled={!format}
            className={`${buttonPrimary} h-control-lg w-full md:w-auto md:self-start`}
          >
            <IconDownload />
            {format ? downloadLabel(format) : "Choose a format"}
          </button>
        </div>
      );
    case "challenge":
      return (
        <div className="flex flex-col gap-3">
          <Turnstile onToken={onToken} onError={onChallengeError} />
          <button type="button" onClick={onCancel} className={`${buttonGhost} self-start`}>
            Cancel
          </button>
        </div>
      );
    case "starting":
    case "progress": {
      const job = state.phase === "progress" ? state.job : null;
      const running = job?.status === "running" && job.progress > 0;
      const text = state.phase === "starting" ? "Starting…" : stageText(job, data, format);
      return (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-2/60 p-5" data-testid="job-progress">
          <div className="flex items-baseline justify-between gap-4">
            <p id={stageId} className="flex items-center gap-2 font-bold">
              {!running && <IconSpinner size={18} />}
              {text.replace(/ \d+%$/, "")}
            </p>
            {running && (
              <span className="tabular text-lg font-black text-accent-strong" aria-hidden="true">
                {Math.round(job.progress * 100)}%
              </span>
            )}
          </div>
          <ProgressBar value={running ? job.progress : null} label={text} labelId={stageId} />
          <div className="flex items-center justify-between gap-4 text-sm text-muted">
            <span>{format ? `${format.label} · ${formatSize(format)}` : null}</span>
            <button type="button" onClick={onCancel} className={`${buttonGhost} min-h-tap px-2`}>
              Cancel
            </button>
          </div>
        </div>
      );
    }
    case "done":
      return (
        <DoneView
          job={state.job}
          format={format}
          onAgain={onStart}
          onAnotherFormat={onAnotherFormat}
          onNewLink={onNewLink}
        />
      );
    case "error":
      return (
        <ErrorCallout
          key={`${state.error.code}-${state.error.message}`}
          error={state.error}
          context={{ site: data.source.site, durationSeconds: data.duration_seconds, phase: "job" }}
          onAction={onErrorAction}
        />
      );
  }
}
