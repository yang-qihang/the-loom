import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "evidence");
mkdirSync(EVIDENCE, { recursive: true });

test("织典：目录 → A0 详情 → 切换语言 → 未解锁提示", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    localStorage.setItem(
      "loom.studio.progress.v1",
      JSON.stringify({ prologueSeen: true, actsSeen: [1], levelsStarted: ["L01"], lastCompletedLevelId: null }),
    );
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  await page.getByTestId("btn-codex").click();
  await expect(page.getByTestId("codex-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "织典", exact: true })).toBeVisible();
  await expect(page.getByTestId("codex-screen")).toContainText("织典目录");
  await expect(page.getByTestId("codex-screen")).toContainText("共 17 页");
  await expect(page.locator('[data-testid^="codex-page-"]')).toHaveCount(17);
  await expect(page.getByTestId("codex-page-A0")).toContainText("已解锁");
  await expect(page.getByTestId("codex-page-A2")).toContainText("未解锁");

  const viewport = page.viewportSize();
  if (viewport) {
    const box = await page.locator("[data-ui-title]").first().boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  }
  await page.screenshot({ path: resolve(EVIDENCE, "17-codex-index.png"), fullPage: false });

  // A0 详情：机制 / 跨语言 tab / 在我们游戏里 / 常见误解
  await page.getByTestId("codex-page-A0").click();
  await expect(page.getByTestId("codex-detail")).toContainText("机制");
  await expect(page.getByTestId("codex-detail")).toContainText("跨语言对照");
  await page.getByTestId("codex-tab-c").click();
  await expect(page.getByTestId("codex-code")).toContainText("int y = 2 * 3;");
  await page.getByTestId("codex-tab-python").click();
  await expect(page.getByTestId("codex-code")).toContainText("y = 2 * 3");
  await expect(page.getByTestId("codex-detail")).toContainText("在我们游戏里");
  await expect(page.getByTestId("codex-detail")).toContainText("常见误解");
  await expect(page.getByTestId("codex-detail")).toContainText("注意");
  await expect(page.getByTestId("codex-detail")).toContainText("第 1 关");
  await page.locator(".codex-section.is-warn").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(EVIDENCE, "18-codex-detail.png"), fullPage: false });

  // 未解锁页
  await page.getByTestId("codex-page-A2").click();
  await expect(page.getByTestId("codex-locked")).toContainText("继续织下去，这一页会亮起来");
  await expect(page.getByTestId("codex-locked")).toContainText("第 2 关");

  await page.getByTestId("btn-codex-back").click();
  await expect(page.getByTestId("codex-screen")).toBeHidden();
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
