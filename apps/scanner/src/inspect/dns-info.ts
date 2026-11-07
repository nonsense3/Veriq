import type { DnsEvidence } from "@veriq/contracts";
import { Resolver } from "node:dns/promises";

const resolver = new Resolver({ timeout: 3000, tries: 2 });

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Registration date from RDAP (the IANA-bootstrapped successor to WHOIS). Fixed, trusted endpoint only. */
async function rdap(domain: string): Promise<DnsEvidence["registration"]> {
  try {
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
      entities?: Array<{ roles?: string[]; vcardArray?: [string, Array<[string, unknown, string, string]>] }>;
    };
    const registeredAt = body.events?.find((event) => event.eventAction === "registration")?.eventDate ?? null;
    const registrar = body.entities?.find((entity) => entity.roles?.includes("registrar"))?.vcardArray?.[1]?.find((entry) => entry[0] === "fn")?.[3] ?? null;
    const ageDays = registeredAt ? Math.floor((Date.now() - Date.parse(registeredAt)) / 86_400_000) : null;
    return { source: "RDAP (rdap.org bootstrap)", registeredAt, ageDays: Number.isFinite(ageDays) ? ageDays : null, registrar: registrar ? String(registrar).slice(0, 120) : null };
  } catch {
    return null;
  }
}

export async function collectDns(hostname: string, registrableDomain: string | null): Promise<{ evidence: DnsEvidence; rdapAvailable: boolean }> {
  const [a, aaaa, cname, mx, ns, registration] = await Promise.all([
    settle(resolver.resolve4(hostname), [] as string[]),
    settle(resolver.resolve6(hostname), [] as string[]),
    settle(resolver.resolveCname(hostname), [] as string[]),
    registrableDomain ? settle(resolver.resolveMx(registrableDomain), []) : Promise.resolve([]),
    registrableDomain ? settle(resolver.resolveNs(registrableDomain), [] as string[]) : Promise.resolve([] as string[]),
    registrableDomain ? rdap(registrableDomain) : Promise.resolve(null),
  ]);
  return {
    evidence: {
      addresses: [...a, ...aaaa].slice(0, 16),
      cname: cname.slice(0, 5),
      mx: mx.map((record) => record.exchange).slice(0, 8),
      ns: ns.slice(0, 8),
      registration,
    },
    rdapAvailable: registration !== null,
  };
}
