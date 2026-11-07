import {
  REPORT_SCHEMA_VERSION,
  RISK_LABELS,
  type AiAnalysis,
  type Check,
  type CtEvidence,
  type DnsEvidence,
  type IntelResult,
  type PageEvidence,
  type RedirectHop,
  type RelatedReport,
  type Report,
  type TlsEvidence,
  type UrlEvidence,
} from "@veriq/contracts";
import { CA_DATASET_VERSION } from "./data/ca-trust";
import { draft, finalizeFindings, RULESET_VERSION, type FindingDraft } from "./finding";
import { analyzeMessage } from "./message";
import { POLICY_VERSION, classify, dimensionsFor, limitationsFor, recommendationsFor } from "./policy";
import { analyzeDns, analyzeIntel } from "./rules/intel-rules";
import { analyzePage, analyzeRedirects, analyzeSecurityHeaders } from "./rules/page-rules";
import { analyzeTls } from "./rules/tls-rules";
import { analyzeUrlLexical } from "./rules/url-rules";
import { normalizeTarget } from "./url";

export const ENGINE_VERSION = "veriq-engine-0.2.0";

export type UrlCollection = {
  url: UrlEvidence;
  dns?: DnsEvidence;
  redirects?: RedirectHop[];
  page?: PageEvidence;
  tls?: TlsEvidence;
  ct?: CtEvidence;
  intel?: IntelResult[];
  checks: Check[];
  datasets?: Record<string, string>;
};

export function urlFindings(collection: UrlCollection): FindingDraft[] {
  const drafts: FindingDraft[] = [...analyzeUrlLexical(collection.url)];
  if (collection.dns) drafts.push(...analyzeDns(collection.dns));
  if (collection.redirects) {
    drafts.push(...analyzeRedirects(collection.url, collection.redirects));
    const final = [...collection.redirects].reverse().find((hop) => hop.status !== null);
    if (final && final.host !== collection.url.hostname) {
      const destination = normalizeTarget(final.url);
      if (destination.ok) drafts.push(...analyzeUrlLexical(destination.value, `Final destination (${destination.value.hostname})`));
    }
  }
  if (collection.page) {
    drafts.push(...analyzePage(collection.url, collection.page));
    drafts.push(...analyzeSecurityHeaders(collection.page));
  }
  if (collection.tls) drafts.push(...analyzeTls(collection.tls, collection.ct));
  if (collection.intel) drafts.push(...analyzeIntel(collection.intel));
  return drafts;
}

export function correlationFindings(related: RelatedReport[]): FindingDraft[] {
  const strongBad = related.filter((item) => item.strength !== "weak" && ["high_risk", "confirmed_malicious"].includes(item.classification));
  if (!strongBad.length) return [];
  return [draft({
    ruleId: "correlation.linked_incidents", category: "correlation", severity: "medium",
    title: `Linked to ${strongBad.length} previously reported high-risk incident(s)`,
    description: `This submission shares ${strongBad[0]!.matches.map((match) => match.display).slice(0, 3).join(", ")} with reports in the Veriq repository.`,
    impact: "Repeated infrastructure or payment destinations suggest an ongoing campaign.",
    recommendation: "Review the linked reports in the repository.",
    evidence: strongBad.slice(0, 5).map((item) => ({ label: item.publicId.slice(0, 12), value: item.matches.map((match) => match.method).join("; ") })),
    source: { name: "Veriq repository correlation", type: "community" },
  })];
}

export function disabledAi(summary: string, note = "Summary generated from Veriq's deterministic findings."): AiAnalysis {
  return { status: "disabled", provider: null, model: null, promptVersion: "none", summary, explanations: [], observations: [], discarded: 0, note };
}

type AssembleInput = {
  reportId: string;
  parentReportId: string | null;
  kind: "url" | "message";
  createdAt: string;
  subject: Report["subject"];
  evidence: Report["evidence"];
  drafts: FindingDraft[];
  checks: Check[];
  related: RelatedReport[];
  datasets?: Record<string, string>;
};

