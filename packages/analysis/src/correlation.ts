import type { CorrelationCluster, RelatedReport, Report, RiskClass } from "@veriq/contracts";
import { URL_SHORTENERS, sharedHostingPlatform } from "./brands";
import { indicatorHash, sha256Hex } from "./hash";
import { registrableDomainOf } from "./url";

export type Strength = "weak" | "moderate" | "strong";
export type CorrelationKey = { type: string; value: string; display: string; strength: Strength; method: string };

export type CorrelationRecord = {
  publicId: string;
  classification: RiskClass;
  createdAt: string;
  keys: CorrelationKey[];
  shingles: string[];
};

const RANK: Record<Strength, number> = { weak: 0, moderate: 1, strong: 2 };

/**
 * Deterministic correlation keys. Shared infrastructure (IP addresses, shortener domains, free-hosting parents)
 * is weak by design: shared hosting alone must not establish that two incidents belong to one campaign.
 */
export function correlationKeysFor(report: Report): CorrelationKey[] {
  const keys: CorrelationKey[] = [];
  const push = (key: CorrelationKey) => {
    if (!keys.some((existing) => existing.type === key.type && existing.value === key.value)) keys.push(key);
  };
  const addDomain = (domain: string | null, host: string | null, method: string) => {
    if (!domain) return;
    const shared = URL_SHORTENERS.has(domain) || (host ? sharedHostingPlatform(host) : null);
    push({ type: "domain", value: domain, display: domain, strength: shared ? "weak" : "strong", method });
  };

  const url = report.evidence.url;
  if (url) {
    push({ type: "url", value: indicatorHash("url", url.normalized), display: url.hostname, strength: "strong", method: "Exact normalised URL" });
    addDomain(url.registrableDomain, url.hostname, "Same registrable domain");
  }
  const hops = report.evidence.redirects ?? [];
  const final = [...hops].reverse().find((hop) => hop.status !== null);
  if (final && final.host !== url?.hostname) addDomain(registrableDomainOf(final.host), final.host, "Redirect destination domain");
  for (const address of report.evidence.dns?.addresses ?? []) {
    push({ type: "ip", value: address, display: address, strength: "weak", method: "Same hosting IP (shared hosting possible)" });
  }
  const leaf = report.evidence.tls?.chain[0];
  if (leaf && !URL_SHORTENERS.has(url?.registrableDomain ?? "")) {
    push({ type: "certificate", value: leaf.fingerprintSha256, display: `${leaf.subject} (${leaf.fingerprintSha256.slice(0, 11)}…)`, strength: "strong", method: "Identical TLS certificate" });
  }
  const message = report.evidence.message;
  if (message) {
    for (const indicator of message.indicators) {
      if (indicator.type === "amount") continue;
      if (indicator.type === "url") continue;
      push({
        type: indicator.type,
        value: indicator.hash,
        display: indicator.display,
        strength: indicator.type === "email" ? "moderate" : "strong",
        method: indicator.type === "upi" || indicator.type === "crypto_wallet" || indicator.type === "ifsc" ? "Same payment destination" : `Same ${indicator.type.replace("_", " ")}`,
      });
    }
    for (const link of message.links) addDomain(link.registrableDomain, null, "Linked domain");
  }
  const brands = new Set<string>([...(message?.claimedBrands ?? [])]);
  for (const finding of report.findings) {
    const brand = finding.evidence.find((entry) => entry.label === "Claimed brand" || entry.label === "Claimed")?.value;
    if (brand) brands.add(brand);
  }
  for (const brand of brands) push({ type: "brand", value: brand, display: `${brand} impersonation`, strength: "weak", method: "Recurring impersonation target" });
  return keys;
}

/** Hashed 4-word shingles of redacted message text, for near-duplicate detection without storing the text. */
export function shinglesFor(report: Report): string[] {
  const text = report.evidence.message?.redactedExcerpt;
  if (!text) return [];
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 1);
  const shingles = new Set<string>();
  for (let index = 0; index + 4 <= words.length && shingles.size < 300; index += 1) {
    shingles.add(sha256Hex(words.slice(index, index + 4).join(" ")).slice(0, 16));
  }
  return [...shingles];
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  const intersection = b.filter((item) => set.has(item)).length;
  return intersection / (a.length + b.length - intersection);
}

