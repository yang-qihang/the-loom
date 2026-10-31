import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

/** QA 用户操作模拟（UOS）专用配置：mock Studio + 系统 Chrome；截图写入 qa/evidence/ux-shots。 */
export default defineConfig({
  testDir: ".",
  testMatch: /ux-sim\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["json", { outputFile: resolve(process.cwd(), "../../qa/evidence/ux-playwright-raw.json") }], ["list"]],
  use: {
    baseURL: "http://127.0.0.1:5176",
    channel: "chrome",
    viewport: { width: 1440, height: 960 },
    screenshot: "off",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:mock -- --port 5176 --strictPort",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, VITE_MOCK: "1", VITE_E2E: "1" },
  },
});
