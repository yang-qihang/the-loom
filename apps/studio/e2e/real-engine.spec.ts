import { expect, test, type Frame, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "evidence");
mkdirSync(EVIDENCE, { recursive: true });

/** real-engine 配置里的引擎地址（playwright.config.ts 的 PORT=4399）。 */
const ENGINE_BASE = "http://127.0.0.1:4399";

interface ApiProgressStep {
  id: string;
  text: string;
  player: boolean;
}

/** 目标面板真值来自引擎 progress（docs/46 §2.3）：e2e 断言随内容层文案变化自动适配。 */
async function apiProgress(levelId: string): Promise<ApiProgressStep[]> {
  const response = await fetch(`${ENGINE_BASE}/api/levels/${levelId}`);
  expect(response.ok, `/api/levels/${levelId} 可访问`).toBe(true);
  const data = (await response.json()) as { progress?: ApiProgressStep[] };
  return Array.isArray(data.progress) ? data.progress.filter((step) => typeof step?.id === "string") : [];
}

const PROGRESS = {
  prologueSeen: true,
  actsSeen: [1, 2, 3],
  levelsStarted: ["L01", "L02", "L03", "L04"],
  lastCompletedLevelId: null,
};

async function seedProgress(page: Page) {
  await page.addInitScript((progress) => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify(progress));
    // 回访玩家：教材已读，避免首次自动弹出教材窗口拦截工作台点击（教材本身有独立 spec）。
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]));
  }, PROGRESS);
}

interface TitleBox {
  text: string;
  centerX: number;
  height: number;
  lineHeight: number;
  whiteSpace: string;
}

