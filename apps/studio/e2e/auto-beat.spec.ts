/**
 * 玩家节拍自动检测 / 自动结算（用户反馈 1，docs/49 §2.3）。
 *
 * 真实 Paper 世界的真值：玩家亲手完成最后一步后，世界快照里 progress 全部通过、playerBeatDone=true；
 * Studio 每秒轮询 snapshot 自动同步目标面板，并在 state=READY 时一次性自动确认玩家节拍 → 自动结算。
 *
 * mock 世界没有真人，所以本 spec 用 page.route 把 snapshot 改写为「玩家已在真实 MC 完成」的形态，
 * 走的是与 paper 完全相同的 production 路径：Studio 自动确认 → 引擎按自己世界模式处理
 * （mock 引擎模拟最后一步；paper 引擎 confirm-only 仍只认真实世界）。
 * 断言：不点 btn-player-beat 也会自动出现结算浮层 3 星；自动确认请求发出时目标面板已全部打勾。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Playwright 由 `npm --prefix apps/studio` 启动时 cwd=apps/studio；证据统一写仓库根 evidence/。 */
const EVIDENCE = resolve(process.cwd(), "../../evidence/runtime-ui");
mkdirSync(EVIDENCE, { recursive: true });

const SEED_PROGRESS = {
  prologueSeen: true,
  actsSeen: [1, 2, 3],
  levelsStarted: ["L01", "L02", "L03", "L04"],
  lastCompletedLevelId: null,
};

interface LoomTimeline {
  goalsAllDoneAt: number | null;
  settleAt: number | null;
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript((progress) => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify(progress));
    // 时间线埋点：目标面板全部打勾的时刻 vs 结算浮层出现的时刻。
    // 用来证明「目标在 result 之前就已自动勾选」（用户反馈 1 的验收点）。
    const timeline: LoomTimeline = { goalsAllDoneAt: null, settleAt: null };
    (window as unknown as { __loomTimeline: LoomTimeline }).__loomTimeline = timeline;
    const sample = (): void => {
      if (timeline.settleAt === null && document.querySelector('[data-testid="settle-overlay"]')) {
        timeline.settleAt = performance.now();
      }
      if (timeline.goalsAllDoneAt !== null) return;
      const goals = Array.from(document.querySelectorAll(".goal"));
      if (goals.length > 0 && goals.every((node) => node.getAttribute("data-done") === "true")) {
        timeline.goalsAllDoneAt = performance.now();
      }
    };
    // 用定时采样而不是 MutationObserver：addInitScript 里 document.documentElement 可能还不存在。
    window.setInterval(sample, 25);
  }, SEED_PROGRESS);
}

/** 其他 WP 的教材窗口可能自动弹在工作台上：把它关掉再操作按钮（不影响本 spec 断言）。 */
async function dismissTextbook(page: Page): Promise<void> {
  const textbook = page.getByTestId("textbook-window");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await textbook.isVisible().catch(() => false)) {
      const start = page.getByTestId("btn-textbook-start");
      if (await start.isVisible().catch(() => false)) await start.click();
      else await page.getByTestId("btn-textbook-close").click().catch(() => undefined);
      await expect(textbook).toBeHidden({ timeout: 5_000 });
      return;
    }
    await page.waitForTimeout(100);
  }
}

