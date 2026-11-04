// 应得到 3 FAIL / 1 PASS、exit 1：只替换 bot 为修复前版本，全部回归断言保持原样。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(root, 'tmp/arrival-before-'));
let oldBot = execFileSync('git', ['show', '418fdb5:bot/manager.mjs'], { cwd: root, encoding: 'utf8' });
oldBot = oldBot.replace('from "mineflayer"', `from ${JSON.stringify(join(root, 'bot/node_modules/mineflayer/index.js'))}`)
  .replace('from "mineflayer-pathfinder"', `from ${JSON.stringify(join(root, 'bot/node_modules/mineflayer-pathfinder/index.js'))}`);
writeFileSync(join(dir, 'original-manager.mjs'), oldBot);
const source = readFileSync(join(root, 'apps/engine/src/bot-arrival.test.ts'), 'utf8')
  .replace('../../../bot/manager.mjs', join(dir, 'original-manager.mjs'))
  .replaceAll('../../../', root + '/');
const testFile = join(dir, 'arrival.test.ts');
writeFileSync(testFile, source);
const config = join(dir, 'vitest.config.ts');
writeFileSync(config, `export default {test:{include:[${JSON.stringify(testFile)}],environment:"node"}};\n`);
const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
