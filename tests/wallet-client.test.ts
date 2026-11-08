import { describe, expect, it } from "vitest";
import type { RegistrationPlan } from "../packages/contracts/src/index";
import type { EIP1193Provider } from "../apps/web/node_modules/viem";
import { sealWithWallet, walletErrorMessage } from "../apps/web/src/lib/registry-wallet";

const plan: RegistrationPlan = { chainId: 11155111, contractAddress: `0x${"1".repeat(40)}`, registryKey: `0x${"a".repeat(64)}`, commitment: `0x${"b".repeat(64)}`, parentKey: `0x${"0".repeat(64)}`, schemaVersion: 1 };

describe("wallet sealing", () => {
  it("requests only a zero-value registration at the supplied testnet registry", async () => {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const provider = { request: async (request: { method: string; params?: unknown }) => {
      calls.push(request);
      if (request.method === "eth_requestAccounts") return [`0x${"2".repeat(40)}`];
      if (request.method === "eth_chainId") return "0xaa36a7";
      if (request.method === "eth_sendTransaction") return `0x${"c".repeat(64)}`;
      throw Error("Unexpected wallet request: " + request.method);
    } } as EIP1193Provider;
    expect(await sealWithWallet(plan, provider)).toBe(`0x${"c".repeat(64)}`);
    const tx = (calls.find(call => call.method === "eth_sendTransaction")?.params as Array<Record<string, unknown>>)[0];
    expect(tx).toMatchObject({ to: plan.contractAddress, value: "0x0" });
    expect(tx?.data).toBeTypeOf("string");
    expect(calls.every(call => !/signTypedData|personal_sign|privateKey/i.test(call.method))).toBe(true);
  });

  it("does not send anything on a real-money chain", async () => {
    let calls = 0;
    const provider = { request: async () => { calls++; } } as unknown as EIP1193Provider;
    await expect(sealWithWallet({ ...plan, chainId: 1 }, provider)).rejects.toThrow("Sepolia testnet");
    expect(calls).toBe(0);
  });

  it("turns cancellation, funding and unknown wallet errors into safe messages", () => {
    expect(walletErrorMessage(Error("User rejected request"))).toContain("cancelled");
    expect(walletErrorMessage(Error("insufficient funds"))).toContain("Sepolia test ETH");
    expect(walletErrorMessage(Error("private debug details"))).not.toContain("private debug details");
  });
});
