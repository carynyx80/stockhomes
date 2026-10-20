import { expect, test, type Route } from "@playwright/test";

const SUPPLY = (10n ** 27n).toString();
const base = {
  status: "live",
  network: "mainnet",
  ticker: "$STOXH",
  explorer: "https://robinhoodchain.blockscout.com",
  token: "0x00000000000000000000000000000000000000aa",
  onChainDeadBalance: "1500000000000000000000000",
  totalSupply: SUPPLY,
  totalClaimedWei: "250000000000000000",
  owedBurns: 0,
  lastRun: { at: "2026-10-20T12:00:00.000Z", outcome: "burned", dryRun: false },
  nextCheckAt: "2099-01-01T00:00:00.000Z",
};
const burn = (id: number, amount: string) => ({
  id,
  amount,
  txHash: `0x${id.toString(16).padStart(64, "0")}`,
  at: "2026-10-20T12:00:00.000Z",
});

test("fireplace shows the ledger and flares when a new burn arrives", async ({ page }) => {
  await page.clock.install();
  let body = { ...base, totalBurned: "1250000000000000000000000", burns: [burn(1, "1250000000000000000000000")] };
  await page.route("**/api/burns", (route: Route) => route.fulfill({ json: body }));

  await page.goto("/burn");
  await expect(page.getByText("1,250,000", { exact: true })).toBeVisible();
  await expect(page.getByText("0.1250%")).toBeVisible();
  await expect(page.getByRole("link", { name: /0x000000…000001/ })).toHaveAttribute(
    "href",
    `https://robinhoodchain.blockscout.com/tx/${burn(1, "0").txHash}`,
  );
  await expect(page.locator(".hearth-flames")).not.toHaveClass(/is-flaring/);

  body = { ...body, totalBurned: "1300000000000000000000000", burns: [burn(2, "50000000000000000000000"), ...body.burns] };
  await page.clock.fastForward(31_000);
  await expect(page.getByText("1,300,000", { exact: true })).toBeVisible();
  await expect(page.locator(".hearth-flames")).toHaveClass(/is-flaring/);
});

test("fireplace before launch shows a cold hearth", async ({ page }) => {
  await page.route("**/api/burns", (route) =>
    route.fulfill({ json: { ...base, status: "not-launched", token: null, onChainDeadBalance: null, totalBurned: "0", burns: [] } }),
  );
  await page.goto("/burn");
  await expect(page.getByText("The fire isn’t lit yet")).toBeVisible();
  await expect(page.locator(".hearth-flames")).toHaveClass(/is-out/);
});

test("burn and cron endpoints: public read, protected trigger", async ({ request }) => {
  const burns = await request.get("/api/burns");
  expect(burns.ok()).toBe(true);
  const json = await burns.json();
  expect(json).toHaveProperty("totalBurned");
  expect(JSON.stringify(json)).not.toMatch(/PRIVATE|private_key/i);

  expect((await request.get("/api/cron/fees")).status()).toBe(401);
  expect((await request.get("/api/cron/fees", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
});