export function correlate(current: { keys: CorrelationKey[]; shingles: string[] }, others: CorrelationRecord[]): RelatedReport[] {
  const related: RelatedReport[] = [];
  for (const other of others) {
    const matches = current.keys.filter((key) => other.keys.some((candidate) => candidate.type === key.type && candidate.value === key.value));
    const similarity = jaccard(current.shingles, other.shingles);
    if (!matches.length && similarity < 0.5) continue;
    let strength: Strength = matches.reduce<Strength>((best, key) => (RANK[key.strength] > RANK[best] ? key.strength : best), "weak");
    if (matches.filter((key) => key.strength === "moderate").length >= 2) strength = "strong";
    if (similarity >= 0.5 && RANK[strength] < RANK.moderate) strength = "moderate";
    const weakOnly = matches.length > 0 && matches.every((key) => key.strength === "weak") && similarity < 0.5;
    related.push({
      publicId: other.publicId,
      classification: other.classification,
      createdAt: other.createdAt,
      matches: [
        ...matches.map((key) => ({ type: key.type, display: key.display, method: key.method })),
        ...(similarity >= 0.5 ? [{ type: "text", display: `${Math.round(similarity * 100)}% wording overlap`, method: "Similar message text (hashed shingles)" }] : []),
      ],
      strength,
      note: weakOnly
        ? "Only shared infrastructure or a common impersonation target links these reports; this alone does not show they are the same campaign."
        : "Shared indicators suggest these incidents may be connected.",
    });
  }
  return related.sort((a, b) => RANK[b.strength] - RANK[a.strength]).slice(0, 20);
}

/** Group records into clusters connected by moderate or strong evidence (union-find). */
export function buildClusters(records: CorrelationRecord[]): CorrelationCluster[] {
  const parent = new Map(records.map((record) => [record.publicId, record.publicId]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const edges: Array<{ a: string; b: string; keys: CorrelationKey[]; strength: Strength }> = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const a = records[i]!, b = records[j]!;
      const [link] = correlate({ keys: a.keys, shingles: a.shingles }, [b]);
      if (!link || link.strength === "weak") continue;
      const keys = a.keys.filter((key) => b.keys.some((other) => other.type === key.type && other.value === key.value));
      edges.push({ a: a.publicId, b: b.publicId, keys, strength: link.strength });
      parent.set(find(a.publicId), find(b.publicId));
    }
  }
  const groups = new Map<string, string[]>();
  for (const record of records) {
    const root = find(record.publicId);
    groups.set(root, [...(groups.get(root) ?? []), record.publicId]);
  }
  const clusters: CorrelationCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const memberEdges = edges.filter((edge) => members.includes(edge.a));
    const shared = new Map<string, { type: string; display: string; method: string; reports: Set<string> }>();
    for (const edge of memberEdges) {
      for (const key of edge.keys) {
        const id = `${key.type}:${key.value}`;
        const entry = shared.get(id) ?? { type: key.type, display: key.display, method: key.method, reports: new Set<string>() };
        entry.reports.add(edge.a).add(edge.b);
        shared.set(id, entry);
      }
    }
    const strength: Strength = memberEdges.some((edge) => edge.strength === "strong") ? "strong" : "moderate";
    const sharedIndicators = [...shared.values()].map((entry) => ({ type: entry.type, display: entry.display, method: entry.method, reports: entry.reports.size }));
    clusters.push({
      clusterId: `C-${sha256Hex([...members].sort().join(",")).slice(0, 10)}`,
      members,
      sharedIndicators,
      strength,
      summary: `${members.length} reports share ${sharedIndicators.length || "similar"} indicator(s)${sharedIndicators[0] ? `, including ${sharedIndicators[0].display}` : " (similar wording)"}.`,
    });
  }
  return clusters;
}
