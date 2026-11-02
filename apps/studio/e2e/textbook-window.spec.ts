// 配套教材浮动窗口回归（docs/49 §2.5 / 用户任务 6）。
//
// 接入契约（App/Workbench 由 Lead 接入）：
// - 进入关卡后首次自动打开本章教材；工作台右下角常驻入口 `data-testid="btn-textbook"`（可随时回看）。
// - 窗口是 body portal 的非模态浮窗：可拖动/缩放/置顶，几何与置顶状态持久化。
//
// 覆盖：打开/章节导航/目录滚动/阅读字体与代码字体/代码复制/callout/术语/拖动/缩放/置顶/
// 持久化/窄视口单列/关闭与 Esc/已读标记/控制台无错误；证据写 evidence/textbook-window/。
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STUDIO_DIR = resolve(process.cwd());
const EVIDENCE_DIR = resolve(STUDIO_DIR, "../../evidence/textbook-window");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const PROGRESS_KEY = "loom.studio.progress.v1";
const WINDOW_KEY = "loom.textbook.window.v1";
const READ_KEY = "loom.textbook.read.v1";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function prepare(page: Page): Promise<void> {
  await page.addInitScript(
    ({ progressKey, windowKey, readKey }) => {
      localStorage.setItem(
        progressKey,
        JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }),
      );
      if (!sessionStorage.getItem("loom.textbook.e2e.init")) {
        sessionStorage.setItem("loom.textbook.e2e.init", "1");
        localStorage.removeItem(windowKey);
        localStorage.removeItem(readKey);
      }
    },
    { progressKey: PROGRESS_KEY, windowKey: WINDOW_KEY, readKey: READ_KEY },
  );
}

async function enterL01(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("level-card-L01")).toBeVisible();
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
}

async function ensureTextbookOpen(page: Page): Promise<void> {
  const win = page.getByTestId("textbook-window");
  // 首次进入会自动打开；若被上一轮已读标记抑制，则从常驻入口打开。
  if (!(await win.isVisible().catch(() => false))) {
    await page.getByTestId("btn-textbook").click();
  }
  await expect(win).toBeVisible();
}

