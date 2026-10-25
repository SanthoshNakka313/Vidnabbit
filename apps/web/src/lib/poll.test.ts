import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-error";
import type { JobResponse } from "./api-types";
import { jobFixtures } from "./mock-fixtures";
import { backoffDelay, pollJob } from "./poll";

function fakeApi(responses: (JobResponse | ApiError)[]) {
  const getJob = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof ApiError) throw next;
    return next;
  });
  return { getJob };
}

const noSleep = vi.fn(async () => {});

describe("backoffDelay", () => {
  it("grows exponentially and caps", () => {
    expect(backoffDelay(0, 1000, 1.25, 3000)).toBe(1000);
    expect(backoffDelay(1, 1000, 1.25, 3000)).toBe(1250);
    expect(backoffDelay(10, 1000, 1.25, 3000)).toBe(3000);
  });
});

describe("pollJob", () => {
  it("reports progress and resolves when done", async () => {
    const api = fakeApi([
      jobFixtures.queued(),
      jobFixtures.running(0.5),
      jobFixtures.done("f.mp4", "https://dl/f"),
    ]);
    const updates: number[] = [];
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const job = await pollJob(api, "j", { sleep, onUpdate: (j) => updates.push(j.progress) });
    expect(job.download_url).toBe("https://dl/f");
    expect(updates).toEqual([0, 0.5, 1]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 750, 1125]);
  });

  it("throws the job's own error code when it fails", async () => {
    const api = fakeApi([jobFixtures.running(0.2), jobFixtures.failed("too_large")]);
    await expect(pollJob(api, "j", { sleep: noSleep })).rejects.toMatchObject({ code: "too_large" });
  });

  it("retries transient errors, honouring Retry-After", async () => {
    const api = fakeApi([
      new ApiError("network_error", "x"),
      new ApiError("rate_limited", "slow", 429, 7),
      jobFixtures.done("f", "u"),
    ]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await expect(pollJob(api, "j", { sleep })).resolves.toMatchObject({ status: "done" });
    expect(sleep.mock.calls.map((c) => c[0])).toContain(7000);
  });

  it("gives up after too many transient errors", async () => {
    const errs = Array.from({ length: 6 }, () => new ApiError("network_error", "x"));
    await expect(
      pollJob(fakeApi(errs), "j", { sleep: noSleep, maxTransientErrors: 2 }),
    ).rejects.toMatchObject({ code: "network_error" });
  });

  it("does not retry not_found", async () => {
    const api = fakeApi([new ApiError("not_found", "gone", 404)]);
    await expect(pollJob(api, "j", { sleep: noSleep })).rejects.toMatchObject({ code: "not_found" });
    expect(api.getJob).toHaveBeenCalledTimes(1);
  });

  it("times out", async () => {
    let t = 0;
    const api = fakeApi(Array.from({ length: 5 }, () => jobFixtures.running(0.1)));
    await expect(
      pollJob(api, "j", { sleep: noSleep, timeoutMs: 1000, now: () => (t += 600) }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
