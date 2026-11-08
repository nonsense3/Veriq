import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/scanner/src/app";
import { LocalStore, postgrestEq } from "../apps/scanner/src/store";
import { signatureAlgorithmOf } from "../apps/scanner/src/inspect/tls-probe";
import { assessMessage } from "../packages/analysis/src/assess";
import { newNonce, registryKeyFor } from "../packages/analysis/src/integrity";
import { EMPTY_RECEIPT } from "../apps/scanner/src/registry";

const app = createApp(new LocalStore(mkdtempSync(join(tmpdir(), "veriq-test-"))));
const investigate = (body: unknown) => app.request("/v1/investigations", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("scanner safe URL inspection boundary", () => {
  it("mounts the health router on the running scanner app", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ok", service: "veriq-scanner" });
  });
  it("refuses loopback, private and metadata destinations before connecting", async () => {
    for (const target of ["http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://2130706433/", "http://[::ffff:127.0.0.1]/"]) {
      const response = await investigate({ kind: "url", target });
      expect(response.status, target).toBe(422);
      expect(await response.json()).toMatchObject({ code: "DESTINATION_BLOCKED" });
    }
  });
  it("refuses non-public names and disallowed ports", async () => {
    expect((await investigate({ kind: "url", target: "http://localhost/" })).status).toBe(422);
    const port = await investigate({ kind: "url", target: "http://example.com:22/" });
    expect(port.status).toBe(422);
    expect(await port.json()).toMatchObject({ code: "DESTINATION_BLOCKED" });
  });
  it("rejects alternate schemes and malformed bodies", async () => {
    expect((await investigate({ kind: "url", target: "javascript:alert(1)" })).status).toBe(400);
    const malformed = await app.request("/v1/investigations", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } });
    expect(malformed.status).toBe(400);
  });
  it("returns 404 for unknown or malformed report identifiers", async () => {
    expect((await app.request("/v1/investigations/not-a-uuid")).status).toBe(404);
    expect((await app.request("/v1/investigations/00000000-0000-4000-8000-000000000000/bundle")).status).toBe(404);
  });
});

describe("certificate parsing", () => {
  it("reads the outer signature algorithm OID from DER", () => {
    // Minimal Certificate: SEQUENCE { SEQUENCE {} , SEQUENCE { OID 1.2.840.113549.1.1.5 } }
    const der = Buffer.from("30 11 30 00 30 0d 06 09 2a 86 48 86 f7 0d 01 01 05 05 00".replace(/ /g, ""), "hex");
    expect(signatureAlgorithmOf(der)).toBe("sha1WithRSAEncryption");
  });
});

describe("owned report privacy boundary", () => {
  it("rejects signed-out report reads, bundle export and registration, even when a report was published", async () => {
    const store = new LocalStore(mkdtempSync(join(tmpdir(), "veriq-private-test-")));
    const reportId = "00000000-0000-4000-8000-000000000099";
    await store.save({ report: assessMessage({ reportId, createdAt: new Date().toISOString(), text: "Your meeting begins tomorrow." }), nonce: newNonce(), registryKey: registryKeyFor(reportId), registry: { ...EMPTY_RECEIPT }, published: true, note: null, keys: [], shingles: [], statements: [], ownerId: "private-owner" });
    const privateApp = createApp(store);
    for (const [suffix, method] of [["", "GET"], ["/bundle", "GET"], ["/registration", "GET"], ["/register", "POST"]]) {
      const result = await privateApp.request(`/v1/investigations/${reportId}${suffix}`, { method });
      expect(result.status).toBe(401);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });

  it("does not silently downgrade an unverifiable signed-in submission to anonymous storage", async () => {
    const result = await app.request("/v1/investigations", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer invalid-session" }, body: JSON.stringify({ kind: "message", text: "A private appointment reminder for tomorrow." }) });
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects malformed wallet transaction hashes before reaching the chain", async () => {
    const store = new LocalStore(mkdtempSync(join(tmpdir(), "veriq-wallet-input-")));
    const reportId = "00000000-0000-4000-8000-000000000077";
    await store.save({ report: assessMessage({ reportId, createdAt: new Date().toISOString(), text: "Your meeting begins tomorrow." }), nonce: newNonce(), registryKey: registryKeyFor(reportId), registry: { ...EMPTY_RECEIPT }, published: false, note: null, keys: [], shingles: [], statements: [], ownerId: null });
    const walletApp = createApp(store);
    const malformed = await walletApp.request(`/v1/investigations/${reportId}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionHash: "not-a-transaction" }) });
    expect(malformed.status).toBe(400);
    const relay = await walletApp.request(`/v1/investigations/${reportId}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publishToRepository: false }) });
    expect(relay.status).toBe(401);
    expect((await store.get(reportId))?.registry.status).toBe("unregistered");
  });

  it("refuses repository publication and statements without a signed-in owner", async () => {
    const store = new LocalStore(mkdtempSync(join(tmpdir(), "veriq-publish-test-")));
    const reportId = "00000000-0000-4000-8000-000000000088";
    const registryKey = registryKeyFor(reportId);
    await store.save({ report: assessMessage({ reportId, createdAt: new Date().toISOString(), text: "Your meeting begins tomorrow." }), nonce: newNonce(), registryKey, registry: { ...EMPTY_RECEIPT }, published: false, note: null, keys: [], shingles: [], statements: [], ownerId: null });
    const privateApp = createApp(store);
    const publish = await privateApp.request(`/v1/investigations/${reportId}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publishToRepository: true }) });
    expect(publish.status).toBe(401);
    expect(await publish.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((await store.get(reportId))?.published).toBe(false);
    const statement = await privateApp.request(`/v1/repository/${registryKey}/statements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "validate", note: "I checked this." }) });
    expect(statement.status).toBe(401);
    expect(() => postgrestEq("owner_id", "1&published=eq.true")).toThrow(/unsafe/);
    expect(postgrestEq("report_id", reportId)).toBe(`report_id=eq.${reportId}`);
  });
});
