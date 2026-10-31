import { defineConfig } from "@playwright/test";

// 本地演示兜底验收（不需要织机进程）。
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".pw-out/mock",
  testMatch: /mock-flow\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5185",
    channel: "chrome",
    viewport: { width: 1440, height: 960 },
    screenshot: "off",
    trace: "off",
  },
  webServer: {
    command: "npm run build:mock && node scripts/serve-dist.mjs 5185",
    url: "http://127.0.0.1:5185",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...process.env, VITE_MOCK: "1", VITE_E2E: "1" },
  },
});
