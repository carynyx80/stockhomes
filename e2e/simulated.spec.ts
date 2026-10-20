import { expect, test } from "@playwright/test";

test("trading floor: open and close a paper position", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByText("Simulated — no real funds.")).toBeVisible();
  await expect(page.getByText("10,000.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Miami" }).click();
  await page.getByLabel("Collateral").fill("200");
  await page.getByRole("button", { name: "25x" }).click();
  await page.getByRole("radio", { name: /short/i }).click();
  await page.getByRole("button", { name: "Open short · Miami · 25x" }).click();

  await expect(page.getByText(/Opened short Miami 25x/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Open positions (1)" })).toBeVisible();
  // 200 collateral + 0.06% of 5,000 = 3.00 fee
  await expect(page.getByText("9,797.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Open positions (0)" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Closed" })).toBeVisible();

  // Paper state survives a reload.
  await page.reload();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Closed" })).toBeVisible();
});

test("trading floor: rejects a position bigger than the balance", async ({ page }) => {
  await page.goto("/trade");
  await page.getByLabel("Collateral").fill("20000");
  await expect(page.getByText("Not enough paper USDG for collateral plus fee.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open long/ })).toBeDisabled();
});

test("vault: deposit then withdraw everything", async ({ page }) => {
  await page.goto("/vault");
  await expect(page.getByText("Simulated — no real funds.")).toBeVisible();
  await page.getByLabel("Amount").fill("500");
  await page.getByRole("button", { name: "Deposit into the Vault" }).click();
  await expect(page.getByText("Deposited 500.00 USDG.")).toBeVisible();
  await expect(page.getByText("9,500.00").first()).toBeVisible();

  await page.getByRole("tab", { name: "Withdraw" }).click();
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByRole("button", { name: "Withdraw from the Vault" }).click();
  await expect(page.getByText(/Withdrew 500\.\d\d USDG\./)).toBeVisible();
  await expect(page.getByText("0.0000")).toBeVisible();
});

test("parlour: back a city in a War", async ({ page }) => {
  await page.goto("/wars");
  await expect(page.getByText("Simulated — no real funds.")).toBeVisible();
  const first = page.getByRole("button", { name: /^Back / }).first();
  const city = (await first.textContent())!.replace("Back ", "");
  await first.click();
  await expect(page.getByText(`You backed ${city} with 25.00 USDG.`, { exact: false })).toBeVisible();
  await expect(page.getByText("9,975.00").first()).toBeVisible();
});

for (const path of ["/trade", "/vault", "/wars"]) {
  test(`${path} fits a phone without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await expect(page.getByText("Simulated — no real funds.")).toBeVisible();
    await page.waitForTimeout(500);
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(sw).toBe(cw);
  });
}

test("trading pages are geo-blocked for restricted countries", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "US" });
  const res = await page.goto("/trade");
  expect(res?.status()).toBe(451);
  await expect(page.getByRole("heading", { name: "This room is closed to you." })).toBeVisible();

  const burn = await page.goto("/burn");
  expect(burn?.status()).toBe(200);
});
