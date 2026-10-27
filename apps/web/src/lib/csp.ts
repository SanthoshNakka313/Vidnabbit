import { DEFAULT_API_URL } from "./config";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Returns the origin of the API URL, or the default origin if it is invalid. */
export function apiOrigin(apiUrl: string | undefined): string {
  try {
    return new URL(apiUrl || DEFAULT_API_URL).origin;
  } catch {
    return new URL(DEFAULT_API_URL).origin;
  }
}

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  apiUrl?: string;
}

/**
 * Builds the CSP header value.
 * - Scripts: nonce + 'strict-dynamic' (Turnstile's script is injected by our
 *   trusted bundle, so it inherits trust). The Cloudflare host is also listed
 *   for browsers that don't support 'strict-dynamic'.
 * - img-src https: allows remote thumbnails rendered with plain <img>.
 * - connect-src allows the API origin only.
 * - worker-src 'self': PDF.js renders PDFs in a worker served from /vendor/pdfjs.
 */
export function buildCsp({ nonce, isDev, apiUrl }: CspOptions): string {
  const api = apiOrigin(apiUrl);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      TURNSTILE_ORIGIN,
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:", "https:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", api, TURNSTILE_ORIGIN],
    "frame-src": [TURNSTILE_ORIGIN],
    "media-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  // Only upgrade in production: local dev talks to http://localhost:8000.
  if (!isDev && api.startsWith("https:")) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
