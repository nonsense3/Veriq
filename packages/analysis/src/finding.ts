import type { EvidenceConfidence, Finding, FindingCategory, Severity } from "@veriq/contracts";

export type FindingDraft = Omit<Finding, "id">;

export const RULESET_VERSION = "veriq-rules-2026.11.1";

type DraftInput = {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  evidence?: Array<{ label: string; value: string }>;
  source?: Finding["source"];
  authoritative?: boolean;
  confidence?: EvidenceConfidence;
  ruleVersion?: number;
};

export function draft(input: DraftInput): FindingDraft {
  return {
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion ?? 1,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    impact: input.impact,
    recommendation: input.recommendation,
    evidence: input.evidence ?? [],
    source: input.source ?? { name: "Veriq deterministic rules", type: "veriq_rule", reference: RULESET_VERSION },
    authoritative: input.authoritative ?? false,
    confidence: input.confidence ?? "medium",
  };
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Give drafts stable IDs ordered by severity, then by rule ID, so equal evidence produces equal reports. */
export function finalizeFindings(drafts: FindingDraft[]): Finding[] {
  const unique = new Map<string, FindingDraft>();
  for (const item of drafts) {
    const key = `${item.ruleId}|${item.evidence.map((entry) => entry.value).join("|")}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.ruleId.localeCompare(b.ruleId))
    .map((item, index) => ({ id: `F${String(index + 1).padStart(2, "0")}`, ...item }));
}
