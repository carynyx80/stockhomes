import { createWalletClient, custom, type Address, type Chain, type EIP1193Provider, type WalletClient } from "viem";

/**
 * A browser wallet (MetaMask, Rabby, Coinbase…) via the injected EIP-1193 provider. Non-custodial: every
 * transaction is signed in the user's wallet; the site never sees a key.
 */

type Injected = EIP1193Provider & {
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
};

export type WalletState = { available: boolean; address: Address | null; chainId: number | null };

export function injected(): Injected | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Injected }).ethereum ?? null) as Injected | null;
}

export class BrowserWallet {
  state: WalletState = { available: false, address: null, chainId: null };
  private listeners = new Set<() => void>();

  constructor(private chain: Chain) {
    const p = injected();
    if (!p) return;
    this.state = { ...this.state, available: true };
    const refresh = () => void this.refresh();
    p.on?.("accountsChanged", refresh);
    p.on?.("chainChanged", refresh);
    void this.refresh(true);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Reads accounts without prompting (eth_accounts), so returning visitors stay connected. */
  private async refresh(silent = false) {
    const p = injected();
    if (!p) return;
    try {
      const [accounts, chainHex] = await Promise.all([p.request({ method: "eth_accounts" }) as Promise<string[]>, p.request({ method: "eth_chainId" }) as Promise<string>]);
      this.state = { available: true, address: (accounts[0] as Address) ?? null, chainId: Number.parseInt(chainHex, 16) };
    } catch {
      if (!silent) this.state = { ...this.state, address: null };
    }
    this.emit();
  }

  async connect(): Promise<Address> {
    const p = injected();
    if (!p) throw new Error("No browser wallet found. Install a wallet such as MetaMask or Rabby.");
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("No account was shared by the wallet.");
    await this.ensureChain();
    await this.refresh();
    return accounts[0] as Address;
  }

  /** Switches the wallet to our chain, adding it first if the wallet doesn't know it. */
  async ensureChain() {
    const p = injected();
    if (!p) throw new Error("No browser wallet found.");
    const hex = `0x${this.chain.id.toString(16)}`;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (err) {
      if ((err as { code?: number }).code !== 4902) throw err;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: this.chain.name,
            nativeCurrency: this.chain.nativeCurrency,
            rpcUrls: this.chain.rpcUrls.default.http,
            blockExplorerUrls: this.chain.blockExplorers ? [this.chain.blockExplorers.default.url] : [],
          },
        ],
      });
    }
  }

  /** A viem wallet client for the connected account, on the right chain. */
  async client(): Promise<{ wallet: WalletClient; account: Address }> {
    const p = injected();
    if (!p) throw new Error("No browser wallet found. Install a wallet such as MetaMask or Rabby.");
    const account = this.state.address ?? (await this.connect());
    if (this.state.chainId !== this.chain.id) await this.ensureChain();
    return { wallet: createWalletClient({ account, chain: this.chain, transport: custom(p) }), account };
  }
}
