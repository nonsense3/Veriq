import ipaddr from "ipaddr.js";

/** Ports a passive inspection may connect to. Everything else is refused. */
export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export type AddressDecision = { allowed: boolean; range: string; address: string };

/**
 * Only globally routable unicast addresses are allowed. This blocks loopback, private (RFC 1918),
 * carrier-grade NAT, link-local (including cloud metadata 169.254.169.254), multicast, reserved,
 * unique-local IPv6, 6to4/Teredo/NAT64 translation ranges and IPv4-mapped IPv6 forms of all of these.
 */
export function classifyAddress(address: string): AddressDecision {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!ipaddr.isValid(bare)) return { allowed: false, range: "invalid", address: bare };
  const parsed = ipaddr.process(bare); // converts IPv4-mapped IPv6 to IPv4
  const range = parsed.range();
  return { allowed: range === "unicast", range, address: parsed.toString() };
}

export function isPortAllowed(port: number | null): boolean {
  return port === null || ALLOWED_PORTS.has(port);
}
