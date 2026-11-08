import { buildClusters, computeCommitment, statementHashFor, ZERO_BYTES32 } from "@veriq/analysis";
import {
  investigationRequestSchema,
  registerRequestSchema,
  statementRequestSchema,
  REPORT_SCHEMA_VERSION,
  type InvestigationResponse,
  type MyInvestigationsResponse,
  type RepositoryEntry,
  type ServiceConfig,
  type VerificationBundle,
} from "@veriq/contracts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Hex } from "viem";
import { aiEnabled, reviewPublication } from "./ai/explain";
import { authConfigured, bearer, supabaseAsUser, userFromAuthorization } from "./auth";
import { config } from "./config";
import { createHealthRouter } from "./routes/health";
import { AppError } from "./errors";
import { intelProviderStatus } from "./intel/providers";
import { investigateMessage, investigateUrl } from "./pipeline";
import { confirmWalletCommitment, registerCommitment, registryState } from "./registry";
import { registryRelayerStatus } from "./registry-key";
import { correlationRecords, createStore, postgrestEq, publicStatements, publicSummary, publicText, type Store, type StoredReport } from "./store";

type Env = { Variables: { correlationId: string } };

/** Fixed-window limiter keyed by client address and action. Adequate for a single-instance prototype. */
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): { ok: boolean; retryAfter: number } => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) for (const [id, value] of hits) if (value.resetAt <= now) hits.delete(id);
      return { ok: true, retryAfter: 0 };
    }
    entry.count += 1;
    return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  };
}

