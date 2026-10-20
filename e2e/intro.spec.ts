import { expect, test, type Page } from "@playwright/test";

const intro = (page: Page) => page.locator("[data-intro]");
const door = (page: Page) => page.getByRole("button", { name: "Enter Stoxhomes" });
const foyerHeading = (page: Page) => page.getByRole("heading", { name: /every city/i });

async function expectInside(page: Page) {
  await expect(intro(page)).toHaveCount(0);
  await expect(foyerHeading(page)).toBeVisible();
  await expect(page.locator("#inside")).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("stoxhomes:entered"))).toBe("1");
}

test("first visit shows the facade and hides the house behind it", async ({ page }) => {
  await page.goto("/");
  await expect(door(page)).toBeVisible();
  await expect(page.locator("[data-house]")).toHaveAttribute("inert", "");
  await expect(page.getByText("Knock to enter.").first()).toBeVisible();
});

test("clicking the door walks into the site", async ({ page }) => {
  await page.goto("/");
  await door(page).click();
  // The full sequence is ~1.8s.
  await expectInside(page);
  await expect(page.locator("[data-house]")).not.toHaveAttribute("inert", "");
});

test("skip intro goes straight inside", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Skip intro" }).click();
  await expectInside(page);
});

test("keyboard: Tab reaches the door and Enter opens it", async ({ page }) => {
  await page.goto("/");
  await expect(door(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(door(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expectInside(page);
});

test("keyboard: Space opens the door", async ({ page }) => {
  await page.goto("/");
  await door(page).focus();
  await page.keyboard.press("Space");
  await expectInside(page);
});

test("reduced motion replaces the walk-in with a fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await door(page).click();
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => {
    const leaf = document.querySelector<HTMLElement>("[data-leaf]");
    const stage = document.querySelector<HTMLElement>("[data-stage]");
    const root = document.querySelector<HTMLElement>("[data-intro]");
    return {
      leafTransform: leaf ? getComputedStyle(leaf).transform : null,
      stageTransform: stage ? getComputedStyle(stage).transform : null,
      opacity: root ? Number(getComputedStyle(root).opacity) : 0,
    };
  });
  // Door never swings, the camera never moves, the overlay is fading.
  expect([null, "none"]).toContain(state.leafTransform);
  expect([null, "none"]).toContain(state.stageTransform);
  expect(state.opacity).toBeLessThan(1);
  await expectInside(page);
});

test("returning visitors skip the intro, and Leave the house replays it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Skip intro" }).click();
  await expect(intro(page)).toHaveCount(0);

  await page.reload();
  await expect(foyerHeading(page)).toBeVisible();
  await expect(door(page)).toBeHidden();

  await page.getByRole("button", { name: "Leave the house" }).click();
  await expect(door(page)).toBeVisible();
});

test("the facade fits a phone without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(door(page)).toBeInViewport({ ratio: 1 });
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBe(cw);
});
