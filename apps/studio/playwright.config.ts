import { defineConfig } from "@playwright/test";

// 真实织机联调验收：先起 apps/engine（4399），再起 Studio 真实模式（5186）。
// 跨平台注意：环境变量通过 Playwright 的 env 传入，不要用 `PORT=... npm run ...`（Windows cmd 不支持）。
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".pw-out/real",
  testMatch:
    /(real-engine|onboarding|repl|codex|levels-copy|narrative-layout|typography|textbook-window|auto-beat|runtime-recovery)\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5186",
    channel: "chrome",
    viewport: { width: 1440, height: 960 },
    screenshot: "off",
    trace: "off",
  },
  webServer: [
    {
      command: "npm run dev:engine",
      cwd: "../..",
      env: { ...process.env, PORT: "4399" },
      url: "http://127.0.0.1:4399/api/health",
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: "npm run build:e2e && node scripts/serve-dist.mjs 5186",
      url: "http://127.0.0.1:5186",
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...process.env, VITE_E2E: "1", VITE_ENGINE_URL: "http://127.0.0.1:4399" },
    },
  ],
});
