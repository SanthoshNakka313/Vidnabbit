/**
 * In-browser mock of the v1 API, enabled with NEXT_PUBLIC_API_MOCK=1.
 *
 * Choose a scenario with the pasted URL:
 * - `?mock=<error_code>` on any URL makes /extract fail with that code, e.g.
 *   https://example.com/watch?mock=rate_limited
 * - DRM-only hosts (netflix.com, spotify.com, ...) fail with drm_protected.
 * - Path keywords: /private, /login, /drm, /blocked, /too-long, /too-large,
 *   /rate-limit, /unsupported, /upstream, /not-found, /internal, /live.
 * - `?mock=job_failed` succeeds at extract but the job fails mid-way.
 * - `?mock=challenge_required` succeeds at extract but /jobs rejects the first
 *   Turnstile token (the retry succeeds).
 * - `?mock=extract_challenge` (or a /challenge path) makes /extract demand a
 *   Turnstile token: it fails with challenge_required until one is sent.
 * - `?mock=xss` returns hostile remote strings (markup title, javascript:
 *   thumbnail) to prove they are rendered inertly.
 * - Paths containing "audio" or "podcast" return audio; "photo", "gallery"
 *   or "images" return an image gallery; anything else returns a video.
 */
import { ApiError, isContractErrorCode } from "./api-error";
import type { VidNabbitApi } from "./api";
import type { ContractErrorCode, ExtractResponse, JobResponse } from "./api-types";
import {
  audioExtractFixture,
  errorFixtures,
  galleryExtractFixture,
  hostileExtractFixture,
  jobFixtures,
  videoExtractFixture,
} from "./mock-fixtures";

export const MOCK_DRM_HOSTS = [
  "netflix.com",
  "primevideo.com",
  "disneyplus.com",
  "hotstar.com",
  "spotify.com",
  "music.apple.com",
  "tv.apple.com",
];

const PATH_KEYWORDS: [string, ContractErrorCode][] = [
  ["private", "private_content"],
  ["login", "login_required"],
  ["drm", "drm_protected"],
  ["not-cc", "license_required"],
  ["blocked", "blocked_by_rights_holder"],
  ["too-long", "too_long"],
  ["too-large", "too_large"],
  ["rate-limit", "rate_limited"],
  ["unsupported", "unsupported_site"],
  ["upstream", "upstream_error"],
  ["not-found", "not_found"],
  ["internal", "internal"],
  ["live", "live_not_supported"],
];

export const MOCK_JOB_DURATION_MS = 3000;

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Which error, if any, the mock /extract should return for this URL. */
export function mockExtractErrorFor(rawUrl: string): ContractErrorCode | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid_url";
  const forced = url.searchParams.get("mock");
  if (forced && isContractErrorCode(forced) && forced !== "challenge_required") {
    return forced;
  }
  const host = url.hostname.toLowerCase();
  if (MOCK_DRM_HOSTS.some((d) => hostMatches(host, d))) return "drm_protected";
  const path = url.pathname.toLowerCase();
  for (const [keyword, code] of PATH_KEYWORDS) {
    if (path.includes(keyword)) return code;
  }
  return null;
}

/** Whether the mock /extract requires a Turnstile token for this URL. */
export function mockExtractNeedsChallenge(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.searchParams.get("mock") === "extract_challenge" ||
      url.pathname.toLowerCase().includes("challenge")
    );
  } catch {
    return false;
  }
}

function fixtureFor(url: string): ExtractResponse {
  if (new URL(url).searchParams.get("mock") === "xss") return hostileExtractFixture(url);
  const path = new URL(url).pathname.toLowerCase();
  if (/audio|podcast|track/.test(path)) return audioExtractFixture(url);
  if (/photo|gallery|images/.test(path)) return galleryExtractFixture(url);
  return videoExtractFixture(url);
}

function toError(code: ContractErrorCode): ApiError {
  const f = errorFixtures[code];
  return new ApiError(code, f.body.error.message, f.status, f.retryAfterSeconds ?? null);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

interface MockExtract {
  data: ExtractResponse;
  scenario: string | null;
  challengeRejected?: boolean;
}

interface MockJob {
  startedAt: number;
  filename: string;
  fail: boolean;
}

export interface MockApiOptions {
  /** Latency for extract/createJob in ms. */
  latencyMs?: number;
  jobDurationMs?: number;
  now?: () => number;
}

export function createMockApi(options: MockApiOptions = {}): VidNabbitApi {
  const latency = options.latencyMs ?? 700;
  const jobDuration = options.jobDurationMs ?? MOCK_JOB_DURATION_MS;
  const now = options.now ?? (() => Date.now());
  const extracts = new Map<string, MockExtract>();
  const jobs = new Map<string, MockJob>();
  let counter = 0;

  return {
    async extract({ url, turnstile_token }, signal) {
      await delay(latency, signal);
      const code = mockExtractErrorFor(url);
      if (code) throw toError(code);
      if (mockExtractNeedsChallenge(url) && !turnstile_token) {
        throw toError("challenge_required");
      }
      counter += 1;
      const base = fixtureFor(url);
      const data = { ...base, id: `${base.id}_${counter}` };
      extracts.set(data.id, {
        data,
        scenario: new URL(url).searchParams.get("mock"),
      });
      return data;
    },

    async createJob(req, signal) {
      await delay(Math.round(latency / 2), signal);
      const extract = extracts.get(req.extract_id);
      if (!extract) throw toError("not_found");
      if (!req.turnstile_token) throw toError("challenge_required");
      // The challenge_required scenario rejects the first token only.
      if (extract.scenario === "challenge_required" && !extract.challengeRejected) {
        extract.challengeRejected = true;
        throw toError("challenge_required");
      }
      const format = extract.data.formats.find((f) => f.format_id === req.format_id);
      if (!format) throw toError("not_found");
      counter += 1;
      const jobId = `job_mock_${counter}`;
      const slug = extract.data.title
        .replace(/<[^>]*>/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 60);
      jobs.set(jobId, {
        startedAt: now(),
        filename: `${slug}.${format.ext}`,
        fail: extract.scenario === "job_failed",
      });
      return { job_id: jobId };
    },

    async getJob(jobId, signal) {
      await delay(80, signal);
      const job = jobs.get(jobId);
      if (!job) throw toError("not_found");
      const elapsed = now() - job.startedAt;
      const progress = Math.min(1, elapsed / jobDuration);
      if (job.fail && progress >= 0.4) return jobFixtures.failed("upstream_error");
      if (elapsed < 300) return jobFixtures.queued();
      if (progress < 1) return jobFixtures.running(Math.round(progress * 100) / 100);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
      const done: JobResponse = jobFixtures.done(
        job.filename,
        `${origin}/mock/vidnabbit-sample.txt`,
      );
      return done;
    },

    async takedown(req, signal) {
      await delay(latency, signal);
      if (!req.urls.length) throw toError("invalid_url");
    },

    async health() {
      return { ok: true };
    },
  };
}
