import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Veriq report commitments (algorithm id `veriq-commitment-v1`).
 *
 *   canonical  = JSON with object keys sorted by UTF-16 code unit, no whitespace, `undefined` members omitted
 *   commitment = SHA-256( UTF8("veriq-commitment-v1\n") || nonce[32 bytes] || UTF8(canonical(report)) )
 *   registryKey = SHA-256( UTF8("veriq-report-id-v1\n" + reportId) )
 *
 * The random nonce prevents anyone from confirming a guessed report (for example a low-entropy URL)
 * against the public chain. Only `registryKey` and `commitment` are published on-chain.
 * This module has no Node-only dependencies so the browser verifier can use it unchanged.
 */

export const COMMITMENT_ALGORITHM = "veriq-commitment-v1";

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("Non-finite numbers cannot be canonicalised");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalize(item))).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
    }
    default:
      throw new Error(`Unsupported value type: ${typeof value}`);
  }
}

export function newNonce(): string {
  return `0x${bytesToHex(randomBytes(32))}`;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function computeCommitment(report: unknown, nonceHex: string): string {
  const nonce = hexToBytes(strip0x(nonceHex));
  if (nonce.length !== 32) throw new Error("Nonce must be 32 bytes");
  const digest = sha256(concatBytes(utf8ToBytes(`${COMMITMENT_ALGORITHM}\n`), nonce, utf8ToBytes(canonicalize(report))));
  return `0x${bytesToHex(digest)}`;
}

export function registryKeyFor(reportId: string): string {
  return `0x${bytesToHex(sha256(utf8ToBytes(`veriq-report-id-v1\n${reportId}`)))}`;
}

/** Hash for validation/dispute statements: the note stays off-chain, only this hash is published. */
export function statementHashFor(registryKey: string, kind: "validate" | "dispute", note: string, createdAt: string): string {
  return `0x${bytesToHex(sha256(utf8ToBytes(`veriq-statement-v1\n${registryKey}\n${kind}\n${createdAt}\n${note}`)))}`;
}

export const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
