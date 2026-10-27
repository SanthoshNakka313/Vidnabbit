import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * E2E runs against a production build in mock mode (NEXT_PUBLIC_API_MOCK=1),
 * so the real CSP and headers are exercised and no backend is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
    // The converters depend on each browser's own codecs, so they also run in Safari and Firefox.
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /convert.*\.spec\.ts/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /convert.*\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_API_MOCK: "1",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  },
});
