import type { MyInvestigation } from "@veriq/contracts";

type Sources = { database: () => Promise<MyInvestigation[]>; scanner: () => Promise<MyInvestigation[]> };
export type HistoryUpdate = { items: MyInvestigation[]; available: boolean; loading: boolean; note: string };

/** Publish each source as soon as it finishes. The scanner's current receipts take precedence. */
export async function loadHistorySources(sources: Sources, update: (result: HistoryUpdate) => void, timeoutMs = 10_000): Promise<void> {
  const values: Partial<Record<keyof Sources, MyInvestigation[]>> = {};
  const failed = new Set<keyof Sources>();
  let pending = 2;
  await Promise.all((Object.keys(sources) as Array<keyof Sources>).map(async source => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      values[source] = await Promise.race([
        Promise.resolve().then(sources[source]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("History source timed out")), timeoutMs); }),
      ]);
    } catch { failed.add(source); }
    finally {
      clearTimeout(timer);
      pending--;
      const merged = new Map<string, MyInvestigation>();
      for (const item of [...(values.database ?? []), ...(values.scanner ?? [])]) merged.set(item.reportId, item);
      const available = values.database !== undefined || values.scanner !== undefined;
      update({
        items: [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        available,
        loading: pending > 0,
        note: failed.size === 2 ? "History couldn’t be loaded. Please retry; this does not mean your investigations were deleted." : failed.size ? "One history source is unavailable. Showing the entries that could be loaded." : "",
      });
    }
  }));
}
