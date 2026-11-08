import type { RegistrationPlan } from "@veriq/contracts";
import { createWalletClient, custom, defineChain, encodeFunctionData, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";

const ABI = parseAbi(["function register(bytes32 key, bytes32 commitment, bytes32 parent, uint16 schemaVersion)"]);

/** Uses the selected browser or WalletConnect wallet. No private key enters Veriq. */
export async function sealWithWallet(plan: RegistrationPlan, provider?: EIP1193Provider): Promise<Hex> {
  if (plan.chainId !== 11155111 && plan.chainId !== 31337) throw new Error("Wallet sealing is available on Sepolia testnet. No real ETH is required.");
  const wallet = provider ?? await (await import("./wallet-connection")).chooseWallet();
  if (!wallet) throw new Error("Open Veriq in your wallet browser or enable a compatible browser wallet, then try again.");
  const chain = defineChain({
    id: plan.chainId,
    name: plan.chainId === 11155111 ? "Sepolia" : "Local test chain",
    nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [plan.chainId === 11155111 ? "https://ethereum-sepolia-rpc.publicnode.com" : "http://127.0.0.1:8545"] } },
  });
  const client = createWalletClient({ chain, transport: custom(wallet) });
  const [account] = await client.requestAddresses();
  if (!account) throw new Error("Choose a wallet account to seal the report.");
  if (await client.getChainId() !== plan.chainId) {
    try { await client.switchChain({ id: plan.chainId }); }
    catch (error) {
      const codes = [error, (error as { cause?: unknown })?.cause, (error as { cause?: { cause?: unknown } })?.cause?.cause];
      if (plan.chainId !== 11155111 || !codes.some(item => (item as { code?: number })?.code === 4902)) throw error;
      await client.addChain({ chain });
      await client.switchChain({ id: plan.chainId });
    }
  }
  if (await client.getChainId() !== plan.chainId) throw new Error("Enable Sepolia in your wallet, then try again.");
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
  if (/rejected|denied|cancelled|canceled|4001/i.test(text)) return "Wallet request cancelled. Your report is still available.";
  if (/insufficient funds/i.test(text)) return "This account needs Sepolia test ETH to pay the transaction fee.";
  if (/4902|unrecognized chain|chain.*not.*added/i.test(text)) return "Enable Sepolia in your wallet, then try again.";
  if (/Open Veriq|Choose a wallet|Wallet sealing is available|Enable Sepolia/.test(text)) return text;
  return "The wallet could not submit the seal. Check your account and Sepolia network, then try again.";
}
