import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "../apps/scanner/node_modules/viem/accounts";
import { registryAccount, registryRelayerStatus } from "../apps/scanner/src/registry-key";

describe("registry signing key configuration", () => {
  it("accepts prefixed, bare and quoted wallet exports as the same signer", () => {
    const key = generatePrivateKey();
    const expected = privateKeyToAccount(key).address;
    for (const value of [key, key.slice(2), `  ${key}  `, `"${key}"`, `'${key.slice(2)}'`, `0X${key.slice(2)}`]) {
      expect(registryAccount(value).address).toBe(expected);
    }
  });

  it("rejects addresses, seed phrases, API keys and invalid scalars without echoing them", () => {
    for (const value of [undefined, "", "0x" + "1".repeat(40), "test-only-api-token", "word ".repeat(12), "0x" + "0".repeat(64), "0x" + "f".repeat(64), "ab ".repeat(32)]) {
      const status = registryRelayerStatus(value);
      expect(status.ready).toBe(false);
      expect(status.detail).toMatch(/^REGISTRY_PRIVATE_KEY /);
      if (value) expect(status.detail).not.toContain(value);
    }
  });

  it("reports readiness without returning the key or account object", () => {
    const key = generatePrivateKey();
    expect(registryRelayerStatus(key).ready).toBe(true);
    expect(JSON.stringify(registryRelayerStatus(key))).not.toContain(key);
    expect(Object.keys(registryRelayerStatus(key)).sort()).toEqual(["detail", "ready"]);
  });
});
