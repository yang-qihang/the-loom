/**
 * 用户路线验收（L01）：
 * - 真实 Paper + 真实引擎 + mineflayer 模拟「真人玩家」（不是引擎的 Golem bot）
 * - Playwright 真实点击/键盘输入 Studio
 * - 检查玩家进服后快捷栏有灯笼；运行参考解；点击「我已在游戏里点亮」；拿到 3 星
 * 前置：PORT=4317 LOOM_WORLD=paper 引擎与 Paper 已启动。
 */
import { chromium } from "/home/yqh0919/Documents/deepseek-harness/default-workspace/apps/studio/node_modules/playwright/index.mjs";
import mineflayer from "/home/yqh0919/Documents/deepseek-harness/default-workspace/bot/node_modules/mineflayer/index.js";

const BASE = process.env.LOOM_ENGINE || "http://127.0.0.1:4317";
const player = mineflayer.createBot({ host: "127.0.0.1", port: 25565, username: "PickyPlayer", auth: "offline" });
player.on("error", (e) => console.log("player error:", e.message));
await new Promise((resolve, reject) => {
  player.once("spawn", resolve);
  setTimeout(() => reject(new Error("player spawn timeout")), 30000);
});
console.log("player spawned");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 826, height: 1000 } });
await page.addInitScript(() => {
  localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }));
});
await page.goto(`${BASE}/studio/index.html?engine=${encodeURIComponent(BASE)}&scale=0.8`, { waitUntil: "networkidle" });
await page.getByText("第一缕光").first().click({ force: true });
await page.waitForTimeout(2500);

const inventory = player.inventory.items().map((item) => `${item.name}:${item.count}`);
if (!inventory.some((item) => item.startsWith("lantern:"))) throw new Error(`NO_LANTERN: ${inventory.join(",")}`);
console.log("lantern in hotbar:", inventory.join(","));

const reference = `golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(2, 16)
golem.moveTo(0, 6)
`;
await page.locator(".monaco-editor").click();
await page.keyboard.press("Control+A");
await page.keyboard.insertText(reference);
await page.screenshot({ path: "/tmp/acceptance-1-workbench.png" });
await page.getByTestId("btn-run").click();
// 真实运行要走完 3 盏灯和回到艾拉，不能用固定 5 秒。
await page.getByTestId("btn-player-beat").waitFor({ state: "visible", timeout: 60000 });
const guide = await page.getByTestId("player-beat-guide").isVisible().catch(() => false);
console.log("player-beat-guide visible:", guide);
await page.screenshot({ path: "/tmp/acceptance-2-player-turn.png" });
await page.getByTestId("btn-player-beat").click();
await page.getByTestId("settle-overlay").waitFor({ state: "visible", timeout: 30000 });
const settle = true;
const stars = (await page.locator(".settle-overlay").innerText()).match(/★/g)?.length ?? 0;
console.log("settle visible:", settle, "stars:", stars);
await page.screenshot({ path: "/tmp/acceptance-3-settle.png" });
await browser.close();
player.quit();
if (stars < 3) throw new Error("expected 3 stars, got " + stars);
