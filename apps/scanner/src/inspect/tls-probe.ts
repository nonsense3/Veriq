import type { CertificateSummary, TlsEvidence } from "@veriq/contracts";
import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import tls from "node:tls";
import { config } from "../config";
import type { ResolvedTarget } from "./safe-http";

const SIGNATURE_OIDS: Record<string, string> = {
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "rsassaPss",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
};

const CURVE_BITS: Record<string, number> = { prime256v1: 256, "P-256": 256, secp384r1: 384, "P-384": 384, secp521r1: 521, "P-521": 521, secp256k1: 256, prime192v1: 192, secp224r1: 224 };

/** CT precertificate SCT list extension, OID 1.3.6.1.4.1.11129.2.4.2, DER-encoded. */
const SCT_OID = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x04, 0x02]);

function readLength(der: Buffer, offset: number): { length: number; next: number } {
  const first = der[offset] ?? 0;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const bytes = first & 0x7f;
  let length = 0;
  for (let index = 0; index < bytes; index += 1) length = length * 256 + (der[offset + 1 + index] ?? 0);
  return { length, next: offset + 1 + bytes };
}

function decodeOid(bytes: Buffer): string {
  const parts: number[] = [];
  const first = bytes[0] ?? 0;
  parts.push(Math.floor(first / 40), first % 40);
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/** Read Certificate.signatureAlgorithm (the outer AlgorithmIdentifier following tbsCertificate). */
export function signatureAlgorithmOf(der: Buffer): string | null {
  try {
    if (der[0] !== 0x30) return null;
    const outer = readLength(der, 1);
    let cursor = outer.next;
    if (der[cursor] !== 0x30) return null;
    const tbs = readLength(der, cursor + 1);
    cursor = tbs.next + tbs.length;
    if (der[cursor] !== 0x30) return null;
    const algorithm = readLength(der, cursor + 1);
    cursor = algorithm.next;
    if (der[cursor] !== 0x06) return null;
    const oid = readLength(der, cursor + 1);
    const dotted = decodeOid(der.subarray(oid.next, oid.next + oid.length));
    return SIGNATURE_OIDS[dotted] ?? dotted;
  } catch {
    return null;
  }
}

function flattenDn(dn: string): string {
  return dn.split("\n").filter(Boolean).join(", ");
}

export function summarizeCertificate(cert: X509Certificate, position: number, now = Date.now()): CertificateSummary {
  const key = cert.publicKey;
  const details = key.asymmetricKeyDetails ?? {};
  const keyType = key.asymmetricKeyType ?? "unknown";
  const curve = (details as { namedCurve?: string }).namedCurve ?? null;
  let spkiSha256: string | null = null;
  try {
    spkiSha256 = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  } catch {
    spkiSha256 = null;
  }
  let selfSigned = false;
  try {
    selfSigned = cert.subject === cert.issuer && cert.verify(cert.publicKey);
  } catch {
    selfSigned = false;
  }
  const validTo = new Date(cert.validTo);
  return {
    position,
    subject: flattenDn(cert.subject),
    issuer: flattenDn(cert.issuer),
    issuerOrganization: /(?:^|\n)O=([^\n]+)/.exec(cert.issuer)?.[1] ?? null,
    serialNumber: cert.serialNumber.toUpperCase(),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: validTo.toISOString(),
    daysRemaining: Math.floor((validTo.getTime() - now) / 86_400_000),
    subjectAltNames: (cert.subjectAltName ?? "")
      .split(/,\s*/)
      .map((entry) => entry.replace(/^(DNS|IP Address):/, ""))
      .filter(Boolean)
      .slice(0, 50),
    publicKeyAlgorithm: keyType === "rsa-pss" ? "rsa" : keyType,
    publicKeyBits: (details as { modulusLength?: number }).modulusLength ?? (curve ? (CURVE_BITS[curve] ?? null) : keyType === "ed25519" ? 256 : null),
    curve,
    signatureAlgorithm: signatureAlgorithmOf(cert.raw),
    fingerprintSha256: cert.fingerprint256,
    spkiSha256,
    selfSigned,
    isCa: cert.ca,
    hasEmbeddedScts: cert.raw.includes(SCT_OID),
  };
}

/** Connect once to the validated address and record the presented chain. Nothing is sent after the handshake. */
export function probeTls(host: string, port: number, target: ResolvedTarget): Promise<TlsEvidence> {
  const servername = isIP(host) ? undefined : host;
  return new Promise((resolvePromise, reject) => {
    let ocspStapled = false;
    const socket = tls.connect({
      host: target.address,
      port,
      ...(servername ? { servername } : {}),
      rejectUnauthorized: false,
      requestOCSP: true,
      minVersion: "TLSv1",
      timeout: config.limits.requestTimeoutMs,
    });
    socket.on("OCSPResponse", (response: Buffer) => {
      ocspStapled = Boolean(response?.length);
    });
    socket.on("timeout", () => socket.destroy(new Error("TLS_TIMEOUT")));
    socket.on("error", reject);
    socket.on("secureConnect", () => {
      try {
        const peer = socket.getPeerCertificate(true);
        const chain: CertificateSummary[] = [];
        const seen = new Set<string>();
        let current: tls.DetailedPeerCertificate | undefined = peer && Object.keys(peer).length ? peer : undefined;
        while (current?.raw && !seen.has(current.fingerprint256)) {
          seen.add(current.fingerprint256);
          chain.push(summarizeCertificate(new X509Certificate(current.raw), chain.length));
          current = current.issuerCertificate;
        }
        const identityError = peer && Object.keys(peer).length ? tls.checkServerIdentity(host, peer) : new Error("no certificate");
        const evidence: TlsEvidence = {
          host,
          address: target.address,
          protocol: socket.getProtocol() ?? null,
          cipher: socket.getCipher()?.name ?? null,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String((socket.authorizationError as unknown as { code?: string }).code ?? socket.authorizationError) : null,
          hostnameMatch: !identityError,
          ocspStapled,
          chain,
        };
        socket.end();
        resolvePromise(evidence);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}
