import { expect, test } from "@playwright/test";

const LEVELS = {
  L05: "先看清五块地的位置和样式",
  L06: "先给每件货读清编号和类别",
  L07: "先写三条分辨矿石、木料、食物的规矩",
  L08: "先看清每台机器能做什么",
  L09: "先让两坛药同时开酿",
  L10: "先让两只织偶互报份额",
} as const;

test("L05–L09 进关卡后有完整中文引导，不是空面板", async ({ page }) => {
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
  await page.goto("/");
  for (const [id, goal] of Object.entries(LEVELS)) {
    await page.goto("/");
    const card = page.getByTestId(`level-card-${id}`);
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByText(goal, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("加载中…", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("challenge-card")).toContainText("挑战层");
  }
});
