import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyInvestigation } from "../packages/contracts/src/index";
import { loadHistorySources, type HistoryUpdate } from "../apps/web/src/lib/account-history";

const item: MyInvestigation = { reportId: "00000000-0000-4000-8000-000000000001", kind: "url", subject: "example.com", classification: "low_risk", label: "Low Risk", createdAt: "2026-11-08T00:00:00Z", findings: 0, registry: "unregistered", published: false };
afterEach(() => vi.useRealTimers());

describe("independent account history sources", () => {
  it("shows database history while the scanner is stalled and eventually finishes loading", async () => {
    vi.useFakeTimers();
    const updates: HistoryUpdate[] = [];
    const task = loadHistorySources({ database: async () => [item], scanner: () => new Promise(() => {}) }, result => updates.push(result), 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates[0]).toMatchObject({ items: [item], available: true, loading: true });
    await vi.advanceTimersByTimeAsync(1000);
    await task;
    expect(updates.at(-1)).toMatchObject({ items: [item], available: true, loading: false });
    expect(updates.at(-1)?.note).toContain("One history source");
  });

  it("also shows scanner history when the database fails", async () => {
    const updates: HistoryUpdate[] = [];
    await loadHistorySources({ database: async () => { throw Error("Database failed"); }, scanner: async () => [item] }, result => updates.push(result));
    expect(updates.at(-1)).toMatchObject({ items: [item], available: true, loading: false });
  });

  it("deduplicates reports and prefers the scanner's newer registry receipt", async () => {
    const updates: HistoryUpdate[] = [];
    const current = { ...item, registry: "confirmed" as const };
    await loadHistorySources({ database: async () => [item], scanner: async () => [current] }, result => updates.push(result));
    expect(updates.at(-1)?.items).toEqual([current]);
  });

  it("distinguishes an outage from a genuinely empty account", async () => {
    const updates: HistoryUpdate[] = [];
    const fail = async () => { throw Error("Unavailable"); };
    await loadHistorySources({ database: fail, scanner: fail }, result => updates.push(result));
    expect(updates.at(-1)).toMatchObject({ available: false, loading: false });
    expect(updates.at(-1)?.note).toContain("does not mean your investigations were deleted");
    await loadHistorySources({ database: async () => [], scanner: async () => [] }, result => updates.push(result));
    expect(updates.at(-1)).toEqual({ available: true, loading: false, items: [], note: "" });
  });

  it("ignores a source that returns after its deadline", async () => {
    vi.useFakeTimers();
    let finish!: (items: MyInvestigation[]) => void;
    const update = vi.fn();
    const task = loadHistorySources({ database: async () => [], scanner: () => new Promise(resolve => { finish = resolve; }) }, update, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await task;
    const count = update.mock.calls.length;
    finish([item]);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(count);
  });
});
