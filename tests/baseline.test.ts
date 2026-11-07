import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { investigationRequestSchema } from "../packages/contracts/src/index";

const env = { ALLOWED_ORIGIN: "http://localhost:3000" };
const post = (path: string, body: string) => app.request(path, { method: "POST", body, headers: { "Content-Type": "application/json" } }, env);

describe("intake contract", () => {
  it("accepts URL, bare-domain and message submissions", () => {
    expect(investigationRequestSchema.safeParse({ kind: "url", target: "https://example.com/login" }).success).toBe(true);
    expect(investigationRequestSchema.safeParse({ kind: "url", target: "example.com" }).success).toBe(true);
    expect(investigationRequestSchema.safeParse({ kind: "message", text: "Your parcel is held, pay the fee now." }).success).toBe(true);
  });

  it("rejects empty, oversized and unknown submissions", () => {
    expect(investigationRequestSchema.safeParse({ kind: "url", target: "" }).success).toBe(false);
    expect(investigationRequestSchema.safeParse({ kind: "url", target: `https://example.com/${"a".repeat(2100)}` }).success).toBe(false);
    expect(investigationRequestSchema.safeParse({ kind: "message", text: "hi" }).success).toBe(false);
    expect(investigationRequestSchema.safeParse({ kind: "file", data: "x" }).success).toBe(false);
  });
});

describe("Cloudflare API gateway", () => {
  it("validates input before forwarding", async () => {
    const response = await post("/v1/investigations", JSON.stringify({ kind: "url", target: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("returns a structured error for malformed JSON", async () => {
    const response = await post("/v1/investigations", "{");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("does not pretend a scanner exists when none is connected", async () => {
    const response = await post("/v1/investigations", JSON.stringify({ kind: "url", target: "https://example.com" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SCANNER_NOT_CONFIGURED", retryable: true });
  });

  it("only exposes the allow-listed routes", async () => {
    const response = await app.request("/v1/admin/everything", { method: "GET" }, env);
    expect(response.status).toBe(404);
  });

  it("refuses cross-origin requests from unknown origins", async () => {
    const response = await app.request("/v1/config", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } }, env);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("returns only the public Supabase settings from the Worker variables", async () => {
    const response = await app.request("/v1/public-config", { method: "GET" }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "eyJpublic", SUPABASE_SECRET_KEY: "sb_secret_hidden" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ supabaseUrl: "https://example.supabase.co", supabaseKey: "eyJpublic" });
  });

  it("allows the worker's own origin and any origin named in ALLOWED_ORIGINS", async () => {
    const own = await app.request("https://cards.example/v1/config", { method: "OPTIONS", headers: { Origin: "https://cards.example", "Access-Control-Request-Method": "GET" } }, {});
    expect(own.headers.get("access-control-allow-origin")).toBe("https://cards.example");
    const listed = await app.request("https://cards.example/v1/config", { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET" } }, { ALLOWED_ORIGINS: "http://localhost:3000, https://preview.example" });
    expect(listed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
