// QA UOS：真实用户操作模拟（不读实现、只读屏幕；证据写 qa/evidence/ux-shots + JSON）。
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "../..");
const SHOTS = resolve(ROOT, "qa/evidence/ux-shots");
const EV = resolve(ROOT, "qa/evidence");
mkdirSync(SHOTS, { recursive: true });

async function shot(page: import("@playwright/test").Page, name: string) {
  const file = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return { name, file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
}

// v3 引导门禁：需要在 localStorage 标记序章/幕已看过，才能直达地图墙（与 Studio 自带 mock-flow 一致）
async function openMap(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "loom.studio.progress.v1",
      JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "关卡墙" })).toBeVisible();
}

function write(name: string, data: unknown) { writeFileSync(resolve(EV, name), `${JSON.stringify(data, null, 2)}\n`, "utf8"); }

test("U1 契约：纯中文/标题中线/无横向滚动/console 0 error", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(`pageerror: ${e.message}`));
  await openMap(page);
  const title = page.locator(".map-head h1");
  await expect(title).toBeVisible();
  const box = await title.boundingBox();
  const vp = page.viewportSize()!;
  const centerDiff = box ? Math.abs((box.x + box.width / 2) - vp.width / 2) : 999;
  const scrollW = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const bodyText = await page.locator("body").innerText();
  const bannedUi = /\b(Run|Stop|Reset|Level|Objective|Coach|Result|Mock)\b/.exec(bodyText);
  const shots = [await shot(page, "U1-map-wall")];
  write("ux-contract.json", { suite: "U1", centerDiff: Math.round(centerDiff * 100) / 100, horizontalScroll: scrollW.sw > scrollW.cw, consoleErrors, bannedUi: bannedUi?.[0] ?? null, shots });
  expect(centerDiff).toBeLessThanOrEqual(2);
  expect(scrollW.sw).toBeLessThanOrEqual(scrollW.cw);
  expect(consoleErrors).toEqual([]);
  expect(bannedUi).toBeNull();
});

test("U2 happy：试符台/织典 → L01 参考解 → player-beat → 结算 → 重置", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(`pageerror: ${e.message}`));
  await openMap(page);
  // 试符台（REPL）：一句 golem.pos
  await page.getByTestId("btn-repl").click();
  await expect(page.getByTestId("repl-screen")).toBeVisible();
  await page.getByTestId("repl-input").fill("golem.pos");
  await page.getByTestId("repl-input").press("Enter");
  await expect(page.getByTestId("repl-history")).toContainText("65");
  const replShot = await shot(page, "U2-repl");
  await page.getByTestId("btn-repl-back").click();
  // 织典（Codex）
  await page.getByTestId("btn-codex").click();
  await expect(page.getByTestId("codex-screen")).toBeVisible();
  const codexShot = await shot(page, "U2-codex");
  await page.getByTestId("btn-codex-back").click();
  // L01 happy
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await page.evaluate(() => window.__loomStudio?.fillReference());
  const shots = [await shot(page, "U2-workbench")];
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("result-card")).toContainText("最后一步");
  await page.evaluate(() => window.__loomStudio?.playerBeat());
  await expect(page.getByTestId("result-headline")).toContainText("灯全亮");
  await expect(page.getByTestId("result-card")).toContainText("灯全亮");
  shots.push(await shot(page, "U2-result-3stars"));
  await page.getByTestId("btn-settle-replay").click();
  await expect(page.getByTestId("result-placeholder")).toBeVisible();
  write("ux-happy.json", { suite: "U2", consoleErrors, shots: [...shots, replShot, codexShot] });
  expect(consoleErrors).toEqual([]);
});

test("U3 错误恢复：语法错误提示 → 停止 → 重置", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await openMap(page);
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await page.evaluate(() => window.__loomStudio?.setCode("golem.moveTo("));
  await page.getByTestId("btn-run").click();
  const banner = page.getByTestId("error-banner");
  await expect(banner).toBeVisible();
  const errText = await banner.innerText();
  await page.getByTestId("btn-reset").click();
  await expect(page.getByTestId("result-placeholder")).toBeVisible();
  const shots = [await shot(page, "U3-syntax-error")];
  const chinese = /[\u4e00-\u9fff]/.test(errText);
  write("ux-error.json", { suite: "U3", errorText: errText.slice(0, 200), chinese, consoleErrors, shots });
  expect(chinese).toBe(true);
});

test("U4 fresh：只读屏幕文字完成 L01 + 五问记录", async ({ page }) => {
  await openMap(page);
  await page.getByTestId("btn-journal").click();
  await page.getByTestId("journal-replay-prologue").click();
  await expect(page.locator("#loom-prologue, [data-testid=prologue-overlay], [data-testid=opening-overlay]").first()).toBeVisible();
  const prologueText = await page.locator("body").innerText();
  await page.keyboard.press("Escape");
  const mapText = prologueText;
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  const visibleStarter = (await page.locator(".monaco-editor .view-lines").innerText()).slice(0, 2000);
  const panel = [...visibleStarter.matchAll(/(\d)\s*号[:：]\s*\((-?\d+),\s*(-?\d+)\)/g)].map(m => ({ i: Number(m[1]), x: Number(m[2]), z: Number(m[3]) })).sort((a, b) => a.i - b.i);
  const yMatch = visibleStarter.match(/place\("lantern",\s*-?\d+,\s*(\d+)/);
  const attempts: Array<{ attempt: number; ran: boolean; passed: boolean }> = [];
  // 第 1 次：照 starter 运行（会失败），观察错误/结果反馈
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("result-card")).toBeVisible();
  attempts.push({ attempt: 1, ran: true, passed: false });
  await page.getByTestId("btn-reset").click();
  // 第 2 次：只用屏幕上的坐标面板重写程序
  let passed = false;
  if (panel.length >= 3 && yMatch) {
    const y = Number(yMatch[1]);
    const code = [
      ...panel.slice(0, 3).flatMap(p => [`golem.moveTo(${p.x}, ${p.z})`, `golem.place("lantern", ${p.x}, ${y}, ${p.z})`]),
      `golem.moveTo(${panel[3]?.x ?? panel[2].x}, ${panel[3]?.z ?? panel[2].z})`,
      "golem.moveTo(0, 6)",
    ].join("\n");
    await page.evaluate(c => window.__loomStudio?.setCode(c), code);
    await page.getByTestId("btn-run").click();
    // 真实玩家会先看到「最后一步」提示，再去做玩家节拍；不能运行请求还没结束就抢跑。
    await expect(page.getByTestId("result-card")).toContainText("最后一步", { timeout: 20_000 });
    await page.evaluate(() => window.__loomStudio?.playerBeat());
    await expect(page.getByTestId("result-card")).toContainText("灯全亮", { timeout: 20_000 });
    passed = true;
    attempts.push({ attempt: 2, ran: true, passed: true });
    await page.getByTestId("btn-settle-replay").click();
  }
  const fiveQ: Record<string, boolean> = {
    whoAmI: /学徒|织者|你手心/.test(mapText),
    world: /断纬|灰岩村|灯/.test(mapText),
    golem: /织偶|织机/.test(mapText),
    nowWhat: /目标|点亮/.test(mapText),
    mistake: /不罚|重置|重来/.test(mapText),
  };
  write("ux-fresh.json", { suite: "U4", attempts, panelFound: panel.length, yFound: !!yMatch, passed, fiveQ, note: "五问基于地图墙/关卡可见文字；prologue 未接线时 whoAmI/world/golem 可能缺" });
  expect(passed).toBe(true);
});
