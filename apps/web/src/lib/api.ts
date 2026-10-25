import { API_MOCK, API_URL } from "./config";
import {
  type ContractErrorCode,
  type CreateJobRequest,
  type CreateJobResponse,
  type ExtractRequest,
  type ExtractResponse,
  type HealthResponse,
  type JobResponse,
  type TakedownRequest,
} from "./api-types";
import { createMockApi } from "./mock-api";
import { ApiError, isContractErrorCode } from "./api-error";

export { ApiError, isApiError, isContractErrorCode } from "./api-error";

export type * from "./api-types";

/** Fallback code when the server returns a non-JSON or unknown error. */
function codeForStatus(status: number): ContractErrorCode {
  if (status === 400 || status === 422) return "invalid_url";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "upstream_error";
  return "internal";
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return null;
}

/** Converts a non-2xx response into an ApiError, tolerating bad bodies. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
  let code: ContractErrorCode = codeForStatus(res.status);
  let message = `Request failed with status ${res.status}`;
  try {
    const body: unknown = await res.json();
    const err = (body as { error?: { code?: unknown; message?: unknown } })
      ?.error;
    if (err && isContractErrorCode(err.code)) code = err.code;
    if (err && typeof err.message === "string" && err.message) {
      message = err.message;
    }
  } catch {
    // Non-JSON body: keep the status-derived code.
  }
  return new ApiError(code, message, res.status, retryAfter);
}

export interface VidNabbitApi {
  extract(req: ExtractRequest, signal?: AbortSignal): Promise<ExtractResponse>;
  createJob(req: CreateJobRequest, signal?: AbortSignal): Promise<CreateJobResponse>;
  getJob(jobId: string, signal?: AbortSignal): Promise<JobResponse>;
  takedown(req: TakedownRequest, signal?: AbortSignal): Promise<void>;
  health(signal?: AbortSignal): Promise<HealthResponse>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions = {}): VidNabbitApi {
  const baseUrl = (options.baseUrl ?? API_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/v1${path}`, {
        method,
        signal,
        // No cookies or credentials are ever sent (public content only).
        credentials: "omit",
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(
        "network_error",
        "Could not reach the VidNabbit service.",
      );
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (res.status === 202 || res.status === 204) {
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError("internal", "The service sent an unreadable response.", res.status);
    }
  }

  return {
    extract: (req, signal) =>
      request<ExtractResponse>(
        "POST",
        "/extract",
        req.turnstile_token ? { url: req.url, turnstile_token: req.turnstile_token } : { url: req.url },
        signal,
      ),
    createJob: (req, signal) =>
      request<CreateJobResponse>("POST", "/jobs", req, signal),
    getJob: (jobId, signal) =>
      request<JobResponse>(
        "GET",
        `/jobs/${encodeURIComponent(jobId)}`,
        undefined,
        signal,
      ),
    takedown: async (req, signal) => {
      await request<unknown>("POST", "/takedown", req, signal);
    },
    health: (signal) => request<HealthResponse>("GET", "/health", undefined, signal),
  };
}

/** The app-wide client: mock fixtures when NEXT_PUBLIC_API_MOCK=1. */
export const api: VidNabbitApi = API_MOCK ? createMockApi() : createApiClient();
