import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 字体系统回归（task-2 / docs/48 §1.7）：
 *  - 所有【代码】渲染位置 → Maple Mono（含编辑器外的手册/织典/试符台/参考解/日志内联代码）；

 *  - 像素装饰字（章节标题/按钮/标签/角色名“艾拉”）保留 Zpix + Departure Mono；
 *  - MiSans VF 用于非像素正文/普通 UI 文本（替换原 Noto 主字体，Noto 作 fallback）；
 *  - 字体文件真的加载成功（document.fonts.check + woff2 网络响应）。
 *
 * 证据：evidence/typography/*.png + typography-verify.json。
 */

const EVIDENCE = resolve(process.cwd(), "../../evidence/typography");
mkdirSync(EVIDENCE, { recursive: true });

const MAPLE = "Maple Mono";
const PIXEL = /Zpix|Departure Mono/;
const MISANS = "MiSans";

/** 代码渲染点（元素 + 类名）：任何一个 computed font-family 不含 Maple Mono 都算失败。 */
const CODE_SELECTOR = "code, pre, kbd, .mono, .inline-code, .solution-code, .gd-signature, .codex-code, .hud-value, .repl-input";

/** 长段正文扫描时跳过的「短标签/装饰字/非正文」选择器（与 typography.css 的装饰字清单同源）。 */
const SHORT_LABEL_SELECTOR = [
  "code",
  "pre",
  "kbd",
  ".mono",
  ".inline-code",
  "textarea",
  "script",
  "style",
  "button",
  ".btn",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[data-ui-title]",
  "[data-ui-panel-title]",
  ".kicker",
  ".card-tag",
  ".phase-chip",
  ".mode-chip",
  ".card-order",
  ".card-meta",
  ".card-status",
  ".night-index",
  ".hint-level",
  ".opening-label",
  ".narrative-note",
  ".stage-scene",
  ".stage-speaker",
  ".opening-mark",
  ".settle-caption",
  ".settle-line",
  ".result-headline",
  ".error-title",
  ".pane-title",
  ".codex-item-title",
  ".codex-item-sub",
  ".codex-badge",
  ".codex-tab",
  ".codex-count",
  ".criterion-state",
  ".term-button",
  ".kbd",
  ".file-chip",
  ".about-tagline",
  ".about-en",
  ".about-version",
  ".dtitle-sub",
  ".error-line",
  ".act-count",
  ".sky-chip",
  ".solution-count",
  ".repl-who",
  ".repl-level-chip",
  ".map-hero-kicker",
  ".map-hero-copy p",
  ".hud-note",
  ".repl-hint",
  ".repl-input-label",
  ".repl-subtitle",
  ".map-status",
  ".settings-row p",
  ".world-strip-text span",
  ".criterion",
  ".settle-goal",
  ".code-req-item",
  ".card.waiting p",
  ".system-kicker",
  "[aria-hidden='true']",
].join(", ");

const SEED_PROGRESS = {
  prologueSeen: true,
  actsSeen: [1, 2, 3],
  levelsStarted: ["L01"],
  lastCompletedLevelId: null,
};

const report: Record<string, unknown> = {};

test.afterAll(() => {
  writeFileSync(resolve(EVIDENCE, "typography-verify.json"), `${JSON.stringify({ ...report, ts: new Date().toISOString() }, null, 2)}\n`, "utf8");
});

function seedProgress(page: Page, progress = SEED_PROGRESS) {
  return page.addInitScript((value) => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify(value));
    // 回访玩家：教材已读，避免首次自动弹出教材窗口拦截工作台点击（教材字体有独立 spec）。
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]));
  }, progress);
}

/** 等字体加载与 swap 后的重排全部落定（否则 computed font-family 可能读到 fallback 阶段）。 */
async function settleFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function fontLoadState(page: Page) {
  await settleFonts(page);
  return page.evaluate(() => ({
    noto: document.fonts.check('16px "Noto Sans SC"', "织界正文"),
    maple: document.fonts.check('16px "Maple Mono"', "golem.pos"),
    misans: document.fonts.check('16px "MiSans VF"', "织界"),
    zpix: document.fonts.check('16px "Zpix"', "织界"),
    departure: document.fonts.check('16px "Departure Mono"', "THE LOOM"),
    loadedFamilies: [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family)
      .sort(),
  }));
}

async function visibleFamilies(page: Page, selector: string) {
  return page.$$eval(selector, (elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        family: style.fontFamily,
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 36),
        visible: style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0,
      };
    }),
  );
}

