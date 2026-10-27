import type { ApiErrorCode } from "./api-types";
import { formatDurationLong } from "./format";

export type ErrorTone = "warning" | "danger" | "info";

/** What the primary button in the callout does. */
export type ErrorAction =
  | "retry" // repeat the last action
  | "new-link" // focus the URL box so the user can try another link
  | "restart" // clear everything and start again
  | "choose-format"; // go back to the format list

export interface FriendlyError {
  title: string;
  description: string;
  /** Label for the primary action button. */
  actionLabel: string;
  action: ErrorAction;
  tone: ErrorTone;
  link?: { href: string; label: string };
}

export interface ErrorContext {
  site?: string | null;
  durationSeconds?: number | null;
  retryAfterSeconds?: number | null;
  /** Whether the error happened while preparing a file (vs reading the link). */
  phase?: "extract" | "job";
}

/**
 * Friendly copy for each error code (docs/04-design.md §2). Never suggests
 * workarounds for DRM, logins or takedowns.
 */
export function friendlyError(code: ApiErrorCode, ctx: ErrorContext = {}): FriendlyError {
  const site = ctx.site?.trim() || null;
  const tryAnother = { actionLabel: "Try another link", action: "new-link" as const };
  switch (code) {
    case "invalid_url":
      return {
        title: "That doesn't look like a link",
        description: "Paste the full address, starting with https://",
        ...tryAnother,
        actionLabel: "Edit the link",
        tone: "warning",
      };
    case "unsupported_site":
      return {
        title: "This link isn't supported",
        description:
          "VidNabbit couldn't read media from this link. Paste a link to one public video, post or file. Channels, playlists and profiles aren't supported.",
        ...tryAnother,
        tone: "warning",
        link: { href: "/supported-sites", label: "See supported sites" },
      };
    case "drm_protected":
      return {
        title: "This content is copy-protected",
        description: site
          ? `${site} protects this media with DRM, so it can't be downloaded here. Use ${site}'s own app if it offers offline viewing.`
          : "This content protects its media with DRM, so it can't be downloaded here. Use the service's own app if it offers offline viewing.",
        ...tryAnother,
        tone: "info",
        link: { href: "/supported-sites", label: "What VidNabbit can't download" },
      };
    case "login_required":
      return {
        title: "This needs a sign-in",
        description:
          "The media is only available to signed-in or paying users. VidNabbit only works with public content and never asks for your login.",
        ...tryAnother,
        tone: "info",
      };
    case "private_content":
      return {
        title: "This content is private",
        description: "The owner has limited who can see it. Only public links can be downloaded.",
        ...tryAnother,
        tone: "info",
      };
    case "blocked_by_rights_holder":
      return {
        title: "Unavailable at the owner's request",
        description: "The rights holder asked us not to offer this content.",
        ...tryAnother,
        tone: "info",
        link: { href: "/copyright", label: "Learn about our copyright policy" },
      };
    case "live_not_supported":
      return {
        title: "Live streams can't be downloaded",
        description:
          "This is a live stream or an upcoming premiere. VidNabbit can only download media that has finished and is available to replay.",
        ...tryAnother,
        tone: "info",
      };
    case "too_long": {
      const duration = formatDurationLong(ctx.durationSeconds ?? null);
      return {
        title: "This one is too long",
        description: `We support media up to 3 hours.${duration ? ` This is ${duration}.` : ""}`,
        ...tryAnother,
        tone: "warning",
      };
    }
    case "too_large":
      return ctx.phase === "job"
        ? {
            title: "This file is too big",
            description: "Files are limited to 4 GB. Try a lower quality.",
            actionLabel: "Choose another format",
            action: "choose-format",
            tone: "warning",
          }
        : {
            title: "This file is too big",
            description: "Files are limited to 4 GB.",
            ...tryAnother,
            tone: "warning",
          };
    case "rate_limited": {
      const n = ctx.retryAfterSeconds ?? 60;
      return {
        title: "You're going a bit fast",
        description: `Please wait ${n} seconds and try again. This keeps the service free for everyone.`,
        actionLabel: "Try again",
        action: "retry",
        tone: "warning",
      };
    }
    case "challenge_required":
      return {
        title: "Quick check needed",
        description: "Please complete the check to continue.",
        actionLabel: "Try the check again",
        action: "retry",
        tone: "warning",
      };
    case "upstream_error":
      return {
        title: site ? `${site} didn't respond properly` : "The site didn't respond properly",
        description: "This is usually temporary. Try again in a minute.",
        actionLabel: "Try again",
        action: "retry",
        tone: "danger",
      };
    case "not_found":
      return {
        title: "This download has expired",
        description: "Files and links are deleted after 1 hour.",
        actionLabel: "Start again",
        action: "restart",
        tone: "warning",
      };
    case "network_error":
      return {
        title: "You're offline",
        description: "We couldn't reach VidNabbit. Check your connection and try again.",
        actionLabel: "Try again",
        action: "retry",
        tone: "danger",
      };
    case "timeout":
      return {
        title: "This is taking too long",
        description: "The file still isn't ready. Try again, or pick a lower quality.",
        actionLabel: "Try again",
        action: "retry",
        tone: "warning",
      };
    case "internal":
    default:
      return {
        title: "Something went wrong on our side",
        description: "It's not you. Please try again.",
        actionLabel: "Try again",
        action: "retry",
        tone: "danger",
      };
  }
}
