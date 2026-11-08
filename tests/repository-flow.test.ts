import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessMessage } from "../packages/analysis/src/assess";
import { newNonce, registryKeyFor } from "../packages/analysis/src/integrity";
import { repositoryDetailSchema } from "../packages/contracts/src/index";
import { createApp } from "../apps/scanner/src/app";
import { LocalStore, SupabaseStore, publicStatements, type StoredReport } from "../apps/scanner/src/store";
import { EMPTY_RECEIPT, registerCommitment } from "../apps/scanner/src/registry";
import { userFromAuthorization } from "../apps/scanner/src/auth";

vi.mock("../apps/scanner/src/auth", () => ({ authConfigured: () => true, bearer: () => null, supabaseAsUser: vi.fn(), userFromAuthorization: vi.fn() }));
vi.mock("../apps/scanner/src/ai/explain", () => ({ aiEnabled: () => false, reviewPublication: async () => ({ available: false, authentic: false, important: false, reason: "Model unavailable." }) }));
vi.mock("../apps/scanner/src/registry", async (original) => ({ ...await original<typeof import("../apps/scanner/src/registry")>(), registerCommitment: vi.fn() }));

const reportId = "00000000-0000-4000-8000-000000000099";
const key = registryKeyFor(reportId);
const hash = `0x${"a".repeat(64)}`;
beforeEach(() => { vi.mocked(userFromAuthorization).mockResolvedValue({ id: "owner", email: null }); vi.mocked(registerCommitment).mockClear(); });
async function fixture(published = false) {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), "veriq-repository-")));
  const record: StoredReport = { report: assessMessage({ reportId, createdAt: "2026-11-08T00:00:00Z", text: "Pay a processing fee now to claim your guaranteed prize. Send your OTP to https://example.test/private?token=secret-token" }), ownerId: "owner", nonce: newNonce(), registryKey: key, registry: { ...EMPTY_RECEIPT, status: "confirmed", registryKey: key, transactionHash: hash, chainId: 11155111 }, published, note: null, keys: [], shingles: [], statements: [] };
  record.report.findings[0]!.evidence = [{ label: "private", value: "private-evidence-secret" }];
  record.report.findings[0]!.description = "Observed https://example.test/private?token=secret-token and person@example.test";
  await store.save(record);
  return { store, record, app: createApp(store) };
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer mock" }, body: JSON.stringify(body) });

