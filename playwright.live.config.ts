import { defineConfig } from "@playwright/test";

/**
 * The site in testnet mode against a local Anvil fork of Robinhood Chain testnet (same contracts and prices; no
 * transaction leaves this machine). A stub wallet in the page forwards to the fork.   npm run test:e2e:live
 */
const PORT = 3400;
export const ANVIL_PORT = 8570;

export default defineConfig({
  testDir: "e2e-live",
  globalSetup: "./e2e-live/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: {
      NEXT_DIST_DIR: ".next-live",
      NEXT_PUBLIC_DATA_SOURCE: "testnet",
      NEXT_PUBLIC_RPC_URL_TESTNET: `http://127.0.0.1:${ANVIL_PORT}`,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