async function expectFamilies(page: Page, selector: string, expected: string | RegExp, label: string) {
  const rows = (await visibleFamilies(page, selector)).filter((row) => row.visible);
  expect(rows.length, `${label}: 页面上没有可断言的可见元素（${selector}）`).toBeGreaterThan(0);
  for (const row of rows) {
    const ok = typeof expected === "string" ? row.family.includes(expected) : expected.test(row.family);
    expect(ok, `${label}: 「${row.text}」的 font-family 是 ${row.family}`).toBe(true);
  }
}

/** 有则断言、无则跳过（例如手册坐标表依赖关卡命名点数据）。 */
async function expectFamiliesIfPresent(page: Page, selector: string, expected: string, label: string) {
  const rows = (await visibleFamilies(page, selector)).filter((row) => row.visible);
  for (const row of rows) {
    expect(row.family, `${label}: 「${row.text}」的 font-family 是 ${row.family}`).toContain(expected);
  }
}

/**
 * 通用长文断言：页面上任何 ≥24 字的可见文本块（跳过代码/按钮/短标签）都必须是 MiSans VF。
 * 这样即使叙事/手册结构重构、类名变化，也不依赖具体 selector。
 */
async function longTextRows(page: Page, rootSelector: string | null = null) {
  return page.evaluate(
    ({ rootSelector, skipSelector, minLength }) => {
      const root = rootSelector ? document.querySelector(rootSelector) : document.body;
      if (!root) return [];
      const rows: Array<{ text: string; family: string; tag: string; className: string }> = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        const parent = node.parentElement;
        if (text.length >= minLength && parent && !parent.closest(skipSelector)) {
          const style = getComputedStyle(parent);
          const visible = style.display !== "none" && style.visibility !== "hidden" && parent.getClientRects().length > 0;
          if (visible) {
            rows.push({ text: text.slice(0, 40), family: style.fontFamily, tag: parent.tagName, className: String(parent.className) });
          }
        }
        node = walker.nextNode();
      }
      return rows;
    },
    { rootSelector, skipSelector: SHORT_LABEL_SELECTOR, minLength: 24 },
  );
}

async function expectLongTextMiSans(page: Page, label: string, rootSelector: string | null = null) {
  const rows = await longTextRows(page, rootSelector);
  expect(rows.length, `${label}: 找不到 ≥24 字的长段正文，字体断言无从谈起`).toBeGreaterThan(0);
  const bad = rows.filter((row) => !row.family.includes(MISANS));
  expect(
    bad.map((row) => `${row.tag}.${row.className}「${row.text}」→ ${row.family}`),
    `${label}: 长段正文必须使用非像素正文 MiSans VF`,
  ).toEqual([]);
}

async function openIfVisible(page: Page, testId: string) {
  const overlay = page.getByTestId(testId);
  if (await overlay.isVisible().catch(() => false)) {
    return overlay;
  }
  return null;
}

