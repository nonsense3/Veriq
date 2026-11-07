import type { UrlEvidence } from "@veriq/contracts";
import { parse } from "tldts";
import { domainToUnicode } from "./text";

export type NormalizeFailure = {
  ok: false;
  code: "URL_INVALID" | "UNSUPPORTED_SCHEME" | "HOST_NOT_PUBLIC";
  message: string;
};
export type NormalizeSuccess = { ok: true; value: UrlEvidence; url: URL };
export type NormalizeResult = NormalizeSuccess | NormalizeFailure;

/** Undo common "defanging" so analysts can paste `hxxps://evil[.]com`. */
export function refang(input: string): string {
  return input
    .replace(/^hxxp/i, "http")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]/gi, ".")
    .replace(/\[:\]/g, ":");
}

/**
 * Normalise a submitted URL or bare domain. Bare domains become explicit HTTPS targets.
 * Embedded credentials are recorded (they are a phishing trick) and stripped before any request.
 */
export function normalizeTarget(rawInput: string): NormalizeResult {
  let input = refang(rawInput.trim()).replace(/^<|>$/g, "").replace(/^["']|["']$/g, "");
  if (!input) return { ok: false, code: "URL_INVALID", message: "Enter a URL or domain." };
  if (/\s/.test(input)) return { ok: false, code: "URL_INVALID", message: "A URL cannot contain spaces." };
  if (input.length > 2048) return { ok: false, code: "URL_INVALID", message: "The URL is too long." };

  const scheme = /^([a-z][a-z0-9+\-]*):/i.exec(input)?.[1]?.toLowerCase();
  const looksLikeHostPort = /^[^/]+\.[^/]+:\d+/.test(input) && !input.includes("://");
  if (scheme && !looksLikeHostPort) {
    if (scheme !== "http" && scheme !== "https") {
      return { ok: false, code: "UNSUPPORTED_SCHEME", message: "Only HTTP and HTTPS links can be investigated." };
    }
    if (!/^https?:\/\//i.test(input)) input = input.replace(/^(https?):\/*/i, "$1://");
  } else {
    input = `https://${input.replace(/^\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: "URL_INVALID", message: "This does not look like a valid URL or domain." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "UNSUPPORTED_SCHEME", message: "Only HTTP and HTTPS links can be investigated." };
  }

  const hadUserinfo = Boolean(url.username || url.password);
  url.username = "";
  url.password = "";
  url.hash = "";
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname) return { ok: false, code: "URL_INVALID", message: "The URL has no host name." };
  url.hostname = hostname;

  const bareHost = hostname.replace(/^\[|\]$/g, "");
  const parsed = parse(bareHost, { allowPrivateDomains: true });
  const isIp = Boolean(parsed.isIp);
  if (!isIp && !(parsed.isIcann || parsed.isPrivate)) {
    return {
      ok: false,
      code: "HOST_NOT_PUBLIC",
      message: "Only public internet domains can be investigated. Local, internal and unknown top-level domains are refused.",
    };
  }
  if (!isIp && !parsed.domain) {
    return { ok: false, code: "URL_INVALID", message: "The host is a public suffix, not a website domain." };
  }

  return {
    ok: true,
    url,
    value: {
      input: rawInput.trim().slice(0, 2048),
      normalized: url.toString(),
      scheme: url.protocol.replace(":", ""),
      hostname: bareHost,
      unicodeHostname: isIp ? bareHost : domainToUnicode(bareHost),
      registrableDomain: isIp ? null : (parsed.domain ?? null),
      publicSuffix: isIp ? null : (parsed.publicSuffix ?? null),
      subdomain: isIp ? null : parsed.subdomain || null,
      port: url.port ? Number(url.port) : null,
      isIp,
      hadUserinfo,
      path: url.pathname,
      query: url.search,
    },
  };
}

export function registrableDomainOf(hostname: string): string | null {
  const parsed = parse(hostname, { allowPrivateDomains: true });
  return parsed.isIp ? null : (parsed.domain ?? null);
}

/** Registrable label without the public suffix, e.g. `paypa1-login` for `paypa1-login.co.uk`. */
export function registrableLabel(u: Pick<UrlEvidence, "registrableDomain" | "publicSuffix">): string {
  if (!u.registrableDomain) return "";
  if (!u.publicSuffix) return u.registrableDomain;
  return u.registrableDomain.slice(0, -(u.publicSuffix.length + 1));
}
