import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, zeroHash } from "viem";

const { viem, networkHelpers } = await network.create();

const key = (label: string) => keccak256(toHex(`key:${label}`));
const commitment = (label: string) => keccak256(toHex(`commitment:${label}`));

describe("ReportRegistry", () => {
  async function deploy() {
    const registry = await viem.deployContract("ReportRegistry");
    return { registry };
  }

  it("registers a commitment and emits ReportRegistered", async () => {
    const { registry } = await networkHelpers.loadFixture(deploy);
    const [wallet] = await viem.getWalletClients();
    await viem.assertions.emitWithArgs(
      registry.write.register([key("a"), commitment("a"), zeroHash, 1]),
      registry,
      "ReportRegistered",
      [key("a"), commitment("a"), zeroHash, getAddress(wallet!.account.address), 1],
    );
    const [stored, parent, registrar, registeredAt, schemaVersion] = await registry.read.getRecord([key("a")]);
    assert.equal(stored, commitment("a"));
    assert.equal(parent, zeroHash);
    assert.equal(registrar.toLowerCase(), wallet!.account.address.toLowerCase());
    assert.ok(registeredAt > 0n);
    assert.equal(schemaVersion, 1);
    assert.equal(await registry.read.totalRecords(), 1n);
  });

  it("is append-only: a key cannot be registered twice", async () => {
    const { registry } = await networkHelpers.loadFixture(deploy);
    await registry.write.register([key("a"), commitment("a"), zeroHash, 1]);
    await viem.assertions.revertWithCustomError(registry.write.register([key("a"), commitment("tampered"), zeroHash, 1]), registry, "AlreadyRegistered");
    const [stored] = await registry.read.getRecord([key("a")]);
    assert.equal(stored, commitment("a"));
  });

  it("links revisions to an existing parent and rejects unknown parents", async () => {
    const { registry } = await networkHelpers.loadFixture(deploy);
    await registry.write.register([key("v1"), commitment("v1"), zeroHash, 1]);
    await registry.write.register([key("v2"), commitment("v2"), key("v1"), 1]);
    const [, parent] = await registry.read.getRecord([key("v2")]);
    assert.equal(parent, key("v1"));
    await viem.assertions.revertWithCustomError(registry.write.register([key("v3"), commitment("v3"), key("missing"), 1]), registry, "UnknownReport");
  });

  it("rejects empty keys, commitments and schema versions", async () => {
    const { registry } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(registry.write.register([zeroHash, commitment("a"), zeroHash, 1]), registry, "EmptyValue");
    await viem.assertions.revertWithCustomError(registry.write.register([key("a"), zeroHash, zeroHash, 1]), registry, "EmptyValue");
    await viem.assertions.revertWithCustomError(registry.write.register([key("a"), commitment("a"), zeroHash, 0]), registry, "EmptyValue");
  });

  it("records validation and dispute statements without overwriting the report", async () => {
    const { registry } = await networkHelpers.loadFixture(deploy);
    await registry.write.register([key("a"), commitment("a"), zeroHash, 1]);
    await registry.write.addStatement([key("a"), 1, keccak256(toHex("looks right"))]);
    await registry.write.addStatement([key("a"), 2, keccak256(toHex("false positive"))]);
    assert.equal(await registry.read.validations([key("a")]), 1);
    assert.equal(await registry.read.disputes([key("a")]), 1);
    const [stored] = await registry.read.getRecord([key("a")]);
    assert.equal(stored, commitment("a"));
    await viem.assertions.revertWithCustomError(registry.write.addStatement([key("missing"), 1, keccak256(toHex("x"))]), registry, "UnknownReport");
    await viem.assertions.revertWithCustomError(registry.write.addStatement([key("a"), 0, keccak256(toHex("x"))]), registry, "InvalidStatement");
  });
});