test("字体资产：像素装饰字 + MiSans 正文 + 长文 + 字体真加载", async ({ page }) => {
  const fontResponses: Array<{ url: string; status: number }> = [];
  const fontFailures: string[] = [];
  page.on("response", (response) => {
    if (/\.woff2(\?|$)/.test(response.url())) fontResponses.push({ url: response.url(), status: response.status() });
  });
  page.on("requestfailed", (request) => {
    if (/\.woff2(\?|$)/.test(request.url())) fontFailures.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`);
  });

  await page.goto("/");

  // 1) 首次进入：序章正文 MiSans，角色名/按钮像素字。
  await expect(page.getByTestId("prologue-overlay")).toBeVisible();
  // 2026-11-02 用户要求：序章/幕/关开场方框里的横向金色装饰线必须不存在。
  await expect(page.locator(".stage-lines")).toHaveCount(0);
  // 2026-11-02 用户要求：有充足文本时，序言/幕/关开场正文两端对齐（短行/末行保持自然左对齐）。
  const stageAlign = await page.locator('[data-testid="prologue-overlay"] .stage-lines-text p').first().evaluate((element) => getComputedStyle(element).textAlign);
  expect(stageAlign, "序言正文未两端对齐").toBe("justify");
  // 两段正文必须共享同一文本盒（左右边必须一致；不能一段比另一段整体右移）。
  const stageBoxes = await page.locator('[data-testid="prologue-overlay"] .stage-lines-text p').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }),
  );
  expect(stageBoxes.length, "序言应有至少两段正文").toBeGreaterThanOrEqual(2);
  for (const box of stageBoxes) {
    expect(Math.abs(box.left - stageBoxes[0].left), "序言两段左边缘不一致").toBeLessThan(0.5);
    expect(Math.abs(box.right - stageBoxes[0].right), "序言两段右边缘不一致").toBeLessThan(0.5);
    expect(Math.abs(box.width - stageBoxes[0].width), "序言两段文本盒宽度不一致").toBeLessThan(0.5);
  }
  const loadState = await fontLoadState(page);
  expect(loadState.misans, "MiSans VF 未加载").toBe(true);
  expect(loadState.zpix, "Zpix 未加载").toBe(true);
  expect(loadState.departure, "Departure Mono 未加载").toBe(true);
  await expectLongTextMiSans(page, "序章", '[data-testid="prologue-overlay"]');
  await expectFamilies(page, '[data-testid="prologue-overlay"] .stage-speaker', PIXEL, "角色名（艾拉）");
  await expectFamilies(page, '[data-testid="prologue-overlay"] .btn', PIXEL, "序章按钮");
  await page.screenshot({ path: resolve(EVIDENCE, "01-prologue-long-text.png") });

  // 2) 跳过序章 → 地图墙：标题/按钮像素字 / 引导长文 MiSans。
  await page.getByTestId("onboarding-skip").click();
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  await settleFonts(page);
  await expectFamilies(page, ".map-head h1", PIXEL, "地图墙主标题");
  await expectFamilies(page, ".map-head .lede", MISANS, "地图墙引导长文");
  await expectFamilies(page, ".btn", PIXEL, "地图墙按钮");
  await expectLongTextMiSans(page, "地图墙");
  await page.screenshot({ path: resolve(EVIDENCE, "02-map-wall.png"), fullPage: true });

  // 3) 进关：幕/关开场正文 MiSans，开始按钮像素字。
  // 回访玩家：教材已读，避免首次自动弹出教材窗口抢走 Esc/点击（教材字体有独立 spec）。
  await page.evaluate(() =>
    localStorage.setItem(
      "loom.textbook.read.v1",
      JSON.stringify(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]),
    ),
  );
  await page.getByTestId("level-card-L01").click();
  await expect(page.locator('[data-testid="act-overlay"], [data-testid="opening-overlay"], [data-testid="code-editor"]').first()).toBeVisible();
  const actOverlay = await openIfVisible(page, "act-overlay");
  if (actOverlay) {
    await settleFonts(page);
    await expectLongTextMiSans(page, "幕开场", '[data-testid="act-overlay"]');
    await expectFamilies(page, '[data-testid="act-overlay"] .btn', PIXEL, "幕开场按钮");
    await page.screenshot({ path: resolve(EVIDENCE, "03-act-intro.png") });
    await page.getByTestId("act-skip").click();
  }
  const openingOverlay = await openIfVisible(page, "opening-overlay");
  if (openingOverlay) {
    await settleFonts(page);
    await expectLongTextMiSans(page, "关开场", '[data-testid="opening-overlay"]');
    await expectFamilies(page, '[data-testid="opening-overlay"] .btn', PIXEL, "关开场按钮");
    await page.screenshot({ path: resolve(EVIDENCE, "04-level-opening.png") });
    await page.getByTestId("opening-start").click();
  }
  await expect(page.getByTestId("code-editor")).toBeVisible();

  // 4) 手记：正文 MiSans（含展开名词解释）。
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("journal-overlay")).toBeVisible();
  await settleFonts(page);
  await expectLongTextMiSans(page, "旅途手记", '[data-testid="journal-overlay"]');
  await expectFamilies(page, '[data-testid="journal-overlay"] .btn', PIXEL, "手记按钮");
  await page.screenshot({ path: resolve(EVIDENCE, "05-journal.png"), fullPage: true });
  await page.getByTestId("journal-close").click();
  await expect(page.getByTestId("journal-overlay")).toBeHidden();

  expect(fontFailures, `woff2 字体请求失败: ${fontFailures.join(" | ")}`).toEqual([]);
  expect(fontResponses.length, "没有捕获到任何 woff2 字体请求").toBeGreaterThanOrEqual(3);
  const badStatus = fontResponses.filter((response) => response.status >= 400);
  expect(badStatus, `字体文件 HTTP 状态异常: ${badStatus.map((item) => `${item.status} ${item.url}`).join(" | ")}`).toEqual([]);
  report.fontLoad = { ...loadState, responses: fontResponses };
});

test("代码统一 Maple Mono：编辑器/参考解/手册/试符台/织典 + 长文 MiSans", async ({ page }) => {
  await seedProgress(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await settleFonts(page);

  // 1) 编辑器 + 教练卡/结果卡长文。
  const loadState = await fontLoadState(page);
  expect(loadState.maple, 'Maple Mono 未加载（document.fonts.check("16px \\"Maple Mono\\"") = false）').toBe(true);
  await expectFamilies(page, ".monaco-editor .view-lines", MAPLE, "Monaco 编辑器");
  await expectFamilies(page, ".coach-line", MISANS, "教练卡正文");
  await expectLongTextMiSans(page, "工作台");
  await expectFamilies(page, ".btn", PIXEL, "工作台按钮");
  await page.screenshot({ path: resolve(EVIDENCE, "06-workbench.png"), fullPage: true });

  // 2) 参考解查看器：<pre> 代码块必须 Maple Mono。
  const solutionButton = page.getByTestId("btn-solution");
  if (await solutionButton.isVisible().catch(() => false)) {
    await solutionButton.click();
  } else {
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-solution-menu").click();
  }
  await expect(page.getByTestId("solution-viewer")).toBeVisible();
  await settleFonts(page);
  await expectFamilies(page, ".solution-code", MAPLE, "参考解代码块");
  await expectFamilies(page, CODE_SELECTOR, MAPLE, "参考解查看器内代码元素");
  await page.screenshot({ path: resolve(EVIDENCE, "07-solution-viewer.png") });
  await page.getByTestId("btn-solution-close").click();

  // 3) 指令手册：API 签名/示例/坐标是代码；说明长文是 MiSans。
  await page.getByTestId("btn-manual").click();
  await expect(page.getByTestId("api-manual")).toBeVisible();
  await settleFonts(page);
  await expectFamilies(page, ".gd-signature", MAPLE, "手册 API 签名");
  await expectFamilies(page, ".gd-example", MAPLE, "手册示例代码");
  await expectFamiliesIfPresent(page, ".gd-pos", MAPLE, "手册坐标");
  await expectFamilies(page, ".gd-summary", MISANS, "手册说明长文");
  await expectFamilies(page, CODE_SELECTOR, MAPLE, "指令手册内代码元素");
  await expectLongTextMiSans(page, "指令手册", '[data-testid="api-manual"]');
  await page.screenshot({ path: resolve(EVIDENCE, "08-guidance-manual.png") });
  await page.getByTestId("btn-manual-close").click();

  // 4) 试符台（REPL）：输入框与历史里的代码是 Maple Mono。
  await page.getByTestId("btn-repl-top").click();
  await expect(page.getByTestId("repl-screen")).toBeVisible();
  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("repl-input").press("Enter");
  await expect(page.getByTestId("repl-history").locator("code").first()).toBeVisible();
  await settleFonts(page);
  await expectFamilies(page, ".repl-input", MAPLE, "试符台输入框");
  await expectFamilies(page, ".repl-example code", MAPLE, "试符台示例代码");
  await expectFamilies(page, CODE_SELECTOR, MAPLE, "试符台内代码元素");
  await expectFamilies(page, ".repl-hint", PIXEL, "试符台短说明文字");
  await page.screenshot({ path: resolve(EVIDENCE, "09-repl.png") });
  await page.getByTestId("btn-repl-back").click();

  // 5) 织典：跨语言代码块 Maple Mono，正文说明 MiSans。
  await page.getByTestId("btn-codex").click();
  await expect(page.getByTestId("codex-screen")).toBeVisible();
  await expect(page.getByTestId("codex-code")).toBeVisible();
  await settleFonts(page);
  await expectFamilies(page, ".codex-code", MAPLE, "织典代码块");
  await expectFamilies(page, ".codex-section p", MISANS, "织典正文长文");
  await expectFamilies(page, CODE_SELECTOR, MAPLE, "织典内代码元素");
  await expectLongTextMiSans(page, "织典", '[data-testid="codex-screen"]');
  await page.screenshot({ path: resolve(EVIDENCE, "10-codex.png") });

  report.codeFamilies = await visibleFamilies(page, CODE_SELECTOR);
  report.codeFontLoad = loadState;
});
