import type { EIP1193Provider } from "viem";

export interface BrowserWallet { name: string; provider: EIP1193Provider }
const discovered = new Map<EIP1193Provider, BrowserWallet>();
let listening = false;

/** Keep the discovery listener alive for wallets injected after page load. */
export async function discoverWallets(): Promise<BrowserWallet[]> {
  if (!listening) {
    window.addEventListener("eip6963:announceProvider", ((event: CustomEvent) => {
      const detail = event.detail;
      if (detail?.provider && typeof detail.provider.request === "function" && typeof detail.info?.name === "string") {
        discovered.set(detail.provider, { name: detail.info.name.slice(0, 80), provider: detail.provider });
      }
    }) as EventListener);
    listening = true;
  }
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise(resolve => window.setTimeout(resolve, 300));
  const legacy = (window as unknown as Window & { ethereum?: EIP1193Provider & { providers?: EIP1193Provider[] } }).ethereum;
  for (const provider of legacy?.providers ?? (legacy ? [legacy] : [])) {
    if (!discovered.has(provider) && typeof provider.request === "function") discovered.set(provider, { name: "Browser wallet", provider });
  }
  return [...discovered.values()];
}

export async function chooseWallet(): Promise<EIP1193Provider> {
  const wallets = await discoverWallets();
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  const choice = await new Promise<BrowserWallet | "mobile">((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Choose a wallet");
    dialog.style.cssText = "width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid #687080;border-radius:24px;background:var(--surface,#10121b);color:var(--ink,#fff);";
    const heading = document.createElement("h2");
    heading.textContent = "Choose your wallet";
    dialog.append(heading);
    const finish = (wallet?: BrowserWallet | "mobile") => {
      dialog.close(); dialog.remove();
      if (wallet) resolve(wallet); else reject(new Error("Wallet request cancelled"));
    };
    const button = (label: string, action: () => void) => {
      const element = document.createElement("button");
      element.type = "button"; element.textContent = label;
      element.style.cssText = "display:block;width:100%;padding:14px;margin-top:10px;border:1px solid #687080;border-radius:14px;background:transparent;color:inherit;cursor:pointer;font:inherit;";
      element.onclick = action; dialog.append(element);
    };
    for (const wallet of wallets) button(wallet.name, () => finish(wallet));
    if (projectId) button("Mobile wallet / WalletConnect", () => finish("mobile"));
    const help = document.createElement("p");
    help.textContent = projectId ? "Connect a Sepolia-compatible wallet. Approve the connection and transaction in your wallet." : "Use a wallet extension or open this page in your wallet app’s browser. Mobile pairing is awaiting site configuration.";
    dialog.append(help);
    button("Cancel", () => finish());
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(); });
    document.body.append(dialog); dialog.showModal();
  });
  if (choice !== "mobile") return choice.provider;
  return connectMobileWallet(projectId!);
}

let mobile: Promise<InstanceType<typeof import("@walletconnect/ethereum-provider").EthereumProvider>> | undefined;
async function connectMobileWallet(projectId: string): Promise<EIP1193Provider> {
  mobile ??= (async () => {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    // EthereumProvider's QR modal uses AppKit; keep both out of the initial page bundle.

    return EthereumProvider.init({ projectId, showQrModal: true, optionalChains: [11155111],
      rpcMap: { 11155111: "https://ethereum-sepolia-rpc.publicnode.com" },
      metadata: { name: "Veriq", description: "Seal a report fingerprint on Sepolia", url: window.location.origin, icons: [new URL("/icon.svg", window.location.origin).href] },
    });
  })().catch(error => { mobile = undefined; throw error; });
  const provider = await mobile;
  if (!provider.session) await provider.connect();
  return provider as EIP1193Provider;
}
