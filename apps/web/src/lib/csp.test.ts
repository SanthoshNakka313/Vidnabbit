import { describe, expect, it } from "vitest";
import { apiOrigin, buildCsp } from "./csp";

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc", isDev: false, apiUrl: "https://api.vidnabbit.test/x" });

  it("uses a nonce with strict-dynamic and no unsafe-eval in production", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("style-src 'self' 'nonce-abc'");
  });

  it("allows the API origin, Turnstile frames and https images", () => {
    expect(prod).toContain("connect-src 'self' https://api.vidnabbit.test https://challenges.cloudflare.com");
    expect(prod).toContain("frame-src 'self' https://challenges.cloudflare.com");
    expect(prod).toContain("img-src 'self' blob: data: https:");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("only allows same-origin workers (PDF.js)", () => {
    expect(prod).toContain("worker-src 'self';");
  });

  it("does not upgrade requests to an http API (local)", () => {
    expect(buildCsp({ nonce: "n", isDev: false, apiUrl: "http://localhost:8000" })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("falls back to the default API origin", () => {
    expect(apiOrigin(undefined)).toBe("http://localhost:8000");
    expect(apiOrigin("not a url")).toBe("http://localhost:8000");
  });
});