export function assembleReport(input: AssembleInput): Report {
  const findings = finalizeFindings(input.drafts);
  const decision = classify(findings, input.checks);
  const completed = input.checks.filter((check) => check.status === "completed").length;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    parentReportId: input.parentReportId,
    kind: input.kind,
    createdAt: input.createdAt,
    subject: input.subject,
    risk: {
      classification: decision.classification,
      label: RISK_LABELS[decision.classification],
      summary: decision.summary,
      rationale: decision.rationale,
      confidence: decision.confidence,
    },
    coverage: {
      completed,
      total: input.checks.length,
      unavailable: input.checks.filter((check) => check.status !== "completed" && check.status !== "skipped").map((check) => check.label),
    },
    dimensions: dimensionsFor(input.kind, findings, input.checks),
    findings,
    checks: input.checks,
    evidence: input.evidence,
    related: input.related,
    ai: disabledAi(decision.summary),
    recommendations: recommendationsFor(decision.classification, findings, input.kind),
    limitations: limitationsFor(input.kind, input.checks),
    versions: {
      engine: ENGINE_VERSION,
      rules: RULESET_VERSION,
      policy: POLICY_VERSION,
      datasets: { caTrust: CA_DATASET_VERSION, ...(input.datasets ?? {}) },
    },
  };
}

export function assessUrl(input: { reportId: string; parentReportId?: string | null; createdAt: string; collection: UrlCollection; related?: RelatedReport[]; extraDrafts?: FindingDraft[] }): Report {
  const { collection } = input;
  const related = input.related ?? [];
  return assembleReport({
    reportId: input.reportId,
    parentReportId: input.parentReportId ?? null,
    kind: "url",
    createdAt: input.createdAt,
    subject: { display: collection.url.normalized, registrableDomain: collection.url.registrableDomain },
    evidence: {
      url: collection.url,
      ...(collection.dns ? { dns: collection.dns } : {}),
      ...(collection.redirects ? { redirects: collection.redirects } : {}),
      ...(collection.page ? { page: collection.page } : {}),
      ...(collection.tls ? { tls: collection.tls } : {}),
      ...(collection.ct ? { ct: collection.ct } : {}),
      ...(collection.intel ? { intel: collection.intel } : {}),
    },
    drafts: [...urlFindings(collection), ...correlationFindings(related), ...(input.extraDrafts ?? [])],
    checks: collection.checks,
    related,
    ...(collection.datasets ? { datasets: collection.datasets } : {}),
  });
}

export function assessMessage(input: {
  reportId: string;
  createdAt: string;
  text: string;
  sender?: string | undefined;
  subject?: string | undefined;
  intel?: IntelResult[];
  extraChecks?: Check[];
  related?: RelatedReport[];
  datasets?: Record<string, string>;
}): Report {
  const analysis = analyzeMessage({ text: input.text, sender: input.sender, subject: input.subject });
  const related = input.related ?? [];
  const checks: Check[] = [
    { id: "extraction", label: "Indicator extraction", status: "completed", detail: `${analysis.evidence.indicators.length} indicator(s) extracted; raw values redacted.`, core: true },
    { id: "cues", label: "Social-engineering analysis", status: "completed", detail: `${analysis.evidence.cues.length} cue type(s) detected.`, core: true },
    { id: "links", label: "Link analysis (not opened)", status: "completed", detail: `${analysis.evidence.links.length} link(s) analysed lexically.`, core: false },
    ...(input.extraChecks ?? []),
  ];
  return assembleReport({
    reportId: input.reportId,
    parentReportId: null,
    kind: "message",
    createdAt: input.createdAt,
    subject: { display: `Pasted message (${analysis.evidence.characters} characters)`, registrableDomain: null },
    evidence: { message: analysis.evidence, ...(input.intel ? { intel: input.intel } : {}) },
    drafts: [...analysis.findings, ...(input.intel ? analyzeIntel(input.intel) : []), ...correlationFindings(related)],
    checks,
    related,
    ...(input.datasets ? { datasets: input.datasets } : {}),
  });
}
