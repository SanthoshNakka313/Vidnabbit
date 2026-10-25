/**
 * Client-side URL validation. This is a usability check only: the API does
 * the authoritative validation and SSRF protection.
 */
export const MAX_URL_LENGTH = 2048;

export type UrlValidationError =
  | "empty"
  | "too_long"
  | "malformed"
  | "unsupported_scheme"
  | "no_host"
  | "credentials"
  | "private_host";

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: UrlValidationError; message: string };

export const URL_ERROR_MESSAGES: Record<UrlValidationError, string> = {
  empty: "Paste a link to a public page first.",
  too_long: "That link is too long. Copy the page address again and paste it.",
  malformed: "That doesn't look like a web address. It should look like https://example.com/video.",
  unsupported_scheme: "Only links starting with http:// or https:// are supported.",
  no_host: "That link is missing a website name, like example.com.",
  credentials: "Links that contain a username or password are not supported. Use the public link.",
  private_host: "That link points to a private or local network address. Only public websites are supported.",
};

function fail(error: UrlValidationError): UrlValidationResult {
  return { ok: false, error, message: URL_ERROR_MESSAGES[error] };
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.includes(":")) {
    // IPv6 literal: loopback, unspecified, unique-local, link-local, mapped.
    return (
      h === "::1" ||
      h === "::" ||
      /^f[cd][0-9a-f]{2}:/.test(h) ||
      /^fe[89ab][0-9a-f]:/.test(h) ||
      h.startsWith("::ffff:")
    );
  }
  return false;
}

/**
 * Validates and normalises user input. Adds https:// when the scheme is
 * missing (e.g. "youtube.com/watch?v=x").
 */
export function validateUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return fail("empty");
  if (trimmed.length > MAX_URL_LENGTH) return fail("too_long");
  if (/\s/.test(trimmed)) return fail("malformed");

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  // "example.com:8080/x" looks like a scheme; treat host:port as schemeless.
  const looksLikeHostPort = /^[^/:]+\.[^/:]+:\d+/.test(trimmed);
  const candidate = hasScheme && !looksLikeHostPort ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("malformed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("unsupported_scheme");
  }
  if (!url.hostname) return fail("no_host");
  if (url.username || url.password) return fail("credentials");
  if (isPrivateHost(url.hostname)) return fail("private_host");
  const isIpv6 = url.hostname.startsWith("[");
  if (!isIpv6 && !url.hostname.includes(".")) return fail("no_host");
  if (!isIpv6 && /^\.|\.\./.test(url.hostname)) return fail("malformed");
  return { ok: true, url: url.toString() };
}
