// 独立真实 Paper 栈 + build:e2e Studio；不控制用户正在玩的服务器。
import { chromium, expect } from '../../apps/studio/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = dirname(fileURLToPath(import.meta.url));
const engine = process.env.INCREMENTAL_ENGINE_URL ?? 'http://127.0.0.1:4409';
const studio = process.env.INCREMENTAL_STUDIO_URL ?? 'http://127.0.0.1:5191';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('loom.studio.progress.v1', JSON.stringify({ prologueSeen: true, actsSeen: [1, 2, 3], levelsStarted: ['L01'], lastCompletedLevelId: null }));
    localStorage.setItem('loom.textbook.read.v1', JSON.stringify(['L01']));
  });
  await page.goto(`${studio}/?engine=${encodeURIComponent(engine)}`);
  const created = page.waitForResponse(response => response.url().endsWith('/api/session') && response.status() === 201);
  await page.getByTestId('level-card-L01').click();
  const level = await (await created).json();
  assert.equal(level.port, 'paper+bot');
  await expect(page.getByTestId('code-editor')).toBeVisible();
  const code = 'golem.say("保留编辑器代码")';
  await page.evaluate(source => window.__loomStudio.setCode(source), code);
  const snapshot = async () => await (await fetch(`${engine}/api/session/${level.sessionId}/snapshot?view=hud`)).json();
  const before = await snapshot();
  await page.getByTestId('btn-help-menu').click();
  const attachedResponse = page.waitForResponse(response => response.url().endsWith('/api/session') && response.request().postDataJSON()?.mode === 'repl');
  await page.getByTestId('btn-repl-top').click();
  const attached = await attachedResponse;
  assert.equal(attached.request().postDataJSON().live, true);
  assert.equal((await attached.json()).sessionId, level.sessionId);
  await expect(page.getByTestId('repl-input')).toBeEnabled();
  await page.getByTestId('repl-input').fill('golem.moveTo(lamp2)');
  const started = performance.now();
  await page.getByTestId('btn-repl-try').click();
  await expect(page.getByTestId('repl-history')).toContainText('照做了', { timeout: 120000 });
  const elapsedMs = Math.round(performance.now() - started);
  const after = await snapshot();
  const pos = after.agents.golem.pos;
  assert.notDeepEqual(pos, before.agents.golem.pos);
  assert.ok(Math.hypot(pos[0] + 12, pos[2] + 2) <= 2);
  assert.equal(after.sessionEpoch, before.sessionEpoch);
  await page.getByTestId('repl-input').fill('golem.pos');
  await page.getByTestId('btn-repl-try').click();
  await expect(page.getByTestId('repl-history')).toContainText(`左右 ${pos[0]}`);
  await page.screenshot({ path: join(out, 'repl-real-move.png'), fullPage: true });
  await page.getByTestId('btn-repl-back').click();
  await expect(page.getByTestId('code-editor')).toContainText('保留编辑器代码');
  await page.getByTestId('btn-help-menu').click();
  await page.getByTestId('btn-repl-top').click();
  await expect(page.getByTestId('btn-repl-reset')).toBeEnabled();
  await page.getByTestId('btn-repl-reset').click();
  await expect(page.getByTestId('repl-notice')).toContainText('现场已恢复原样', { timeout: 30000 });
  const reset = await snapshot();
  assert.equal(reset.sessionEpoch, before.sessionEpoch + 1);
  await page.getByTestId('btn-repl-back').click();
  await expect(page.getByTestId('settle-overlay')).toBeHidden();
  await expect(page.locator('.goal[data-done="true"]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  const summary = { mode: 'real Paper + real bot + source engine + headless Chrome', sessionId: level.sessionId,
    attachedSameSession: true, before: before.agents.golem.pos, after: pos, actionMs: elapsedMs,
    epochBefore: before.sessionEpoch, epochAfterMove: after.sessionEpoch, epochAfterReset: reset.sessionEpoch,
    afterReset: reset.agents.golem.pos, editorPreserved: true, errors };
  writeFileSync(join(out, 'repl-paper-ui-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
