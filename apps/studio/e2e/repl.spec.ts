import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "evidence");
mkdirSync(EVIDENCE, { recursive: true });

test("试符台：进入 → 坐标 → 错误 → 重置", async ({ page }) => {
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
  await page.getByTestId("btn-repl").click();
  await expect(page.getByTestId("repl-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "试符台" })).toBeVisible();
  await expect(page.getByTestId("repl-empty")).toBeVisible();
  await expect(page.getByTestId("repl-input")).toBeVisible();
  await expect(page.getByTestId("btn-repl-try")).toBeVisible();
  const inputScale = await page.evaluate(() => {
    const el = document.querySelector(".repl-input") as HTMLInputElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, font: parseFloat(cs.fontSize), lineHeight: parseFloat(cs.lineHeight), padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom) };
  });
  expect(inputScale, "试符台输入框不存在").not.toBeNull();
  expect(inputScale!.height, "输入框高度不应超过同行按钮 44px").toBeLessThanOrEqual(45);
  expect(inputScale!.height, "输入框高度不应小于同行按钮").toBeGreaterThanOrEqual(43);
  expect(inputScale!.font, "输入框字号应为 16").toBe(16);
  expect(inputScale!.padTop, "输入框上内边距过大").toBeLessThanOrEqual(9);
  expect(inputScale!.padBottom, "输入框下内边距过大").toBeLessThanOrEqual(9);
  expect(inputScale!.lineHeight / inputScale!.font, "输入框行高相对字号过大").toBeLessThanOrEqual(1.6);
  await expect(page.getByTestId("btn-repl-clear")).toHaveText("清空对话");
  await expect(page.getByTestId("btn-repl-reset")).toHaveText("把现场恢复原样");

  // 标题沿中线 + 无横向滚动
  const viewport = page.viewportSize();
  if (viewport) {
    const box = await page.getByTestId("repl-screen").locator("[data-ui-title]").first().boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  }
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(noScroll).toBe(true);
  await page.screenshot({ path: resolve(EVIDENCE, "14-repl-empty.png"), fullPage: false });

  // 1) 表达式：坐标
  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("repl-input").press("Enter");
  await expect(page.getByTestId("repl-history")).toContainText("golem.pos");
  await expect(page.getByTestId("repl-history")).toContainText("65");
  await expect(page.getByTestId("repl-history")).toContainText("你写的");
  await expect(page.getByTestId("repl-history")).toContainText("灰崽");
  await page.screenshot({ path: resolve(EVIDENCE, "15-repl-success.png"), fullPage: false });

  // 2) 示例可直接执行：moveTo → 灰崽照做了
  await page.getByTestId("repl-example-move").click();
  await expect(page.getByTestId("repl-input")).toHaveValue('golem.moveTo(-12, -2)');
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-history")).toContainText("照做了");
  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-history")).toContainText("-12");

  // 3) 错误：中文红框，不出现英文叙述
  await page.getByTestId("repl-input").fill("golem.place(");
  await page.getByTestId("btn-repl-try").click();
  await expect(page.getByTestId("repl-error")).toBeVisible();
  const errorText = await page.getByTestId("repl-error").innerText();
  expect(errorText.length).toBeGreaterThan(0);
  expect(/[A-Za-z]{2,}/.test(errorText)).toBe(false);
  await page.screenshot({ path: resolve(EVIDENCE, "16-repl-error.png"), fullPage: false });

  // 4) 重置：现场回初始
  await page.getByTestId("btn-repl-reset").click();
  await expect(page.getByTestId("repl-notice")).toContainText("现场已恢复原样");
  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("repl-input").press("Enter");
  await expect(page.getByTestId("repl-history")).toContainText("左右 0");

  // 5) 返回不丢地图
  await page.getByTestId("btn-repl-back").click();
  await expect(page.getByTestId("repl-screen")).toBeHidden();
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
