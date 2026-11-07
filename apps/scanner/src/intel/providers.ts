import { URL_SHORTENERS, normalizeTarget, sharedHostingPlatform } from "@veriq/analysis";
import type { IntelResult } from "@veriq/contracts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// OpenPhish community feed (keyless, refreshed hourly, cached on disk for outages)
// ---------------------------------------------------------------------------

type FeedCache = { fetchedAt: number; urls: Set<string>; hosts: Map<string, number>; size: number };
let openPhish: FeedCache | null = null;
let openPhishLoading: Promise<FeedCache | null> | null = null;

function feedFile() {
  return resolve(config.dataDir, "openphish-feed.txt");
}

function canonicalUrl(value: string): string | null {
  const normalized = normalizeTarget(value);
  return normalized.ok ? normalized.value.normalized.replace(/\/$/, "") : null;
}

function buildFeed(text: string, fetchedAt: number): FeedCache {
  const urls = new Set<string>();
  const hosts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    const canonical = canonicalUrl(value);
    if (!canonical) continue;
    urls.add(canonical);
    const host = new URL(canonical).hostname;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  return { fetchedAt, urls, hosts, size: urls.size };
}

async function loadOpenPhish(): Promise<FeedCache | null> {
  if (openPhish && Date.now() - openPhish.fetchedAt < 60 * 60 * 1000) return openPhish;
  if (openPhishLoading) return openPhishLoading;
  openPhishLoading = (async () => {
    try {
      if (config.intel.disableNetworkIntel) throw new Error("offline mode");
      const response = await fetch(config.intel.openPhishFeed, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      mkdirSync(config.dataDir, { recursive: true });
      writeFileSync(feedFile(), text);
      openPhish = buildFeed(text, Date.now());
    } catch {
      if (!openPhish && existsSync(feedFile())) openPhish = buildFeed(readFileSync(feedFile(), "utf8"), 0);
    } finally {
      openPhishLoading = null;
    }
    return openPhish;
  })();
  return openPhishLoading;
}

export async function checkOpenPhish(url: string): Promise<IntelResult> {
  const feed = await loadOpenPhish();
  const checkedAt = now();
  if (!feed) return { source: "OpenPhish community feed", status: "unavailable", matchScope: "exact URL / host", detail: "The feed could not be downloaded and no cached copy exists.", checkedAt };
  const canonical = canonicalUrl(url);
  const freshness = feed.fetchedAt ? `feed fetched ${new Date(feed.fetchedAt).toISOString()}` : "cached copy of unknown age (feed unreachable)";
  if (canonical && feed.urls.has(canonical)) {
    return { source: "OpenPhish community feed", status: "listed", matchScope: "exact URL", detail: `This exact URL is listed as an active phishing URL (${freshness}; ${feed.size} URLs).`, checkedAt, reference: "https://openphish.com/" };
  }
  const host = canonical ? new URL(canonical).hostname : null;
  const hostCount = host ? (feed.hosts.get(host) ?? 0) : 0;
  const ambiguousHost = host ? URL_SHORTENERS.has(host) || sharedHostingPlatform(host) === host : true;
  if (host && hostCount && !ambiguousHost) {
    return { source: "OpenPhish community feed", status: "listed", matchScope: "same host", detail: `${hostCount} phishing URL(s) on ${host} are listed (${freshness}).`, checkedAt, reference: "https://openphish.com/" };
  }
  return { source: "OpenPhish community feed", status: "not_listed", matchScope: "exact URL / host", detail: `Not listed (${freshness}; ${feed.size} URLs).`, checkedAt };
}

// ---------------------------------------------------------------------------
// URLhaus (abuse.ch). Requires a free Auth-Key since abuse.ch retired keyless access.
// ---------------------------------------------------------------------------

export async function checkUrlhaus(url: string): Promise<IntelResult> {
  const checkedAt = now();
  if (!config.intel.urlhausKey) return { source: "URLhaus (abuse.ch)", status: "disabled", matchScope: "exact URL / host", detail: "Not configured: set URLHAUS_AUTH_KEY (free from auth.abuse.ch).", checkedAt };
  try {
    const post = async (path: string, field: string, value: string) => {
      const response = await fetch(`https://urlhaus-api.abuse.ch/v1/${path}/`, {
        method: "POST",
        headers: { "Auth-Key": config.intel.urlhausKey!, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ [field]: value }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as { query_status?: string; threat?: string; url_status?: string; urlhaus_reference?: string; url_count?: string };
    };
    const byUrl = await post("url", "url", url);
    if (byUrl.query_status === "ok") {
      return { source: "URLhaus (abuse.ch)", status: "listed", matchScope: "exact URL", detail: `Listed as ${byUrl.threat ?? "malicious"} (status: ${byUrl.url_status ?? "unknown"}).`, checkedAt, ...(byUrl.urlhaus_reference ? { reference: byUrl.urlhaus_reference } : {}) };
    }
    const host = new URL(url).hostname;
    const byHost = await post("host", "host", host);
    if (byHost.query_status === "ok" && !URL_SHORTENERS.has(host)) {
      return { source: "URLhaus (abuse.ch)", status: "listed", matchScope: "same host", detail: `${byHost.url_count ?? "Some"} malware URL(s) recorded on ${host}.`, checkedAt, ...(byHost.urlhaus_reference ? { reference: byHost.urlhaus_reference } : {}) };
    }
    return { source: "URLhaus (abuse.ch)", status: "not_listed", matchScope: "exact URL / host", detail: "No URLhaus record.", checkedAt };
  } catch (error) {
    return { source: "URLhaus (abuse.ch)", status: "error", matchScope: "exact URL / host", detail: `Lookup failed (${(error as Error).message}).`, checkedAt };
  }
}

// ---------------------------------------------------------------------------
// Google Safe Browsing v4 Lookup API (optional key)
// ---------------------------------------------------------------------------

export async function checkSafeBrowsing(url: string): Promise<IntelResult> {
  const checkedAt = now();
  if (!config.intel.safeBrowsingKey) return { source: "Google Safe Browsing", status: "disabled", matchScope: "URL expression", detail: "Not configured: set GOOGLE_SAFE_BROWSING_API_KEY.", checkedAt };
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(config.intel.safeBrowsingKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "veriq", clientVersion: "0.2.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { matches?: Array<{ threatType?: string }> };
    if (body.matches?.length) {
      return { source: "Google Safe Browsing", status: "listed", matchScope: "exact URL (Safe Browsing URL expression)", detail: `Flagged as ${[...new Set(body.matches.map((match) => match.threatType))].join(", ")}.`, checkedAt, reference: "https://transparencyreport.google.com/safe-browsing/search" };
    }
    return { source: "Google Safe Browsing", status: "not_listed", matchScope: "URL expression", detail: "No Safe Browsing match.", checkedAt };
  } catch (error) {
    return { source: "Google Safe Browsing", status: "error", matchScope: "URL expression", detail: `Lookup failed (${(error as Error).message}).`, checkedAt };
  }
}

export async function checkExternalIntel(urls: string[]): Promise<IntelResult[]> {
  const unique = [...new Set(urls)].slice(0, 6);
  const label = (url: string, result: IntelResult): IntelResult =>
    unique.length > 1 && result.status === "listed" ? { ...result, detail: `${url.slice(0, 120)}: ${result.detail}` } : result;
  const results = await Promise.all(
    unique.flatMap((url) => [checkOpenPhish(url), checkUrlhaus(url), checkSafeBrowsing(url)].map((promise) => promise.then((result) => label(url, result)))),
  );
  // Collapse duplicates: keep the most significant result per source.
  const rank = { listed: 4, not_listed: 3, error: 2, unavailable: 1, disabled: 0 } as const;
  const bySource = new Map<string, IntelResult>();
  for (const result of results) {
    const existing = bySource.get(result.source);
    if (!existing || rank[result.status] > rank[existing.status]) bySource.set(result.source, result);
  }
  return [...bySource.values()];
}

export function intelProviderStatus() {
  return [
    { name: "OpenPhish community feed", enabled: !config.intel.disableNetworkIntel, detail: openPhish ? `${openPhish.size} URLs cached` : "Loaded on first lookup" },
    { name: "URLhaus (abuse.ch)", enabled: Boolean(config.intel.urlhausKey), detail: config.intel.urlhausKey ? "Configured" : "Set URLHAUS_AUTH_KEY to enable" },
    { name: "Google Safe Browsing", enabled: Boolean(config.intel.safeBrowsingKey), detail: config.intel.safeBrowsingKey ? "Configured" : "Set GOOGLE_SAFE_BROWSING_API_KEY to enable" },
    { name: "Veriq CA trust dataset (eMudhra and distrusted CAs)", enabled: true, detail: "Bundled, versioned dataset" },
    { name: "Veriq threat repository", enabled: true, detail: "Published, chain-anchored reports" },
  ];
}

export function warmIntel() {
  void loadOpenPhish();
}