describe("sealed report publishing and community details", () => {
  it("requires the signed-in owner for publication even when already sealed", async () => {
    const { app, store } = await fixture();
    const path = `/v1/investigations/${reportId}/register`;
    vi.mocked(userFromAuthorization).mockResolvedValue(null);
    expect((await app.request(path, post({ publishToRepository: true, confirmPublication: true }))).status).toBe(401);
    vi.mocked(userFromAuthorization).mockResolvedValue({ id: "someone-else", email: null });
    expect((await app.request(path, post({ publishToRepository: true, confirmPublication: true }))).status).toBe(404);
    expect((await store.get(reportId))?.published).toBe(false);
  });
  it("lets only the owner remove a submission while retaining its private report and chain receipt", async () => {
    const { app, store } = await fixture(true);
    const path = `/v1/investigations/${reportId}/publication`;
    vi.mocked(userFromAuthorization).mockResolvedValue(null);
    expect((await app.request(path, { method: "DELETE" })).status).toBe(401);
    vi.mocked(userFromAuthorization).mockResolvedValue({ id: "someone-else", email: null });
    expect((await app.request(path, { method: "DELETE" })).status).toBe(404);
    expect((await store.get(reportId))?.published).toBe(true);
    vi.mocked(userFromAuthorization).mockResolvedValue({ id: "owner", email: null });
    const result = await app.request(path, { method: "DELETE" });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ publishedToRepository: false, registry: { status: "confirmed", transactionHash: hash } });
    expect((await store.get(reportId))?.report.reportId).toBe(reportId);
    expect((await app.request(`/v1/repository/${key}`)).status).toBe(404);
    expect(await (await app.request('/v1/repository')).json()).toMatchObject({ entries: [], clusters: [] });
    expect((await app.request(path, { method: "DELETE" })).status).toBe(200);
  });
  it("deletes the Supabase public projection by key and surfaces cleanup failures", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const store = new SupabaseStore("https://supabase.invalid", "sb_secret_test_only");
      await store.removePublication(key);
      expect(request).toHaveBeenCalledWith(`https://supabase.invalid/rest/v1/repository_entries?public_id=eq.${key}`, expect.objectContaining({ method: "DELETE" }));
      request.mockResolvedValue(new Response("Unavailable", { status: 503 }));
      await expect(store.removePublication(key)).rejects.toThrow("HTTP 503");
    } finally { request.mockRestore(); }
  });
  it("allows retry instead of claiming success when projection cleanup fails", async () => {
    const { app, store } = await fixture(true);
    const cleanup = vi.spyOn(store, "removePublication").mockRejectedValueOnce(new Error("Projection unavailable"));
    const path = `/v1/investigations/${reportId}/publication`;
    expect((await app.request(path, { method: "DELETE" })).status).toBe(500);
    expect((await app.request(path, { method: "DELETE" })).status).toBe(200);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("shares an already confirmed seal after consent without signing another transaction", async () => {
    const { app, store } = await fixture();
    const request = `/v1/investigations/${reportId}/register`;
    expect((await app.request(request, post({ publishToRepository: true }))).status).toBe(409);
    expect((await store.get(reportId))?.registry.transactionHash).toBe(hash);
    const result = await app.request(request, post({ publishToRepository: true, confirmPublication: true }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ registry: { status: "confirmed", transactionHash: hash }, publishedToRepository: true });
    expect(registerCommitment).not.toHaveBeenCalled();
  });
  it("never exposes a private incident, even to its owner through the public endpoint", async () => {
    const { app } = await fixture();
    expect((await app.request(`/v1/repository/${key}`)).status).toBe(404);
  });
  it("returns useful public findings without private evidence, report IDs, nonces or URL tokens", async () => {
    const { app, record } = await fixture(true);
    const result = await app.request(`/v1/repository/${key}`);
    const body = await result.json();
    expect(repositoryDetailSchema.safeParse(body).success).toBe(true);
    expect(body.findings.length).toBeGreaterThan(0);
    const text = JSON.stringify(body);
    for (const secret of [record.nonce, reportId, "secret-token", "private-evidence-secret", "person@example.test"]) expect(text).not.toContain(secret);
    expect(text).toContain("[link redacted]");
  });
  it("keeps one current community vote and public reason per account without a relayer key", async () => {
    const { app, store } = await fixture(true);
    const path = `/v1/repository/${key}/statements`;
    await app.request(path, post({ kind: "validate", note: "I checked the claimed domain." }));
    const result = await app.request(path, post({ kind: "dispute", note: "The organisation lists this as its official domain." }));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.statements).toHaveLength(1);
    expect(body.statements[0]).toMatchObject({ kind: "dispute", status: "unregistered", transactionHash: null });
    expect(JSON.stringify(body)).not.toContain("authorId");
    expect((await store.get(reportId))?.statements).toHaveLength(2);
    await app.request(path, post({ kind: "dispute", note: "The organisation lists this as its official domain." }));
    expect((await store.get(reportId))?.statements).toHaveLength(2);
  });
  it("rejects signed-out feedback and excludes failed blockchain attempts from votes", async () => {
    const { app } = await fixture(true);
    vi.mocked(userFromAuthorization).mockResolvedValue(null);
    expect((await app.request(`/v1/repository/${key}/statements`, post({ kind: "validate", note: "I agree." }))).status).toBe(401);
    expect(publicStatements([{ kind: "validate", note: "Failed", status: "failed", statementHash: hash, transactionHash: null, createdAt: "2026-11-08" }])).toEqual([]);
  });
});
