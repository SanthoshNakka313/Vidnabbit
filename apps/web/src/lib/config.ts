/**
 * Public runtime configuration. Only NEXT_PUBLIC_* values are available in the
 * browser; they are inlined at build time. Never put secrets here.
 */
export const DEFAULT_API_URL = "http://localhost:8000";
/** Cloudflare's always-passes test sitekey. Replace via env in production. */
export const TEST_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL
).replace(/\/+$/, "");

export const API_MOCK = process.env.NEXT_PUBLIC_API_MOCK === "1";

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TEST_TURNSTILE_SITE_KEY;

export const SITE_NAME = "VidNabbit";
