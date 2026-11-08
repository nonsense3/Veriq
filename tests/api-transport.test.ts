import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../apps/web/src/lib/api-transport";
import gateway from "../apps/api/src/index";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded frontend requests", () => {
  it("stops an indefinitely stalled fetch", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const result = requestJson("/v1/me/investigations", { getToken: async () => "session", timeoutMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ error: { code: "REQUEST_TIMEOUT" } });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetcher.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
  });

  it("does not send a private request if the session arrives after timeout", async () => {
    vi.useFakeTimers();
    let finish!: (token: string) => void;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = requestJson("/v1/me/investigations", { getToken: () => new Promise(resolve => { finish = resolve; }), timeoutMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ error: { code: "REQUEST_TIMEOUT" } });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    finish("late-session");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("also bounds a stalled JSON response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) })));
    const result = requestJson("/v1/me/investigations", { getToken: async () => null, timeoutMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ error: { code: "REQUEST_TIMEOUT" } });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("keeps authentication and preserves structured service errors", async () => {
    const error = { code: "SCANNER_UNAVAILABLE", title: "Service unavailable", message: "Please retry.", retryable: true, correlationId: "test" };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(error), { status: 502, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("/v1/report", { getToken: async () => "test-session" })).rejects.toMatchObject({ error });
    expect(fetcher.mock.calls[0]?.[1]?.headers.authorization).toBe("Bearer test-session");
  });
});

describe("gateway upstream errors", () => {
  it("turns a hosting HTML error into a retryable service error instead of a report body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Host unavailable</html>", { status: 503, headers: { "content-type": "text/html" } })));
    const response = await gateway.fetch(new Request("https://veriq.test/v1/config"), { SCANNER_ORIGIN: "https://scanner.test" });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "SCANNER_UNAVAILABLE", retryable: true });
  });
});
