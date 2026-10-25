/**
 * Realistic fixtures for every v1 response and every error code. Used by the
 * mock API (NEXT_PUBLIC_API_MOCK=1) and by unit/e2e tests.
 */
import type {
  ApiErrorEnvelope,
  ContractErrorCode,
  ExtractResponse,
  JobResponse,
  MediaFormat,
} from "./api-types";

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function videoFormat(
  format_id: string,
  label: string,
  height: number,
  filesize_bytes: number,
  overrides: Partial<MediaFormat> = {},
): MediaFormat {
  return {
    format_id,
    kind: "video",
    ext: "mp4",
    label,
    width: Math.round((height * 16) / 9),
    height,
    fps: 30,
    audio_bitrate_kbps: null,
    has_audio: true,
    has_video: true,
    filesize_bytes,
    filesize_is_estimate: true,
    ...overrides,
  };
}

const audioFormats: MediaFormat[] = [
  {
    format_id: "preset-audio-mp3-192",
    kind: "audio",
    ext: "mp3",
    label: "Audio · MP3 192 kbps",
    width: null,
    height: null,
    fps: null,
    audio_bitrate_kbps: 192,
    has_audio: true,
    has_video: false,
    filesize_bytes: 5_112_000,
    filesize_is_estimate: true,
  },
  {
    format_id: "preset-audio-m4a",
    kind: "audio",
    ext: "m4a",
    label: "Audio · M4A (original)",
    width: null,
    height: null,
    fps: null,
    audio_bitrate_kbps: 128,
    has_audio: true,
    has_video: false,
    filesize_bytes: 3_420_118,
    filesize_is_estimate: false,
  },
];

export function videoExtractFixture(url: string): ExtractResponse {
  return {
    id: "ext_mock_video_8f3a2c",
    source: { site: "Example Video", url },
    // Deliberately contains markup: it must render as text, never as HTML.
    title: "Big Buck Bunny <b>4K</b> & friends: open movie trailer",
    uploader: "Blender Foundation",
    duration_seconds: 213,
    thumbnail_url: "https://picsum.photos/seed/vidnabbit/640/360",
    media_type: "video",
    formats: [
      videoFormat("preset-best", "Best quality · MP4 (2160p)", 2160, 412_000_000, {
        fps: 60,
      }),
      videoFormat("preset-1080p", "1080p · MP4", 1080, 123_456_789),
      videoFormat("preset-720p", "720p · MP4", 720, 64_200_000),
      videoFormat("preset-480p", "480p · MP4", 480, 31_800_000),
      videoFormat("webm-1080p", "1080p · WebM (VP9)", 1080, 98_000_000, {
        ext: "webm",
        filesize_bytes: null,
      }),
      ...audioFormats,
    ],
    expires_at: inOneHour(),
  };
}

export function audioExtractFixture(url: string): ExtractResponse {
  return {
    id: "ext_mock_audio_51b7d0",
    source: { site: "Example Audio", url },
    title: "Field recording: rain on a tin roof (CC BY 4.0)",
    uploader: "Open Sound Library",
    duration_seconds: 1_847,
    thumbnail_url: null,
    media_type: "audio",
    formats: audioFormats,
    expires_at: inOneHour(),
  };
}

export function galleryExtractFixture(url: string): ExtractResponse {
  const image = (n: number, w: number, h: number, bytes: number): MediaFormat => ({
    format_id: `image-${n}-original`,
    kind: "image",
    ext: n === 3 ? "png" : "jpg",
    label: `Image ${n} · ${n === 3 ? "PNG" : "JPG"} (original, ${w}×${h})`,
    width: w,
    height: h,
    fps: null,
    audio_bitrate_kbps: null,
    has_audio: false,
    has_video: false,
    filesize_bytes: bytes,
    filesize_is_estimate: false,
  });
  return {
    id: "ext_mock_gallery_c09e14",
    source: { site: "Example Photos", url },
    title: "Alpine lakes, summer 2026",
    uploader: null,
    duration_seconds: null,
    thumbnail_url: "https://picsum.photos/seed/alpine/640/427",
    media_type: "gallery",
    formats: [
      image(1, 4032, 3024, 4_812_330),
      image(2, 3024, 4032, 5_020_114),
      image(3, 2048, 1365, 7_310_002),
    ],
    expires_at: inOneHour(),
  };
}

/** Hostile remote strings: must render as literal text, never execute. */
export function hostileExtractFixture(url: string): ExtractResponse {
  return {
    ...videoExtractFixture(url),
    id: "ext_mock_hostile_000",
    title: '<img src=x onerror=alert(1)>',
    uploader: '<script>alert("uploader")</script>',
    thumbnail_url: "javascript:alert(1)",
    source: { site: "<b>Evil</b>", url },
  };
}

export const jobFixtures = {
  queued: (): JobResponse => ({
    status: "queued",
    progress: 0,
    filename: null,
    download_url: null,
    expires_at: null,
    error: null,
  }),
  running: (progress: number): JobResponse => ({
    status: "running",
    progress,
    filename: null,
    download_url: null,
    expires_at: null,
    error: null,
  }),
  done: (filename: string, download_url: string): JobResponse => ({
    status: "done",
    progress: 1,
    filename,
    download_url,
    expires_at: inOneHour(),
    error: null,
  }),
  failed: (code: ContractErrorCode = "upstream_error"): JobResponse => ({
    status: "failed",
    progress: 0.4,
    filename: null,
    download_url: null,
    expires_at: null,
    error: { code, message: errorFixtures[code].body.error.message },
  }),
};

export interface ErrorFixture {
  status: number;
  body: ApiErrorEnvelope;
  retryAfterSeconds?: number;
}

/** One fixture per contract error code, with a plausible HTTP status. */
export const errorFixtures: Record<ContractErrorCode, ErrorFixture> = {
  invalid_url: {
    status: 400,
    body: { error: { code: "invalid_url", message: "The URL is not a valid public http(s) URL." } },
  },
  unsupported_site: {
    status: 422,
    body: { error: { code: "unsupported_site", message: "No downloadable media was found on this site." } },
  },
  drm_protected: {
    status: 451,
    body: { error: { code: "drm_protected", message: "This content is DRM-protected and cannot be downloaded." } },
  },
  login_required: {
    status: 403,
    body: { error: { code: "login_required", message: "This content requires signing in." } },
  },
  private_content: {
    status: 403,
    body: { error: { code: "private_content", message: "This content is private." } },
  },
  blocked_by_rights_holder: {
    status: 451,
    body: { error: { code: "blocked_by_rights_holder", message: "This item was removed at the request of the rights holder." } },
  },
  live_not_supported: {
    status: 422,
    body: { error: { code: "live_not_supported", message: "Live streams and premieres are not supported." } },
  },
  too_long: {
    status: 413,
    body: { error: { code: "too_long", message: "Media longer than 3 hours is not supported." } },
  },
  too_large: {
    status: 413,
    body: { error: { code: "too_large", message: "The file would exceed the 4 GB limit." } },
  },
  rate_limited: {
    status: 429,
    body: { error: { code: "rate_limited", message: "Too many requests. Try again shortly." } },
    retryAfterSeconds: 60,
  },
  challenge_required: {
    status: 403,
    body: { error: { code: "challenge_required", message: "Bot check failed or expired." } },
  },
  upstream_error: {
    status: 502,
    body: { error: { code: "upstream_error", message: "The source site returned an error." } },
  },
  not_found: {
    status: 404,
    body: { error: { code: "not_found", message: "Not found or expired." } },
  },
  internal: {
    status: 500,
    body: { error: { code: "internal", message: "Unexpected server error." } },
  },
};
