/** Types for the VidNabbit v1 API contract (docs/00-project-brief.md). */

export const API_ERROR_CODES = [
  "invalid_url",
  "unsupported_site",
  "drm_protected",
  "license_required",
  "login_required",
  "private_content",
  "blocked_by_rights_holder",
  "live_not_supported",
  "too_long",
  "too_large",
  "rate_limited",
  "challenge_required",
  "upstream_error",
  "not_found",
  "internal",
] as const;

export type ContractErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Client-only codes: `network_error` when the API can't be reached, and
 * `timeout` when a job takes longer than the client is willing to poll.
 */
export type ClientErrorCode = "network_error" | "timeout";

export type ApiErrorCode = ContractErrorCode | ClientErrorCode;

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export type MediaType = "video" | "audio" | "image" | "gallery";
export type FormatKind = "video" | "audio" | "image";

export interface MediaFormat {
  format_id: string;
  kind: FormatKind;
  ext: string;
  label: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  audio_bitrate_kbps: number | null;
  has_audio: boolean;
  has_video: boolean;
  filesize_bytes: number | null;
  filesize_is_estimate: boolean;
}

export interface ExtractRequest {
  url: string;
  /** Optional; the server may require it after heavy use (challenge_required). */
  turnstile_token?: string;
}

export interface ExtractResponse {
  id: string;
  source: { site: string; url: string };
  title: string;
  uploader: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  media_type: MediaType;
  formats: MediaFormat[];
  expires_at: string;
}

export interface CreateJobRequest {
  extract_id: string;
  format_id: string;
  turnstile_token: string;
}

export interface CreateJobResponse {
  job_id: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobResponse {
  status: JobStatus;
  progress: number;
  filename: string | null;
  download_url: string | null;
  expires_at: string | null;
  error: ApiErrorBody | null;
}

export interface TakedownRequest {
  urls: string[];
  name: string;
  email: string;
  organisation?: string;
  statement_good_faith: true;
  statement_accuracy: true;
  signature: string;
}

export interface HealthResponse {
  ok: boolean;
}
