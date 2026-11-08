import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "../apps/scanner/node_modules/viem";
import { REPORT_SCHEMA_VERSION } from "../packages/contracts/src/index";

const rpc = { waitForTransactionReceipt: vi.fn(), readContract: vi.fn() };

import { confirmWalletReceipt, REGISTRY_ABI } from "../apps/scanner/src/registry";

const address = `0x${"1".repeat(40)}` as const;
const registrar = `0x${"2".repeat(40)}` as const;
const key = `0x${"a".repeat(64)}` as const;
const commitment = `0x${"b".repeat(64)}` as const;
const parent = `0x${"0".repeat(64)}` as const;
const hash = `0x${"c".repeat(64)}` as const;
const confirmWalletCommitment = (key: Hex, commitment: Hex, parent: Hex, hash: Hex) => confirmWalletReceipt(rpc as unknown as Parameters<typeof confirmWalletReceipt>[0], { chainId: 11155111, address }, key, commitment, parent, hash);
const log = () => ({ address, topics: encodeEventTopics({ abi: REGISTRY_ABI, eventName: "ReportRegistered", args: { key, commitment, parent } }), data: encodeAbiParameters([{ type: "address" }, { type: "uint16" }], [registrar, REPORT_SCHEMA_VERSION]) });

beforeEach(() => {
  rpc.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, logs: [log()] });
  rpc.readContract.mockResolvedValue([commitment, parent, registrar, 1794096000n, REPORT_SCHEMA_VERSION]);
});

describe("independent wallet transaction confirmation", () => {
  it("confirms an exact registry event and stored commitment without a server key", async () => {
    expect(await confirmWalletCommitment(key, commitment, parent, hash)).toMatchObject({ status: "confirmed", transactionHash: hash, blockNumber: 42, chainId: 11155111, contractAddress: address, error: null });
    expect(rpc.waitForTransactionReceipt).toHaveBeenLastCalledWith({ hash, confirmations: 2, timeout: 25_000 });
  });

  it("rejects a successful transaction from another contract", async () => {
    rpc.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, logs: [{ ...log(), address: registrar }] });
    expect((await confirmWalletCommitment(key, commitment, parent, hash)).status).toBe("failed");
  });

  it("rejects altered reports, different revision parents and schema versions", async () => {
    for (const tuple of [[hash, parent, registrar, 1n, 1], [commitment, key, registrar, 1n, 1], [commitment, parent, registrar, 1n, 2]]) {
      rpc.readContract.mockResolvedValue(tuple);
      expect((await confirmWalletCommitment(key, commitment, parent, hash)).status).toBe("failed");
    }
  });

  it("never treats reverted or unrelated transactions as a seal", async () => {
    rpc.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 42n, logs: [] });
    expect((await confirmWalletCommitment(key, commitment, parent, hash)).status).toBe("failed");
    rpc.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 42n, logs: [] });
    expect((await confirmWalletCommitment(key, commitment, parent, hash)).status).toBe("failed");
  });

  it("retains a pending hash after RPC timeout so retry does not send another transaction", async () => {
    rpc.waitForTransactionReceipt.mockRejectedValue(Error("RPC timeout"));
    expect(await confirmWalletCommitment(key, commitment, parent, hash)).toMatchObject({ status: "pending", transactionHash: hash, registeredAt: null });
  });
});
