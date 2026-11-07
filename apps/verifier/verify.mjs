#!/usr/bin/env node
/**
 * Veriq independent report verifier.
 *
 * Deliberately self-contained: it does not import any Veriq package and never contacts the Veriq API or database.
 * It re-implements `veriq-commitment-v1` from its specification using Node's crypto module and reads the registry
 * through a public JSON-RPC endpoint.
 *
 *   canonical   = JSON, object keys sorted by UTF-16 code unit, no whitespace, undefined members omitted
 *   commitment  = SHA-256( "veriq-commitment-v1\n" || nonce (32 bytes) || canonical(report) )
 *   registryKey = SHA-256( "veriq-report-id-v1\n" || reportId )
 *
 * Usage:
 *   node verify.mjs <bundle.json> [--rpc http://127.0.0.1:8545] [--contract 0x...] [--json]
 *
 * Exit codes: 0 verified · 1 mismatch / tampered · 2 not registered · 3 usage or network error
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";

const ABI = parseAbi([
  "function getRecord(bytes32 key) view returns (bytes32 commitment, bytes32 parent, address registrar, uint64 registeredAt, uint16 schemaVersion)",
  "function validations(bytes32 key) view returns (uint32)",
  "function disputes(bytes32 key) view returns (uint32)",
]);

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in report");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalize(item))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  throw new Error(`unsupported value type ${typeof value}`);
}

const sha256 = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return `0x${hash.digest("hex")}`;
};

function parseArgs(argv) {
  const args = { bundle: null, rpc: null, contract: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--rpc") args.rpc = argv[++index];
    else if (value === "--contract") args.contract = argv[++index];
    else if (value === "--json") args.json = true;
    else if (!args.bundle) args.bundle = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundle) {
    console.error("Usage: node verify.mjs <bundle.json> [--rpc URL] [--contract 0x...] [--json]");
    process.exitCode = 3;
    return;
  }
  const bundle = JSON.parse(readFileSync(args.bundle, "utf8").replace(/^\uFEFF/, ""));
  if (bundle.algorithm !== "veriq-commitment-v1") throw new Error(`unsupported algorithm ${bundle.algorithm}`);
  const nonce = Buffer.from(String(bundle.nonce).replace(/^0x/, ""), "hex");
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");

  const recomputedCommitment = sha256(Buffer.from("veriq-commitment-v1\n", "utf8"), nonce, Buffer.from(canonicalize(bundle.report), "utf8"));
  const recomputedKey = sha256(Buffer.from(`veriq-report-id-v1\n${bundle.report.reportId}`, "utf8"));
  const rpc = args.rpc ?? bundle.registry?.rpcHint ?? "http://127.0.0.1:8545";
  const contract = args.contract ?? bundle.registry?.contractAddress;
  if (!contract) throw new Error("no contract address: pass --contract");

  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000 }) });
  const chainId = await client.getChainId();
  const [onChainCommitment, parent, registrar, registeredAt, schemaVersion] = await client.readContract({ address: contract, abi: ABI, functionName: "getRecord", args: [recomputedKey] });
  const [validations, disputes] = await Promise.all([
    client.readContract({ address: contract, abi: ABI, functionName: "validations", args: [recomputedKey] }),
    client.readContract({ address: contract, abi: ABI, functionName: "disputes", args: [recomputedKey] }),
  ]);

  const registered = registeredAt > 0n;
  const commitmentMatches = registered && onChainCommitment.toLowerCase() === recomputedCommitment.toLowerCase();
  const result = {
    status: !registered ? "NOT_REGISTERED" : commitmentMatches ? "VERIFIED" : "MISMATCH",
    reportId: bundle.report.reportId,
    classification: bundle.report.risk?.label,
    chainId,
    contract,
    registryKey: recomputedKey,
    recomputedCommitment,
    onChainCommitment: registered ? onChainCommitment : null,
    bundleCommitmentConsistent: String(bundle.commitment).toLowerCase() === recomputedCommitment.toLowerCase(),
    registrar: registered ? registrar : null,
    registeredAt: registered ? new Date(Number(registeredAt) * 1000).toISOString() : null,
    parent: registered && !/^0x0+$/.test(parent) ? parent : null,
    schemaVersion: registered ? schemaVersion : null,
    validations: Number(validations),
    disputes: Number(disputes),
    note: "A matching commitment proves this exact report existed unchanged when it was registered. It does not prove the verdict is correct.",
  };

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    const mark = result.status === "VERIFIED" ? "✔" : "✘";
    console.log(`${mark} ${result.status}`);
    console.log(`  report        ${result.reportId} (${result.classification})`);
    console.log(`  chain         ${chainId} · contract ${contract}`);
    console.log(`  registry key  ${recomputedKey}`);
    console.log(`  recomputed    ${recomputedCommitment}`);
    console.log(`  on-chain      ${result.onChainCommitment ?? "(none)"}`);
    if (registered) console.log(`  registered    ${result.registeredAt} by ${registrar}${result.parent ? ` · revision of ${result.parent}` : ""}`);
    console.log(`  statements    ${result.validations} validation(s), ${result.disputes} dispute(s)`);
    console.log(`  ${result.note}`);
  }
  // exitCode (not process.exit) lets pending sockets close cleanly; abrupt exit trips a libuv assertion on Windows.
  process.exitCode = result.status === "VERIFIED" ? 0 : result.status === "MISMATCH" ? 1 : 2;
}

main().catch((error) => {
  console.error(`✘ ERROR ${error.message.split("\n")[0]}`);
  process.exitCode = 3;
});
