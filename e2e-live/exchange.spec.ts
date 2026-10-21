import { expect, test, type Page } from "@playwright/test";

const ANVIL = "http://127.0.0.1:8570";
// A fresh address: the fork signs for it (--auto-impersonate) and we give it testnet ETH for gas.
const TRADER = "0x000000000000000000000000000000000057ac5e";

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** A minimal EIP-1193 wallet that forwards everything to the fork. */
async function installStubWallet(page: Page) {
  await page.addInitScript(
    ({ anvil, account }) => {
      const send = async (method: string, params: unknown[] = []) => {
        const r = await fetch(anvil, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
        const body = await r.json();
        if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
        return body.result;
      };
      let connected = false;
      (window as unknown as { ethereum: unknown }).ethereum = {
        isStub: true,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") {
            connected = true;
            return [account];
          }
          if (method === "eth_accounts") return connected ? [account] : [];
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          return send(method, params ?? []);
        },
        on() {},
        removeListener() {},
      };
    },
    { anvil: ANVIL, account: TRADER },
  );
}

test.beforeAll(async () => {
  await rpc("anvil_setBalance", [TRADER, "0x8AC7230489E80000"]); // 10 ETH on the fork
});

test("trade on the testnet exchange: connect, faucet, open, close, Vault", async ({ page }) => {
  await installStubWallet(page);
  await page.goto("/trade");
  await expect(page.getByText("Testnet — test tokens only, no real funds.")).toBeVisible();

  // Only the four cities with live price sources are listed; prices come from the on-chain oracle.
  const markets = page.getByRole("region", { name: "City markets" }).or(page.locator("section[aria-labelledby=markets-heading]"));
  await expect(markets.getByRole("button")).toHaveCount(4);
  await expect(markets.getByRole("button", { name: /Dubai/ })).toHaveCount(0);
  await expect(page.getByText(/On-chain oracle price · S&P CoreLogic Case-Shiller NY/)).toBeVisible();
  await expect(page.locator("#market-heading ~ p .numeric").first()).toHaveText(/^8\d\d,\d{3}\.\d{2}$/);

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("0x0000…ac5e")).toBeVisible();
  await page.getByRole("button", { name: "Get 10,000 tUSDG" }).click();
  await expect(page.getByText("10,000.00").first()).toBeVisible();

  // Open a 5x New York long.
  await page.getByLabel("Collateral").fill("100");
  await page.getByRole("button", { name: "5x", exact: true }).click();
  await page.getByRole("button", { name: "Open long · New York · 5x" }).click();
  await expect(page.getByText(/Opened long New York 5x at/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Open positions (1)" })).toBeVisible();
  await expect(page.getByText("9,899.70").first()).toBeVisible(); // 100 margin + 0.30 open fee

  // Too soon to close: the contract's minimum hold surfaces as a friendly message.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Positions must be held at least a minute before closing.")).toBeVisible();

  await rpc("evm_increaseTime", [61]);
  await rpc("evm_mine");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Open positions (0)" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Closed" })).toBeVisible();

  // The Vault: deposit 500 tUSDG.
  await page.goto("/vault");
  await page.getByLabel("Amount").fill("500");
  await page.getByRole("button", { name: "Deposit into the Vault" }).click();
  await expect(page.getByText("Deposited 500.00 tUSDG.")).toBeVisible();
  await expect(page.getByRole("region", { name: /Your share of the House/ }).or(page.locator("section[aria-labelledby=holding-heading]"))).toContainText(/499\.\d\d|500\.\d\d/);
});

test("without a wallet, the site still shows live markets and asks you to connect", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByText("Install a browser wallet (MetaMask, Rabby…) to trade.")).toBeVisible();
  await expect(page.locator("#market-heading ~ p .numeric").first()).toHaveText(/^8\d\d,\d{3}\.\d{2}$/);
});