test("教材浮动窗口：阅读排版、代码字体、拖动缩放置顶、持久化与关闭", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await prepare(page);
  await enterL01(page);
  await ensureTextbookOpen(page);

  const win = page.getByTestId("textbook-window");
  const scroll = page.getByTestId("textbook-scroll");
  await expect(win).toHaveAttribute("role", "dialog");
  await expect(win).toHaveAttribute("aria-modal", "false");

  // 1) 标题/副标题/正文 = 当前关卡章节（L01 第一缕光）。
  await expect(page.getByTestId("textbook-title")).toContainText("第一缕光");
  await expect(page.getByTestId("textbook-subtitle")).toContainText("调用");
  await expect(page.getByTestId("textbook-content")).toBeVisible();
  const counter = page.getByTestId("textbook-counter");
  await expect(counter).toContainText("1 / 10");

  // 2) 默认几何：980×760（1440×960 视口下不被夹取）。
  const geometry = async () =>
    win.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    });
  const initial = await geometry();
  expect(initial.width).toBe(980);
  expect(initial.height).toBe(760);

  // 3) 章节导航：下一章 → 第二章标题；上一章 → 回到 L01。
  await page.getByTestId("btn-textbook-next").click();
  await expect(counter).toContainText("2 / 10");
  const secondTitle = (await page.getByTestId("textbook-title").textContent())?.trim() ?? "";
  expect(secondTitle.length).toBeGreaterThan(0);
  expect(secondTitle).not.toContain("第一缕光");
  await page.getByTestId("btn-textbook-prev").click();
  await expect(counter).toContainText("1 / 10");
  await expect(page.getByTestId("textbook-title")).toContainText("第一缕光");

  // 4) 目录：点击最后一个小节后正文滚动。
  const tocButtons = page.getByTestId("textbook-toc").locator("button");
  const tocCount = await tocButtons.count();
  expect(tocCount).toBeGreaterThanOrEqual(3);
  await scroll.evaluate((element) => element.scrollTo({ top: 0, behavior: "auto" }));
  await tocButtons.nth(tocCount - 1).click();
  await expect.poll(async () => scroll.evaluate((element) => element.scrollTop), { timeout: 10_000 }).toBeGreaterThan(120);

  // 5) 阅读字体：正文 Noto Sans SC、17–18px、行高 1.75–1.9。
  const reading = await page.locator(".tb-p").first().evaluate((element) => {
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    return {
      fontFamily: style.fontFamily,
      fontSize,
      lineHeightRatio: Number.parseFloat(style.lineHeight) / fontSize,
      width: element.getBoundingClientRect().width,
    };
  });
  expect(reading.fontFamily).toContain("Noto Sans SC");
  expect(reading.fontSize).toBeGreaterThanOrEqual(17);
  expect(reading.fontSize).toBeLessThanOrEqual(18);
  expect(reading.lineHeightRatio).toBeGreaterThanOrEqual(1.75);
  expect(reading.lineHeightRatio).toBeLessThanOrEqual(1.95);

  // 6) 代码字体：Maple Mono、横向可滚动、pre 不换行。
  const codeMetrics = await page.locator(".tb-code-pre").first().evaluate((element) => {
    const style = getComputedStyle(element);
    const code = element.querySelector("code");
    const codeStyle = code ? getComputedStyle(code) : null;
    return {
      fontFamily: codeStyle?.fontFamily ?? "",
      overflowX: style.overflowX,
      whiteSpace: codeStyle?.whiteSpace ?? "",
    };
  });
  expect(codeMetrics.fontFamily).toContain("Maple Mono");
  expect(codeMetrics.overflowX).toBe("auto");
  expect(codeMetrics.whiteSpace).toBe("pre");
  expect(await page.locator(".tb-code").count()).toBeGreaterThanOrEqual(3);

  // 7) 代码复制成功路径。
  const copyButton = page.locator(".tb-code-copy").first();
  await copyButton.scrollIntoViewIfNeeded();
  await expect(copyButton).toHaveAttribute("data-copy-state", "idle");
  await copyButton.click();
  await expect(copyButton).toHaveAttribute("data-copy-state", "copied");
  const clipboardText = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  });
  if (clipboardText !== null) expect(clipboardText).toContain("golem");

  // 8) callout / 术语 / 列表 / 行内代码。
  await expect(page.getByTestId("textbook-callout-warn")).toBeVisible();
  await expect(page.getByTestId("textbook-callout-warn").locator(".tb-callout-label")).toHaveText("注意");
  expect(await page.locator(".tb-terms dt").count()).toBeGreaterThanOrEqual(5);
  expect(await page.locator(".tb-list li").count()).toBeGreaterThanOrEqual(2);
  expect(await page.locator(".tb-p .inline-code").count()).toBeGreaterThan(0);

  await win.screenshot({ path: resolve(EVIDENCE_DIR, "textbook-window-element.png") });
  await page.screenshot({ path: resolve(EVIDENCE_DIR, "textbook-window-1440x960.png") });

  // 9) 拖动标题栏（夹在视口内）。
  const titlebar = page.getByTestId("textbook-titlebar");
  const titlebarBox = await titlebar.boundingBox();
  if (!titlebarBox) throw new Error("标题栏不可见");
  await page.mouse.move(titlebarBox.x + titlebarBox.width / 2, titlebarBox.y + titlebarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titlebarBox.x + titlebarBox.width / 2 + 90, titlebarBox.y + titlebarBox.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const dragged = await geometry();
  expect(dragged.x).toBeGreaterThan(initial.x);
  expect(dragged.y).toBeGreaterThan(initial.y);

  // 10) 右下角缩放（变宽变高）。
  const resizeHandle = page.getByTestId("textbook-resize");
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox) throw new Error("缩放手柄不可见");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 140, resizeBox.y + resizeBox.height / 2 + 100, { steps: 6 });
  await page.mouse.up();
  const resized = await geometry();
  expect(resized.width).toBeGreaterThan(dragged.width);
  expect(resized.height).toBeGreaterThan(dragged.height);

  // 11) 置顶：z-index 85 ↔ 60，且持久化。
  const pinButton = page.getByTestId("btn-textbook-pin");
  await pinButton.click();
  expect(await win.evaluate((element) => getComputedStyle(element).zIndex)).toBe("85");
  await pinButton.click();
  expect(await win.evaluate((element) => getComputedStyle(element).zIndex)).toBe("60");
  await pinButton.click();
  // 窗口几何/置顶落盘有 120ms 防抖；等它写完再断言 localStorage。
  await page.waitForTimeout(260);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>, WINDOW_KEY);
  expect(stored.pinned).toBe(true);
  expect(Number(stored.width)).toBe(resized.width);

  // 12) 重载后几何/置顶恢复（已读标记决定是否自动打开，这里手动从入口打开）。
  await page.reload();
  await expect(page.getByTestId("level-card-L01")).toBeVisible();
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await ensureTextbookOpen(page);
  const restored = await geometry();
  expect(Math.abs(restored.width - resized.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.height - resized.height)).toBeLessThanOrEqual(2);
  expect(await win.evaluate((element) => getComputedStyle(element).zIndex)).toBe("85");

  // 13) Esc 关闭；关闭即标记已读；入口可再次打开（回看）。
  await page.getByTestId("textbook-titlebar").click({ position: { x: 60, y: 20 } });
  await page.keyboard.press("Escape");
  await expect(win).toHaveCount(0);
  const readIds = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as string[], READ_KEY);
  expect(readIds).toContain("L01");
  await page.getByTestId("btn-textbook").click();
  await expect(win).toBeVisible();
  await page.getByTestId("btn-textbook-start").click();
  await expect(win).toHaveCount(0);

  // 14) 窄视口：窗口被夹取为 compact 单列。
  await page.setViewportSize({ width: 800, height: 640 });
  await page.getByTestId("btn-textbook").click();
  await expect(win).toBeVisible();
  await expect(win).toHaveAttribute("data-compact", "true");
  const compactGeometry = await geometry();
  expect(compactGeometry.width).toBeLessThanOrEqual(800 - 8);
  await page.screenshot({ path: resolve(EVIDENCE_DIR, "textbook-window-compact-800x640.png") });

  writeFileSync(
    resolve(EVIDENCE_DIR, "textbook-window.json"),
    `${JSON.stringify(
      {
        ts: new Date().toISOString(),
        viewport: { width: 1440, height: 960 },
        initial,
        dragged,
        resized,
        restored,
        compactGeometry,
        chapterTotal: 10,
        reading,
        codeMetrics,
        readIds,
        consoleErrors,
        screenshot: "textbook-window-element.png / textbook-window-1440x960.png / textbook-window-compact-800x640.png",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
