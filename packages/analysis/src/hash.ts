import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function sha256Hex(value: string | Uint8Array): string {
  return bytesToHex(sha256(typeof value === "string" ? utf8ToBytes(value) : value));
}

/** Hash used for indicator correlation. Domain-separated so it cannot be confused with report commitments. */
export function indicatorHash(type: string, normalizedValue: string): string {
  return sha256Hex(`veriq-indicator-v1\n${type}\n${normalizedValue}`);
}
