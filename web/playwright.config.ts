import { defineConfig } from "@playwright/test";

const runningInCi = Boolean(process.env.CI);
const deployedBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  // WebGL under software rendering can be substantially slower on shared CI
  // runners even when interaction remains correct.
  timeout: runningInCi ? 120_000 : 60_000,
  expect: { timeout: runningInCi ? 15_000 : 8_000 },
  fullyParallel: true,
  // Isolate persistent WebGL render loops on the software renderer used by CI.
  // Local machines still use Playwright's normal worker count.
  workers: runningInCi ? 1 : undefined,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL:
      deployedBaseUrl ??
      "http://127.0.0.1:4173/shortest-path-through-a-curved-world/",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: deployedBaseUrl
    ? undefined
    : {
        command: "npm run preview -- --port 4173",
        port: 4173,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "tablet-1024", use: { viewport: { width: 1024, height: 768 } } },
    {
      name: "tablet-768",
      use: {
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
    {
      name: "mobile-390",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-375",
      use: {
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-320",
      use: {
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
