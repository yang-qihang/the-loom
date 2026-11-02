/**
 * 编辑器/运行状态鲁棒性回归（用户反馈 7：第一次失败后粘正确参考解仍报错）。
 *
 * 覆盖 docs/49 §2.4：
 * 1. 语法错误红条 → 换参考解再运行：红条消失、进入玩家节拍（不再「永远报错」）；
 * 2. 双击「运行」：同步守卫只发一次 run，第二个请求不会 409→红条覆盖正确结果；
 * 3. P0 脏世界：L02 starter 失败已经把蛋收走/走位改乱，再跑参考解时引擎自动恢复场景
 *    （sessionEpoch 增加），不再出现「这一格没有可以收走的 egg」，且手动兜底仍可 3 星结算。
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript((progress) => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify(progress));
  }, SEED_PROGRESS);
}

/** 从 snapshot 响应里采集 sessionEpoch（自动恢复场景会让 epoch +1）。 */
function collectSnapshotEpochs(page: Page): number[] {
  const epochs: number[] = [];
  page.on("response", (response) => {
    if (!/\/api\/session\/[^/]+\/snapshot/.test(response.url())) return;
    void response
      .json()
      .then((json: { sessionEpoch?: number; snapshot?: { sessionEpoch?: number } }) => {
        const epoch = typeof json.sessionEpoch === "number" ? json.sessionEpoch : json.snapshot?.sessionEpoch;
        if (typeof epoch === "number") epochs.push(epoch);
      })
      .catch(() => undefined);
  });
  return epochs;
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

async function openLevel(page: Page, levelId: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId(`level-card-${levelId}`).click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await dismissTextbook(page);
}

test("语法错误后换参考解再运行：红条消失、直接进入玩家节拍", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  let runRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/run")) runRequests += 1;
  });

  await seed(page);
  await openLevel(page, "L01");
  await page.evaluate(() => window.__loomStudio?.setCode("golem.moveTo("));
  await page.getByTestId("btn-run").click();
  const banner = page.getByTestId("error-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const firstError = await banner.innerText();
  expect(firstError).toContain("行");

  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  // 第二轮：真实评分结果到达 → 旧红条必须消失，并进入「轮到你」。
  await expect(page.getByTestId("btn-player-beat")).toBeVisible({ timeout: 20_000 });
  await expect(banner).toBeHidden();
  await expect(page.getByTestId("result-card")).toContainText("织者之印");
  expect(runRequests, "两轮运行应各发一次 POST /api/run").toBe(2);

  writeFileSync(
    resolve(EVIDENCE, "runtime-recovery-summary.json"),
    `${JSON.stringify(
      { ts: new Date().toISOString(), case: "syntax-error-then-reference", firstError: firstError.slice(0, 120), runRequests, consoleErrors },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await page.screenshot({ path: resolve(EVIDENCE, "runtime-recovery-after-reference.png"), fullPage: true });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("双击「运行」只发一次 run：不会用 409 红条覆盖正确结果", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  let runRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/run")) runRequests += 1;
  });
  await seed(page);
  await openLevel(page, "L01");
  await page.evaluate(() => window.__loomStudio?.setCode("golem.moveTo("));
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => window.__loomStudio?.fillReference());
  const before = runRequests;
  // 同一帧内连发两次 run（等价于双击 + 渲染还没更新的极端情况）。
  await page.evaluate(() => {
    window.__loomStudio?.run();
    window.__loomStudio?.run();
  });
  await expect(page.getByTestId("btn-player-beat")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("error-banner")).toBeHidden();
  expect(runRequests - before, "同步守卫应只放行一次 run 请求").toBe(1);
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("P0 脏世界：L02 starter 失败后参考解自动恢复场景并通过（手动兜底 3 星）", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const epochs = collectSnapshotEpochs(page);

  await seed(page);
  await openLevel(page, "L02");
  // 第一轮：直接跑 starter（会失败，但已经把第 1 枚蛋收走、织偶也移动了 → 世界已脏）。
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("result-headline")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("error-banner")).toBeHidden();
  await page.waitForTimeout(1200); // 等一次快照轮询，记录 epoch 0

  // 第二轮：参考解。旧缺陷在这里报「(-16, 10) 这一格没有可以收走的 egg」。
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("btn-player-beat")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("error-banner")).toBeHidden();
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "脏世界错误不能再次出现").not.toContain("没有可以收走的");

  // 自动恢复场景：引擎 epoch 增加（第一次失败时 0，参考解前自动 port.reset 后为 1）。
  await expect.poll(() => Math.max(0, ...epochs), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  // 目标面板按快照 progress 自动同步（不再只靠 result 事件）。
  await expect(page.getByTestId("goal-l02-six-eggs")).toHaveAttribute("data-done", "true");

  // 手动兜底按钮仍可用：L02 的玩家节拍是放蛋糕，mock 引擎模拟 → 3 星结算。
  await page.getByTestId("btn-player-beat").click();
  await expect(page.getByTestId("settle-overlay")).toBeVisible({ timeout: 20_000 });

  writeFileSync(
    resolve(EVIDENCE, "runtime-recovery-l02.json"),
    `${JSON.stringify(
      {
        ts: new Date().toISOString(),
        case: "dirty-world-auto-restore",
        epochs,
        dirtyWorldErrorGone: !bodyText.includes("没有可以收走的"),
        settled: true,
        consoleErrors,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await page.screenshot({ path: resolve(EVIDENCE, "runtime-recovery-l02-settle.png"), fullPage: true });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
