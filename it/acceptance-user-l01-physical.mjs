/**
 * 真实用户路线（L01，无后台代放）：
 * - 真实 Paper + 引擎 + mineflayer 玩家连接
 * - Playwright 真实鼠标/键盘操作 Studio
 * - 玩家用 WASD/寻路控制走进世界，右键放置第 4 盏灯笼
 * - UI 只确认真实世界状态（simulate=false），不再由引擎代放
 */
import { chromium } from "/home/yqh0919/Documents/deepseek-harness/default-workspace/apps/studio/node_modules/playwright/index.mjs";
import mineflayer from "/home/yqh0919/Documents/deepseek-harness/default-workspace/bot/node_modules/mineflayer/index.js";
import pf from "/home/yqh0919/Documents/deepseek-harness/default-workspace/bot/node_modules/mineflayer-pathfinder/index.js";
import vec3 from "/home/yqh0919/Documents/deepseek-harness/default-workspace/bot/node_modules/vec3/index.js";
const V = vec3.Vec3;
const BASE = "http://127.0.0.1:4317";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const player = mineflayer.createBot({ host: "127.0.0.1", port: 25565, username: "PhysicalPicky", auth: "offline" });
player.on("error", (e) => console.log("player error:", e.message));
await new Promise((resolve, reject) => { player.once("spawn", resolve); setTimeout(() => reject(new Error("spawn timeout")), 30000); });
console.log("player spawned", player.entity.position);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 826, height: 1000 } });
await page.addInitScript(() => localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: true, actsSeen: [1,2,3], levelsStarted: ["L01"], lastCompletedLevelId: null })));
await page.goto(`${BASE}/studio/index.html?engine=${encodeURIComponent(BASE)}&scale=0.8`, { waitUntil: "networkidle" });
await page.getByText("第一缕光").first().click({ force: true });
await page.waitForTimeout(2200);
const inv = player.inventory.items().map((i) => `${i.name}:${i.count}`);
if (!inv.some((x) => x.startsWith("lantern:"))) throw new Error("no lantern: " + inv);
console.log("inventory", inv);
const reference = `golem.moveTo(-12, 10)\ngolem.place("lantern", -12, 14, 10)\ngolem.moveTo(-12, -2)\ngolem.place("lantern", -12, 14, -2)\ngolem.moveTo(2, -2)\ngolem.place("lantern", 2, 14, -2)\ngolem.moveTo(2, 16)\ngolem.moveTo(0, 6)\n`;
await page.locator(".monaco-editor").click();
await page.keyboard.press("Control+A");
await page.keyboard.insertText(reference);
await page.getByTestId("btn-run").click();
await page.getByTestId("btn-player-beat").waitFor({ state: "visible", timeout: 60000 });
await page.screenshot({ path: "/tmp/physical-1-turn.png" });
console.log("player turn reached at", player.entity.position);
// 真实玩家移动：启用寻路（底层就是 mineflayer 的 WASD 控制状态与跳跃）
player.loadPlugin(pf.pathfinder);
const movements = new pf.Movements(player);
player.pathfinder.setMovements(movements);
player.pathfinder.setGoal(new pf.goals.GoalNear(1, 13, 16, 1));
try {
  await Promise.race([
    new Promise((r) => player.once("goal_reached", r)),
    sleep(45000).then(() => { throw new Error("move timeout"); }),
  ]);
} catch (error) {
  console.log("move warning:", error.message, player.entity.position);
}
console.log("at lamp:", player.entity.position, "onGround", player.entity.onGround);
const lantern = player.inventory.items().find((item) => item.name.includes("lantern"));
await player.equip(lantern, "hand");
await player.lookAt(new V(2.5, 14.5, 16.5), true);
const below = player.blockAt(new V(2, 13, 16));
console.log("support", below?.name);
for (let attempt = 0; attempt < 4; attempt++) {
  await player.placeBlock(below, new V(0, 1, 0));
  await sleep(500);
  if (player.blockAt(new V(2, 14, 16))?.name.includes("lantern")) break;
}
console.log("lamp block", player.blockAt(new V(2, 14, 16))?.name);
await page.screenshot({ path: "/tmp/physical-2-placed.png" });
await page.getByTestId("btn-player-beat").click();
await page.getByTestId("settle-overlay").waitFor({ state: "visible", timeout: 30000 });
const stars = (await page.locator(".settle-overlay").innerText()).match(/★/g)?.length ?? 0;
console.log("stars", stars);
await page.screenshot({ path: "/tmp/physical-3-settle.png" });
await browser.close();
player.quit();
if (stars < 3) throw new Error("expected 3 stars after real placement, got " + stars);
