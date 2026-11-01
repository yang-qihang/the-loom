import { expect, test } from "@playwright/test";

/** real-engine 配置里的引擎地址（playwright.config.ts 的 PORT=4399）。 */
const ENGINE_BASE = "http://127.0.0.1:4399";

const LEVELS = ["L05", "L06", "L07", "L08", "L09", "L10"] as const;

/** 内容层还没补 progress 时的旧 copy 文案（过渡期兜底；progress 落地后不再使用）。 */
const LEGACY_GOALS: Record<string, string> = {
  L05: "先看清五块地的位置和样式",
  L06: "先给每件货读清编号和类别",
  L07: "先写三条分辨矿石、木料、食物的规矩",
  L08: "先看清每台机器能做什么",
  L09: "先让两坛药同时开酿",
  L10: "先让两只织偶互报份额",
};

interface ApiProgressStep {
  id: string;
  text: string;
  player: boolean;
}

async function apiProgress(levelId: string): Promise<ApiProgressStep[]> {
  const response = await fetch(`${ENGINE_BASE}/api/levels/${levelId}`);
  expect(response.ok, `/api/levels/${levelId} 可访问`).toBe(true);
  const data = (await response.json()) as { progress?: ApiProgressStep[] };
  return Array.isArray(data.progress) ? data.progress.filter((step) => typeof step?.id === "string") : [];
}

test("L05–L10 进关卡后有完整中文引导（目标面板来自引擎 progress），不是空面板", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "loom.studio.progress.v1",
      JSON.stringify({
        prologueSeen: true,
        actsSeen: [1, 2, 3],
        levelsStarted: ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"],
        lastCompletedLevelId: "L04",
      }),
    );
  });
  // 目标面板文案的唯一来源是引擎 progress（Studio loadLevel 优先用它）；spec 不再硬编码旧 copy。
  const goals: Record<string, string> = {};
  for (const id of LEVELS) {
    goals[id] = (await apiProgress(id))[0]?.text ?? LEGACY_GOALS[id]!;
  }
  await page.goto("/");
  for (const id of LEVELS) {
    await page.goto("/");
    const card = page.getByTestId(`level-card-${id}`);
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByText(goals[id]!, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("加载中…", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("challenge-card")).toContainText("挑战层");
  }
});
