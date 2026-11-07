import { RISK_LABELS, type Check, type Dimension, type EvidenceConfidence, type Finding, type FindingCategory, type RiskClass } from "@veriq/contracts";

export const POLICY_VERSION = "veriq-policy-2026.11.1";

export type Classification = { classification: RiskClass; rationale: string[]; confidence: EvidenceConfidence; summary: string };

/** Categories that decide the overall risk class. Configuration hygiene is reported separately. */
const THREAT_CATEGORIES: FindingCategory[] = ["phishing", "domain", "redirect", "tls", "intelligence", "message", "correlation"];

/**
 * Versioned decision policy.
 * - Confirmed Malicious requires an authoritative exact match (never AI, never heuristics alone).
 * - High Risk needs a critical finding or several significant corroborating findings.
 * - Missing security headers and other configuration findings never raise the class.
 * - When a core check could not run and nothing significant was found, the result is Inconclusive, not Low Risk.
 */
export function classify(findings: Finding[], checks: Check[]): Classification {
  const threat = findings.filter((finding) => THREAT_CATEGORIES.includes(finding.category));
  const authoritative = threat.filter((finding) => finding.authoritative && (finding.severity === "critical" || finding.severity === "high"));
  const critical = threat.filter((finding) => finding.severity === "critical");
  const high = threat.filter((finding) => finding.severity === "high");
  const medium = threat.filter((finding) => finding.severity === "medium");
  const low = threat.filter((finding) => finding.severity === "low");
  const significantCategories = new Set([...critical, ...high, ...medium].map((finding) => finding.category));
  const incompleteCore = checks.filter((check) => check.core && check.status !== "completed");
  const rationale: string[] = [];

  let classification: RiskClass;
  if (authoritative.length) {
    classification = "confirmed_malicious";
    rationale.push(`Authoritative match: ${authoritative.map((finding) => `${finding.title} (${finding.source.name})`).join("; ")}.`);
  } else if (critical.length) {
    classification = "high_risk";
    rationale.push(`Critical finding: ${critical.map((finding) => finding.title).join("; ")}.`);
  } else if (high.length >= 2 || (high.length === 1 && medium.length >= 1) || medium.length >= 3) {
    classification = "high_risk";
    rationale.push(`${high.length} high and ${medium.length} medium-severity indicators corroborate each other across ${significantCategories.size} area(s).`);
  } else if (high.length === 1 || medium.length >= 1 || low.length >= 4) {
    classification = "suspicious";
    if (high.length) rationale.push(`One high-severity indicator: ${high[0]!.title}.`);
    if (medium.length) rationale.push(`${medium.length} medium-severity indicator(s) need further investigation.`);
    if (!high.length && !medium.length) rationale.push(`${low.length} weak indicators together warrant caution.`);
  } else if (incompleteCore.length) {
    classification = "inconclusive";
    rationale.push(`Core checks did not complete: ${incompleteCore.map((check) => check.label).join(", ")}. Absence of findings is not evidence of safety.`);
  } else {
    classification = "low_risk";
    rationale.push("No significant malicious indicators were found in the checks that completed.");
    if (low.length) rationale.push(`${low.length} weak contextual signal(s) were noted but do not indicate a threat on their own.`);
  }
  if (incompleteCore.length && classification !== "inconclusive") {
    rationale.push(`Some checks were unavailable (${incompleteCore.map((check) => check.label).join(", ")}); the result may understate risk.`);
  }
  const configCount = findings.filter((finding) => finding.category === "configuration" && finding.severity !== "info").length;
  if (configCount) rationale.push(`${configCount} security-configuration issue(s) are reported separately and do not by themselves indicate phishing.`);

  const completed = checks.filter((check) => check.status === "completed").length;
  const coverage = checks.length ? completed / checks.length : 0;
  let confidence: EvidenceConfidence;
  switch (classification) {
    case "confirmed_malicious":
      confidence = "high";
      break;
    case "high_risk":
      confidence = critical.length || (high.length + medium.length >= 3 && significantCategories.size >= 2) ? "high" : "medium";
      break;
    case "suspicious":
      confidence = high.length + medium.length >= 2 ? "medium" : "low";
      break;
    case "low_risk":
      confidence = coverage >= 0.85 ? "high" : coverage >= 0.6 ? "medium" : "low";
      break;
    default:
      confidence = "low";
  }
  return { classification, rationale, confidence, summary: summaryFor(classification, findings) };
}

function summaryFor(classification: RiskClass, findings: Finding[]): string {
  const top = findings.find((finding) => finding.category !== "configuration" && finding.severity !== "info");
  switch (classification) {
    case "confirmed_malicious":
      return `${RISK_LABELS[classification]}: ${top?.title ?? "listed by threat intelligence"}. Do not open or interact.`;
    case "high_risk":
      return `${RISK_LABELS[classification]}: ${top?.title ?? "several significant indicators"}. Avoid entering any information.`;
    case "suspicious":
      return `${RISK_LABELS[classification]}: ${top?.title ?? "indicators need review"}. Verify independently before trusting.`;
    case "inconclusive":
      return "Inconclusive: not enough checks completed to assess this. Treat it as unverified.";
    default:
      return "Low Risk: no significant malicious indicators within the checks performed. This is not a guarantee of safety.";
  }
}

