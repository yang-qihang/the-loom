import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 桌面主窗给 iframe 传 scale，教材原生窗使用 ?textbook，普通工作台测试不经过这些路径。
for (const webkit of [false, true]) {
  for (const scale of [0.65, 0.8, 1, 1.25]) {
    test(`叙事缩放后宽度稳定 ${webkit ? 'WebKit fallback' : 'Chromium native'} × ${scale}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        ...(webkit ? { userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' } : {}),
      });
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.clear());
      await page.goto(`/?scale=${scale}`);
      await expect(page.getByTestId('prologue-overlay')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const kind of ['prologue', 'act'] as const) {
        if (kind === 'act') {
          await page.getByTestId('onboarding-skip').click();
          await page.getByTestId('level-card-L01').click();
          await expect(page.getByTestId('act-overlay')).toBeVisible();
        }
        const pages = await page.getByTestId(`${kind}-overlay`).locator('.narrative-dots span').count();
        for (let screen = 0; screen < pages; screen += 1) {
          if (screen) await page.getByTestId(kind === 'act' ? 'act-next' : 'onboarding-next').click();
          const group = page.locator('.stage-lines-text');
          await expect(group).toBeVisible();
          // 多轮真实 resize + 高度变化，复现 observer 反复把排版输出当输入的反馈。
          for (const width of [1280, 760, 1440]) {
            await page.setViewportSize({ width, height: 960 });
            const samples = await group.evaluate(async (element) => {
              const rows: number[][] = [];
              for (let frame = 0; frame < 24; frame += 1) {
                await new Promise(requestAnimationFrame);
                if (frame < 4) continue;
                rows.push([...element.querySelectorAll('p')].map(p => p.getBoundingClientRect().width));
              }
              return rows;
            });
            for (let index = 0; index < samples[0].length; index += 1) {
              const widths = samples.map(row => row[index]);
              expect(Math.min(...widths), `第 ${screen + 1} 页不应缩成单字列`).toBeGreaterThan(100 * scale);
              expect(Math.max(...widths) - Math.min(...widths), '字体就绪后排版不能持续收窄').toBeLessThan(2);
            }
            const centered = await group.evaluate(element => {
              if (!element.classList.contains('is-centered-block')) return null;
              const box = element.getBoundingClientRect();
              const widths = [...element.querySelectorAll('p')].map(p => {
                const range = document.createRange();
                range.selectNodeContents(p);
                return range.getBoundingClientRect().width;
              });
              const p = element.querySelector('p')!.getBoundingClientRect();
              return { left: p.left - box.left, right: box.right - (p.left + Math.max(...widths)) };
            });
            if (centered) expect(Math.abs(centered.left - centered.right), '缩放后段组仍居中').toBeLessThan(3);
          }
        }
      }
      await context.close();
    });
  }
}

test('独立教材：真实命中、滚动、翻章与 Tauri 命令接线', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const calls: { command: string; args?: unknown }[] = [];
    Object.assign(window, {
      textbookCalls: calls,
      __TAURI__: { core: { invoke: async (command: string, args?: unknown) => { calls.push({ command, args }); } } },
    });
  });
  await page.goto('/?textbook=L01');
  const win = page.getByTestId('textbook-window');
  await expect(win).toBeVisible();
  await expect(win).toHaveAttribute('data-standalone', 'true');
  const next = page.getByTestId('btn-textbook-next');
  // 不使用 force：空 #root 遮挡整个教材时必须失败。
  await next.click({ timeout: 5000 });
  await expect(page.getByTestId('textbook-counter')).toContainText('2 /');
  await page.getByTestId('btn-textbook-prev').click();
  await expect(page.getByTestId('textbook-counter')).toContainText('1 /');
  const scroll = page.getByTestId('textbook-scroll');
  await scroll.hover();
  await page.mouse.wheel(0, 650);
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await page.getByTestId('btn-textbook-pin').click();
  await expect(win).toHaveAttribute('data-pinned', 'true');
  await page.getByTestId('textbook-titlebar').dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
  await page.getByTestId('textbook-resize').dispatchEvent('pointerdown', { button: 0, pointerId: 2 });
  await page.setViewportSize({ width: 600, height: 600 });
  await expect(win).toHaveAttribute('data-compact', 'true');
  await page.getByTestId('btn-textbook-close').click();
  const calls = await page.evaluate(() => (window as unknown as { textbookCalls: { command: string; args?: unknown }[] }).textbookCalls);
  expect(calls).toEqual(expect.arrayContaining([
    { command: 'set_textbook_pin', args: { value: true } },
    { command: 'window_start_drag', args: undefined },
    { command: 'textbook_start_resize', args: { direction: 'south-east' } },
    { command: 'window_close', args: undefined },
  ]));
});

test('独立教材：公共 Tauri 当前窗口 API 接线', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const calls: unknown[][] = [];
    const record = async (...args: unknown[]) => { calls.push(args); };
    Object.assign(window, {
      textbookCalls: calls,
      __TAURI__: {
        core: { invoke: async () => { throw new Error('公共窗口 API 应直接成功'); } },
        window: { getCurrentWindow: () => ({
          close: () => record('close'),
          startDragging: () => record('startDragging'),
          setAlwaysOnTop: (value: boolean) => record('setAlwaysOnTop', value),
          startResizeDragging: (direction: string) => record('startResizeDragging', direction),
        }) },
      },
    });
  });
  await page.goto('/?textbook=L01');
  await page.getByTestId('btn-textbook-pin').click();
  const title = await page.getByTestId('textbook-titlebar').boundingBox();
  await page.mouse.move(title!.x + 60, title!.y + 20);
  await page.mouse.down();
  await page.mouse.up();
  const resize = await page.getByTestId('textbook-resize').boundingBox();
  await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.getByTestId('btn-textbook-close').click();
  expect(await page.evaluate(() => (window as unknown as { textbookCalls: unknown[][] }).textbookCalls))
    .toEqual(expect.arrayContaining([['setAlwaysOnTop', true], ['startDragging'], ['startResizeDragging', 'SouthEast'], ['close']]));
});

test("80% 缩放的 Chromium 使用原生排版，字体通知不再逐字扫描", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const original = Range.prototype.getClientRects;
    (window as any).rangeReadCount = 0;
    Range.prototype.getClientRects = function () {
      (window as any).rangeReadCount++;
      return original.call(this);
    };
  });
  await page.goto("/?scale=0.8");
  await expect(page.getByTestId("prologue-overlay")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".justified-text-block")).toHaveCount(0);
  const reads = await page.evaluate(async () => {
    (window as any).rangeReadCount = 0;
    document.fonts.dispatchEvent(new Event("loadingdone"));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return (window as any).rangeReadCount;
  });
  expect(reads).toBe(0);
});

test("快速运行的 SSE 先于 HTTP 202 返回时，第二次运行仍显示结果", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }));
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01"]));
  });
  await page.goto("/");
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await page.evaluate(() => window.__loomStudio?.setCode("golem.moveTo("));
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/run") && response.request().method() === "POST"),
    page.getByTestId("btn-run").click(),
  ]);
  await expect(page.getByTestId("error-banner")).toBeVisible();
  await page.route("**/api/run", async route => {
    const response = await route.fetch();
    // 后端照常执行，只延后网络确认，确定性重现 SSE 已到但 activeRunId 仍属于上一轮。
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.__loomStudio?.fillReference());
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("btn-player-beat")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("error-banner")).toBeHidden();
});

test("HTTP 确认在途时 reset，晚到确认和缓冲结果不得恢复旧运行", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }));
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01"]));
  });
  await page.goto("/");
  await page.getByTestId("level-card-L01").click();
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await page.evaluate(() => window.__loomStudio?.fillReference());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/run", async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByTestId("btn-run").click();
    await expect(page.locator('.goal[data-done="true"]')).toHaveCount(2);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/reset")),
      page.getByTestId("btn-reset").click(),
    ]);
    await expect(page.locator('.goal[data-done="true"]')).toHaveCount(0);
    const oldAck = page.waitForResponse(response => response.url().endsWith("/api/run"));
    release();
    await oldAck;
    await expect(page.getByTestId("btn-player-beat")).toBeHidden();
    await expect(page.locator('.goal[data-done="true"]')).toHaveCount(0);
  } finally { release(); await page.unroute("**/api/run"); }
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("btn-player-beat")).toBeVisible();
});

test("位置卡收起后的坐标与标题、按钮不重叠", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("loom.studio.progress.v1", JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ["L01"], lastCompletedLevelId: null }));
    localStorage.setItem("loom.textbook.read.v1", JSON.stringify(["L01"]));
  });
  await page.goto("/");
  await page.getByTestId("level-card-L01").click();
  const hud = page.getByTestId("position-hud");
  await expect(hud).toBeVisible();
  await expect(page.getByTestId("hud-golem-pos")).not.toContainText("未知");
  await page.getByTestId("btn-hud-toggle").click();
  await expect(page.getByTestId("hud-collapsed-pos")).toBeVisible();
  for (const width of [1920, 1440, 1024]) {
    await page.setViewportSize({ width, height: 1080 });
    const collisions = await hud.evaluate(root => {
      const items = Array.from(root.querySelectorAll('h3, .hud-pos-tag, button'));
      const hits: string[] = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.getBoundingClientRect(), b = items[j]!.getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          hits.push(`${items[i]!.textContent} / ${items[j]!.textContent}`);
        }
      }
      return hits;
    });
    expect(collisions, `${width}px 下标题、坐标、按钮必须相互避让`).toEqual([]);
    const evidence = resolve(process.cwd(), '../../evidence/incremental-fix');
    mkdirSync(evidence, { recursive: true });
    await hud.screenshot({ path: resolve(evidence, `hud-${width}.png`) });
  }
});
