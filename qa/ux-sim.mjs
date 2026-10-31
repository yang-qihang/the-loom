// qa/ux-sim.mjs — UOS 编排器 v2：每个 suite 独立 90s timeout、失败立即落 raw JSON、不阻塞后续 suite。
// 注意：不做任何全局清理（不 kill Chrome、不 fuser 其它 517x 端口）；只依赖 spawnSync 的 timeout 回收本次子进程，
// 避免误杀并行运行的 Studio e2e（2026-10-31 hotfix）。
// 用法：node qa/ux-sim.mjs --suite happy|error|fresh|desktop|all
// 证据：qa/evidence/ux-<suite>-raw.json / ux-<suite>.json / ux-summary.json / ux-screens.json / ux-shots/
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const EV = path.join(ROOT, "qa/evidence");
const SHOTS = path.join(EV, "ux-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const args = process.argv.slice(2);
const sIdx = args.indexOf("--suite");
const suiteArg = sIdx >= 0 ? args[sIdx + 1] : "all";
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const PLAYWRIGHT = path.join(ROOT, "apps/studio/node_modules/.bin/playwright");
const STUDIO = path.join(ROOT, "apps/studio");
const SUITES = {
  happy: { grep: "U1|U2", label: "U1 契约 + U2 happy" },
  error: { grep: "U3", label: "U3 错误恢复" },
  fresh: { grep: "U4", label: "U4 fresh 盲操作" },
};
const results = [];

function runSuite(name) {
  const t0 = Date.now();
  const rawFile = path.join(EV, `ux-${name}-raw.json`);
  try { fs.rmSync(rawFile, { force: true }); } catch {}
  const outFile = path.join(EV, `ux-${name}-playwright.out`);
  const errFile = path.join(EV, `ux-${name}-playwright.err`);
  try { fs.rmSync(outFile, { force: true }); fs.rmSync(errFile, { force: true }); } catch {}
  // 用 shell 重定向到文件（避免 webServer 子进程占住 pipe 导致 spawnSync 等 EOF 卡死）
  const cmd = `"${PLAYWRIGHT}" test -c e2e/playwright.ux.config.ts -g "${SUITES[name].grep}" --reporter=json > "${outFile}" 2> "${errFile}"`;
  const r = spawnSync("bash", ["-c", cmd], { cwd: STUDIO, encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });
  // 立即落 rawjson：优先 stdout（--reporter=json），失败时也写错误日志
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(outFile, "utf8").slice(fs.readFileSync(outFile, "utf8").indexOf("{"))); } catch {}
  if (raw) fs.writeFileSync(rawFile, JSON.stringify(raw, null, 2));
  else fs.writeFileSync(path.join(EV, `ux-${name}-raw.log`), `exit=${r.status ?? "timeout"}\nSTDOUT:\n${fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : ""}\nSTDERR:\n${fs.existsSync(errFile) ? fs.readFileSync(errFile, "utf8") : ""}\n`);
  const tests = [];
  for (const su of raw?.suites ?? []) for (const spec of su.specs ?? []) for (const t of spec.tests ?? []) {
    const res = t.results?.[0] ?? {};
    const err = (res.errors ?? [{}])[0]?.message ?? "";
    tests.push({ title: t.title, status: res.status ?? "unknown", error: err.slice(0, 1200) });
  }
  const failed = tests.filter(t => t.status !== "passed" && t.status !== "skipped");
  const status = r.status === 0 && failed.length === 0 ? "pass" : "fail";
  results.push({ suite: name, label: SUITES[name].label, status, exit: r.status, durationMs: Date.now() - t0, tests, failures: failed });
  fs.writeFileSync(path.join(EV, `ux-${name}.json`), JSON.stringify({ ts: new Date().toISOString(), suite: name, status, tests, raw: path.relative(ROOT, rawFile) }, null, 2));
  console.log(JSON.stringify({ suite: name, status, tests: tests.length, failed: failed.length, durationMs: Date.now() - t0 }));
}

const order = suiteArg === "all" ? ["happy", "error", "fresh"] : [suiteArg];
for (const s of order) { if (SUITES[s]) runSuite(s); }

let desktop = readJson(path.join(EV, "qa-desktop.json"));
if (suiteArg === "all" || suiteArg === "desktop") {
  desktop = desktop ?? (() => { spawnSync("node", ["qa/desktop-smoke.mjs", "--gate", "desktop"], { cwd: ROOT, timeout: 30000 }); return readJson(path.join(EV, "qa-desktop.json")); })();
  results.push({ suite: "desktop", label: "U5 desktop（复用 task-31 Xvfb/Wayland 证据）", status: desktop?.status ?? "blocked" });
}

const screens = (fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).filter(f => f.endsWith(".png")).sort() : []).map(f => { const p = path.join(SHOTS, f); return { file: path.relative(ROOT, p), sha256: sha(p), bytes: fs.statSync(p).size }; });
fs.writeFileSync(path.join(EV, "ux-screens.json"), JSON.stringify({ ts: new Date().toISOString(), suite: "ux-screens", count: screens.length, screens }, null, 2));

const pass = results.filter(r => r.status === "pass").length;
const fail = results.filter(r => r.status === "fail").length;
const blocked = results.filter(r => !["pass", "fail"].includes(r.status)).length;
const summary = {
  ts: new Date().toISOString(), suite: "ux-sim", mode: "mock(Studio dev:mock + system Chrome channel)",
  suites: results, pass, fail, blocked, shots: screens.length,
  residualGaps: ["U4 fresh（须 U1–U3 全过后再跑）", "真实 engine 模式（需 MC 插件联调）"],
};
fs.writeFileSync(path.join(EV, "ux-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ suite: "ux-sim", pass, fail, blocked, shots: screens.length, evidence: "qa/evidence/ux-summary.json" }));
process.exit(fail > 0 ? 1 : 0);
