import {
  assessMessage,
  assessUrl,
  correlate,
  correlationKeysFor,
  isPortAllowed,
  newNonce,
  normalizeTarget,
  registryKeyFor,
  shinglesFor,
  type UrlCollection,
} from "@veriq/analysis";
import type { Check, IntelResult, MessageInvestigation, Report, UrlInvestigation } from "@veriq/contracts";
import { randomUUID } from "node:crypto";
import { explainReport } from "./ai/explain";
import { AppError, PolicyBlockedError } from "./errors";
import { lookupCertificateTransparency } from "./inspect/ct";
import { collectDns } from "./inspect/dns-info";
import { extractPage } from "./inspect/page";
import { resolveAllowed, walkRedirects } from "./inspect/safe-http";
import { probeTls } from "./inspect/tls-probe";
import { checkExternalIntel } from "./intel/providers";
import { EMPTY_RECEIPT } from "./registry";
import { correlationRecords, type Store, type StoredReport } from "./store";

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null; error: Error | null; ms: number }> {
  const started = performance.now();
  try {
    return { value: await work(), error: null, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { value: null, error: error as Error, ms: Math.round(performance.now() - started) };
  }
}

function intelCheck(results: IntelResult[], core: boolean): Check {
  const completed = results.filter((result) => result.status === "listed" || result.status === "not_listed");
  return {
    id: "intel",
    label: "Threat intelligence",
    status: completed.length ? "completed" : "unavailable",
    detail: results.map((result) => `${result.source}: ${result.status.replace("_", " ")}`).join("; "),
    source: completed.map((result) => result.source).join(", ") || undefined,
    core,
  } as Check;
}

/** Repository lookups are expressed as intel results so they share the same evidence presentation. */
async function repositoryIntel(store: Store, urls: string[]): Promise<IntelResult[]> {
  const records = await store.published();
  const results: IntelResult[] = [];
  for (const url of urls) {
    const normalized = normalizeTarget(url);
    if (!normalized.ok) continue;
    const exact = records.filter((record) => record.report.evidence.url?.normalized === normalized.value.normalized);
    const sameDomain = records.filter((record) => normalized.value.registrableDomain && record.report.evidence.url?.registrableDomain === normalized.value.registrableDomain && !exact.includes(record));
    const matches = exact.length ? exact : sameDomain;
    if (!matches.length) continue;
    const harmful = matches.filter((record) => ["suspicious", "high_risk", "confirmed_malicious"].includes(record.report.risk.classification));
    if (!harmful.length) continue;
    const validated = harmful.filter((record) => {
      const validations = record.statements.filter((statement) => statement.kind === "validate").length;
      const disputes = record.statements.filter((statement) => statement.kind === "dispute").length;
      return validations > disputes;
    });
    results.push({
      source: "Veriq repository",
      status: "listed",
      matchScope: exact.length ? "exact URL (community report)" : "same registrable domain (community report)",
      detail: `${harmful.length} published report(s) rated ${[...new Set(harmful.map((record) => record.report.risk.label))].join("/")}${validated.length ? `; ${validated.length} validated by reviewers` : "; not yet validated"}.`,
      checkedAt: new Date().toISOString(),
    });
  }
  return results;
}

async function finalize(store: Store, report: Report, ownerId: string | null): Promise<StoredReport> {
  const record: StoredReport = {
    report,
    nonce: newNonce(),
    registryKey: registryKeyFor(report.reportId),
    registry: { ...EMPTY_RECEIPT },
    published: false,
    note: null,
    keys: correlationKeysFor(report),
    shingles: shinglesFor(report),
    statements: [],
    ownerId,
  };
  await store.save(record);
  return record;
}

export async function investigateUrl(store: Store, request: UrlInvestigation, ownerId: string | null = null): Promise<StoredReport> {
  const normalized = normalizeTarget(request.target);
  if (!normalized.ok) {
    throw new AppError(normalized.code === "HOST_NOT_PUBLIC" ? 422 : 400, normalized.code, "Check the link", normalized.message);
  }
  const url = normalized.value;
  if (!isPortAllowed(url.port)) {
    throw new AppError(422, "DESTINATION_BLOCKED", "Destination refused", `Port ${url.port} is not allowed. Veriq only inspects ports 80, 443, 8080 and 8443.`);
  }
  const parent = request.parentReportId ? await store.get(request.parentReportId) : undefined;

  // Refuse private/internal destinations before any network activity beyond DNS resolution.
  let target;
  try {
    target = await resolveAllowed(url.hostname);
  } catch (error) {
    if (error instanceof PolicyBlockedError) {
      throw new AppError(422, "DESTINATION_BLOCKED", "Destination refused", `Veriq refused to inspect this address: ${error.message}. Private, local and reserved networks are never contacted.`);
    }
    target = null; // unresolvable: continue with lexical and intelligence checks only
  }

  const checks: Check[] = [{ id: "lexical", label: "Link structure analysis", status: "completed", detail: "Domain, brand-lookalike and URL-pattern rules evaluated.", core: false }];
  const [dnsResult, walkResult] = await Promise.all([
    timed(() => collectDns(url.hostname, url.registrableDomain)),
    target ? timed(() => walkRedirects(normalized.url)) : Promise.resolve({ value: null, error: new Error("DNS_FAILED: the host does not resolve"), ms: 0 }),
  ]);
  const dns = dnsResult.value;
  checks.push({ id: "dns", label: "DNS resolution", status: dns && dns.evidence.addresses.length ? "completed" : "failed", detail: dns ? `${dns.evidence.addresses.length} address(es), ${dns.evidence.ns.length} name server(s).` : "DNS lookup failed.", durationMs: dnsResult.ms, core: false });
  checks.push({ id: "rdap", label: "Domain registration (RDAP)", status: dns?.rdapAvailable ? "completed" : url.isIp ? "skipped" : "unavailable", detail: dns?.evidence.registration?.registeredAt ? `Registered ${dns.evidence.registration.registeredAt.slice(0, 10)}.` : "Registration data unavailable for this domain.", source: "rdap.org", core: false });

  const walk = walkResult.value;
  const finalResponse = walk?.final ?? null;
  const httpCompleted = Boolean(finalResponse);
  checks.push({
    id: "http",
    label: "Passive HTTP inspection",
    status: httpCompleted ? "completed" : walk?.error === "DESTINATION_BLOCKED" ? "blocked" : "failed",
    detail: httpCompleted
      ? `${walk!.hops.length} request(s); final status ${finalResponse!.status}. No scripts executed, no forms submitted, no files downloaded.`
      : `Could not load the page (${walk?.error ?? walkResult.error?.message ?? "unknown error"}).`,
    durationMs: walkResult.ms,
    core: true,
  });

  const page = finalResponse ? extractPage({ finalUrl: finalResponse.url, status: finalResponse.status, headers: finalResponse.headers, body: finalResponse.body, bodyBytes: finalResponse.bodyBytes }) : undefined;
  checks.push({ id: "headers", label: "Security headers & configuration", status: page ? "completed" : "unavailable", detail: page ? `${Object.keys(page.headers).length} relevant header(s) reviewed.` : "No HTTP response to review.", core: false });

  // TLS: inspect the final HTTPS host (or the submitted host when it is HTTPS).
  const finalUrl = finalResponse ? new URL(finalResponse.url) : normalized.url;
  const tlsUrl = finalUrl.protocol === "https:" ? finalUrl : normalized.url.protocol === "https:" ? normalized.url : null;
  let tls: UrlCollection["tls"];
  let ct: UrlCollection["ct"];
  if (tlsUrl && target) {
    const tlsTarget = tlsUrl.hostname === url.hostname ? target : await resolveAllowed(tlsUrl.hostname).catch(() => null);
    const tlsResult = tlsTarget ? await timed(() => probeTls(tlsUrl.hostname, tlsUrl.port ? Number(tlsUrl.port) : 443, tlsTarget)) : null;
    tls = tlsResult?.value ?? undefined;
    checks.push({ id: "tls", label: "TLS certificate inspection", status: tls ? "completed" : "failed", detail: tls ? `${tls.protocol ?? "TLS"}, ${tls.chain.length} certificate(s), verifier: ${tls.authorized ? "trusted" : (tls.authorizationError ?? "untrusted")}.` : `TLS handshake failed (${tlsResult?.error?.message ?? "host unreachable"}).`, durationMs: tlsResult?.ms, core: false } as Check);
    if (tls?.chain[0]) {
      const ctResult = await timed(() => lookupCertificateTransparency(tlsUrl.hostname, tls!.chain[0]!.serialNumber));
      ct = ctResult.value ?? undefined;
      checks.push({ id: "ct", label: "Certificate Transparency (crt.sh)", status: ct?.status === "completed" ? "completed" : "unavailable", detail: ct?.detail ?? "CT search failed.", source: "crt.sh", durationMs: ctResult.ms, core: false });
    }
  } else {
    checks.push({ id: "tls", label: "TLS certificate inspection", status: tlsUrl ? "failed" : "skipped", detail: tlsUrl ? "Host could not be reached." : "The site was served over plain HTTP; no certificate to inspect.", core: false });
  }

  const urlsToCheck = [url.normalized, ...(finalResponse && finalResponse.url !== url.normalized ? [finalResponse.url] : [])];
  const intel = [...(await checkExternalIntel(urlsToCheck)), ...(await repositoryIntel(store, urlsToCheck))];
  checks.push(intelCheck(intel.filter((result) => result.source !== "Veriq repository"), true));

  const collection: UrlCollection = {
    url,
    ...(dns ? { dns: dns.evidence } : {}),
    ...(walk ? { redirects: walk.hops } : {}),
    ...(page ? { page } : {}),
    ...(tls ? { tls } : {}),
    ...(ct ? { ct } : {}),
    intel,
    checks,
    datasets: { openPhish: "community feed (hourly)" },
  };
  const reportId = randomUUID();
  const createdAt = new Date().toISOString();
  const preliminary = assessUrl({ reportId, parentReportId: parent?.report.reportId ?? null, createdAt, collection });
  const related = correlate({ keys: correlationKeysFor(preliminary), shingles: [] }, await correlationRecords(store));
  let report = related.length ? assessUrl({ reportId, parentReportId: parent?.report.reportId ?? null, createdAt, collection, related }) : preliminary;
  report = { ...report, ai: await explainReport(report) };
  return finalize(store, report, ownerId);
}

export async function investigateMessage(store: Store, request: MessageInvestigation, ownerId: string | null = null): Promise<StoredReport> {
  const reportId = randomUUID();
  const createdAt = new Date().toISOString();
  const base = { reportId, createdAt, text: request.text, sender: request.sender, subject: request.subject };
  const preliminary = assessMessage(base);
  const linkUrls = (preliminary.evidence.message?.links ?? []).map((link) => link.normalized).filter((value): value is string => Boolean(value));
  const intel = linkUrls.length ? [...(await checkExternalIntel(linkUrls)), ...(await repositoryIntel(store, linkUrls))] : [];
  const external = intel.filter((result) => result.source !== "Veriq repository");
  const extraChecks: Check[] = linkUrls.length
    ? [{ ...intelCheck(external, false), label: "Threat intelligence for extracted links" }]
    : [{ id: "intel", label: "Threat intelligence for extracted links", status: "skipped", detail: "No links found in the message.", core: false }];
  const related = correlate({ keys: correlationKeysFor(preliminary), shingles: shinglesFor(preliminary) }, await correlationRecords(store));
  let report = assessMessage({ ...base, intel, extraChecks, related });
  report = { ...report, ai: await explainReport(report) };
  return finalize(store, report, ownerId);
}
