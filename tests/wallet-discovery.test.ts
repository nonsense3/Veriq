import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverWallets } from "../apps/web/src/lib/wallet-connection";

afterEach(() => vi.unstubAllGlobals());
describe("browser wallet discovery", () => {
  it("discovers multiple extensions without relying on window.ethereum and deduplicates reannouncements", async () => {
    const browser = new EventTarget();
    Object.assign(browser, { setTimeout });
    vi.stubGlobal("window", browser);
    const first = { request: async () => [] };
    const second = { request: async () => [] };
    browser.addEventListener("eip6963:requestProvider", () => {
      for (const [name, provider] of [["Wallet A", first], ["Wallet B", second], ["Wallet A", first]]) {
        browser.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { name }, provider } }));
      }
      browser.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { name: "Invalid" }, provider: {} } }));
    });
    const wallets = await discoverWallets();
    expect(wallets.map(wallet => wallet.name)).toEqual(["Wallet A", "Wallet B"]);
    expect(wallets[1]?.provider).toBe(second);
  });
});
