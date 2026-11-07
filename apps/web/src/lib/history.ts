import type { InvestigationResponse, RiskClass } from "@veriq/contracts";
import { investigationResponseSchema } from "@veriq/contracts";

/** Investigations are private by default: the history lives only in this browser. */
export type HistoryItem = { id: string; kind: "url" | "message"; subject: string; classification: RiskClass; label: string; createdAt: string };

const KEY = "veriq.history.v1";
const CACHE_PREFIX = "veriq.report.";

export function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function remember(response: InvestigationResponse) {
  const report = response.report;
  const item: HistoryItem = {
    id: report.reportId,
    kind: report.kind,
    subject: report.kind === "url" ? (report.evidence.url?.hostname ?? report.subject.display) : report.subject.display,
    classification: report.risk.classification,
    label: report.risk.label,
    createdAt: report.createdAt,
  };
  try {
    const next = [item, ...readHistory().filter((entry) => entry.id !== item.id)].slice(0, 30);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.sessionStorage.setItem(`${CACHE_PREFIX}${report.reportId}`, JSON.stringify(response));
  } catch {
    // Storage can be full or disabled; history is a convenience only.
  }
}

export function cachedReport(id: string): InvestigationResponse | null {
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = investigationResponseSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    window.sessionStorage.removeItem(`${CACHE_PREFIX}${id}`);
    return null;
  } catch {
    return null;
  }
}

export function clearHistory() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
