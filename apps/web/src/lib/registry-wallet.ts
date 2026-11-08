import type { RegistrationPlan } from "@veriq/contracts";
import { createWalletClient, custom, defineChain, encodeFunctionData, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";

const ABI = parseAbi(["function register(bytes32 key, bytes32 commitment, bytes32 parent, uint16 schemaVersion)"]);

/** Uses an injected wallet (including compatible mobile wallet browsers). No private key enters Veriq. */
export async function sealWithWallet(plan: RegistrationPlan, provider?: EIP1193Provider): Promise<Hex> {
  const wallet = provider ?? (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!wallet) throw new Error("Open Veriq in your wallet browser or enable a compatible browser wallet, then try again.");
  // The hackathon flow intentionally uses test ETH only.
  if (plan.chainId !== 11155111 && plan.chainId !== 31337) throw new Error("Wallet sealing is available on Sepolia testnet. No real ETH is required.");
  const chain = defineChain({
    id: plan.chainId,
    name: plan.chainId === 11155111 ? "Sepolia" : "Local test chain",
    nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [plan.chainId === 11155111 ? "https://ethereum-sepolia-rpc.publicnode.com" : "http://127.0.0.1:8545"] } },
  });
  const client = createWalletClient({ chain, transport: custom(wallet) });
  const [account] = await client.requestAddresses();
  if (!account) throw new Error("Choose a wallet account to seal the report.");
  if (await client.getChainId() !== plan.chainId) await client.switchChain({ id: plan.chainId });
  return client.sendTransaction({
    account,
    chain,
    to: plan.contractAddress as Address,
    value: 0n,
    data: encodeFunctionData({ abi: ABI, functionName: "register", args: [plan.registryKey as Hex, plan.commitment as Hex, plan.parentKey as Hex, plan.schemaVersion] }),
  });
}

export function walletErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/rejected|denied|4001/i.test(text)) return "Wallet request cancelled. Your report is still available.";
  if (/insufficient funds/i.test(text)) return "This account needs Sepolia test ETH to pay the transaction fee.";
  if (/4902|unrecognized chain|chain.*not.*added/i.test(text)) return "Enable Sepolia in your wallet, then try again.";
  if (/Open Veriq|Choose a wallet|Wallet sealing is available/.test(text)) return text;
  return "The wallet could not submit the seal. Check your account and Sepolia network, then try again.";
}
