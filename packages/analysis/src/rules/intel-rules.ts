import type { DnsEvidence, IntelResult } from "@veriq/contracts";
import { draft, type FindingDraft } from "../finding";

/** Convert threat-intelligence lookups into findings. Only exact URL listings are authoritative. */
export function analyzeIntel(results: IntelResult[]): FindingDraft[] {
  const findings: FindingDraft[] = [];
  for (const result of results) {
    if (result.status !== "listed") continue;
    const exact = /exact url/i.test(result.matchScope);
    const community = /veriq repository/i.test(result.source);
    if (community) {
      const validated = /validated/i.test(result.detail);
      findings.push(draft({
        ruleId: "intel.community_report", category: "intelligence", severity: validated ? "high" : "medium",
        title: validated ? "Previously reported and validated in the Veriq repository" : "Previously reported to the Veriq threat repository",
        description: result.detail,
        impact: "Community reports add context but are not authoritative on their own.",
        recommendation: "Review the related reports before trusting this destination.",
        evidence: [{ label: "Match scope", value: result.matchScope }],
        source: { name: result.source, type: "community", observedAt: result.checkedAt, ...(result.reference ? { reference: result.reference } : {}) },
        confidence: validated ? "medium" : "low",
      }));
      continue;
    }
    findings.push(draft({
      ruleId: exact ? "intel.listed_exact" : "intel.listed_host",
      category: "intelligence",
      severity: exact ? "critical" : "high",
      title: exact ? `Listed as malicious by ${result.source}` : `Host appears in ${result.source}`,
      description: result.detail,
      impact: exact
        ? "An external threat-intelligence provider has an exact listing for this URL."
        : "Other URLs on this host have been listed. Shared hosting can cause unrelated sites to share a host.",
      recommendation: "Do not open this link or enter any information.",
      evidence: [{ label: "Match scope", value: result.matchScope }, { label: "Checked", value: result.checkedAt }],
      source: { name: result.source, type: "threat_intel", observedAt: result.checkedAt, ...(result.reference ? { reference: result.reference } : {}) },
      authoritative: exact,
      confidence: exact ? "high" : "medium",
    }));
  }
  return findings;
}

/** Domain registration and DNS rules. */
export function analyzeDns(dns: DnsEvidence): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const age = dns.registration?.ageDays;
  if (age !== null && age !== undefined) {
    if (age < 30) {
      findings.push(draft({
        ruleId: "domain.newly_registered", category: "domain", severity: "medium",
        title: "Domain was registered very recently",
        description: `The domain was registered ${age} day(s) ago${dns.registration?.registeredAt ? ` (${dns.registration.registeredAt.slice(0, 10)})` : ""}.`,
        impact: "Most phishing domains are used within days of registration and then abandoned.",
        recommendation: "Be cautious with new domains that claim to represent established organisations.",
        evidence: [{ label: "Registered", value: dns.registration?.registeredAt ?? "" }, { label: "Registrar", value: dns.registration?.registrar ?? "unknown" }],
        source: { name: dns.registration?.source ?? "RDAP", type: "network_observation" }, confidence: "high",
      }));
    } else if (age < 90) {
      findings.push(draft({
        ruleId: "domain.young", category: "domain", severity: "low",
        title: "Domain is less than three months old",
        description: `The domain was registered ${age} days ago.`,
        impact: "Young domains carry slightly elevated risk; context only.",
        recommendation: "Combine with other findings.",
        evidence: [{ label: "Registered", value: dns.registration?.registeredAt ?? "" }],
        source: { name: dns.registration?.source ?? "RDAP", type: "network_observation" },
      }));
    }
  }
  if (!dns.addresses.length) {
    findings.push(draft({
      ruleId: "domain.no_address", category: "domain", severity: "info",
      title: "Domain does not resolve",
      description: "No A or AAAA records were found.",
      impact: "The site may be offline, taken down, or not yet live.",
      recommendation: "An unreachable link cannot be assessed fully.",
      evidence: [],
      source: { name: "DNS", type: "network_observation" },
    }));
  }
  return findings;
}