/** docs/20 §3b3 机器检查：标题沿中线、单行、无横向滚动、同级面板标题一致。 */
async function assertLayout(page: Page, screen: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("没有视口尺寸");
  const titles: TitleBox[] = await page.locator("[data-ui-title]").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const parsedLineHeight = Number.parseFloat(style.lineHeight);
      const fontSize = Number.parseFloat(style.fontSize);
      return {
        text: (element.textContent ?? "").trim(),
        centerX: rect.x + rect.width / 2,
        height: rect.height,
        lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.5,
        whiteSpace: style.whiteSpace,
      };
    }),
  );
  expect(titles.length, `${screen}: 至少有一个页面级标题`).toBeGreaterThan(0);
  for (const title of titles) {
    expect(Math.abs(title.centerX - viewport.width / 2), `${screen} 标题「${title.text}」中线偏差`).toBeLessThanOrEqual(2);
    expect(title.height, `${screen} 标题「${title.text}」不应换行`).toBeLessThanOrEqual(title.lineHeight + 4);
    expect(title.whiteSpace, `${screen} 标题「${title.text}」不换行`).not.toBe("normal");
  }

  const headerOverlaps = await page.evaluate(() => {
    const title = document.querySelector(".wb-top [data-ui-title]");
    if (!title) return [];
    const t = title.getBoundingClientRect();
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll(".wb-top button, .wb-top .phase-chip, .wb-top .mode-chip"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const overlap = r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1;
      if (overlap) hits.push((el.textContent ?? "").trim().slice(0, 20));
    }
    return hits;
  });
  expect(headerOverlaps, `${screen}: 顶栏按钮与标题重叠`).toEqual([]);

  // 操作区拥挤/重叠审计：同一行的按钮与说明之间至少 8px；按钮之间不得相交。
  const footerCrowding = await page.evaluate(() => {
    const root = document.querySelector(".map-foot-left");
    if (!root) return [];
    const items = Array.from(root.querySelectorAll("button, span"))
      .map(el => ({ label: (el.textContent ?? "").trim().slice(0, 16), r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 0 && x.r.height > 0);
    const bad: string[] = [];
    for (let i = 0; i < items.length - 1; i += 1) {
      const a = items[i]!.r, b = items[i + 1]!.r;
      const sameRow = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < Math.min(a.height, b.height) / 2;
      if (sameRow && b.left - a.right < 8) bad.push(`${items[i]!.label} / ${items[i + 1]!.label}: gap ${(b.left - a.right).toFixed(1)}px`);
    }
    return bad;
  });
  expect(footerCrowding, `${screen}: 底部操作区文字/按钮间距过小`).toEqual([]);

  // 同行控件等高 + 最小间距审计（全站横向操作行）。
  const rowIssues = await page.evaluate(() => {
    const rows = [
      ".map-head-actions", ".wb-status", ".actions-main", ".actions-extra", ".coach-actions",
      ".error-actions", ".map-foot-left", ".journal-actions", ".settle-actions", ".repl-actions", ".codex-tabs",
    ];
    const bad: string[] = [];
    for (const selector of rows) {
      const root = document.querySelector(selector);
      if (!root) continue;
      const items = Array.from(root.querySelectorAll(":scope > button, :scope > .btn, :scope > .mode-chip, :scope > .phase-chip"))
        .map(el => ({ label: (el.textContent ?? "").trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter(x => x.r.width > 0 && x.r.height > 0);
      const byRow = new Map<number, typeof items>();
      for (const item of items) {
        const key = Math.round((item.r.top + item.r.bottom) / 4) * 2;
        const list = byRow.get(key) ?? [];
        list.push(item);
        byRow.set(key, list);
      }
      for (const list of byRow.values()) {
        if (list.length < 2) continue;
        const hs = list.map(x => x.r.height);
        if (Math.max(...hs) - Math.min(...hs) > 1.5) bad.push(`${selector}: 同行高度 ${list.map(x => `${x.label}=${x.r.height.toFixed(1)}`).join(", ")}`);
        const sorted = [...list].sort((a, b) => a.r.left - b.r.left);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const gap = sorted[i + 1]!.r.left - sorted[i]!.r.right;
          if (gap < 8) bad.push(`${selector}: ${sorted[i]!.label} ↔ ${sorted[i + 1]!.label} 间距 ${gap.toFixed(1)}px`);
        }
      }
    }
    return bad;
  });
  expect(rowIssues, `${screen}: 同行控件高度/间距不一致`).toEqual([]);

  // 装饰性文字阴影审计：标题与卡片标题不允许 text-shadow 重影。
  const dirtyShadows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1, h2, h3"))
      .filter(el => getComputedStyle(el).textShadow !== "none")
      .map(el => (el.textContent ?? "").trim().slice(0, 16))
  );
  expect(dirtyShadows, `${screen}: 标题仍有文字阴影重影`).toEqual([]);

  // 卡片正文裁切审计：scrollHeight 超过 clientHeight 就是文字下半部分被挡住。
  const clippedCards = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".card-body"))
      .filter(el => {
        const overflow = getComputedStyle(el).overflowY;
        return overflow !== "auto" && overflow !== "scroll" && el.scrollHeight > el.clientHeight + 1;
      })
      .map(el => (el.textContent ?? "").trim().slice(0, 20))
  );
  expect(clippedCards, `${screen}: 卡片正文被裁切`).toEqual([]);

  // 世界方位 summary 必须与其它卡片头同高（44px）、左内边距 20px、文字垂直居中。
  const sceneSummary = await page.evaluate(() => {
    const el = document.querySelector(".card.scene summary") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const text = el.firstChild as Text | null;
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    const tr = range.getBoundingClientRect();
    return { height: r.height, paddingLeft: parseFloat(getComputedStyle(el).paddingLeft), centerDelta: Math.abs((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2) };
  });
  if (sceneSummary) {
    expect(sceneSummary.height, `${screen}: 世界方位标题高度不是 44`).toBeGreaterThanOrEqual(43);
    expect(sceneSummary.height).toBeLessThanOrEqual(45);
    expect(sceneSummary.paddingLeft, `${screen}: 世界方位标题左距不是 20`).toBeGreaterThanOrEqual(19);
    expect(sceneSummary.paddingLeft).toBeLessThanOrEqual(21);
    expect(sceneSummary.centerDelta, `${screen}: 世界方位标题未垂直居中`).toBeLessThanOrEqual(1.5);
  }

  // 目标圈与卡片内容左缘的距离不能过大；L01 第一句目标必须一行说完。
  const goalLayout = await page.evaluate(() => {
    const list = document.querySelector(".wb-goals .card-body");
    const goal = document.querySelector(".goal");
    const marker = document.querySelector(".goal-mark");
    const text = document.querySelector(".goal-text");
    if (!list || !goal || !marker || !text) return null;
    const lb = list.getBoundingClientRect(), gb = goal.getBoundingClientRect(), mb = marker.getBoundingClientRect(), tb = text.getBoundingClientRect();
    return { markerInset: mb.left - lb.left, goalInset: gb.left - lb.left, textHeight: tb.height };
  });
  if (goalLayout) {
    expect(goalLayout.markerInset, `${screen}: 目标圈离卡片左缘太远`).toBeLessThanOrEqual(32);
    expect(goalLayout.goalInset).toBeLessThanOrEqual(16);
    expect(goalLayout.textHeight, `${screen}: 目标句子超过一行（出现尾巴）`).toBeLessThanOrEqual(30);
  }

  // 面板头控件的碰撞审计：标题 / 回车提示 / 字号控件不得互相压住。
  const paneHeadHits = await page.evaluate(() => {
    const head = document.querySelector(".pane-head");
    if (!head) return [];
    const items = Array.from(head.children).map(el => ({ label: (el.textContent ?? "").trim().slice(0, 10), r: el.getBoundingClientRect() }));
    const bad: string[] = [];
    for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!.r, b = items[j]!.r;
      if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) bad.push(`${items[i]!.label} ↔ ${items[j]!.label}`);
    }
    return bad;
  });
  expect(paneHeadHits, `${screen}: 编辑器头控件互相压住`).toEqual([]);

  // 状态胶囊的内边距：右侧水平留白与上下垂直留白相差不超过 2px。
  const chipInsets = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".card-head")).flatMap(head => {
      const tag = head.querySelector(".card-tag") as HTMLElement | null;
      if (!tag) return [];
      const h = head.getBoundingClientRect(), t = tag.getBoundingClientRect();
      if (t.width === 0 || t.height === 0) return [];
      const vertical = Math.min(t.top - h.top, h.bottom - t.bottom);
      const horizontal = h.right - t.right;
      return [{ label: (tag.textContent ?? "").trim().slice(0, 12), delta: Math.abs(vertical - horizontal), vertical, horizontal }];
    }).filter(x => x.delta > 2)
  );
  expect(chipInsets, `${screen}: 状态胶囊右侧留白与上下留白不一致`).toEqual([]);

  // 全站直角审计：像素皮肤不允许任何可见元素带圆角。
  const rounded = await page.evaluate(() =>
    Array.from(document.querySelectorAll("*")).flatMap(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return [];
      const radius = getComputedStyle(el).borderRadius;
      if (radius === "0px") return [];
      const any = radius.split(/\s+/).some(part => Number.parseFloat(part) > 0);
      return any ? [`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className ?? "").split(" ")[0] ?? ""}`] : [];
    }).slice(0, 12)
  );
  expect(rounded, `${screen}: 仍有可见元素带圆角`).toEqual([]);



  const overflows = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".card, .card-body, .goal, .btn, .card-tag"));
    return nodes
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowX === "auto" || style.overflowX === "scroll") return false;
        return element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2;
      })
      .map((element) => (element.textContent ?? "").trim().slice(0, 30));
  });
  expect(overflows, `${screen}: 文字/内容溢出容器`).toEqual([]);

  const panelTitles = await page.locator("[data-ui-panel-title]").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const parent = element.closest(".card-head, .pane-head");
      const parentRect = parent?.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: (element.textContent ?? "").trim(),
        centerOffset: parentRect ? rect.x + rect.width / 2 - (parentRect.x + parentRect.width / 2) : 999,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        color: style.color,
      };
    }),
  );
  if (screen === "地图墙") {
    expect(panelTitles.length, "地图墙没有面板标题").toBe(0);
  } else {
    expect(panelTitles.length, `${screen}: 面板标题数量`).toBeGreaterThanOrEqual(5);
    for (const title of panelTitles) {
      expect(Math.abs(title.centerOffset), `${screen} 面板标题「${title.text}」是否居中`).toBeLessThanOrEqual(2);
    }
    const styles = new Set(panelTitles.map((title) => `${title.fontSize}|${title.fontWeight}|${title.color}`));
    expect(styles.size, `${screen}: 同级面板标题字号/字重/颜色应一致`).toBe(1);
  }

  const iconOffset = await page.evaluate(() => {
    const avatar = document.querySelector(".coach .rune-avatar");
    const title = document.querySelector(".coach [data-ui-panel-title]");
    if (!avatar || !title) return null;
    const a = avatar.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    return Math.abs(a.y + a.height / 2 - (t.y + t.height / 2));
  });
  if (iconOffset !== null) expect(iconOffset, `${screen}: 图标与文字垂直中线`).toBeLessThanOrEqual(2);

  const scroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scroll.scrollWidth, `${screen}: 不应横向滚动`).toBeLessThanOrEqual(scroll.clientWidth + 1);

  return { screen, viewportWidth: viewport.width, titles, panelTitles, scroll };
}

