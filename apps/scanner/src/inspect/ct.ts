import type { CtEvidence } from "@veriq/contracts";

type CrtShEntry = { issuer_name?: string; serial_number?: string; not_before?: string; entry_timestamp?: string };

/** Query crt.sh for certificates logged for the exact host. Popular domains can time out; that is reported honestly. */
export async function lookupCertificateTransparency(hostname: string, leafSerial: string | null): Promise<CtEvidence> {
  try {
    const response = await fetch(`https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = (await response.json()) as CrtShEntry[];
    const now = Date.now();
    const issuers = new Set<string>();
    let recent = 0;
    for (const entry of entries) {
      const organisation = /O=("[^"]+"|[^,]+)/.exec(entry.issuer_name ?? "")?.[1]?.replace(/"/g, "");
      if (organisation) issuers.add(organisation);
      const logged = Date.parse(entry.entry_timestamp ?? entry.not_before ?? "");
      if (Number.isFinite(logged) && now - logged < 30 * 86_400_000) recent += 1;
    }
    const normalizeSerial = (value: string) => value.toLowerCase().replace(/^0+/, "");
    const leafLogged = leafSerial ? entries.some((entry) => entry.serial_number && normalizeSerial(entry.serial_number) === normalizeSerial(leafSerial)) : null;
    return {
      source: "crt.sh Certificate Transparency search",
      status: "completed",
      detail: `${entries.length} logged certificate(s) for ${hostname}; ${recent} in the last 30 days.`,
      totalCertificates: entries.length,
      issuedLast30Days: recent,
      issuers: [...issuers].slice(0, 10),
      leafLogged,
    };
  } catch (error) {
    return {
      source: "crt.sh Certificate Transparency search",
      status: "unavailable",
      detail: `CT search unavailable (${(error as Error).name === "TimeoutError" ? "timed out" : (error as Error).message}).`,
      totalCertificates: null,
      issuedLast30Days: null,
      issuers: [],
      leafLogged: null,
    };
  }
}
