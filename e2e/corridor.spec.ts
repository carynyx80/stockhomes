import { expect, test, type Page } from "@playwright/test";

const CRON = { authorization: "Bearer e2e-cron-secret" };
const bays = (page: Page) => page.locator("[data-bay]");

async function bayIndices(page: Page) {
  return page.locator("[data-bay]").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.bay)));
}

test("the corridor renders agent doors and only the bays near the viewport", async ({ page }) => {
  await page.goto("/house");
  await expect(page.getByText("AI agents for entertainment. Not financial advice.")).toBeVisible();
  await expect(page.getByText("Simulated — no real funds.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Enter .*'s room/ })).toHaveCount(6);

  const before = await bayIndices(page);
  expect(before.length).toBeLessThan(15);
  expect(Math.min(...before)).toBe(0);

  // Walk 120 bays down the hall: far bays appear, the first ones are unmounted, the corridor keeps growing.
  const corridor = page.getByRole("region", { name: /The Corridor/ });
  // Walk to the end repeatedly, the way a visitor would; the hallway extends itself as you approach the end.
  await expect
    .poll(
      async () => {
        await corridor.evaluate((el) => (el.scrollLeft = el.scrollWidth));
        return Math.min(...(await bayIndices(page)));
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBeGreaterThan(100);
  expect((await bayIndices(page)).length).toBeLessThan(15);
  await expect(page.getByRole("button", { name: /^Enter .*'s room/ })).toHaveCount(0);
  expect(await corridor.evaluate((el) => el.scrollWidth)).toBeGreaterThan(300 * 125);
});

test("filters and the directory", async ({ page }) => {
  await page.goto("/house");
  await page.getByLabel("City").selectOption("los");
  // Lagos is traded by the Lagos Landlord and Madame Escrow.
  await expect(page.getByRole("button", { name: /^Enter .*'s room/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Enter Lagos Landlord's room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Directory of rooms" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Directory of rooms" }).getByRole("link")).toHaveCount(2);
});

test("clicking a door swings it open and enters the room", async ({ page }) => {
  await page.goto("/house");
  const door = page.getByRole("button", { name: "Enter The Miami Bull's room" });
  await door.scrollIntoViewIfNeeded();
  await door.click();
  await expect.poll(() => page.locator('[data-door="miami-bull"] [data-leaf]').evaluate((el) => getComputedStyle(el).transform).catch(() => "gone")).not.toBe("none");
  await expect(page).toHaveURL(/\/house\/miami-bull$/);
  await expect(page.getByRole("heading", { name: "The Miami Bull", level: 1 })).toBeVisible();
});

test("keyboard: Tab to a door, Enter goes in", async ({ page }) => {
  await page.goto("/house");
  const door = page.getByRole("button", { name: /^Enter .*'s room/ }).first();
  await door.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/house\/[a-z-]+$/);
});

test("reduced motion: the door doesn't swing, it just opens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/house");
  const door = page.getByRole("button", { name: "Enter The Miami Bull's room" });
  await door.scrollIntoViewIfNeeded();
  await door.click();
  const transform = await page
    .locator('[data-door="miami-bull"] [data-leaf]')
    .evaluate((el) => getComputedStyle(el).transform, null, { timeout: 500 })
    .catch(() => "gone");
  expect(["none", "gone"]).toContain(transform);
  await expect(page).toHaveURL(/\/house\/miami-bull$/);
});

test("commentary arrives over SSE, after the trade, and chat is live too", async ({ page, request }) => {
  await page.goto("/house/london-doomer");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const broadcast = page.getByTestId("broadcast").locator("li");
  const before = await broadcast.count();

  // Tick the agent until it says something (a rejected decision posts nothing, by design).
  await expect
    .poll(
      async () => {
        const r = await request.get("/api/cron/agents?agent=london-doomer", { headers: CRON });
        expect(r.ok()).toBe(true);
        return broadcast.count();
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBeGreaterThan(before);

  // Chat goes out over the same stream.
  await page.getByLabel("Nickname").fill("e2e_visitor");
  await page.getByLabel("Message", { exact: true }).fill("Rain again, Doomer?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Chat" }).getByText("Rain again, Doomer?")).toBeVisible();

  // Rate limit: a second message straight away is refused.
  await page.getByLabel("Message", { exact: true }).fill("And again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Slow down a little.")).toBeVisible();
});

test("chat filter refuses abuse and links", async ({ request }) => {
  const post = (text: string, nickname = "tester_1") =>
    request.post("/api/house/madame-escrow/chat", { data: { nickname, text }, headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` } });
  expect((await post("visit https://scam.example")).status()).toBe(422);
  expect((await post("kys")).status()).toBe(422);
  expect((await post("hello", "Stoxhomes Admin")).status()).toBe(422);
  expect((await post("Lovely parlour, Madame")).status()).toBe(201);
});

test("follow toggles", async ({ page }) => {
  await page.goto("/house/dune-runner");
  const back = page.getByRole("button", { name: /Back this agent/ });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByRole("button", { name: /Following ✓/ })).toBeVisible();
  await page.getByRole("button", { name: /Following ✓/ }).click();
  await expect(page.getByRole("button", { name: /Back this agent/ })).toBeVisible();
});

test("cron is protected", async ({ request }) => {
  expect((await request.get("/api/cron/agents")).status()).toBe(401);
  expect((await request.get("/api/cron/agents", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
});

test("geo-blocked like the trading pages", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "GB" });
  expect((await page.goto("/house"))?.status()).toBe(451);
  expect((await page.goto("/house/miami-bull"))?.status()).toBe(451);
});

for (const path of ["/house", "/house/lagos-landlord"]) {
  test(`${path} on a phone: vertical corridor, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await expect(page.getByText("AI agents for entertainment. Not financial advice.")).toBeVisible();
    if (path === "/house") {
      const corridor = page.getByRole("region", { name: /The Corridor/ });
      await corridor.scrollIntoViewIfNeeded();
      await expect(bays(page).first()).toBeVisible();
      expect(await corridor.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
      await expect(page.getByRole("button", { name: /^Enter .*'s room/ }).first()).toBeInViewport();
    } else {
      await expect(page.getByRole("heading", { name: "Lagos Landlord", level: 1 })).toBeVisible();
    }
    await page.waitForTimeout(400);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBe(cw);
  });
}
