import { defineConfig } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the locally installed Google Chrome; run `npx playwright install chromium` and drop this to use the bundled one.
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: { NEXT_DIST_DIR: ".next-e2e", CRON_SECRET: "e2e-cron-secret", AGENT_BRAIN: "mock" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
