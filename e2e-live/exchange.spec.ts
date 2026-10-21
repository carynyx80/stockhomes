import { expect, test, type Page } from "@playwright/test";

const ANVIL = "http://127.0.0.1:8570";
// A fresh address: the fork signs for it (--auto-impersonate) and we give it testnet ETH for gas.
const TRADER = "0x000000000000000000000000000000000057ac5e";
/** New York's oracle price: around $727,000 at deployment. */
const NYC_PRICE = /^7\d\d,\d{3}\.\d{2}$/;

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

  // All 100 on-chain city markets are listed and searchable; prices come from the on-chain oracle.
  const markets = page.locator("section[aria-labelledby=markets-heading]");
  await expect(markets.locator("ul > li")).toHaveCount(100);
  await expect(markets.getByRole("button", { name: /Dubai/ })).toHaveCount(0);
  await page.getByLabel("Search markets").fill("edinb");
  await expect(markets.locator("ul > li")).toHaveCount(1);
  await page.getByLabel("Search markets").fill("");
  await expect(page.getByText(/On-chain oracle price · Zillow Home Value Index/)).toBeVisible();
  await expect(page.locator("#market-heading ~ p .numeric").first()).toHaveText(NYC_PRICE);

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
  await expect(page.locator("#market-heading ~ p .numeric").first()).toHaveText(NYC_PRICE);
});

test("limit orders, take-profit / stop-loss, partial close and margin from the UI", async ({ page }) => {
  // Each write is approve + action on a fork that fetches fresh state from testnet: allow a minute per step.
  test.setTimeout(300_000);
  const tx = { timeout: 60_000 };
  await installStubWallet(page);
  await page.goto("/trade");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("0x0000…ac5e")).toBeVisible();
  const balance = async () =>
    Number(((await page.locator("section[aria-labelledby=order-heading] span", { hasText: /^Balance/ }).locator(".numeric").textContent()) ?? "").replace(/,/g, ""));
  // Self-contained: mint from the faucet unless the first test already did on this fork.
  await page.waitForTimeout(3_000);
  if ((await balance()) < 1_000) await page.getByRole("button", { name: "Get 10,000 tUSDG" }).click();
  await expect.poll(balance, tx).toBeGreaterThan(1_000);
  const start = await balance();

  // A limit long 1% under the market: escrowed, listed under Orders, then cancelled for a full refund.
  await page.getByRole("tab", { name: "Limit" }).click();
  await expect(page.getByLabel("Trigger price")).not.toHaveValue("");
  await page.getByLabel("Collateral").fill("200");
  await page.getByRole("button", { name: "10x", exact: true }).click();
  await page.getByRole("button", { name: /^Place limit long/ }).click();
  await expect(page.getByText(/Limit long placed at/)).toBeVisible(tx);
  await expect(page.getByRole("tab", { name: "Orders (1)" })).toBeVisible();
  await expect.poll(balance).toBeCloseTo(start - 201.2, 1); // 200 margin + 1.20 fee held
  await page.getByRole("tab", { name: "Orders (1)" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("tab", { name: "Orders (0)" })).toBeVisible(tx);
  await expect.poll(balance).toBeCloseTo(start, 1);

  // A 25x short with take-profit and stop-loss from the return-on-margin chips.
  await page.getByRole("tab", { name: "Market" }).click();
  await page.getByRole("radio", { name: "Short ↓" }).click();
  await page.getByLabel("Collateral").fill("100");
  await page.getByRole("button", { name: "25x", exact: true }).click();
  await page.getByLabel("Take-profit / stop-loss").check();
  await page.getByRole("button", { name: "+50%" }).click();
  await page.getByRole("button", { name: "−25%" }).click();
  await expect(page.getByLabel("Take-profit", { exact: true })).not.toHaveValue("");
  // The simulator plays it out before it's placed.
  await expect(page.getByRole("heading", { name: "Trade simulator" })).toBeVisible();
  await page.getByRole("button", { name: "Take-profit", exact: true }).click();
  await expect(page.getByText(/Take-profit closes it at/)).toBeVisible();
  await page.getByRole("button", { name: "Open short · New York · 25x" }).click();
  await expect(page.getByText(/Opened short New York 25x at/)).toBeVisible(tx);
  await page.getByRole("tab", { name: "Open positions (1)" }).click();
  const row = page.locator("tbody tr").first();
  await expect(row).not.toContainText("— / —"); // TP and SL are on-chain

  // Manage: add margin, then close half after the one-minute hold.
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByLabel("Margin amount").fill("50");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row).toContainText("150.00", tx);
  await rpc("evm_increaseTime", [61]);
  await rpc("evm_mine");
  await page.locator("tbody").getByRole("button", { name: "50%", exact: true }).click();
  await expect(row).toContainText("1,250.00", tx); // size 2,500 → 1,250
  await expect(row).toContainText("75.00");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Open positions (0)" })).toBeVisible(tx);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Partly closed" })).toBeVisible();
});
