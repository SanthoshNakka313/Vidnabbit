import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, errorFromResponse, isApiError } from "./api";
import { API_ERROR_CODES, type ContractErrorCode } from "./api-types";
import { errorFixtures, videoExtractFixture, jobFixtures } from "./mock-fixtures";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function setup(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    typeof response === "function" ? response() : response,
  );
  const client = createApiClient({ baseUrl: "https://api.test/", fetch: fetchMock });
  return { client, fetchMock };
}

describe("createApiClient", () => {
  it("POSTs /v1/extract with JSON and no credentials", async () => {
    const fixture = videoExtractFixture("https://example.com/v");
    const { client, fetchMock } = setup(jsonResponse(fixture));
    await expect(client.extract({ url: "https://example.com/v" })).resolves.toEqual(fixture);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/v1/extract");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://example.com/v" });
  });

  it("sends the optional turnstile_token on extract only when given", async () => {
    const { client, fetchMock } = setup(jsonResponse(videoExtractFixture("https://e.com/v")));
    await client.extract({ url: "https://e.com/v", turnstile_token: "tok" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      url: "https://e.com/v",
      turnstile_token: "tok",
    });
  });

  it("creates a job and reads the 202 body", async () => {
    const { client, fetchMock } = setup(jsonResponse({ job_id: "j1" }, 202));
    const req = { extract_id: "e1", format_id: "f1", turnstile_token: "t" };
    await expect(client.createJob(req)).resolves.toEqual({ job_id: "j1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/v1/jobs");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(req);
  });

  it("GETs a job with an encoded id", async () => {
    const job = jobFixtures.running(0.5);
    const { client, fetchMock } = setup(jsonResponse(job));
    await expect(client.getJob("a/b c")).resolves.toEqual(job);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/v1/jobs/a%2Fb%20c");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("accepts an empty 202 from takedown", async () => {
    const { client, fetchMock } = setup(new Response(null, { status: 202 }));
    await expect(
      client.takedown({
        urls: ["https://e.com/v"],
        name: "A",
        email: "a@b.co",
        statement_good_faith: true,
        statement_accuracy: true,
        signature: "A",
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/v1/takedown");
  });

  it.each(API_ERROR_CODES)("maps the %s error envelope to a typed ApiError", async (code) => {
    const f = errorFixtures[code as ContractErrorCode];
    const { client } = setup(jsonResponse(f.body, f.status));
    const err = await client.extract({ url: "https://e.com" }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ code, status: f.status, message: f.body.error.message });
  });

  it("reads Retry-After seconds on rate limits", async () => {
    const { client } = setup(
      jsonResponse(errorFixtures.rate_limited.body, 429, { "Retry-After": "42" }),
    );
    const err = (await client.extract({ url: "https://e.com" }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfterSeconds).toBe(42);
  });

  it("maps network failures to network_error", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(client.health()).rejects.toMatchObject({ code: "network_error", status: 0 });
  });

  it("rethrows aborts untouched", async () => {
    const { client } = setup(() => Promise.reject(new DOMException("Aborted", "AbortError")));
    await expect(client.health()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports an unreadable success body as internal", async () => {
    const { client } = setup(new Response("<html>", { status: 200 }));
    await expect(client.health()).rejects.toMatchObject({ code: "internal" });
  });
});

describe("errorFromResponse", () => {
  it.each([
    [400, "invalid_url"],
    [404, "not_found"],
    [429, "rate_limited"],
    [502, "upstream_error"],
    [500, "internal"],
  ])("falls back to a status-derived code for non-JSON %i", async (status, code) => {
    const err = await errorFromResponse(new Response("oops", { status }));
    expect(err.code).toBe(code);
  });

  it("ignores unknown codes from the server", async () => {
    const err = await errorFromResponse(
      jsonResponse({ error: { code: "made_up", message: "x" } }, 500),
    );
    expect(err.code).toBe("internal");
    expect(err.message).toBe("x");
  });
});
