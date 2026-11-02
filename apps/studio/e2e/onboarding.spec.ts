import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "evidence");
mkdirSync(EVIDENCE, { recursive: true });


async function expectOverlayTitleCentered(page: import("@playwright/test").Page, screen: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("没有视口尺寸");
  const boxes = await page.locator("[data-ui-title]").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: (element.textContent ?? "").trim(), centerX: rect.x + rect.width / 2, height: rect.height };
    }),
  );
  expect(boxes.length, `${screen}: 应有页面级标题`).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Math.abs(box.centerX - viewport.width / 2), `${screen} 标题「${box.text}」中线偏差`).toBeLessThanOrEqual(2);
  }
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(scroll, `${screen}: 不应横向滚动`).toBe(true);
}

test("首次进入：序章 → 跳过 → L01 开场三句 → 开始 → Esc 手记", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    if (!sessionStorage.getItem("loom.e2e.cleared")) {
      localStorage.clear();
      sessionStorage.setItem("loom.e2e.cleared", "1");
    }
    // 已读教材：本 spec 验证的是序章/开场/手记流程，教材自动弹窗会拦截点击，按「回访玩家」预置。
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]));
  });
  await page.goto("/");

  // 1) 序章（首次进入自动播放 8 屏；可跳过，跳过也算看过）
  await expect(page.getByTestId("prologue-overlay")).toBeVisible();
  await expect(page.getByTestId("prologue-overlay")).toContainText("序章");
  await expectOverlayTitleCentered(page, "序章");
  await page.screenshot({ path: resolve(EVIDENCE, "09-prologue.png"), fullPage: false });
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("prologue-overlay")).toContainText("织偶");
  await page.screenshot({ path: resolve(EVIDENCE, "09b-prologue-3.png"), fullPage: false });
  await page.getByTestId("onboarding-skip").click();
  await expect(page.getByTestId("prologue-overlay")).toBeHidden();
  await expect(page.getByTestId("map-acts")).toBeVisible();
  await expect(page.getByTestId("btn-journal")).toBeVisible();

  // 2) 选 L01 → 幕开场 → 关开场三句
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("act-overlay")).toBeVisible();
  await page.getByTestId("act-skip").click();
  await expect(page.getByTestId("opening-overlay")).toBeVisible();
  const opening = page.getByTestId("opening-lines");
  await expect(opening.locator("li")).toHaveCount(3);
  await expect(opening).toContainText("小径上的灯又灭了");
  await expect(opening).toContainText("先让灰崽点亮 1 到 3 号灯");
  await expect(opening).toContainText("最后那盏要你亲手点");
  await expectOverlayTitleCentered(page, "关开场");
  await page.screenshot({ path: resolve(EVIDENCE, "10-level-opening.png"), fullPage: false });
  await page.getByTestId("opening-start").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();

  // 3) Esc 打开旅途手记：世界 / 我 / 已解锁名词 / 上一关
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("journal-overlay")).toBeVisible();
  await expect(page.getByTestId("journal-overlay")).toContainText("旅途手记");
  await expect(page.getByTestId("journal-overlay")).toContainText("世界怎么了");
  await expect(page.getByTestId("term-织偶")).toBeVisible();
  await expect(page.getByTestId("term-符文")).toBeVisible();
  await page.getByTestId("term-织偶").click();
  await expect(page.getByTestId("journal-overlay")).toContainText("织机织出来的无魂工匠");
  await expectOverlayTitleCentered(page, "旅途手记");
  await page.screenshot({ path: resolve(EVIDENCE, "11-journal.png"), fullPage: true });

  // 4) 关闭手记回到原界面，进度不丢（编辑器仍在）
  await page.getByTestId("journal-close").click();
  await expect(page.getByTestId("journal-overlay")).toBeHidden();
  await expect(page.getByTestId("code-editor")).toBeVisible();

  // 5) 存档：刷新后不再自动播序章
  await page.reload();
  await expect(page.getByTestId("prologue-overlay")).toHaveCount(0);
  await expect(page.getByTestId("map-acts")).toBeVisible();

  writeFileSync(
    resolve(EVIDENCE, "e2e-onboarding-summary.json"),
    `${JSON.stringify({ ts: new Date().toISOString(), flow: ["prologue", "skip", "act", "opening-3-lines", "start", "esc-journal", "close", "reload-no-prologue"], consoleErrors }, null, 2)}\n`,
    "utf8",
  );
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