test("T2 Studio：真实织机 L01 全流程 + 标题对齐", async ({ page }) => {
  const consoleErrors: string[] = [];
  const measurements: unknown[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await seedProgress(page);
  const l01Progress = await apiProgress("L01");
  expect(l01Progress.length, "L01 引擎 progress 必须有 2–3 条").toBeGreaterThanOrEqual(2);
  const l02Progress = await apiProgress("L02");
  const l04Progress = await apiProgress("L04");
  // 内容层还没补 progress 时回退到旧 copy 文案（过渡期兼容）。
  const l02Goal = l02Progress[0]?.text ?? "让灰崽收 6 枚蛋，分趟倒进木桶";
  const l04Goal = l04Progress[0]?.text ?? "把能种的地方都种满";

  // 1) 地图墙
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
  await expect(page.getByTestId("level-card-L01")).toContainText("进入关卡");
  await expect(page.getByTestId("level-card-L04")).toBeVisible();
  await expect(page.getByTestId("level-card-L10")).toContainText("双织者");
  // 浏览器直开（无桌面壳 EnvState）时模式胶囊用本地引擎结果兜底；系统级控制（置顶/伴玩/连接灯）
  // 只属于桌面壳，Studio 内不再渲染（壳内 EnvState 驱动的断言见文末「桌面壳嵌入」用例）。
  await expect(page.locator(".map-head .mode-chip")).toContainText("织机在线");
  await expect(page.getByTestId("btn-pin")).toHaveCount(0);
  await expect(page.getByTestId("btn-companion")).toHaveCount(0);
  measurements.push(await assertLayout(page, "地图墙"));
  const mapPolish = await page.evaluate(() => {
    const title = document.querySelector(".map-head h1") as HTMLElement | null;
    const card = document.querySelector(".map-card") as HTMLElement | null;
    const cta = document.querySelector(".map-card .card-cta") as HTMLElement | null;
    if (!title || !card || !cta) return null;
    const cb = card.getBoundingClientRect(), tb = cta.getBoundingClientRect();
    return {
      font: getComputedStyle(title).fontFamily,
      ctaBottomGap: cb.bottom - tb.bottom,
      cardTopGap: (card.querySelector(".card-order") as HTMLElement).getBoundingClientRect().top - cb.top,
    };
  });
  expect(mapPolish, "主页关卡卡不存在").not.toBeNull();
  expect(mapPolish!.font, "主页展示标题必须使用像素字体栈").toContain("Zpix");
  expect(mapPolish!.ctaBottomGap, "进入关卡 CTA 距卡片下边界过大").toBeLessThanOrEqual(14);
  expect(mapPolish!.cardTopGap, "卡片顶部留白与底部节奏不一致").toBeLessThanOrEqual(18);
  await page.screenshot({ path: resolve(EVIDENCE, "01-map-wall.png"), fullPage: true });

  // 系统页：关于 / 设置都可从主页进入并返回，标题是像素符号而不是随机单词。
  await page.getByTestId("btn-about").click();
  await expect(page.getByTestId("about-screen")).toBeVisible();
  await expect(page.getByTestId("about-title")).toHaveText("织界");
  const aboutTitle = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="about-title"]') as HTMLElement | null;
    return el ? { size: Number.parseFloat(getComputedStyle(el).fontSize), family: getComputedStyle(el).fontFamily } : null;
  });
  expect(aboutTitle, "关于页缺少大标题").not.toBeNull();
  expect(aboutTitle!.size, "关于页标题不够大，不能成为视觉符号").toBeGreaterThanOrEqual(80);
  expect(aboutTitle!.family, "关于页大标题应使用像素字体").toContain("Zpix");
  await page.screenshot({ path: resolve(EVIDENCE, "20-about.png"), fullPage: true });
  await page.getByTestId("btn-system-back").click();
  await page.getByTestId("btn-settings").click();
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  await expect(page.getByTestId("settings-font-value")).toHaveText("16");
  await page.screenshot({ path: resolve(EVIDENCE, "21-settings.png"), fullPage: true });
  await page.getByTestId("btn-system-back").click();
  await expect(page.getByTestId("level-card-L01")).toBeVisible();

  // 2) 工作台
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  // 目标面板文字来自引擎 progress（level-content 定义），不再断言 copy 里的旧文案。
  await expect(page.getByTestId("goal-list")).toContainText(l01Progress[0]!.text);
  await expect(page.getByTestId("btn-run")).toBeVisible();
  await expect(page.getByTestId("btn-stop")).toBeVisible();
  await expect(page.getByTestId("btn-reset")).toBeVisible();
  await expect(page.getByTestId("btn-hint")).toBeVisible();
  // 新顶栏：一级动作只有「返回 / 帮助 / 关卡」，无系统级置顶/伴玩、无「织机在线」胶囊；
  // 「未运行」是状态（span）而不是按钮。
  await expect(page.getByTestId("btn-pin")).toHaveCount(0);
  await expect(page.getByTestId("btn-companion")).toHaveCount(0);
  await expect(page.locator(".wb-top .mode-chip")).toHaveCount(0);
  await expect(page.getByTestId("phase-chip")).toContainText("未运行");
  await page.getByTestId("btn-help-menu").click();
  await expect(page.getByTestId("help-menu")).toBeVisible();
  await expect(page.getByTestId("help-menu").locator("[role='menuitem']")).toHaveCount(5);
  await expect(page.getByTestId("help-menu")).toContainText("指令手册");
  await expect(page.getByTestId("help-menu")).toContainText("试符台");
  await expect(page.getByTestId("help-menu")).toContainText("旅途手记");
  await expect(page.getByTestId("help-menu")).toContainText("配套教材");
  await expect(page.getByTestId("help-menu")).toContainText("完整解");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help-menu")).toBeHidden();
  await expect(page.getByTestId("journal-overlay"), "菜单打开时按 Esc 不应顺带打开旅途手记").toHaveCount(0);
  await measurements.push(await assertLayout(page, "工作台"));
  await page.evaluate(() => document.fonts.ready);
  const editorFont = await page.evaluate(() => {
    const el = document.querySelector(".monaco-editor .view-lines") as HTMLElement | null;
    return {
      family: el ? getComputedStyle(el).fontFamily : "",
      // Round 2（task-10）：代码编辑器统一随包 Maple Mono（含中文的 CN 变体）。
      maple: document.fonts.check('16px "Maple Mono"'),
    };
  });
  expect(editorFont.family, "代码编辑器必须使用随包等宽字体栈（Maple Mono）").toContain("Maple Mono");
  expect(editorFont.maple, "Maple Mono 随包字体未加载").toBe(true);
  await page.getByTestId("btn-font-larger").click();
  await expect(page.getByTestId("font-size-value")).toHaveText("17");
  const enlarged = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector(".monaco-editor .view-lines") as HTMLElement).fontSize));
  expect(enlarged, "代码字号按钮没有真正改变 Monaco fontSize").toBe(17);
  await page.getByTestId("btn-font-smaller").click();
  await expect(page.getByTestId("font-size-value")).toHaveText("16");

  await page.screenshot({ path: resolve(EVIDENCE, "02-workbench.png"), fullPage: true });

  // 3) 参考解 → 运行
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  // 运行态截图要在 click 后立刻拍（mock 世界可能在 1s 内跑完，等待会拍到结果态）。
  await page.screenshot({ path: resolve(EVIDENCE, "03-running.png"), fullPage: true });

  // 4) 缺玩家节拍
  await expect(page.locator(".awaiting-line")).toContainText("织者之印");
  await expect(page.getByTestId("btn-player-beat")).toBeVisible();
  const mcHelp = page.getByTestId("mc-help");
  // 「第一次玩我的世界」默认展开；只有被收起时才点 summary 展开（避免把已展开的又点关）。
  if (!(await mcHelp.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await mcHelp.locator("summary").click();
  }
  await expect(mcHelp).toContainText("W、A、S、D");
  await expect(page.getByTestId("btn-help-reset")).toBeVisible();
  await page.screenshot({ path: resolve(EVIDENCE, "04-waiting-player.png"), fullPage: true });

  // 5) 真实玩家节拍 → 结算浮层（3 星）
  await page.evaluate(() => window.__loomStudio?.playerBeat());
  await expect(page.getByTestId("settle-overlay")).toBeVisible();
  await expect(page.getByTestId("settle-overlay")).toContainText("灯全亮");
  measurements.push(await assertLayout(page, "结算页"));
  await page.screenshot({ path: resolve(EVIDENCE, "05-result-3stars.png"), fullPage: true });

  // 6) 结算页重玩 → 回起点
  await page.getByTestId("btn-settle-replay").click();
  await expect(page.getByTestId("settle-overlay")).toBeHidden();
  await expect(page.getByTestId("result-placeholder")).toBeVisible();
  // 目标 id 由 progress 决定（L01：l01-three-lamps / l01-fourth-by-player / l01-golem-home）。
  for (const step of l01Progress) {
    await expect(page.getByTestId(`goal-${step.id}`)).toHaveAttribute("data-done", "false");
  }

  // 7) 回车运行
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByRole("heading", { name: "第一缕光" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("result-headline")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("btn-reset").click();
  await expect(page.getByTestId("phase-chip")).toContainText("未运行", { timeout: 15_000 });

  // 8) 错误提示
  await page.evaluate(() => window.__loomStudio?.setCode("golem.moveTo("));
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: resolve(EVIDENCE, "06-error.png"), fullPage: true });

  // 9) L03 三夜卡
  await page.getByTestId("btn-back").click();
  await page.getByTestId("level-card-L03").click();
  await expect(page.getByTestId("night-cards")).toContainText("安静夜");
  await expect(page.getByTestId("night-cards")).toContainText("（今晚）");
  await expect(page.getByTestId("night-cards")).toContainText("接下来三夜的剧本");
  await expect(page.getByTestId("night-cards")).toContainText("北门有僵尸");
  await expect(page.getByTestId("night-cards")).toContainText("井边有人被困");
  await page.screenshot({ path: resolve(EVIDENCE, "07-l03-nights.png"), fullPage: true });

  // 10) L02 / L04 工作台截图（Fresh Reader 证据缺口）
  await page.getByTestId("btn-back").click();
  await page.getByTestId("level-card-L02").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await expect(page.getByTestId("goal-list")).toContainText(l02Goal);
  await page.screenshot({ path: resolve(EVIDENCE, "12-l02-workbench.png"), fullPage: true });
  await page.getByTestId("btn-back").click();
  await page.getByTestId("level-card-L04").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await expect(page.getByTestId("goal-list")).toContainText(l04Goal);
  await page.screenshot({ path: resolve(EVIDENCE, "13-l04-workbench.png"), fullPage: true });

  writeFileSync(
    resolve(EVIDENCE, "centering.json"),
    `${JSON.stringify({ ts: new Date().toISOString(), screens: measurements }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    resolve(EVIDENCE, "e2e-real-summary.json"),
    `${JSON.stringify(
      {
        ts: new Date().toISOString(),
        mode: "real-engine",
        engine: "http://127.0.0.1:4399",
        flow: ["map", "l01-workbench", "run", "waiting-player", "player-beat", "settle-3stars", "replay", "enter-run", "error", "l03-nights"],
        consoleErrors,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

/** 把「壳 iframe」等一会儿等到 Studio 页面真的挂载（同源 wrapper 里只有一个 iframe）。 */
async function waitForStudioFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 120; i += 1) {
    const found = page.frames().find((item) => item !== page.mainFrame() && item.url().includes("/index.html"));
    if (found) return found;
    await page.waitForTimeout(100);
  }
  throw new Error("Studio iframe 未加载");
}

type EnvLightState = "checking" | "starting" | "ready" | "needs_action" | "error";

/** 与 docs/55-launcher-env-contract.md §2 同形的 EnvState 测试桩（只用于 headless 消息注入）。 */
function envLight(state: EnvLightState, detail = "") {
  return { state, detail, hint: null as string | null, canStart: false, canRetry: false, guide: null as string | null };
}

function envSnapshot(patch: Record<string, unknown> = {}) {
  return {
    engine: envLight("ready", "/api/health ok"),
    paper: envLight("ready", "25565"),
    bot: envLight("ready", "bot connected"),
    client: envLight("ready", "Minecraft 窗口"),
    allReady: true,
    launching: [] as string[],
    clientLost: false,
    sessionActive: false,
    clientAdapter: "reuse",
    clientAvailableLauncher: "prism",
    mock: false,
    updatedAt: Date.now(),
    ...patch,
  };
}

test("桌面壳嵌入：Studio 不画第二套标题栏，EnvState 驱动状态（headless 模拟壳，不启动 GUI）", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1280, height: 840 });
  // 模拟 Tauri：初始化脚本注入所有 frame（与 WebView2/WebKitGTK 的行为一致）。
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: { invoke: () => Promise<null> } }).__TAURI_INTERNALS__ = { invoke: async () => null };
  });
  await seedProgress(page);
  // 同源 wrapper 模拟 apps/desktop/shell/index.html：一条壳标题栏 + 一个指向 Studio 的 iframe。
  await page.route("**/e2e-shell.html", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
        html, body { margin: 0; background: #0d140f; color: #f0ead8; font: 14px sans-serif; }
        #shell-titlebar { height: 36px; display: flex; align-items: center; padding: 0 12px; background: #101a11; border-bottom: 2px solid #4a5c42; }
        #studio { border: 0; display: block; width: 100%; height: calc(100vh - 36px); }
      </style></head><body>
        <header id="shell-titlebar" data-testid="shell-titlebar">✦ 织界 THE LOOM（桌面壳标题栏 · 四灯）</header>
        <iframe id="studio" title="Studio" src="/index.html?engine=${encodeURIComponent(ENGINE_BASE)}&amp;scale=0.8"></iframe>
      </body></html>`,
    }),
  );
  await page.goto("/e2e-shell.html");
  const frame = await waitForStudioFrame(page);
  await frame.getByTestId("level-card-L01").waitFor({ state: "visible", timeout: 30_000 });

  // 1) 标题栏唯一归壳：整页只有壳那一条；iframe 内没有 DesktopTitlebar / body.desktop-shell。
  await expect(page.getByTestId("shell-titlebar"), "壳自己仍有一条标题栏").toHaveCount(1);
  const embedded = await frame.evaluate(() => ({
    studioTitlebars: document.querySelectorAll("[data-testid='desktop-titlebar']").length,
    desktopClass: document.body.classList.contains("desktop-shell"),
    windowButtons: document.querySelectorAll("[data-testid='btn-win-min'], [data-testid='btn-win-max'], [data-testid='btn-win-close']").length,
  }));
  expect(embedded.studioTitlebars, "Studio 在壳 iframe 内又画了一条标题栏（双标题栏 P0）").toBe(0);
  expect(embedded.desktopClass, "Shell 内不应再挂 body.desktop-shell（否则多预留 36px）").toBe(false);
  expect(embedded.windowButtons, "壳内不应出现第二套窗口按钮").toBe(0);

  // 2) EnvState 唯一状态源：父壳 postMessage → Studio 顶部模式/状态，不再自己探测 health。
  const sendEnv = async (patch: Record<string, unknown> = {}) => {
    await page.evaluate((env) => {
      const iframe = document.getElementById("studio") as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage({ type: "loom:env", env }, "*");
    }, envSnapshot(patch));
    await frame.waitForTimeout(250);
  };
  await sendEnv({ engine: envLight("starting", "正在启动 Paper"), allReady: false, launching: ["engine"] });
  await expect(frame.locator(".map-head .mode-chip"), "地图页模式胶囊必须消费壳 EnvState").toContainText("织机启动中");
  await sendEnv();
  await expect(frame.locator(".map-head .mode-chip")).toContainText("织机在线");

  // 3) 工作台：无系统控制、状态「未运行」，zoom + 100% 链铺满 iframe（无底部空白）。
  await frame.getByTestId("level-card-L01").click();
  await expect(frame.getByTestId("code-editor")).toBeVisible();
  await expect(frame.getByTestId("btn-pin")).toHaveCount(0);
  await expect(frame.getByTestId("btn-companion")).toHaveCount(0);
  await expect(frame.locator(".wb-top .mode-chip")).toHaveCount(0);
  await expect(frame.getByTestId("phase-chip")).toContainText("未运行");
  const geometry = await frame.evaluate(() => {
    const workbench = document.querySelector(".workbench")!.getBoundingClientRect();
    return {
      workbenchBottom: Math.round(workbench.bottom),
      viewportHeight: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
    };
  });
  expect(Math.abs(geometry.workbenchBottom - geometry.viewportHeight), `壳内 zoom 下工作台没铺满（底部空白）：${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1.5);
  expect(geometry.docScrollHeight, "壳内关卡页不应出现文档滚动").toBeLessThanOrEqual(geometry.docClientHeight + 1);

  // 4) L2：clientLost 时 Studio 兜底禁用运行/切关（壳另有红色阻断层）。
  await sendEnv({
    client: envLight("needs_action", "客户端窗口消失"),
    allReady: false,
    clientLost: true,
    sessionActive: true,
  });
  await expect(frame.getByTestId("phase-chip")).toContainText("客户端已断开");
  await expect(frame.getByTestId("btn-run")).toBeDisabled();
  await expect(frame.getByTestId("btn-back")).toBeDisabled();
  await sendEnv();
  await expect(frame.getByTestId("phase-chip")).toContainText("未运行");
  await expect(frame.getByTestId("btn-run")).toBeEnabled();

  // 5) 壳内 native guard 仍生效（右键菜单/Ctrl+R 屏蔽，输入框右键保留）。
  const nativeGuard = await frame.evaluate(() => {
    const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(context);
    const reload = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(reload);
    const probe = document.createElement("input");
    document.body.appendChild(probe);
    const editorContext = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    probe.dispatchEvent(editorContext);
    probe.remove();
    return { bodyContext: context.defaultPrevented, reload: reload.defaultPrevented, editorContext: editorContext.defaultPrevented };
  });
  expect(nativeGuard.bodyContext, "桌面壳必须屏蔽浏览器右键菜单").toBe(true);
  expect(nativeGuard.reload, "桌面壳必须屏蔽 Ctrl+R 刷新").toBe(true);
  expect(nativeGuard.editorContext, "输入框里必须保留复制/粘贴右键菜单").toBe(false);
  await page.screenshot({ path: resolve(EVIDENCE, "08b-desktop-shell.png"), fullPage: false });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("顶层 Tauri 直开 Studio：保留唯一自绘标题栏与 36px 预留（旧开发场景兼容）", async ({ page }) => {
  await page.addInitScript((progress) => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify(progress));
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]));
    (window as unknown as { __TAURI_INTERNALS__: { invoke: () => Promise<null> } }).__TAURI_INTERNALS__ = { invoke: async () => null };
  }, PROGRESS);
  await page.goto("/");
  await expect(page.getByTestId("desktop-titlebar"), "顶层 Tauri 旧场景仍需要自绘标题栏").toBeVisible();
  await expect(page.getByTestId("desktop-titlebar"), "顶层只能有一条标题栏").toHaveCount(1);
  await expect
    .poll(async () => page.evaluate(() => document.body.classList.contains("desktop-shell")), { message: "desktop-shell 类未挂载" })
    .toBe(true);
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  // 36px 预留改成 % 链后仍正好铺满：标题栏 36 + 工作台 = 视口高，无文档滚动。
  const geometry = await page.evaluate(() => {
    const workbench = document.querySelector(".workbench")!.getBoundingClientRect();
    return {
      workbenchBottom: Math.round(workbench.bottom),
      viewportHeight: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
    };
  });
  expect(Math.abs(geometry.workbenchBottom - geometry.viewportHeight)).toBeLessThanOrEqual(1.5);
  expect(geometry.docScrollHeight).toBeLessThanOrEqual(geometry.docClientHeight + 1);
});
