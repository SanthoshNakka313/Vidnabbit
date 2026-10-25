"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type ExtractResponse } from "@/lib/api";
import type { ErrorAction } from "@/lib/error-messages";
import { defaultFormatId } from "@/lib/format";
import { buttonGhost } from "../ui/styles";
import { DownloadPanel, stageText } from "./DownloadPanel";
import { ErrorCallout } from "./ErrorCallout";
import { FormatList } from "./FormatList";
import { MediaPreviewCard } from "./MediaPreviewCard";
import { ResultSkeleton } from "./ResultSkeleton";
import { Turnstile } from "./Turnstile";
import { UrlForm } from "./UrlForm";
import { useDownloadJob, type JobState } from "./useDownloadJob";

type ExtractState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "challenge"; url: string }
  | { status: "success"; url: string; data: ExtractResponse }
  | { status: "error"; url: string; error: ApiError };

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Text for the single polite live region. Derived from state so it only
 * changes on meaningful transitions; progress is bucketed to 25% steps.
 */
function liveMessage(extract: ExtractState, job: JobState): string {
  switch (extract.status) {
    case "idle":
    case "error":
      return "";
    case "loading":
      return "Nabbing your media";
    case "challenge":
      return "Quick check needed before we can read this link";
    case "success":
      break;
  }
  const { data } = extract;
  switch (job.phase) {
    case "idle": {
      const n = data.formats.length;
      return `Found: ${data.title}, ${n} format${n === 1 ? "" : "s"}`;
    }
    case "challenge":
      return "Quick check to keep VidNabbit free and bot-free";
    case "starting":
      return "Download started";
    case "progress": {
      const p = job.job;
      if (!p || p.status === "queued") return "Download started. Waiting in line";
      const bucket = Math.floor(Math.min(1, p.progress) * 4) * 25;
      const stage = stageText(p, data, null).replace(/ \d+%$/, "").replace(/…$/, "");
      return `${stage}, ${bucket}%`;
    }
    case "done":
      return "Your file is ready";
    case "error":
      return "";
  }
}

export function Downloader() {
  const [url, setUrl] = useState("");
  const [extract, setExtract] = useState<ExtractState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const job = useDownloadJob();
  const { reset: resetJob } = job;

  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formatsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const runExtract = useCallback(
    async (target: string, turnstileToken?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      resetJob();
      setSelectedId(null);
      setExtract({ status: "loading", url: target });
      try {
        const data = await api.extract(
          { url: target, turnstile_token: turnstileToken },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSelectedId(defaultFormatId(data.formats));
        setExtract({ status: "success", url: target, data });
      } catch (err) {
        if (isAbort(err) || controller.signal.aborted) return;
        const error = err instanceof ApiError ? err : new ApiError("internal", "Unexpected error");
        // The server may ask for a bot check before extracting (heavy use).
        if (error.code === "challenge_required" && !turnstileToken) {
          setExtract({ status: "challenge", url: target });
          return;
        }
        setExtract({ status: "error", url: target, error });
      }
    },
    [resetJob],
  );

  // Focus management (docs/04-design.md §7).
  useEffect(() => {
    if (extract.status === "success") titleRef.current?.focus();
    if (extract.status === "error" && extract.error.code === "invalid_url") focusInput();
  }, [extract, focusInput]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    resetJob();
    setUrl("");
    setSelectedId(null);
    setExtract({ status: "idle" });
    // Wait for the input to re-render empty before focusing.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [resetJob]);

  const focusFormats = useCallback(() => {
    requestAnimationFrame(() => {
      const el =
        formatsRef.current?.querySelector<HTMLInputElement>("input[type=radio]:checked") ??
        formatsRef.current?.querySelector<HTMLInputElement>("input[type=radio]:not(:disabled)");
      el?.focus();
    });
  }, []);

  function handleExtractErrorAction(action: ErrorAction) {
    if (extract.status !== "error") return;
    if (action === "retry") void runExtract(extract.url);
    else if (action === "restart") startOver();
    else focusInput();
  }

  const data = extract.status === "success" ? extract.data : null;
  const currentUrl = extract.status === "idle" ? "" : extract.url;
  const format = data?.formats.find((f) => f.format_id === selectedId) ?? null;
  const jobBusy = job.state.phase !== "idle" && job.state.phase !== "error";

  function startDownload() {
    if (!data) return;
    // If the extract itself expired, read the link again first.
    if (Date.parse(data.expires_at) <= Date.now()) {
      void runExtract(currentUrl);
      return;
    }
    job.begin();
  }

  function handleJobErrorAction(action: ErrorAction) {
    if (!data) return;
    if (action === "retry") startDownload();
    else if (action === "choose-format") {
      job.reset();
      focusFormats();
    } else if (action === "restart") void runExtract(currentUrl);
    else startOver();
  }

  return (
    <div className="flex flex-col gap-8">
      <UrlForm
        value={url}
        onValueChange={setUrl}
        loading={extract.status === "loading"}
        onSubmit={(u) => void runExtract(u)}
        inputRef={inputRef}
        focusInput={focusInput}
      />

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
        {liveMessage(extract, job.state)}
      </p>

      {extract.status !== "idle" && (
        <section aria-label="Result" className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-5 text-left shadow-lg sm:p-7">
          {extract.status === "loading" && <ResultSkeleton />}

          {extract.status === "challenge" && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg">Quick check needed</h2>
              <Turnstile
                onToken={(token) => void runExtract(extract.url, token)}
                onError={() =>
                  setExtract({
                    status: "error",
                    url: extract.url,
                    error: new ApiError("challenge_required", "Turnstile challenge failed"),
                  })
                }
              />
              <button type="button" onClick={startOver} className={`${buttonGhost} self-start`}>
                Cancel
              </button>
            </div>
          )}

          {extract.status === "error" && (
            <ErrorCallout
              key={`${extract.url}-${extract.error.code}`}
              error={extract.error}
              autoFocus={extract.error.code !== "invalid_url"}
              context={{ phase: "extract" }}
              onAction={handleExtractErrorAction}
            />
          )}

          {data && (
            <>
              <MediaPreviewCard data={data} titleRef={titleRef} />
              <div ref={formatsRef}>
                <FormatList
                  formats={data.formats}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  disabled={jobBusy || job.state.phase === "done"}
                />
              </div>
              {data.formats.length > 0 && (
                <DownloadPanel
                  data={data}
                  format={format}
                  state={job.state}
                  onStart={startDownload}
                  onToken={(token) => {
                    if (format) void job.submitToken(data.id, format.format_id, token);
                  }}
                  onChallengeError={job.challengeFailed}
                  onCancel={job.reset}
                  onErrorAction={handleJobErrorAction}
                  onAnotherFormat={() => {
                    job.reset();
                    focusFormats();
                  }}
                  onNewLink={startOver}
                />
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

