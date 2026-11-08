import type { CorrelationKey, CorrelationRecord } from "@veriq/analysis";
import type { RegistryReceipt, Report, RepositoryEntry } from "@veriq/contracts";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config";

const FILTER_COLUMN = /^[a-z_]+$/;
const FILTER_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** A PostgREST equality filter. Values that are not plain identifiers are rejected before interpolation. */
export function postgrestEq(column: string, value: string): string {
  if (!FILTER_COLUMN.test(column) || !FILTER_VALUE.test(value)) throw new Error("Rejected an unsafe repository filter.");
  return `${column}=eq.${encodeURIComponent(value)}`;
}

export type Statement = RepositoryEntry["statements"][number] & { authorId?: string };

/** Public prose excludes private URL paths, contact identifiers and long account values. */
export function publicText(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, "[link redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/0x[0-9a-f]{40,}/gi, "[address redacted]")
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[number redacted]").slice(0, 1600);
}

/** One current opinion per account; failed/pending chain submissions are not votes. */
export function publicStatements(statements: Statement[]): RepositoryEntry["statements"] {
  return statements.filter((statement, index, all) =>
    (statement.status === "confirmed" || (statement.status === "unregistered" && Boolean(statement.authorId))) &&
    (!statement.authorId || !all.slice(index + 1).some((next) => next.authorId === statement.authorId))
  ).map(({ authorId: _privateAuthor, ...statement }) => ({ ...statement, note: publicText(statement.note).slice(0, 280) }));
}

export type StoredReport = {
  report: Report;
  /** Private commitment nonce. Released only inside a user-requested verification bundle. */
  nonce: string;
  registryKey: string;
  registry: RegistryReceipt;
  published: boolean;
  note: string | null;
  keys: CorrelationKey[];
  shingles: string[];
  statements: Statement[];
  /** Supabase user id of the signed-in submitter; null for anonymous investigations. */
  ownerId?: string | null;
};

/** Persistence for reports and the public repository. All methods are async so backends are interchangeable. */
export interface Store {
  readonly backend: "supabase" | "local";
  save(record: StoredReport): Promise<void>;
  get(reportId: string): Promise<StoredReport | undefined>;
  byRegistryKey(registryKey: string): Promise<StoredReport | undefined>;
  update(reportId: string, change: (record: StoredReport) => void): Promise<StoredReport | undefined>;
  removePublication(registryKey: string): Promise<void>;
  byOwner(ownerId: string): Promise<StoredReport[]>;
  removeOwner(ownerId: string): Promise<{ deleted: number; detached: number }>;
  published(): Promise<StoredReport[]>;
}

export async function correlationRecords(store: Store): Promise<CorrelationRecord[]> {
  return (await store.published()).map((record) => ({
    publicId: record.registryKey,
    classification: record.report.risk.classification,
    createdAt: record.report.createdAt,
    keys: record.keys,
    shingles: record.shingles,
  }));
}

/** Sanitised public projection of a shared report. Raw URLs, messages and evidence never leave `reports`. */
export function publicSummary(record: StoredReport): { summary: string; indicators: RepositoryEntry["indicators"] } {
  const report = record.report;
  const indicators: RepositoryEntry["indicators"] = [];
  if (report.evidence.url) {
    indicators.push({ type: "domain", display: report.evidence.url.registrableDomain ?? report.evidence.url.hostname, hash: record.keys.find((key) => key.type === "url")?.value ?? "" });
  }
  for (const indicator of report.evidence.message?.indicators ?? []) {
    if (indicator.type === "url") {
      try { indicators.push({ type: "domain", display: new URL(indicator.display).hostname, hash: indicator.hash }); } catch { /* Never publish an unparsed URL. */ }
    } else if (indicator.type !== "amount") indicators.push({ type: indicator.type, display: publicText(indicator.display), hash: indicator.hash });
  }
  const lead = report.findings.find((finding) => finding.category !== "configuration" && finding.severity !== "info")?.title;
  const fallback = report.risk.summary.replace(new RegExp(`^${report.risk.label}: `), "");
  return { summary: publicText(lead ?? fallback).slice(0, 400), indicators: indicators.slice(0, 12) };
}

// ---------------------------------------------------------------------------------------------
// Supabase (production): private `reports` via the server-side secret key, public projections.
// ---------------------------------------------------------------------------------------------

type Row = { record: StoredReport };

