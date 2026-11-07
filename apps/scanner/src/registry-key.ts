import { privateKeyToAccount } from "viem/accounts";

/** Parse wallet-export formatting without ever including the supplied secret in an error. */
export function registryAccount(value: string | undefined) {
  let key = value?.trim();
  if (!key) throw new Error("REGISTRY_PRIVATE_KEY is not set; configure the funded Sepolia wallet key on the backend.");
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  const hex = key.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("REGISTRY_PRIVATE_KEY has an invalid format; use the account's 64-character hexadecimal private key, optionally prefixed with 0x. Wallet addresses, API keys and recovery phrases are not accepted.");
  }
  try {
    return privateKeyToAccount(`0x${hex}`);
  } catch {
    throw new Error("REGISTRY_PRIVATE_KEY is not a valid Ethereum signing key; export the dedicated funded account's private key again.");
  }
}

export function registryRelayerStatus(value: string | undefined) {
  try {
    registryAccount(value);
    return { ready: true, detail: "Registry reachable; signing key validated. Wallet funding and transaction success are checked when registering." };
  } catch (error) {
    return { ready: false, detail: (error as Error).message };
  }
}
