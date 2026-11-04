// 需先起隔离 Paper 与 source engine；Studio 用 build:e2e 后的产物。
// 默认 Studio 5186 / engine 4399，测试会创建并使用自己的会话。
import { chromium, expect } from '../../apps/studio/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = dirname(fileURLToPath(import.meta.url));
const engine = process.env.INCREMENTAL_ENGINE_URL ?? 'http://127.0.0.1:4399';
const studio = process.env.INCREMENTAL_STUDIO_URL ?? 'http://127.0.0.1:5186';
const partial = `golem.moveTo(lamp1)
golem.place("lantern", lamp1)
golem.moveTo(lamp2)
golem.place("lantern", lamp2)
golem.moveTo(lamp3)
golem.place("lantern", lamp3)`;
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
  const { sessionId } = await (await created).json();
  await expect(page.getByTestId('code-editor')).toBeVisible();
  await page.evaluate(source => window.__loomStudio.setCode(source), partial);
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('btn-player-beat')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('.goal[data-done="true"]')).toHaveCount(1);
  const beatResponse = await fetch(`${engine}/api/player-beat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, simulate: true }),
  });
  assert.equal(beatResponse.status, 200);
  const beat = await beatResponse.json();
  assert.equal(beat.result.passed, false);
  await expect(page.locator('.goal[data-done="true"]')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByTestId('settle-overlay')).toBeHidden();
  await page.evaluate(source => window.__loomStudio.setCode(source), `${partial}\ngolem.moveTo(eira)`);
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('settle-overlay')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('.goal[data-done="true"]')).toHaveCount(3);
  const snapshot = await (await fetch(`${engine}/api/session/${sessionId}/snapshot`)).json();
  assert.equal(snapshot.state, 'PASSED');
  assert.equal(snapshot.sessionEpoch, 0);
  assert.equal(snapshot.allPassed, true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(out, 'paper-incremental-settle.png'), fullPage: true });
  const summary = { mode: 'source engine + real Paper + real bot + headless Chrome', simulatedPlayer: true, sessionId,
    partialCalls: 6, finalCalls: 7, state: snapshot.state, epoch: snapshot.sessionEpoch,
    progress: snapshot.progress, allPassed: snapshot.allPassed, errors };
  writeFileSync(join(out, 'paper-ui-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
