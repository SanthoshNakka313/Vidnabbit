import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "./api-types";
import { friendlyError } from "./error-messages";

describe("friendlyError", () => {
  it.each([...API_ERROR_CODES, "network_error", "timeout"] as const)(
    "has a title, description and next step for %s",
    (code) => {
      const e = friendlyError(code);
      expect(e.title).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.actionLabel).toBeTruthy();
    },
  );

  it("interpolates the site and drops the clause when missing", () => {
    expect(friendlyError("drm_protected", { site: "Netflix" }).description).toContain("Netflix protects");
    expect(friendlyError("drm_protected").description).toContain("This content protects");
  });

  it("uses Retry-After for rate limits", () => {
    expect(friendlyError("rate_limited", { retryAfterSeconds: 12 }).description).toContain("12 seconds");
  });

  it("offers a lower quality for too_large during a job", () => {
    expect(friendlyError("too_large", { phase: "job" }).action).toBe("choose-format");
  });
});
