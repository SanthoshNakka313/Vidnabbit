import type { FormatKind, MediaFormat } from "./api-types";

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  const digits = value >= 100 || i === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Spoken form for screen readers, e.g. "3 minutes 33 seconds". */
export function formatDurationLong(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (sec || !parts.length) parts.push(`${sec} second${sec === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export const KIND_ORDER: FormatKind[] = ["video", "audio", "image"];
export const KIND_LABELS: Record<FormatKind, string> = {
  video: "Video",
  audio: "Audio",
  image: "Images",
};

export function groupFormats(formats: MediaFormat[]): { kind: FormatKind; formats: MediaFormat[] }[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    formats: formats.filter((f) => f.kind === kind),
  })).filter((g) => g.formats.length > 0);
}

/**
 * Which formats to highlight as "Recommended". The contract has no explicit
 * flag, so we pick: the best merged MP4 at or below 1080p, MP3 audio (or the
 * first audio option), and the largest image.
 */
export function recommendedFormatIds(formats: MediaFormat[]): Set<string> {
  const ids = new Set<string>();
  const merged = formats
    .filter((f) => f.kind === "video" && f.has_audio && f.has_video && f.ext === "mp4")
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const video = merged.find((f) => (f.height ?? 0) <= 1080) ?? merged[merged.length - 1];
  if (video) ids.add(video.format_id);
  const audio = formats.filter((f) => f.kind === "audio");
  const mp3 = audio.find((f) => f.ext === "mp3") ?? audio[0];
  if (mp3) ids.add(mp3.format_id);
  const images = formats
    .filter((f) => f.kind === "image")
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  if (images[0]) ids.add(images[0].format_id);
  return ids;
}

/** The format to pre-select: the recommended option of the main media type. */
export function defaultFormatId(formats: MediaFormat[]): string | null {
  const groups = groupFormats(formats);
  if (!groups.length) return null;
  const recommended = recommendedFormatIds(formats);
  const first = groups[0].formats;
  return (first.find((f) => recommended.has(f.format_id)) ?? first[0]).format_id;
}

export const MAX_FILE_BYTES = 4 * 1000 ** 3;

/** "~142 MB" for estimates, "141.6 MB" for exact sizes, "Size unknown" for null. */
export function formatSize(f: Pick<MediaFormat, "filesize_bytes" | "filesize_is_estimate">): string {
  const size = formatBytes(f.filesize_bytes);
  if (!size) return "Size unknown";
  return f.filesize_is_estimate ? `~${size}` : size;
}

export function isTooLarge(f: MediaFormat): boolean {
  return f.filesize_bytes !== null && f.filesize_bytes > MAX_FILE_BYTES;
}

/** Secondary details shown next to the label (fps, bitrate). */
export function formatDetails(f: MediaFormat): string[] {
  const details: string[] = [];
  if (f.kind === "video" && f.fps) details.push(`${f.fps} fps`);
  if (f.kind === "audio" && f.audio_bitrate_kbps) details.push(`${f.audio_bitrate_kbps} kbps`);
  return details;
}

/**
 * Formats shown before "Show all formats": merged video with sound, all audio
 * and all images. Video-only or non-MP4 video goes behind the disclosure.
 */
export function isPrimaryFormat(f: MediaFormat): boolean {
  if (f.kind !== "video") return true;
  return f.has_audio && f.has_video && f.ext === "mp4";
}

/** Button label that states the choice, e.g. "Download 1080p · MP4 · ~142 MB". */
export function downloadLabel(f: MediaFormat): string {
  const size = formatBytes(f.filesize_bytes) ? ` · ${formatSize(f)}` : "";
  return `Download ${f.label}${size}`;
}

/** BRAND.md: yellow "HD" / "4K" badges on video formats. */
export function qualityBadge(f: MediaFormat): "4K" | "HD" | null {
  if (f.kind !== "video" || !f.height) return null;
  if (f.height >= 2160) return "4K";
  if (f.height >= 720) return "HD";
  return null;
}