function clientKey(context: Context): string {
  const forwarded = context.req.header("cf-connecting-ip") ?? context.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const incoming = (context.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return forwarded || incoming || "local";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^0x[0-9a-f]{64}$/;

function repositoryEntry(record: StoredReport, clusterId: string | null): RepositoryEntry {
  const { summary, indicators } = publicSummary(record);
  return {
    publicId: record.registryKey,
    kind: record.report.kind,
    classification: record.report.risk.classification,
    createdAt: record.report.createdAt,
    summary,
    note: record.note ? publicText(record.note).slice(0, 280) : null,
    indicators,
    registry: record.registry,
    statements: publicStatements(record.statements),
    clusterId,
  };
}

const response = (record: StoredReport): InvestigationResponse => ({ report: record.report, registry: record.registry, publishedToRepository: record.published });

/** Mirror a signed-in user's investigation summary into Supabase (`public.investigations`) for realtime history. */
function syncHistory(token: string, record: StoredReport, action: "insert" | "update") {
  const report = record.report;
  const row = {
    report_id: report.reportId,
    kind: report.kind,
    subject: (report.kind === "url" ? (report.evidence.url?.hostname ?? report.subject.display) : report.subject.display).slice(0, 300),
    classification: report.risk.classification,
    label: report.risk.label,
    findings: report.findings.filter((finding) => finding.severity !== "info").length,
    registry_status: record.registry.status,
    transaction_hash: record.registry.transactionHash,
    published: record.published,
    created_at: report.createdAt,
    updated_at: new Date().toISOString(),
  };
  return action === "insert"
    ? supabaseAsUser(token, "investigations", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" })
    : supabaseAsUser(token, `investigations?${postgrestEq("report_id", report.reportId)}`, { method: "PATCH", body: { registry_status: row.registry_status, transaction_hash: row.transaction_hash, published: row.published, updated_at: row.updated_at }, prefer: "return=minimal" });
}

export function createApp(store: Store = createStore()) {
  const app = new Hono<Env>();
  const investigateLimit = rateLimiter(12, 60_000);
  const writeLimit = rateLimiter(10, 60_000);
  const relayLimit = rateLimiter(3, 60_000);

  app.use("*", async (context, next) => {
    context.set("correlationId", crypto.randomUUID());
    await next();
  });
  app.use("*", secureHeaders());
  // Reports and verification nonces must not enter intermediary/browser HTTP caches.
  app.use("/v1/investigations/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "/v1/*",
    cors({
      // No Origin means the Worker or another server called in. Browser calls must match ALLOWED_ORIGINS.
      // A list entry of * reflects the caller's origin so the allowed sites can be changed without a code edit.
      origin: (origin) => {
        if (!origin) return null;
        if (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) return origin;
        return null;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new AppError(413, "PAYLOAD_TOO_LARGE", "Too much text", "Submissions are limited to 64 KB."); } }));

  app.route("/", createHealthRouter(store.backend));

  app.get("/v1/config", async (context) => {
    const state = await registryState();
    const relayer = registryRelayerStatus(config.registry.privateKey);
    const body: ServiceConfig = {
      ai: { enabled: aiEnabled() },
      auth: { enabled: authConfigured() },
      intel: intelProviderStatus(),
      registry: "error" in state
        ? { available: false, chainId: null, contractAddress: config.registry.contractAddress ?? null, rpcUrl: config.registry.publicRpcUrl, detail: state.error }
        : { available: relayer.ready, chainId: state.chainId, contractAddress: state.address, rpcUrl: config.registry.publicRpcUrl, detail: relayer.detail },
    };
    return context.json(body);
  });

  app.post("/v1/investigations", async (context) => {
    const limit = investigateLimit(clientKey(context));
    if (!limit.ok) throw new AppError(429, "RATE_LIMITED", "Slow down", `Too many investigations. Try again in ${limit.retryAfter} seconds.`, true);
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = investigationRequestSchema.safeParse(body);
    if (!parsed.success) throw new AppError(400, "INVALID_REQUEST", "Check your submission", parsed.error.issues[0]?.message ?? "The request is invalid.");
    const user = await userFromAuthorization(context.req.header("Authorization"));
    if (context.req.header("Authorization") && !user) throw new AppError(401, "AUTH_REQUIRED", "Sign in again", "Your session could not be verified. Sign in again before submitting a private investigation.", true);
    const record = parsed.data.kind === "url" ? await investigateUrl(store, parsed.data, user?.id ?? null) : await investigateMessage(store, parsed.data, user?.id ?? null);
    const token = bearer(context.req.header("Authorization"));
    if (user && token) void syncHistory(token, record, "insert");
    return context.json(response(record), 201);
  });

  const load = async (id: string, context: Context) => {
    if (!UUID.test(id)) throw new AppError(404, "REPORT_NOT_FOUND", "Report not found", "No report exists for this link.");
    const record = await store.get(id);
    if (!record) throw new AppError(404, "REPORT_NOT_FOUND", "Report not found", "This report doesn't exist or was deleted.");
    if (record.ownerId) {
      const user = await userFromAuthorization(context.req.header("Authorization"));
      if (!user) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Sign in to access this private report.");
      if (user.id !== record.ownerId) throw new AppError(404, "REPORT_NOT_FOUND", "Report not found", "No report exists for this account.");
    }
    return record;
  };

  app.get("/v1/investigations/:id", async (context) => context.json(response(await load(context.req.param("id"), context))));

  // Only opaque commitments leave this endpoint. No signing key or verification nonce is released.
  app.get("/v1/investigations/:id/registration", async (context) => {
    const record = await load(context.req.param("id"), context);
    const state = await registryState();
    if ("error" in state) throw new AppError(503, "REGISTRY_UNAVAILABLE", "Report sealing unavailable", "The report registry could not be reached. Please try again later.", true);
    const parent = record.report.parentReportId ? await store.get(record.report.parentReportId) : undefined;
    return context.json({
      chainId: state.chainId,
      contractAddress: state.address,
      registryKey: record.registryKey,
      commitment: computeCommitment(record.report, record.nonce),
      parentKey: parent?.registry.status === "confirmed" ? parent.registryKey : ZERO_BYTES32,
      schemaVersion: REPORT_SCHEMA_VERSION,
    });
  });

  app.post("/v1/investigations/:id/register", async (context) => {
    const limit = writeLimit(clientKey(context));
    if (!limit.ok) throw new AppError(429, "RATE_LIMITED", "Slow down", `Try again in ${limit.retryAfter} seconds.`, true);
    const record = await load(context.req.param("id"), context);
    const parsed = registerRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "INVALID_REQUEST", "Check your request", "The registration request is invalid.");
    const options = parsed.data;
    // Public scans are anonymous; spending the server's gas requires a verified account.
    // Wallet confirmations spend the caller's test ETH and do not need a server signing key.
    if (!options.transactionHash && record.registry.status !== "confirmed") {
      const signer = await userFromAuthorization(context.req.header("Authorization"));
      if (!signer) throw new AppError(401, "AUTH_REQUIRED", "Sign in or use your wallet", "Sign in to use the sealing service, or choose Seal with wallet to pay with Sepolia test ETH.");
      if (!relayLimit(signer.id).ok) throw new AppError(429, "RATE_LIMITED", "Please wait", "The sealing service allows three requests per account per minute. Try again later or use your wallet.", true);
    }
    if (options.publishToRepository) {
      const publisher = await userFromAuthorization(context.req.header("Authorization"));
      if (!publisher) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Sign in before sharing a report to the repository.");
      if (!record.ownerId || publisher.id !== record.ownerId) throw new AppError(403, "NOT_OWNER", "Only your own reports can be shared", "Sign in with the account that ran this investigation.");
      const review = await reviewPublication(record.report);
      if ((!review.available || review.authentic || review.important) && !options.confirmPublication) {
        throw new AppError(409, "PUBLICATION_CONFIRMATION_REQUIRED", review.authentic || review.important ? "This looks important" : "Confirm before publishing", review.reason, false, review);
      }
    }
    const token = bearer(context.req.header("Authorization"));
    const syncIfOwner = async (updated: StoredReport) => {
      if (!token || !updated.ownerId) return;
      const user = await userFromAuthorization(context.req.header("Authorization"));
      if (user?.id === updated.ownerId) void syncHistory(token, updated, "update");
    };
    if (record.registry.status === "confirmed") {
      const fresh = options.publishToRepository && !record.published
        ? (await store.update(record.report.reportId, (item) => { item.published = true; item.note = options.note ?? item.note; }))!
        : record;
      await syncIfOwner(fresh);
      return context.json(response(fresh));
    }
    const parent = record.report.parentReportId ? await store.get(record.report.parentReportId) : undefined;
    const parentKey = (parent?.registry.status === "confirmed" ? parent.registryKey : ZERO_BYTES32) as Hex;
    const commitment = computeCommitment(record.report, record.nonce) as Hex;
    await store.update(record.report.reportId, (item) => { item.registry = { ...item.registry, status: "pending", registryKey: item.registryKey, commitment }; });
    const receipt = options.transactionHash
      ? await confirmWalletCommitment(record.registryKey as Hex, commitment, parentKey, options.transactionHash as Hex)
      : await registerCommitment(record.registryKey as Hex, commitment, parentKey);
    const updated = (await store.update(record.report.reportId, (item) => {
      item.registry = receipt;
      if (receipt.status === "confirmed" && options.publishToRepository) {
        item.published = true;
        item.note = options.note ?? null;
      }
    }))!;
    await syncIfOwner(updated);
    return context.json(response(updated), receipt.status === "confirmed" ? 200 : 503);
  });

  app.get("/v1/investigations/:id/bundle", async (context) => {
    const record = await load(context.req.param("id"), context);
    const bundle: VerificationBundle = {
      bundleVersion: 1,
      algorithm: "veriq-commitment-v1",
      report: record.report,
      nonce: record.nonce,
      registryKey: record.registryKey,
      commitment: computeCommitment(record.report, record.nonce),
      registry: {
        chainId: record.registry.chainId,
        contractAddress: record.registry.contractAddress,
        transactionHash: record.registry.transactionHash,
        rpcHint: config.registry.publicRpcUrl,
      },
    };
    context.header("content-disposition", `attachment; filename="veriq-report-${record.report.reportId}.json"`);
    context.header("cache-control", "no-store");
    return context.json(bundle);
  });

  app.delete("/v1/investigations/:id/publication", async (context) => {
    const user = await userFromAuthorization(context.req.header("Authorization"));
    if (!user) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Sign in to remove your repository submission.");
    if (!writeLimit(user.id).ok) throw new AppError(429, "RATE_LIMITED", "Please wait", "Too many changes. Try again in a minute.", true);
    const record = await load(context.req.param("id"), context);
    if (record.ownerId !== user.id) throw new AppError(403, "NOT_OWNER", "Only your own submissions can be removed", "Use the account that ran this investigation.");
    // Hide API/correlation views first. If projection deletion fails, return an error and allow
    // an idempotent retry; never claim the public database copy was removed before it was.
    const updated = (await store.update(record.report.reportId, (item) => {
      item.published = false;
      item.note = null;
      item.statements = [];
    }))!;
    await store.removePublication(record.registryKey);
    const token = bearer(context.req.header("Authorization"));
    if (token) await syncHistory(token, updated, "update");
    return context.json(response(updated));
  });

  // Account deletion support: drop the caller's private reports; shared (published) reports are detached
  // from the account and stay in the repository because their fingerprints are already on-chain.
  app.delete("/v1/me", async (context) => {
    if (!authConfigured()) throw new AppError(503, "AUTH_NOT_CONFIGURED", "Accounts are not configured", "This Veriq instance has no Supabase project configured.");
    const user = await userFromAuthorization(context.req.header("Authorization"));
    if (!user) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Sign in again to delete your account.");
    return context.json(await store.removeOwner(user.id));
  });

  app.get("/v1/me/investigations", async (context) => {
    if (!authConfigured()) throw new AppError(503, "AUTH_NOT_CONFIGURED", "Accounts are not configured", "This Veriq instance has no Supabase project configured.");
    const user = await userFromAuthorization(context.req.header("Authorization"));
    if (!user) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Your session has expired. Sign in again to see your investigations.");
    const records = await store.byOwner(user.id);
    const byClass: Record<string, number> = {};
    for (const record of records) byClass[record.report.risk.classification] = (byClass[record.report.risk.classification] ?? 0) + 1;
    const body: MyInvestigationsResponse = {
      user,
      items: records.slice(0, 100).map((record) => ({
        reportId: record.report.reportId,
        kind: record.report.kind,
        subject: record.report.kind === "url" ? (record.report.evidence.url?.hostname ?? record.report.subject.display) : record.report.subject.display,
        classification: record.report.risk.classification,
        label: record.report.risk.label,
        createdAt: record.report.createdAt,
        findings: record.report.findings.filter((finding) => finding.severity !== "info").length,
        registry: record.registry.status,
        published: record.published,
      })),
      totals: {
        investigations: records.length,
        registered: records.filter((record) => record.registry.status === "confirmed").length,
        published: records.filter((record) => record.published).length,
        byClass,
      },
    };
    return context.json(body);
  });

  app.get("/v1/repository", async (context) => {
    const records = await store.published();
    const clusters = buildClusters(await correlationRecords(store));
    const clusterOf = new Map(clusters.flatMap((cluster) => cluster.members.map((member) => [member, cluster.clusterId] as const)));
    context.header("cache-control", "no-store");
    return context.json({
      entries: records.slice(0, 100).map((record) => repositoryEntry(record, clusterOf.get(record.registryKey) ?? null)),
      clusters,
    });
  });

  app.get("/v1/repository/:publicId", async (context) => {
    const key = context.req.param("publicId").toLowerCase();
    const record = KEY.test(key) ? await store.byRegistryKey(key) : undefined;
    if (!record?.published || record.registry.status !== "confirmed") throw new AppError(404, "REPORT_NOT_FOUND", "Incident not found", "This incident is private or has not been published.");
    context.header("cache-control", "no-store");
    return context.json({
      ...repositoryEntry(record, null),
      findings: record.report.findings.map((finding) => ({
        id: finding.id, category: finding.category, severity: finding.severity,
        title: publicText(finding.title), description: publicText(finding.description),
        impact: publicText(finding.impact), recommendation: publicText(finding.recommendation), source: publicText(finding.source.name),
      })),
      checks: record.report.checks.map(({ id, label, status }) => ({ id, label: publicText(label), status })),
      coverage: { completed: record.report.checks.filter((check) => check.status === "completed").length, total: record.report.checks.length },
    });
  });

  app.post("/v1/repository/:publicId/statements", async (context) => {
    const limit = writeLimit(clientKey(context));
    if (!limit.ok) throw new AppError(429, "RATE_LIMITED", "Slow down", `Try again in ${limit.retryAfter} seconds.`, true);
    const author = await userFromAuthorization(context.req.header("Authorization"));
    if (!author) throw new AppError(401, "AUTH_REQUIRED", "Sign in required", "Sign in before adding a statement to the repository.");
    const publicId = context.req.param("publicId").toLowerCase();
    if (!KEY.test(publicId)) throw new AppError(404, "REPORT_NOT_FOUND", "Report not found", "Unknown repository entry.");
    const record = await store.byRegistryKey(publicId);
    if (!record || !record.published || record.registry.status !== "confirmed") throw new AppError(404, "REPORT_NOT_FOUND", "Report not found", "Unknown repository entry.");
    const parsed = statementRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "INVALID_REQUEST", "Check your statement", parsed.error.issues[0]?.message ?? "Invalid statement.");
    const createdAt = new Date().toISOString();
    const publicNote = publicText(parsed.data.note).slice(0, 280);
    const statementHash = statementHashFor(publicId, parsed.data.kind, publicNote, createdAt) as Hex;
    // Community feedback is off-chain; only the latest vote per verified account counts.
    const previous = record.statements.filter((item) => item.authorId === author.id).at(-1);
    if (previous?.kind === parsed.data.kind && previous.note === publicNote) return context.json(repositoryEntry(record, null));
    const updated = (await store.update(record.report.reportId, (item) => {
      item.statements.push({ kind: parsed.data.kind, note: publicNote, authorId: author.id, statementHash, transactionHash: null, status: "unregistered", createdAt });
    }))!;
    return context.json(repositoryEntry(updated, null));
  });

  app.notFound((context) =>
    context.json({ code: "NOT_FOUND", title: "Endpoint not found", message: "The requested API endpoint does not exist.", retryable: false, correlationId: context.get("correlationId") }, 404),
  );

  app.onError((error, context) => {
    const correlationId = context.get("correlationId") ?? crypto.randomUUID();
    if (error instanceof AppError) {
      return context.json({ code: error.code, title: error.title, message: error.message, retryable: error.retryable, correlationId, ...(error.review ? { review: error.review } : {}) }, error.status);
    }
    console.error(JSON.stringify({ level: "error", correlationId, message: error.message }));
    return context.json({ code: "INTERNAL_ERROR", title: "Something went wrong", message: "The request could not be completed. Try again in a moment.", retryable: true, correlationId }, 500);
  });

  return app;
}
