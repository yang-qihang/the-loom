// qa/repl-check.mjs — G-REPL 证据门：/api/repl 实现 + repl.test.ts 实跑 + EVIDENCE §6 证据。
// 用法：node qa/repl-check.mjs；证据 qa/evidence/qa-repl.json（含测试 JSON 子证据）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const ROOT = process.cwd();
const EV = path.join(ROOT, "qa/evidence");
fs.mkdirSync(EV, { recursive: true });
const exists = p => fs.existsSync(path.join(ROOT, p));
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const checks = [];
const add = (id, name, ok, detail, severity = "fail") => checks.push({ id, name, status: ok ? "pass" : severity, detail });

const impl = ["packages/runner/src/repl.ts", "packages/session/src/session.ts", "apps/engine/src/server.ts"].filter(exists);
const tests = ["packages/session/src/repl.test.ts"].filter(exists);
add("R1", "REPL 实现文件存在（runner/session/engine）", impl.length >= 2, { found: impl });
add("R2", "repl.test.ts 存在", tests.length === 1, { found: tests });

const evMd = exists("apps/engine/EVIDENCE.md") ? read("apps/engine/EVIDENCE.md") : "";
const sec6 = evMd.split(/## 6\./)[1]?.split(/## 7\./)[0] ?? "";
const keys = ["7 项测试", "/api/repl", "死循环", "沙箱", "不影响关卡", "中文"];
add("R3", "EVIDENCE §6 含四端点/7 测试/沙箱/超时/中文错误证据", keys.filter(k => !sec6.includes(k)).length === 0, { section: "apps/engine/EVIDENCE.md §6", missing: keys.filter(k => !sec6.includes(k)) });
// 路由端点
const server = exists("apps/engine/src/server.ts") ? read("apps/engine/src/server.ts") : "";
const endpoints = ["/api/repl", "/api/repl/history", "/api/repl/reset"].filter(e => server.includes(e));
add("R4", "HTTP 端点 3 个已接线（repl/history/reset）", endpoints.length === 3, { endpoints });

// 实跑 repl 测试（Windows：npx 实为 npx.cmd，直接 spawn 会 ENOENT；优先 node + 本地 vitest CLI）
let testOk = false, stats = null;
if (tests.length) {
  const vitestArgs = ["run", "packages/session/src/repl.test.ts", "--reporter=json", "--outputFile=qa/evidence/qa-repl-tests.json"];
  const vitestCli = path.join(ROOT, "node_modules/vitest/vitest.mjs");
  const r = fs.existsSync(vitestCli)
    ? spawnSync(process.execPath, [vitestCli, ...vitestArgs], { cwd: ROOT, encoding: "utf8", timeout: 180000 })
    : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", ...vitestArgs], { cwd: ROOT, encoding: "utf8", timeout: 180000, shell: process.platform === "win32" });
  testOk = r.status === 0;
  try { const j = JSON.parse(read("qa/evidence/qa-repl-tests.json")); stats = { total: j.numTotalTests, failed: j.numFailedTests, passed: j.numPassedTests }; } catch {}
  if (r.status !== 0) fs.writeFileSync(path.join(EV, "qa-repl-tests-failure.log"), `${r.stdout ?? ""}\n${r.stderr ?? ""}\n`);
}
add("R5", "repl.test.ts 实跑全绿", testOk, { testOk, stats });

const fails = checks.filter(c => c.status === "fail").length;
const status = fails ? "fail" : "pass";
const out = {
  ts: new Date().toISOString(), suite: "repl-check", gate: "G-REPL", status,
  summary: { pass: checks.filter(c => c.status === "pass").length, fail: fails },
  checks, stats, evidence: ["apps/engine/EVIDENCE.md §6", "packages/session/src/repl.test.ts", "qa/evidence/qa-repl-tests.json"],
  endpoints,
  blockedReason: null,
  sandboxNote: "沙箱探针（process/require/globalThis 不可见、死循环 300ms 超时）由 repl.test.ts + RT-02 sandbox.test 覆盖；见 apps/engine/EVIDENCE.md §6",
  missingTests: fails ? ["REPL 测试未全绿/证据缺项；见 checks"] : [],
};
fs.writeFileSync(path.join(EV, "qa-repl.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ suite: "repl-check", gate: "G-REPL", status, summary: out.summary, stats }));
process.exit(fails ? 1 : 0);
