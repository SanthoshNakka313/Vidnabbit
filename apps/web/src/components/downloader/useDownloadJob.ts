"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type JobResponse } from "@/lib/api";
import { pollJob } from "@/lib/poll";

export type JobState =
  | { phase: "idle" }
  | { phase: "challenge" }
  | { phase: "starting" }
  | { phase: "progress"; jobId: string; job: JobResponse | null }
  | { phase: "done"; job: JobResponse }
  | { phase: "error"; error: ApiError };

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError("internal", "Unexpected error");
}

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Drives one download: Turnstile challenge → POST /v1/jobs → poll with
 * backoff → done. Aborts in-flight work on cancel, reset or unmount.
 */
export function useDownloadJob() {
  const [state, setState] = useState<JobState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => abort, [abort]);

  /** Show the challenge; the job starts once a token arrives. */
  const begin = useCallback(() => {
    abort();
    setState({ phase: "challenge" });
  }, [abort]);

  const submitToken = useCallback(
    async (extractId: string, formatId: string, token: string) => {
      abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      setState({ phase: "starting" });
      try {
        const { job_id } = await api.createJob(
          { extract_id: extractId, format_id: formatId, turnstile_token: token },
          signal,
        );
        setState({ phase: "progress", jobId: job_id, job: null });
        const job = await pollJob(api, job_id, {
          signal,
          initialDelayMs: 1000,
          factor: 1.25,
          maxDelayMs: 3000,
          onUpdate: (j) => {
            if (!signal.aborted) setState({ phase: "progress", jobId: job_id, job: j });
          },
        });
        if (!signal.aborted) setState({ phase: "done", job });
      } catch (err) {
        if (isAbort(err) || signal.aborted) return;
        setState({ phase: "error", error: toApiError(err) });
      }
    },
    [abort],
  );

  const challengeFailed = useCallback(() => {
    abort();
    setState({
      phase: "error",
      error: new ApiError("challenge_required", "Turnstile challenge failed"),
    });
  }, [abort]);

  const reset = useCallback(() => {
    abort();
    setState({ phase: "idle" });
  }, [abort]);

  return { state, begin, submitToken, challengeFailed, reset };
}
