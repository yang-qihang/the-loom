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


test("WebKit 降级路径：所有宽度首行占满、末行左对齐", async ({ browser }) => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  for (const viewport of [{ width: 1280, height: 900 }, { width: 480, height: 900 }]) {
    const context = await browser.newContext({ userAgent: ua, viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: false, actsSeen: [], levelsStarted: [], lastCompletedLevelId: null }));
      localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01","L02","L03","L04","L05","L06","L07","L08","L09","L10"]));
    });
    await page.goto("/");
    await expect(page.getByTestId("prologue-overlay")).toBeVisible();
    await expect.poll(() => page.locator(".justified-text-block").count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const rows = await page.locator('[data-testid="prologue-overlay"] .justified-text-block').evaluateAll((blocks) =>
      blocks.map((block) => {
        const width = block.getBoundingClientRect().width;
        const left = block.getBoundingClientRect().left;
        const lines = [...block.querySelectorAll<HTMLElement>(".justified-line")].map((line) => {
          const rect = line.getBoundingClientRect();
          const cs = getComputedStyle(line);
          return { width: rect.width, left: rect.left, right: rect.right, align: cs.textAlign, isLast: line.classList.contains("is-last") };
        });
        return { width, left, lines };
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      for (const line of row.lines) {
        if (line.isLast) {
          expect(line.left, `${viewport.width}px 末行必须从左侧开始`).toBeCloseTo(row.left, 1);
          expect(line.align, `${viewport.width}px 末行不得右对齐`).not.toBe("right");
        } else {
          expect(Math.abs(line.width - row.width), `${viewport.width}px 非末行未占满容器`).toBeLessThan(2);
        }
      }
    }
    if (viewport.width < 1000) {
      // 幕开场：同样必须走 JustifiedText（首行占满、末行左起）。
      await page.getByTestId("onboarding-skip").click();
      await page.getByTestId("level-card-L01").click();
      await expect(page.getByTestId("act-overlay")).toBeVisible();
      await expect.poll(() => page.locator('[data-testid="act-overlay"] .justified-text-block').count(), { timeout: 10_000 }).toBeGreaterThan(0);
      const actRows = await page.locator('[data-testid="act-overlay"] .justified-text-block').evaluateAll((blocks) =>
        blocks.map((block) => {
          const width = block.getBoundingClientRect().width;
          const left = block.getBoundingClientRect().left;
          return {
            width,
            left: block.getBoundingClientRect().left,
            lines: [...block.querySelectorAll<HTMLElement>(".justified-line")].map((line) => {
              const rect = line.getBoundingClientRect();
              return { width: rect.width, left: rect.left, isLast: line.classList.contains("is-last") };
            }),
          };
        }),
      );
      for (const row of actRows) {
        for (const line of row.lines) {
          if (line.isLast) expect(line.left, "幕开场末行必须左起").toBeCloseTo(row.left, 1);
          else expect(Math.abs(line.width - row.width), "幕开场非末行未占满").toBeLessThan(2);
        }
      }
    }
    await context.close();
  }
});
