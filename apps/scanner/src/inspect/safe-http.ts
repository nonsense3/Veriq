import { classifyAddress, isPortAllowed } from "@veriq/analysis";
import type { RedirectHop } from "@veriq/contracts";
import { promises as dns, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { config } from "../config";
import { PolicyBlockedError } from "../errors";

export type ResolvedTarget = { address: string; family: 4 | 6 };

/**
 * Resolve a host and validate every returned address. If any address is non-public the whole host is refused,
 * which defeats split-horizon tricks where one A record is public and another is internal.
 */
export async function resolveAllowed(host: string): Promise<ResolvedTarget> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    const decision = classifyAddress(bare);
    if (!decision.allowed) throw new PolicyBlockedError(`${bare} is a ${decision.range} address`);
    return { address: decision.address, family: isIP(decision.address) === 6 ? 6 : 4 };
  }
  let records: LookupAddress[];
  try {
    records = await dns.lookup(bare, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`DNS_FAILED: ${(error as NodeJS.ErrnoException).code ?? "lookup failed"}`);
  }
  if (!records.length) throw new Error("DNS_FAILED: no addresses");
  for (const record of records) {
    const decision = classifyAddress(record.address);
    if (!decision.allowed) throw new PolicyBlockedError(`${bare} resolves to ${record.address} (${decision.range})`);
  }
  const first = records[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** A lookup function that only ever returns the pre-validated address, so the socket connects where we checked. */
function pinnedLookup(target: ResolvedTarget) {
  return (_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (wantsAll) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}

export type FetchResult = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer | null;
  bodyBytes: number;
  address: string;
};

const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

function fetchOnce(url: URL, target: ResolvedTarget): Promise<FetchResult> {
  const client = url.protocol === "https:" ? https : http;
  const servername = isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname;
  return new Promise((resolvePromise, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: pinnedLookup(target) as never,
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "accept-language": "en",
          "accept-encoding": "gzip, deflate, br",
        },
        timeout: config.limits.requestTimeoutMs,
        // The certificate is inspected separately; accepting it here lets us still analyse the page content.
        rejectUnauthorized: false,
        ...(servername ? { servername } : {}),
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "");
        const declared = Number(response.headers["content-length"] ?? 0);
        if ((status >= 300 && status < 400) || !TEXT_TYPES.test(contentType)) {
          response.destroy();
          resolvePromise({ url: url.toString(), status, headers: response.headers, body: null, bodyBytes: Number.isFinite(declared) ? declared : 0, address: target.address });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > config.limits.maxBodyBytes) {
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          let body = Buffer.concat(chunks);
          const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
          try {
            const options = { maxOutputLength: config.limits.maxBodyBytes * 2 };
            if (encoding === "gzip") body = zlib.gunzipSync(body, options);
            else if (encoding === "deflate") body = zlib.inflateSync(body, options);
            else if (encoding === "br") body = zlib.brotliDecompressSync(body, options);
          } catch {
            // Truncated or oversized compressed body; keep what we have (may be binary garbage, parsed defensively).
          }
          resolvePromise({ url: url.toString(), status, headers: response.headers, body, bodyBytes: size, address: target.address });
        };
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", finish);
      },
    );
    request.on("timeout", () => request.destroy(new Error("TARGET_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

export type RedirectWalk = { hops: RedirectHop[]; final: FetchResult | null; error: string | null };

/**
 * Follow redirects manually. Every hop is re-parsed, scheme/port-checked, DNS-resolved and validated before
 * connecting, so a redirect cannot escape the network policy. Scripts and meta refreshes are never followed.
 */
export async function walkRedirects(start: URL): Promise<RedirectWalk> {
  const hops: RedirectHop[] = [];
  let current = new URL(start.toString());
  for (let index = 0; index <= config.limits.maxRedirects; index += 1) {
    if (index === config.limits.maxRedirects) {
      hops.push({ url: current.toString(), status: null, host: current.hostname, address: null, location: null, error: "REDIRECT_LIMIT" });
      return { hops, final: null, error: "REDIRECT_LIMIT" };
    }
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      hops.push({ url: current.toString(), status: null, host: current.hostname, address: null, location: null, error: `DESTINATION_BLOCKED: unsupported scheme ${current.protocol}` });
      return { hops, final: null, error: "DESTINATION_BLOCKED" };
    }
    if (current.username || current.password) {
      current.username = "";
      current.password = "";
    }
    const port = current.port ? Number(current.port) : null;
    if (!isPortAllowed(port)) {
      hops.push({ url: current.toString(), status: null, host: current.hostname, address: null, location: null, error: `DESTINATION_BLOCKED: port ${port} is not allowed` });
      return { hops, final: null, error: "DESTINATION_BLOCKED" };
    }
    let target: ResolvedTarget;
    try {
      target = await resolveAllowed(current.hostname);
    } catch (error) {
      const blocked = error instanceof PolicyBlockedError;
      hops.push({ url: current.toString(), status: null, host: current.hostname, address: null, location: null, error: blocked ? `DESTINATION_BLOCKED: ${error.message}` : (error as Error).message });
      return { hops, final: null, error: blocked ? "DESTINATION_BLOCKED" : (error as Error).message };
    }
    let result: FetchResult;
    try {
      result = await fetchOnce(current, target);
    } catch (error) {
      const message = (error as Error).message === "TARGET_TIMEOUT" ? "TARGET_TIMEOUT" : `CONNECTION_FAILED: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`;
      hops.push({ url: current.toString(), status: null, host: current.hostname, address: target.address, location: null, error: message });
      return { hops, final: null, error: message };
    }
    const location = typeof result.headers.location === "string" ? result.headers.location : null;
    hops.push({ url: current.toString(), status: result.status, host: current.hostname, address: target.address, location, error: null });
    if (result.status >= 300 && result.status < 400 && location) {
      try {
        current = new URL(location, current);
        current.hash = "";
      } catch {
        return { hops, final: result, error: "INVALID_REDIRECT" };
      }
      continue;
    }
    return { hops, final: result, error: null };
  }
  return { hops, final: null, error: "REDIRECT_LIMIT" };
}