const DIMENSION_CATEGORIES: Record<string, FindingCategory[]> = {
  phishing: ["phishing", "domain", "redirect"],
  tls: ["tls"],
  configuration: ["configuration"],
  intelligence: ["intelligence", "correlation"],
  message: ["message"],
};

export function dimensionsFor(kind: "url" | "message", findings: Finding[], checks: Check[]): Record<string, Dimension> {
  const wanted = kind === "url" ? ["phishing", "tls", "configuration", "intelligence"] : ["message", "phishing", "intelligence"];
  const result: Record<string, Dimension> = {};
  for (const name of wanted) {
    const categories = DIMENSION_CATEGORIES[name] ?? [];
    const related = findings.filter((finding) => categories.includes(finding.category) && finding.severity !== "info");
    const relatedChecks = checks.filter((check) => checkDimension(check.id) === name);
    const skipped = relatedChecks.length > 0 && relatedChecks.every((check) => check.status === "skipped");
    const unavailable = relatedChecks.length > 0 && relatedChecks.every((check) => check.status !== "completed");
    const worst = related.some((finding) => finding.severity === "critical" || finding.severity === "high")
      ? "critical"
      : related.length
        ? "concern"
        : skipped
          ? "not_applicable"
          : unavailable
            ? "unavailable"
            : "clear";
    result[name] = {
      status: worst,
      note:
        worst === "clear"
          ? "No issues found in the checks that ran."
          : worst === "not_applicable"
            ? relatedChecks[0]?.detail ?? "Not applicable to this submission."
            : worst === "unavailable"
            ? "These checks could not run."
            : `${related.length} finding(s); highest: ${related[0]?.title ?? ""}`,
    };
    if (name === "tls" && related.some((finding) => finding.ruleId === "tls.compromised_ca_key" || finding.ruleId === "tls.distrusted_root")) {
      result[name] = { status: "critical", note: "Compromised or distrusted certificate trust (advisory-backed)." };
    }
  }
  return result;
}

function checkDimension(checkId: string): string {
  if (["tls", "ct"].includes(checkId)) return "tls";
  if (["headers"].includes(checkId)) return "configuration";
  if (["intel", "repository", "correlation"].includes(checkId) || checkId.startsWith("intel")) return "intelligence";
  if (["extraction", "cues"].includes(checkId)) return "message";
  return "phishing";
}

export function recommendationsFor(classification: RiskClass, findings: Finding[], kind: "url" | "message"): string[] {
  const base: Record<RiskClass, string[]> = {
    confirmed_malicious: ["Do not open the link or reply to the message.", "If you already entered details, change the password from a trusted device and contact your bank immediately."],
    high_risk: ["Do not enter passwords, OTPs or payment details.", "Reach the organisation through its official app or a number you already trust."],
    suspicious: ["Verify the sender or site through an independent channel before acting."],
    inconclusive: ["Treat this as unverified. Retry later or verify through official channels."],
    low_risk: ["Stay alert: only the checks listed here were performed, and sites can change after inspection."],
  };
  const fromFindings = findings
    .filter((finding) => finding.category !== "configuration" && finding.severity !== "info")
    .map((finding) => finding.recommendation);
  const reporting = kind === "message" || classification === "confirmed_malicious" || classification === "high_risk"
    ? ["Report fraud to your bank and to the national cybercrime helpline (1930 / cybercrime.gov.in in India)."]
    : [];
  return [...new Set([...base[classification], ...fromFindings, ...reporting])].slice(0, 7);
}

export function limitationsFor(kind: "url" | "message", checks: Check[]): string[] {
  const limitations = kind === "url"
    ? [
        "Veriq performs passive inspection only: it does not execute page scripts, submit forms or download files, so content rendered by JavaScript was not observed.",
        "Certificate revocation status (OCSP/CRL) is not queried; only stapled-OCSP presence and verifier results are reported.",
        "Threat-intelligence feeds cover known threats only. Absence from a feed is not proof of safety.",
        "A valid TLS certificate proves the connection is encrypted to the named domain; it does not prove the website is legitimate.",
        "Veriq cannot detect a certificate authority's internal key-generation weakness from a URL; compromised-CA findings rely on published advisories.",
      ]
    : [
        "Links in the message were analysed lexically only and were not opened. Investigate a link explicitly to inspect it.",
        "Language cues indicate risk patterns; urgent wording alone is not evidence of fraud.",
        "Sender information is self-reported and cannot be authenticated without the original email headers.",
      ];
  for (const check of checks) {
    if (check.status !== "completed" && check.status !== "skipped") limitations.push(`${check.label}: ${check.detail}`);
  }
  return limitations;
}
