import { describe, expect, it } from "vitest";
import { createMockApi, mockExtractErrorFor, mockExtractNeedsChallenge } from "./mock-api";
import { API_ERROR_CODES } from "./api-types";

describe("mock API", () => {
  it.each(API_ERROR_CODES.filter((c) => c !== "challenge_required"))(
    "can produce %s from extract",
    async (code) => {
      const api = createMockApi({ latencyMs: 0 });
      await expect(api.extract({ url: `https://example.com/v?mock=${code}` })).rejects.toMatchObject({
        code,
      });
    },
  );

  it("refuses DRM-only hosts and keyword paths", () => {
    expect(mockExtractErrorFor("https://www.netflix.com/watch/1")).toBe("drm_protected");
    expect(mockExtractErrorFor("https://example.com/private/v")).toBe("private_content");
    expect(mockExtractErrorFor("https://example.com/live/now")).toBe("live_not_supported");
    expect(mockExtractErrorFor("https://example.com/watch?v=1")).toBeNull();
  });

  it("requires a token on extract for the challenge scenario", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const url = "https://example.com/v?mock=extract_challenge";
    expect(mockExtractNeedsChallenge(url)).toBe(true);
    await expect(api.extract({ url })).rejects.toMatchObject({ code: "challenge_required" });
    await expect(api.extract({ url, turnstile_token: "t" })).resolves.toMatchObject({
      media_type: "video",
    });
  });

  it("runs a job from queued to done", async () => {
    let now = 0;
    const api = createMockApi({ latencyMs: 0, jobDurationMs: 1000, now: () => now });
    const data = await api.extract({ url: "https://example.com/watch" });
    const { job_id } = await api.createJob({
      extract_id: data.id,
      format_id: data.formats[0].format_id,
      turnstile_token: "t",
    });
    expect((await api.getJob(job_id)).status).toBe("queued");
    now = 500;
    expect(await api.getJob(job_id)).toMatchObject({ status: "running", progress: 0.5 });
    now = 1000;
    const done = await api.getJob(job_id);
    expect(done.status).toBe("done");
    expect(done.download_url).toMatch(/\/mock\/vidnabbit-sample\.txt$/);
    expect(done.filename).toMatch(/\.mp4$/);
  });

  it("rejects jobs without a token or for unknown extracts", async () => {
    const api = createMockApi({ latencyMs: 0 });
    await expect(
      api.createJob({ extract_id: "nope", format_id: "x", turnstile_token: "t" }),
    ).rejects.toMatchObject({ code: "not_found" });
    const data = await api.extract({ url: "https://example.com/watch" });
    await expect(
      api.createJob({ extract_id: data.id, format_id: data.formats[0].format_id, turnstile_token: "" }),
    ).rejects.toMatchObject({ code: "challenge_required" });
  });
});
