import { REPORT_SCHEMA_VERSION, type RegistryReceipt } from "@veriq/contracts";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import { config } from "./config";
import { registryAccount } from "./registry-key";

export const REGISTRY_ABI = parseAbi([
  "function register(bytes32 key, bytes32 commitment, bytes32 parent, uint16 schemaVersion)",
  "function addStatement(bytes32 key, uint8 kind, bytes32 statementHash)",
  "function getRecord(bytes32 key) view returns (bytes32 commitment, bytes32 parent, address registrar, uint64 registeredAt, uint16 schemaVersion)",
  "function isRegistered(bytes32 key) view returns (bool)",
  "event ReportRegistered(bytes32 indexed key, bytes32 indexed commitment, bytes32 indexed parent, address registrar, uint16 schemaVersion)",
  "event StatementAdded(bytes32 indexed key, uint8 kind, bytes32 statementHash, address author)",
]);

export const EMPTY_RECEIPT: RegistryReceipt = {
  status: "unregistered",
  chainId: null,
  contractAddress: null,
  registryKey: null,
  commitment: null,
  parentKey: null,
  transactionHash: null,
  blockNumber: null,
  registeredAt: null,
  error: null,
};

type RegistryState = { chainId: number; address: Address } | { error: string };
let cached: { at: number; state: RegistryState } | null = null;

/** Probe the configured chain. Cached briefly so the config endpoint stays cheap. */
export async function registryState(): Promise<RegistryState> {
  if (cached && Date.now() - cached.at < 15_000) return cached.state;
  let state: RegistryState;
  if (!config.registry.contractAddress) state = { error: "No registry contract configured. Deploy with `pnpm chain:deploy` or set REGISTRY_CONTRACT_ADDRESS." };
  else {
    try {
      const client = createPublicClient({ transport: http(config.registry.rpcUrl, { timeout: 4000 }) });
      const chainId = await client.getChainId();
      const code = await client.getCode({ address: config.registry.contractAddress as Address });
      state = code && code !== "0x" ? { chainId, address: config.registry.contractAddress as Address } : { error: `No contract code at ${config.registry.contractAddress} on chain ${chainId}. Redeploy the registry.` };
    } catch {
      state = { error: "Registry RPC unreachable. Check the backend network configuration." };
    }
  }
  cached = { at: Date.now(), state };
  return state;
}

async function clients() {
  const account = registryAccount(config.registry.privateKey);
  const state = await registryState();
  if ("error" in state) throw new Error(state.error);
  const chain = defineChain({
    id: state.chainId,
    name: `veriq-registry-${state.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.registry.rpcUrl] } },
  });
  return {
    state,
    publicClient: createPublicClient({ chain, transport: http(config.registry.rpcUrl, { timeout: 10_000 }) }),
    walletClient: createWalletClient({ chain, account, transport: http(config.registry.rpcUrl, { timeout: 10_000 }) }),
  };
}

/** Receipt confirmation uses the configured chain and contract; it never trusts a client "success" flag. */
export async function confirmWalletCommitment(registryKey: Hex, commitment: Hex, parentKey: Hex, transactionHash: Hex): Promise<RegistryReceipt> {
  const state = await registryState();
  if ("error" in state) return { ...EMPTY_RECEIPT, registryKey, commitment, transactionHash, status: "unavailable", error: "The report registry could not be reached." };
  const client = createPublicClient({ transport: http(config.registry.rpcUrl, { timeout: 10_000 }) });
  return confirmWalletReceipt(client, state, registryKey, commitment, parentKey, transactionHash);
}

/** The receipt and current record must agree before a wallet submission is accepted. */
export async function confirmWalletReceipt(client: Pick<ReturnType<typeof createPublicClient>, "waitForTransactionReceipt" | "readContract">, state: { chainId: number; address: Address }, registryKey: Hex, commitment: Hex, parentKey: Hex, transactionHash: Hex): Promise<RegistryReceipt> {
  const base: RegistryReceipt = { ...EMPTY_RECEIPT, registryKey, commitment, parentKey: /^0x0+$/.test(parentKey) ? null : parentKey, transactionHash };
  const configured = { ...base, chainId: state.chainId, contractAddress: state.address };
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 2, timeout: 25_000 });
    if (receipt.status !== "success") return { ...configured, status: "failed", error: "The wallet transaction reverted. No seal was confirmed." };
    const record = await client.readContract({ address: state.address, abi: REGISTRY_ABI, functionName: "getRecord", args: [registryKey] });
    const eventMatches = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== state.address.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: REGISTRY_ABI, eventName: "ReportRegistered", data: log.data, topics: log.topics });
        return event.args.key === registryKey && event.args.commitment === commitment && event.args.parent === parentKey && event.args.schemaVersion === REPORT_SCHEMA_VERSION && event.args.registrar.toLowerCase() === record[2].toLowerCase();
      } catch { return false; }
    });
    if (!eventMatches || record[0] !== commitment || record[1] !== parentKey || record[3] === 0n || record[4] !== REPORT_SCHEMA_VERSION) {
      return { ...configured, status: "failed", error: "This transaction does not seal this report at the configured registry." };
    }
    return { ...configured, status: "confirmed", blockNumber: Number(receipt.blockNumber), registeredAt: new Date(Number(record[3]) * 1000).toISOString(), error: null };
  } catch {
    // Keep the hash so the same transaction can be checked again without spending gas twice.
    return { ...configured, status: "pending", error: "The transaction could not be confirmed yet. Check it again in a moment." };
  }
}

export async function registerCommitment(registryKey: Hex, commitment: Hex, parentKey: Hex): Promise<RegistryReceipt> {
  const base: RegistryReceipt = { ...EMPTY_RECEIPT, registryKey, commitment, parentKey: /^0x0+$/.test(parentKey) ? null : parentKey };
  try {
    const { state, publicClient, walletClient } = await clients();
    const hash = await walletClient.writeContract({
      address: state.address,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [registryKey, commitment, parentKey, REPORT_SCHEMA_VERSION],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    return {
      ...base,
      status: receipt.status === "success" ? "confirmed" : "failed",
      chainId: state.chainId,
      contractAddress: state.address,
      transactionHash: hash,
      blockNumber: Number(receipt.blockNumber),
      registeredAt: new Date().toISOString(),
      error: receipt.status === "success" ? null : "Transaction reverted",
    };
  } catch (error) {
    const message = (error as Error).message.split("\n")[0] ?? "Registration failed";
    return { ...base, status: /unreachable|No registry|No contract|not set/.test(message) ? "unavailable" : "failed", error: message.slice(0, 300) };
  }
}

export async function addStatementOnChain(registryKey: Hex, kind: "validate" | "dispute", statementHash: Hex): Promise<{ status: "confirmed" | "failed" | "unavailable"; transactionHash: string | null; error: string | null }> {
  try {
    const { state, publicClient, walletClient } = await clients();
    const hash = await walletClient.writeContract({
      address: state.address,
      abi: REGISTRY_ABI,
      functionName: "addStatement",
      args: [registryKey, kind === "validate" ? 1 : 2, statementHash],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    return { status: receipt.status === "success" ? "confirmed" : "failed", transactionHash: hash, error: null };
  } catch (error) {
    const message = (error as Error).message.split("\n")[0] ?? "Statement failed";
    return { status: /unreachable|No registry|No contract|not set/.test(message) ? "unavailable" : "failed", transactionHash: null, error: message.slice(0, 300) };
  }
}
