import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "evidence");
mkdirSync(EVIDENCE, { recursive: true });

test("本地演示兜底：选关 → 运行 → 玩家节拍 → 3 星 → 重置", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    localStorage.setItem(
      "loom.studio.progress.v1",
      JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  await expect(page.locator(".mode-chip")).toContainText("本地演示");
  await expect(page.getByTestId("level-card-L01")).toContainText("进入关卡");
  await expect(page.getByTestId("level-card-L05")).toContainText("未解锁");
  await page.getByTestId("level-card-L01").click();

  await expect(page.getByTestId("code-editor")).toBeVisible();
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("result-card")).toContainText("最后一步");

  await page.evaluate(() => window.__loomStudio?.playerBeat());
  await expect(page.getByTestId("result-headline")).toContainText("灯全亮");
  await expect(page.getByTestId("result-card")).toContainText("灯全亮");

  await expect(page.getByTestId("settle-overlay")).toBeVisible();
  await page.getByTestId("btn-settle-replay").click();
  await expect(page.getByTestId("result-placeholder")).toBeVisible();

  writeFileSync(
    resolve(EVIDENCE, "e2e-mock-summary.json"),
    `${JSON.stringify({ ts: new Date().toISOString(), mode: "local", consoleErrors }, null, 2)}\n`,
    "utf8",
  );
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});


test("试符台本地演示：四种结果与重置", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "loom.studio.progress.v1",
      JSON.stringify({ prologueSeen: true, actsSeen: [1], levelsStarted: ["L01"], lastCompletedLevelId: null }),
    );
  });
  await page.goto("/");
  await page.getByTestId("btn-repl").click();
  await expect(page.getByTestId("repl-screen")).toBeVisible();

  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("repl-input").press("Enter");
  await expect(page.getByTestId("repl-history")).toContainText(/\[\s*0,\s*65,\s*0\s*\]/);

  await page.getByTestId("repl-example-move").click();
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-history")).toContainText("灰崽照做了");

  await page.getByTestId("repl-input").fill('golem.say("你好，灰崽")');
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-history")).toContainText("灰崽照做了");

  await page.getByTestId("repl-input").fill("golem.place(");
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-error")).toBeVisible();

  await page.getByTestId("btn-repl-reset").click();
  await expect(page.getByTestId("repl-notice")).toContainText("现场已恢复原样");
});
