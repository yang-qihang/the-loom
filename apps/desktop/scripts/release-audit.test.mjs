import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { smokeTestEngine } from "./build-assets.mjs";
import { normalizeEngineUrl, trustedFrameMessage, BRIDGE_COMMANDS, bridgeArgs } from "../shell/shell-policy.js";

test("命令桥必须同时校验 iframe、origin 与命令白名单", () => {
  const frame = {}, local = "http://tauri.localhost", engine = "http://127.0.0.1:4317";
  assert.equal(trustedFrameMessage({ source: {}, origin: local }, frame, local, engine), false);
  for (const origin of ["https://untrusted.example", "null", "http://127.0.0.1:9999"]) {
    assert.equal(trustedFrameMessage({ source: frame, origin }, frame, local, engine), false);
  }
  for (const origin of [local, engine]) assert.equal(trustedFrameMessage({ source: frame, origin }, frame, local, engine), true);
  for (const cmd of ["window_force_close", "window_allow_close", "quit_game", "eval"]) assert.equal(BRIDGE_COMMANDS.has(cmd), false);
  assert.equal(BRIDGE_COMMANDS.has("open_textbook_window"), true);
  const args = { settings: { prismCommand: "prism; echo $HOME | cat > /tmp/x\n" } };
  assert.doesNotMatch(bridgeArgs("save_settings", args).settings.prismCommand, /[;&|`$<>\r\n]/);
  assert.match(args.settings.prismCommand, /;/); // 不修改调用方对象。
});

test("织机地址只允许不带凭据/路径的 loopback HTTP origin", () => {
  for (const value of ["http://127.0.0.1:4317", "http://localhost:4317/", "http://[::1]:4317"]) assert.ok(normalizeEngineUrl(value));
  for (const value of ["https://example.com", "http://127.0.0.1.evil", "http://user:pass@localhost:4317", "http://localhost:4317/path", "http://localhost:4317?x=1", "file:///tmp/a"]) assert.equal(normalizeEngineUrl(value), null);
});

test("构建冒烟拒绝提前退出的新产物，即使已有服务返回健康", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-smoke-"));
  const old = createServer((_, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); });
  await new Promise(resolve => old.listen(0, "127.0.0.1", resolve));
  try {
    const entry = join(dir, "bad.cjs");
    await writeFile(entry, 'process.exit(1)');
    await assert.rejects(smokeTestEngine({ entry, timeoutMs: 1500 }), /提前退出/);
  } finally { await new Promise(resolve => old.close(resolve)); await rm(dir, { recursive: true }); }
});

test("构建冒烟使用新产物通过 PORT=0 报告的独立地址", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-smoke-"));
  try {
    const entry = join(dir, "good.cjs");
    await writeFile(entry, `const http = require('node:http'); const server = http.createServer((_, res) => res.end(JSON.stringify({ok:true,ownArtifact:true}))); server.listen(Number(process.env.PORT), process.env.HOST, () => console.log('LOOM engine ready: http://127.0.0.1:' + server.address().port));`);
    assert.equal((await smokeTestEngine({ entry, timeoutMs: 1500 })).ownArtifact, true);
  } finally { await rm(dir, { recursive: true }); }
});

test("交接脚本拒绝仓库路径和已有非空目录，不删除原数据", { skip: process.platform === "win32" }, async () => {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const script = join(repo, "scripts/prepare-github-handoff.sh");
  const dir = await mkdtemp(join(tmpdir(), "loom-handoff-"));
  try {
    await writeFile(join(dir, "keep.txt"), "must survive");
    for (const target of [repo, join(repo, "apps"), join(repo, ".."), dir]) {
      const result = spawnSync("bash", [script, target], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 2, result.stderr);
    }
    assert.equal(await readFile(join(dir, "keep.txt"), "utf8"), "must survive");
  } finally { await rm(dir, { recursive: true }); }
});