interface SnapshotPatchJson {
  progress?: Array<{ id: string; text: string; passed: boolean; player: boolean; hint?: string }>;
  playerBeatReady?: boolean;
  snapshot?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 把 mock 引擎的 snapshot 改写为「真实 MC 里玩家已完成最后一步」的形态：
 * - 参考解跑完（playerBeatReady=true）之前不动，避免提前把玩家步骤判过；
 * - 之后 progress 全 passed、playerBeatDone=true，模拟 Paper 世界的真值。
 */
async function installPlayerCompletedSnapshot(page: Page): Promise<void> {
  await page.route("**/api/session/*/snapshot", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as SnapshotPatchJson;
    const progress = Array.isArray(json.progress) ? json.progress : [];
    const reachable = json.playerBeatReady === true || progress.some((step) => step.passed);
    if (!reachable) {
      await route.fulfill({ response, json });
      return;
    }
    const patched = progress.map((step) => ({ ...step, passed: true }));
    await route.fulfill({
      response,
      json: {
        ...json,
        state: "READY",
        progress: patched,
        playerBeatReady: true,
        allPassed: true,
        playerBeatDone: true,
        snapshot: {
          ...(json.snapshot ?? {}),
          state: "READY",
          progress: patched,
          playerBeatReady: true,
          allPassed: true,
          playerBeatDone: true,
        },
      },
    });
  });
}

test("L01 参考解跑完后：世界侧全完成 → 不点按钮自动结算 3 星", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  let playerBeatRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/player-beat")) playerBeatRequests += 1;
  });

  await seed(page);
  // 模拟真实 Paper 世界：玩家点完 4 号灯后，快照里 progress 全通过 + playerBeatDone。
  await installPlayerCompletedSnapshot(page);

  await page.goto("/");
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await dismissTextbook(page);
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();

  // 不点 btn-player-beat：轮询到「世界侧全完成」后自动确认 → 自动结算。
  await expect(page.getByTestId("settle-overlay")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("settle-overlay")).toContainText("灯全亮");

  // 结算浮层出现后，目标打勾可能在同一帧稍晚落地：先等它记录到，再比较先后顺序（时间戳不会倒置）。
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as unknown as { __loomTimeline?: LoomTimeline }).__loomTimeline?.goalsAllDoneAt ?? null),
      { timeout: 10_000 },
    )
    .not.toBeNull();
  const timeline = await page.evaluate(
    () => (window as unknown as { __loomTimeline?: LoomTimeline }).__loomTimeline,
  );
  expect(timeline, "时间线埋点应存在").toBeTruthy();
  expect(timeline!.goalsAllDoneAt, "结算前目标面板应已全部自动打勾").not.toBeNull();
  expect(timeline!.settleAt, "自动结算应出现").not.toBeNull();
  expect(
    timeline!.goalsAllDoneAt! <= timeline!.settleAt!,
    `目标打勾应在结算之前：goals=${timeline!.goalsAllDoneAt} settle=${timeline!.settleAt}`,
  ).toBe(true);
  const goalDones = await page.locator(".goal").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-done")));
  expect(goalDones.length).toBe(3);
  expect(goalDones.every((done) => done === "true")).toBe(true);
  expect(playerBeatRequests, "自动确认只应触发一次（不重复 POST）").toBe(1);

  const summary = {
    ts: new Date().toISOString(),
    level: "L01",
    mode: "mock-engine + 快照改写模拟真实玩家完成",
    autoSettle: true,
    stars: 3,
    playerBeatRequests,
    goalsAllDoneAt: timeline!.goalsAllDoneAt,
    settleAt: timeline!.settleAt,
    consoleErrors,
  };
  writeFileSync(resolve(EVIDENCE, "auto-beat-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await page.screenshot({ path: resolve(EVIDENCE, "auto-beat-settle.png"), fullPage: true });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("自动确认串行安全：重置后再跑一轮不会残留上一轮的结算", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await seed(page);
  await installPlayerCompletedSnapshot(page);
  await page.goto("/");
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await dismissTextbook(page);
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("settle-overlay")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("btn-settle-replay").click();
  await expect(page.getByTestId("settle-overlay")).toBeHidden();
  await expect(page.getByTestId("result-placeholder")).toBeVisible();
  // 重置后（有 2s 抑制窗口）不应当立刻再弹一次结算；目标面板也应回到未完成。
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("settle-overlay")).toBeHidden();
  const goals = await page.locator(".goal").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-done")));
  expect(goals.length).toBe(3);
  expect(goals.every((done) => done === "false"), `重置后目标应全部未完成：${JSON.stringify(goals)}`).toBe(true);
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