export class SupabaseStore implements Store {
  readonly backend = "supabase" as const;
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, secretKey: string) {
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    // New `sb_secret_…` keys go in `apikey` only; legacy service_role JWTs also need the bearer header.
    this.headers = { apikey: secretKey, "content-type": "application/json", ...(secretKey.startsWith("eyJ") ? { authorization: `Bearer ${secretKey}` } : {}) };
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const response = await fetch(`${this.base}/${path}`, {
      method: init.method ?? "GET",
      headers: { ...this.headers, ...(init.prefer ? { prefer: init.prefer } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed: HTTP ${response.status} ${(await response.text()).slice(0, 160)}`);
    if (response.status === 204 || init.prefer?.includes("return=minimal")) return undefined as T;
    return (await response.json()) as T;
  }

  private row(record: StoredReport) {
    return {
      report_id: record.report.reportId,
      registry_key: record.registryKey,
      owner_id: record.ownerId ?? null,
      kind: record.report.kind,
      classification: record.report.risk.classification,
      published: record.published,
      record,
      created_at: record.report.createdAt,
      updated_at: new Date().toISOString(),
    };
  }

  /** Keep the public repository tables in step with a shared report. */
  private async syncPublic(record: StoredReport) {
    if (!record.published) return;
    const { summary, indicators } = publicSummary(record);
    await this.request("repository_entries?on_conflict=public_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        public_id: record.registryKey,
        report_id: record.report.reportId,
        kind: record.report.kind,
        classification: record.report.risk.classification,
        summary,
        note: record.note ? publicText(record.note).slice(0, 280) : null,
        indicators,
        chain_id: record.registry.chainId,
        transaction_hash: record.registry.transactionHash,
        block_number: record.registry.blockNumber,
        confirms: publicStatements(record.statements).filter((statement) => statement.kind === "validate").length,
        disputes: publicStatements(record.statements).filter((statement) => statement.kind === "dispute").length,
        created_at: record.report.createdAt,
        updated_at: new Date().toISOString(),
      },
    });
    if (record.statements.length) {
      await this.request("repository_statements?on_conflict=statement_hash", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: record.statements.map((statement) => ({ statement_hash: statement.statementHash, public_id: record.registryKey, kind: statement.kind, note: publicText(statement.note).slice(0, 280), transaction_hash: statement.transactionHash, status: statement.status, created_at: statement.createdAt })),
      });
    }
  }

  async save(record: StoredReport) {
    await this.request("reports?on_conflict=report_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: this.row(record) });
    await this.syncPublic(record);
  }

  async get(reportId: string) {
    const rows = await this.request<Row[]>(`reports?select=record&${postgrestEq("report_id", reportId)}&limit=1`);
    return rows[0]?.record;
  }

  async byRegistryKey(registryKey: string) {
    const rows = await this.request<Row[]>(`reports?select=record&${postgrestEq("registry_key", registryKey)}&limit=1`);
    return rows[0]?.record;
  }

  async update(reportId: string, change: (record: StoredReport) => void) {
    const record = await this.get(reportId);
    if (!record) return undefined;
    change(record);
    await this.save(record);
    return record;
  }

  async byOwner(ownerId: string) {
    const rows = await this.request<Row[]>(`reports?select=record&${postgrestEq("owner_id", ownerId)}&order=created_at.desc&limit=200`);
    return rows.map((row) => row.record);
  }

  /** Deleting the projection also deletes its public reviews via the existing foreign key. */
  async removePublication(registryKey: string) {
    await this.request(`repository_entries?${postgrestEq("public_id", registryKey)}`, { method: "DELETE", prefer: "return=minimal" });
  }

  async removeOwner(ownerId: string) {
    const owned = await this.byOwner(ownerId);
    const deleted = owned.filter((record) => !record.published).length;
    await this.request(`reports?${postgrestEq("owner_id", ownerId)}&published=eq.false`, { method: "DELETE", prefer: "return=minimal" });
    for (const record of owned.filter((item) => item.published)) {
      record.ownerId = null;
      await this.save(record);
    }
    return { deleted, detached: owned.length - deleted };
  }

  async published() {
    const rows = await this.request<Row[]>("reports?select=record&published=eq.true&order=created_at.desc&limit=300");
    return rows.map((row) => row.record);
  }
}

// ---------------------------------------------------------------------------------------------
// Local JSON file (development fallback when no Supabase secret key is configured).
// ---------------------------------------------------------------------------------------------

type StoreFile = { version: 1; reports: Record<string, StoredReport> };

export class LocalStore implements Store {
  readonly backend = "local" as const;
  private data: StoreFile = { version: 1, reports: {} };
  private readonly file: string;

  constructor(directory = config.dataDir) {
    mkdirSync(directory, { recursive: true });
    this.file = resolve(directory, "reports.json");
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, "utf8")) as StoreFile;
      } catch {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
    }
  }

  private flush() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data));
    renameSync(temp, this.file);
  }

  async save(record: StoredReport) {
    this.data.reports[record.report.reportId] = record;
    this.flush();
  }

  async get(reportId: string) {
    return this.data.reports[reportId];
  }

  async byRegistryKey(registryKey: string) {
    return Object.values(this.data.reports).find((record) => record.registryKey === registryKey);
  }

  async update(reportId: string, change: (record: StoredReport) => void) {
    const record = this.data.reports[reportId];
    if (!record) return undefined;
    change(record);
    this.flush();
    return record;
  }

  async byOwner(ownerId: string) {
    return Object.values(this.data.reports)
      .filter((record) => record.ownerId === ownerId)
      .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
  }

  async removePublication(_registryKey: string) {
    // Local public views read the published flag directly; there is no separate projection.
  }

  async removeOwner(ownerId: string) {
    let deleted = 0;
    let detached = 0;
    for (const [id, record] of Object.entries(this.data.reports)) {
      if (record.ownerId !== ownerId) continue;
      if (record.published) {
        record.ownerId = null;
        detached += 1;
      } else {
        delete this.data.reports[id];
        deleted += 1;
      }
    }
    this.flush();
    return { deleted, detached };
  }

  async published() {
    return Object.values(this.data.reports)
      .filter((record) => record.published)
      .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
  }
}

export function createStore(): Store {
  if (config.supabase.url && config.supabase.secretKey) return new SupabaseStore(config.supabase.url, config.supabase.secretKey);
  return new LocalStore();
}
