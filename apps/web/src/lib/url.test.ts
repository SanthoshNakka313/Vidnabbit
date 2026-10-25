import { describe, expect, it } from "vitest";
import { MAX_URL_LENGTH, validateUrl } from "./url";

describe("validateUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc"],
    ["http://example.com/video", "http://example.com/video"],
    ["  https://example.com/a  ", "https://example.com/a"],
    ["vimeo.com/123", "https://vimeo.com/123"],
    ["example.com:8080/x", "https://example.com:8080/x"],
    ["HTTPS://EXAMPLE.COM/Path", "https://example.com/Path"],
    ["https://bücher.example/clip", "https://xn--bcher-kva.example/clip"],
  ])("accepts %s", (input, expected) => {
    expect(validateUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["not a url", "malformed"],
    ["https://exa mple.com", "malformed"],
    ["ftp://example.com/file", "unsupported_scheme"],
    ["javascript:alert(1)", "unsupported_scheme"],
    ["file:///etc/passwd", "unsupported_scheme"],
    ["data:text/html,hi", "unsupported_scheme"],
    ["https://user:pass@example.com/v", "credentials"],
    ["http://localhost:8000/v1", "private_host"],
    ["http://127.0.0.1/", "private_host"],
    ["http://10.1.2.3/", "private_host"],
    ["http://192.168.0.1/", "private_host"],
    ["http://172.16.5.4/", "private_host"],
    ["http://169.254.169.254/latest/meta-data", "private_host"],
    ["http://100.64.0.1/", "private_host"],
    ["http://0x7f.0.0.1/", "private_host"],
    ["http://[::1]/", "private_host"],
    ["http://[fd00::1]/", "private_host"],
    ["http://printer.local/", "private_host"],
    ["https://intranet/", "no_host"],
    ["https://a..b.com/", "malformed"],
  ])("rejects %j as %s", (input, error) => {
    const r = validateUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(error);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects over-long URLs", () => {
    const r = validateUrl(`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`);
    expect(r).toMatchObject({ ok: false, error: "too_long" });
  });

  it("allows public IP addresses", () => {
    expect(validateUrl("http://93.184.216.34/v")).toMatchObject({ ok: true });
  });
});
