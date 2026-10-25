import { ApiError, isContractErrorCode } from "./api-error";
import type { JobResponse } from "./api-types";
import type { VidNabbitApi } from "./api";

export interface PollOptions {
  signal?: AbortSignal;
  onUpdate?: (job: JobResponse) => void;
  initialDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  /** Give up after this long and throw a `timeout` ApiError. */
  timeoutMs?: number;
  /** Consecutive transient failures tolerated before giving up. */
  maxTransientErrors?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

const TRANSIENT = new Set(["network_error", "upstream_error", "internal", "rate_limited"]);

/** The delay before poll attempt `attempt` (0-based), with exponential backoff. */
export function backoffDelay(
  attempt: number,
  initialDelayMs = 500,
  factor = 1.5,
  maxDelayMs = 4000,
): number {
  return Math.min(maxDelayMs, Math.round(initialDelayMs * factor ** attempt));
}

/**
 * Polls GET /v1/jobs/{id} until it is done (resolves) or failed (throws an
 * ApiError with the job's error code). Backs off exponentially between polls.
 */
export async function pollJob(
  api: Pick<VidNabbitApi, "getJob">,
  jobId: string,
  options: PollOptions = {},
): Promise<JobResponse> {
  const {
    signal,
    onUpdate,
    initialDelayMs = 500,
    factor = 1.5,
    maxDelayMs = 4000,
    timeoutMs = 30 * 60 * 1000,
    maxTransientErrors = 4,
    sleep: wait = sleep,
    now = Date.now,
  } = options;
  const started = now();
  let attempt = 0;
  let transientErrors = 0;

  for (;;) {
    const delay = backoffDelay(attempt, initialDelayMs, factor, maxDelayMs);
    await wait(delay, signal);
    attempt += 1;
    let job: JobResponse;
    try {
      job = await api.getJob(jobId, signal);
    } catch (err) {
      // Retry transient request-level problems a few times, then give up.
      if (!(err instanceof ApiError)) throw err;
      if (!TRANSIENT.has(err.code) || transientErrors >= maxTransientErrors) throw err;
      transientErrors += 1;
      if (err.retryAfterSeconds) await wait(err.retryAfterSeconds * 1000, signal);
      continue;
    }
    transientErrors = 0;
    onUpdate?.(job);
    if (job.status === "done") return job;
    if (job.status === "failed") {
      // The job's own error is final.
      const code = job.error?.code;
      throw new ApiError(
        code && isContractErrorCode(code) ? code : "internal",
        job.error?.message ?? "The job failed.",
      );
    }
    if (now() - started > timeoutMs) {
      throw new ApiError("timeout", "The job did not finish in time.");
    }
  }
}

