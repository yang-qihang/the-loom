import { expect, test, type Page } from "@playwright/test";

/**
 * 字体与行内代码强制契约（docs/61）。
 *
 * 1) 代码 = Maple Mono；像素字只用于装饰；正文 = MiSans；三者 computed family 断言。
 * 2) 可见文本中不允许出现未被 <code>/<pre> 包住的反引号（跳过合法代码块/textarea）。
 * 3) 覆盖地图墙、关卡工作台、指令手册、织典、试符台、手记、教材窗口。
 */

const PIXEL = /Zpix|Departure Mono/;
const MISANS = /MiSans/;
const MAPLE = /Maple Mono/;

const seed = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify({
      prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: [], lastCompletedLevelId: null,
    }));
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01","L02","L03","L04","L05","L06","L07","L08","L09","L10"]));
  });
};

async function literalBackticks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const parent = node.parentElement;
      if (text.includes("`") && parent && !parent.closest("code, pre, textarea, .mono, .inline-code")) {
        const style = getComputedStyle(parent);
        if (style.display !== "none" && style.visibility !== "hidden" && parent.getClientRects().length > 0) {
          out.push(text.slice(0, 120));
        }
      }
      node = walker.nextNode();
    }
    return out;
  });
}

async function family(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((element) => getComputedStyle(element).fontFamily);
}

test("字体三轨道 + 行内代码渲染策略", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  expect(await literalBackticks(page), "地图墙出现未渲染反引号").toEqual([]);
  expect(await family(page, ".map-head h1"), "地图墙标题应为像素字").toMatch(PIXEL);
  expect(await family(page, ".map-head .lede"), "地图墙引导长文应为 MiSans").toMatch(MISANS);
  expect(await family(page, ".map-hero-kicker"), "灰岩村的黄昏标签应为像素字").toMatch(PIXEL);
  expect(await family(page, ".map-hero-copy p"), "地图墙短说明应为像素字").toMatch(PIXEL);
  const kickerSize = Number.parseFloat(await page.locator(".map-hero-kicker").evaluate((element) => getComputedStyle(element).fontSize));
  const heroBodySize = Number.parseFloat(await page.locator(".map-hero-copy p").evaluate((element) => getComputedStyle(element).fontSize));
  expect(kickerSize, "灰岩村的黄昏字号必须大于紧跟的正文").toBeGreaterThan(heroBodySize);
  expect(await family(page, ".btn"), "按钮应为像素字").toMatch(PIXEL);
  for (const id of ["btn-settings"]) {
    expect(await family(page, `[data-testid="${id}"]`), `${id} 应为像素字`).toMatch(PIXEL);
  }

  await page.getByTestId("level-card-L01").click();
  for (let i = 0; i < 3; i++) {
    const act = page.getByTestId("act-skip");
    if (await act.isVisible().catch(() => false)) {
      expect(await literalBackticks(page), "幕开场出现未渲染反引号").toEqual([]);
      await act.click();
    }
    const opening = page.getByTestId("opening-start");
    if (await opening.isVisible().catch(() => false)) {
      expect(await literalBackticks(page), "关开场出现未渲染反引号").toEqual([]);
      await opening.click();
    }
  }
  await expect(page.getByTestId("code-editor")).toBeVisible();
  expect(await literalBackticks(page), "工作台出现未渲染反引号").toEqual([]);
  expect(await family(page, ".coach-line"), "教练卡正文应为 MiSans").toMatch(MISANS);
  expect(await family(page, ".hud-note"), "HUD 短说明应为像素字").toMatch(PIXEL);
  expect(await family(page, ".btn"), "工作台按钮应为像素字").toMatch(PIXEL);
  for (const id of ["btn-pin", "btn-companion"]) {
    const locator = page.getByTestId(id);
    if (await locator.isVisible().catch(() => false)) {
      expect(await locator.evaluate((element) => getComputedStyle(element).fontFamily), `${id} 应为像素字`).toMatch(PIXEL);
    }
  }
  expect(await family(page, ".monaco-editor .view-lines"), "编辑器应为 Maple").toMatch(MAPLE);
  for (const codeSelector of ["code", ".inline-code"]) {
    const families = await page.locator(codeSelector).evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontFamily));
    for (const value of families) {
      expect(value, `${codeSelector} 不允许像素字`).not.toMatch(PIXEL);
      expect(value, `${codeSelector} 不允许正文 MiSans`).not.toMatch(MISANS);
    }
  }

  for (const [label, id] of [["指令手册", "btn-manual"], ["试符台", "btn-repl-top"], ["织典", "btn-codex"], ["旅途手记", "btn-journal"]] as const) {
    const button = page.getByTestId(id);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    await page.waitForTimeout(120);
    expect(await literalBackticks(page), `${label}出现未渲染反引号`).toEqual([]);
    await page.keyboard.press("Escape");
  }

  const textbook = page.getByTestId("btn-textbook");
  if (await textbook.isVisible().catch(() => false)) {
    await textbook.click();
    await page.waitForTimeout(160);
    for (let chapter = 0; chapter < 10; chapter++) {
      expect(await literalBackticks(page), `教材第 ${chapter + 1} 章出现未渲染反引号`).toEqual([]);
      const next = page.getByTestId("btn-textbook-next");
      if (!(await next.isEnabled().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(100);
    }
  }
});
