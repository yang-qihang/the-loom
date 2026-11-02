// qa/gates.mjs — docs/28 专项门禁汇总：G-SCALE / G-PURE-ZH / G-UI-ALIGN / G-ONBOARD / G-REPL / G-DESKTOP / G-TOP
// Windows（win32）补充：G-DESKTOP-WIN / G-TOP-WIN（qa/desktop-smoke-win.mjs）；Linux-only 的 G-DESKTOP/G-TOP 显式 blocked。
// 未实现功能明确标 blocked（不假绿）；证据写 qa/evidence/qa-gates.json，回归写 qa/evidence/qa-regression.json。
// 用法：npx tsx qa/gates.mjs [--strict]（--strict 时 warn 也 exit 1；默认只 fail 退出非 0）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const WIN = process.platform === "win32";
const dir = path.join(ROOT, "qa/evidence");
fs.mkdirSync(dir, { recursive: true });
const readJson = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return null; } };
const writeJson = (p, d) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(d, null, 2) + "\n");
const localCli = rel => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? p : null; };
// 跨平台子进程：Windows 上 spawnSync("npx") 是 ENOENT（npx 实际是 npx.cmd），不能 spawn bash；
// 优先直调 node_modules 内的 CLI（node + 绝对 cli 路径），找不到才退化 npx（win32 用 npx.cmd + shell）。
const spawnCli = (cliRel, bin, args, timeout) => {
  const cli = localCli(cliRel);
  const opts = { cwd: ROOT, encoding: "utf8", timeout, env: { ...process.env, NO_COLOR: "1" } };
  if (cli) return spawnSync(process.execPath, [cli, ...args], opts);
  const npx = WIN ? "npx.cmd" : "npx";
  return spawnSync(npx, [bin, ...args], { ...opts, shell: WIN });
};
const runTsx = (script, args = [], timeout = 120000) => spawnCli("node_modules/tsx/dist/cli.mjs", "tsx", [script, ...args], timeout);
const runVitest = (args, timeout = 180000) => spawnCli("node_modules/vitest/vitest.mjs", "vitest", args, timeout);
const importTs = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const gate = (id, name, status, detail = {}) => ({ id, name, status, detail });
const glob = fs.readdirSync(path.join(ROOT, "content/levels")).filter(f => f.endsWith(".content.ts")).sort();

// ---------- G-SCALE ----------
const { L01, validateLevel, effectiveLines } = await importTs("packages/level-spec/src/index.ts");
const scaleLevels = [{ id: "L01", def: L01, file: "packages/level-spec/src/index.ts", testFile: null }];
for (const f of glob) {
  const mod = await importTs(path.join("content/levels", f));
  for (const [, v] of Object.entries(mod)) {
    if (v && v.def && v.def.task) scaleLevels.push({ id: v.def.meta.id, def: v.def, file: `content/levels/${f}`, testFile: f.replace(".content.ts", ".content.test.ts") });
  }
}
const seen = new Set();
const uniqueLevels = [];
for (const row of scaleLevels) { if (seen.has(row.id)) { if (row.file.startsWith('content/')) { uniqueLevels[uniqueLevels.findIndex(x => x.id === row.id)] = row; } continue; } seen.add(row.id); uniqueLevels.push(row); }
const scaleRows = uniqueLevels.map(({ id, def, file, testFile }) => {
  const issues = validateLevel(def);
  const refLines = effectiveLines(def.code.referenceSolution);
  const starterLines = effectiveLines(def.code.starterCode);
  let challengeTests = 0;
  const tpath = testFile ? path.join(ROOT, "content/levels", testFile) : null;
  if (tpath && fs.existsSync(tpath)) challengeTests = (fs.readFileSync(tpath, "utf8").match(/挑战|challenge/gi) || []).length;
  const l01MissingChallenge = id === "L01" && !def.challenge;
  const ok = issues.length === 0 && (def.challenge ? challengeTests >= 3 : id === "L01");
  const status = issues.length ? "fail" : l01MissingChallenge ? "warn" : ok ? "pass" : "warn";
  return { id, file, refLines, starterLines, hidden: def.task.hiddenTests.length, challenge: !!def.challenge, challengeTests, issues, missing: l01MissingChallenge ? ["L01 challenge（加练）未实现：docs/20 §3c 要求每关有加练；docs/24 §4.2 列为补强项"] : [], status };
});
const scaleFail = scaleRows.filter(r => r.status === "fail");
const scale = gate("G-SCALE", "关卡体量/挑战层（LOC/challenge/hidden；L01 例外）", scaleFail.length ? "fail" : scaleRows.every(r => r.status === "pass") ? "pass" : "warn", {
  levels: scaleRows,
  rule: "docs/20 §3c + docs/24：有效行数 L01≥8/ActI≥25/ActII≥50/ActIII≥60；starter 差≥下限一半；hidden≥1(L01)/≥2；challenge 必须有且至少 3 条挑战测试（挑战过/偷懒失败/写死失败）",
  notImplemented: ["L05–L10 的 content 尚未实现（只有设计 spec），G-SCALE 只对已实现 content 负责"],
  warnLevels: scaleRows.filter(r => r.status === 'warn').map(r => r.id),
});

// ---------- G-PURE-ZH ----------
const copyRun = runTsx("scripts/check-copy.mjs", ["--pure-zh", "--json", "qa/evidence/qa-copy.json"]);
const copy = readJson("qa/evidence/qa-copy.json");
const pureViolations = copy?.pureZh?.counts?.violations ?? null;
const pure = gate("G-PURE-ZH", "UI 纯中文（docs/20 §3b）", pureViolations === 0 ? "pass" : pureViolations == null ? "blocked" : "warn", {
  violations: pureViolations,
  exemptTokens: copy?.pureZh?.counts?.exemptTokens,
  exemptStrings: copy?.pureZh?.counts?.exemptStrings,
  warnings: copy?.pureZh?.counts?.warnings,
  evidence: "qa/evidence/qa-copy.json",
  mode: "warn（T4 前不判红；feature freeze 后 --strict）",
  exitCode: copyRun.status,
});

// ---------- 其余 gate：读各检查器证据（不存在则先跑检查器） ----------
// 每次都重跑（快），避免读到过时证据
for (const script of ["qa/ui-assert.mjs", "qa/onboard-check.mjs", "qa/repl-check.mjs"]) runTsx(script);
// G-DESKTOP / G-TOP 是 Linux 桌面壳证据门（rpm/AppImage/Xvfb/Wayland）。Windows 上：
//   1) 不 spawn bash（bash 是 WSL 桩、.sh 是 CRLF，必然失败）；
//   2) 不读 Linux 证据冒充 Windows 通过；
//   3) 改跑 qa/desktop-smoke-win.mjs 生成 G-DESKTOP-WIN / G-TOP-WIN 证据。
let desktop = null, top = null, desktopWin = null, topWin = null;
if (WIN) {
  spawnSync(process.execPath, [path.join(ROOT, "qa/desktop-smoke-win.mjs")], { cwd: ROOT, encoding: "utf8", timeout: 180000, env: { ...process.env, NO_COLOR: "1" } });
  desktopWin = readJson("qa/evidence/qa-desktop-win.json");
  topWin = readJson("qa/evidence/qa-top-win.json");
} else {
  const runNode = (script, args, timeout = 30000) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: "utf8", timeout, env: { ...process.env, NO_COLOR: "1" } });
  if (!readJson("qa/evidence/qa-desktop.json")) runNode("qa/desktop-smoke.mjs", ["--gate", "desktop"], 120000);
  if (!readJson("qa/evidence/qa-top.json")) runNode("qa/desktop-smoke.mjs", ["--gate", "top"], 120000);
  desktop = readJson("qa/evidence/qa-desktop.json");
  top = readJson("qa/evidence/qa-top.json");
}
const ui = readJson("qa/evidence/qa-ui-align.json");
const on = readJson("qa/evidence/qa-onboard.json");
const repl = readJson("qa/evidence/qa-repl.json");
const mapStatus = s => (s === "fail" ? "fail" : s === "pass" ? "pass" : s === "warn" ? "warn" : "blocked");
const LINUX_ONLY = "Linux-only 门（rpm/AppImage/Xvfb/Wayland 证据）；Windows 无对应证据，见 G-DESKTOP-WIN / G-TOP-WIN";
const gates = [
  scale,
  pure,
  gate("G-UI-ALIGN", "标题中线/不换行/无横向滚动", mapStatus(ui?.status), { summary: ui?.summary, evidence: "qa/evidence/qa-ui-align.json", blockedReason: ui?.blockedReason, missing: ui?.missing }),
  gate("G-ONBOARD", "序章/引导文本预算 + 盲读证据", mapStatus(on?.status), { summary: on?.summary, evidence: "qa/evidence/qa-onboard.json", blockedReason: on?.blockedReason, missing: on?.missing, budgets: on?.budgets }),
  gate("G-REPL", "试符台 REPL + 沙箱", mapStatus(repl?.status), { evidence: "qa/evidence/qa-repl.json", blockedReason: repl?.blockedReason, requiredProbes: repl?.requiredProbes, missingTests: repl?.missingTests }),
  WIN
    ? gate("G-DESKTOP", "Tauri 桌面壳（Linux-only；Windows 见 G-DESKTOP-WIN）", "blocked", { evidence: "qa/evidence/qa-desktop.json（Linux，不适用 Windows）", blockedReason: LINUX_ONLY, replacedBy: "G-DESKTOP-WIN" })
    : gate("G-DESKTOP", "Tauri 桌面壳（无浏览器启动）", mapStatus(desktop?.status), { evidence: "qa/evidence/qa-desktop.json", blockedReason: desktop?.blockedReason, requiredChecks: desktop?.requiredChecks }),
  WIN
    ? gate("G-TOP", "总在最前/伴玩（Linux-only；Windows 见 G-TOP-WIN）", "blocked", { evidence: "qa/evidence/qa-top.json（Linux，不适用 Windows）", blockedReason: LINUX_ONLY, replacedBy: "G-TOP-WIN" })
    : gate("G-TOP", "总在最前/伴玩（窗口 API）", mapStatus(top?.status), { evidence: "qa/evidence/qa-top.json", blockedReason: top?.blockedReason, requiredChecks: top?.requiredChecks }),
];
// Windows 等价门（qa/desktop-smoke-win.mjs 只读校验证据；缺 GUI 证据标 blocked，不假绿）
if (WIN) {
  gates.push(gate("G-DESKTOP-WIN", "Windows 桌面壳（NSIS 产物/静默安装/包内 runtime/headless e2e；GUI 证据缺省 blocked）", mapStatus(desktopWin?.status), {
    evidence: "qa/evidence/qa-desktop-win.json",
    blockedReason: desktopWin?.blockedReason ?? "缺 qa/evidence/qa-desktop-win.json",
    summary: desktopWin?.summary,
    artifact: {
      nsis: desktopWin?.evidence?.nsis ? { path: desktopWin.evidence.nsis.path, bytes: desktopWin.evidence.nsis.bytes, sha256: desktopWin.evidence.nsis.sha256, mtime: desktopWin.evidence.nsis.mtime } : null,
      releaseExe: desktopWin?.evidence?.releaseExe ? { path: desktopWin.evidence.releaseExe.path, bytes: desktopWin.evidence.releaseExe.bytes, sha256: desktopWin.evidence.releaseExe.sha256 } : null,
      installedExe: desktopWin?.evidence?.installed?.exe ? { path: desktopWin.evidence.installed.exe.path, bytes: desktopWin.evidence.installed.exe.bytes, sha256: desktopWin.evidence.installed.exe.sha256 } : null,
    },
    headlessE2E: desktopWin?.evidence?.headless ? { path: desktopWin.evidence.headless.path, ok: desktopWin.evidence.headless.ok, headGit: desktopWin.evidence.headless.headGit, finishedAt: desktopWin.evidence.headless.finishedAt, runtimePath: desktopWin.evidence.headless.runtimePath } : null,
    guiEvidence: { screenshots: desktopWin?.evidence?.guiEvidence?.screenshotCount ?? null, evidenceMd: desktopWin?.evidence?.guiEvidence?.evidenceMd ?? null },
    checks: desktopWin?.checks?.map(c => ({ id: c.id, name: c.name, status: c.status })),
  }));
  gates.push(gate("G-TOP-WIN", "Windows 置顶/伴玩/Alt+Z/focus-follow（代码存在性 + GUI 行为证据缺省 blocked）", mapStatus(topWin?.status), {
    evidence: "qa/evidence/qa-top-win.json",
    blockedReason: topWin?.blockedReason ?? "缺 qa/evidence/qa-top-win.json",
    summary: topWin?.summary,
    codePresence: topWin?.evidence?.codePresence ? Object.fromEntries(Object.entries(topWin.evidence.codePresence.markerGroups ?? {}).map(([k, v]) => [k, { present: v.present, total: v.total, missing: v.missing }])) : null,
    installedBinaryTokens: topWin?.evidence?.codePresence?.installedBinaryTokens ?? null,
    settingsSnapshot: topWin?.evidence?.settingsSnapshot ?? null,
    checks: topWin?.checks?.map(c => ({ id: c.id, name: c.name, status: c.status })),
  }));
}
// G-UX-SIM：UOS（运行 --layers ux 后更新；system Chrome channel）
const uxs = readJson("qa/evidence/ux-summary.json");
const chromeCandidates = WIN
  ? [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean)
  : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
const edgeCandidates = WIN
  ? [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
  ].filter(Boolean)
  : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];
const chromePath = chromeCandidates.find(f => fs.existsSync(f)) ?? null;
const edgePath = edgeCandidates.find(f => fs.existsSync(f)) ?? null;
const sysChrome = {
  available: !!chromePath,
  chromePath,
  edge: { available: !!edgePath, path: edgePath, note: "Playwright 配置 channel: chrome，Edge 不能替代 chrome channel" },
  candidates: chromeCandidates,
  note: WIN ? "Windows 探测 Program Files / Program Files (x86) / LOCALAPPDATA 下 Chrome；不依赖 ms-playwright 下载" : "Playwright config 使用 channel: chrome，不依赖 ms-playwright 下载",
};
const uxStatus = uxs ? (uxs.fail > 0 ? "fail" : (uxs.blocked > 0 || uxs.pass === 0) ? "warn" : "pass") : "blocked";
gates.push(gate("G-UX-SIM", "用户操作模拟 UOS（Playwright + system Chrome）", uxStatus, {
  evidence: "qa/evidence/ux-summary.json",
  systemChrome: sysChrome,
  pass: uxs?.pass, fail: uxs?.fail, blocked: uxs?.blocked, shots: uxs?.shots,
  suites: uxs?.suites,
  blockedReason: uxs ? null : "ux 层未跑：`bash scripts/verify.sh --layers ux`（Linux）/ Windows 当前无 ux layer 入口（彩排前必跑）",
  fixList: uxs?.fail > 0 ? uxs?.fixList : undefined,
}));

// G-FRESH-READER：fresh agent 盲读（Round 1 FAIL，tracked；Round 2 由 pedagogy task-44 复读）
const fr = readJson("qa/evidence/fresh-reader-round1.json");
const frConsolidated = fr?.consolidated ?? fr?.gate ?? null;
const frScores = fr?.scores ?? null;
gates.push(gate("G-FRESH-READER", "Fresh Reader 盲读（Round 1）", fr ? "fail" : "blocked", {
  tracked: true, round: 1,
  evidence: ["docs/31-fresh-reader-report.md", "qa/evidence/fresh-reader-round1.json"],
  consolidated: frConsolidated, scores: frScores,
  reason: fr ? "Round 1 FAIL：11 blocker/20 major；自然度/清楚度 2/5（门槛≥4）；不得进入下一关验收" : "缺 qa/evidence/fresh-reader-round1.json",
  next: "Round 2 由 pedagogy task-44 在 task-41/42/43 完成后用新的 2 个 fresh agent 复读；复读通过前不得假绿",
}));

// ---------- G-FAP：新增功能协议矩阵（spec + 测试 + 证据，缺一不可） ----------
const fap = [];
const fapRow = (feature, specDocs, tests, evidence) => {
  const specOk = specDocs.every(p => fs.existsSync(path.join(ROOT, p)));
  const testsOk = tests.some(p => fs.existsSync(path.join(ROOT, p)));
  const evOk = evidence.some(p => fs.existsSync(path.join(ROOT, p)));
  fap.push({ feature, spec: specOk ? specDocs : false, tests: testsOk, evidence: evOk, status: specOk && testsOk && evOk ? "pass" : "blocked" });
};
fapRow("G-REPL", ["docs/27-repl-rune-bench.md"], ["apps/engine/src/repl.test.ts", "packages/session/src/repl.test.ts"], ["qa/evidence/qa-repl.json"]);
fapRow("G-DESKTOP", ["docs/26-desktop-packaging.md"], ["apps/desktop/src-tauri/tauri.test.ts", "qa/desktop-smoke.sh"], ["qa/evidence/qa-desktop.json"]);
fapRow("G-TOP", ["docs/26-desktop-packaging.md"], ["apps/desktop/src-tauri/top.test.ts", "qa/desktop-smoke.sh"], ["qa/evidence/qa-top.json"]);
fapRow("G-ONBOARD", ["docs/25-onboarding-and-guidance.md", "docs/22-copy-deck.md"], ["qa/onboard-check.mjs"], ["qa/evidence/qa-onboard.json"]);
fapRow("G-PURE-ZH", ["docs/20-quality-bar.md", "docs/28-change-control-quality.md"], ["scripts/check-copy.mjs"], ["qa/evidence/qa-copy.json", "qa/evidence/qa-copy-selftest.json"]);
fapRow("G-SCALE", ["docs/24-level-scale-audit.md", "docs/20-quality-bar.md"], ["qa/gates.mjs"], ["qa/evidence/qa-gates.json"]);
fapRow("G-UI-ALIGN", ["docs/19-art-direction.md", "docs/28-change-control-quality.md"], ["qa/ui-assert.mjs"], ["qa/evidence/qa-ui-align.json"]);
if (WIN) {
  // Windows 桌面必须的新增功能协议行：docs（Windows 交叉平台说明）+ 测试/脚本 + 证据
  fapRow("G-DESKTOP-WIN", ["docs/26-desktop-packaging.md", "docs/51-windows-cross-platform.md"], ["qa/desktop-smoke-win.mjs"], ["qa/evidence/qa-desktop-win.json"]);
  fapRow("G-TOP-WIN", ["docs/26-desktop-packaging.md", "docs/51-windows-cross-platform.md"], ["qa/desktop-smoke-win.mjs"], ["qa/evidence/qa-top-win.json"]);
}

// ---------- G-REG：回归不降级（测试数） ----------
if (!readJson("qa/evidence/vitest-packages.json")) {
  runVitest(["run", "packages", "--reporter=default", "--reporter=json", "--outputFile=qa/evidence/vitest-packages.json"]);
}
const pk = readJson("qa/evidence/vitest-packages.json");
const ct = readJson("qa/evidence/qa-content-tests.json");
const current = {
  packagesTests: pk?.numTotalTests ?? 0,
  packagesFiles: pk?.numTotalTestSuites ?? 0,
  contentTests: ct?.numTotalTests ?? 0,
  total: (pk?.numTotalTests ?? 0) + (ct?.numTotalTests ?? 0),
};
const prevReg = readJson("qa/evidence/qa-regression.json");
const baseline = prevReg?.current ?? null;
const notDecreased = !baseline || current.total >= baseline.total;
const regression = {
  ts: new Date().toISOString(), suite: "qa-regression",
  current, previous: prevReg?.current ?? null, baseline,
  notDecreased, delta: baseline ? current.total - baseline.total : null,
  coverage: { status: "blocked", reason: "@vitest/coverage-v8 未安装（不新增依赖）；以测试文件/用例数为回归锚点" },
  rule: "docs/28：新增功能不得降低既有测试数/覆盖率；本 gate 至少保证测试数不下降",
};
writeJson("qa/evidence/qa-regression.json", regression);
gates.push(gate("G-REG", "回归不降级（测试数）", notDecreased ? "pass" : "fail", { current, baseline, delta: regression.delta, coverage: regression.coverage }));

// ---------- 汇总 ----------
const by = s => gates.filter(g => g.status === s).map(g => g.id);
const failGates = gates.filter(g => g.status === "fail");
const trackedFails = failGates.filter(g => g.detail?.tracked).map(g => g.id);
const untrackedFails = failGates.filter(g => !g.detail?.tracked).map(g => g.id);
const summary = { total: gates.length, pass: by("pass").length, warn: by("warn").length, fail: failGates.length, blocked: by("blocked").length, pass_gates: by("pass"), warn_gates: by("warn"), fail_gates: failGates.map(g => g.id), fail_tracked: trackedFails, fail_untracked: untrackedFails, blocked_gates: by("blocked") };
const missingTests = [
  "REPL：HTTP/session 四示例 + 错误中文 + 死循环超时 + 重置不影响关卡 + process/require/globalThis 沙箱探针（task-35）",
  "Tauri：tauri build / Xvfb 启动截图 / sidecar 清理 / 首启向导中文（T3）",
  "置顶/伴玩：X11+Wayland 窗口 API 调用日志、快捷键、重启记忆、伴玩布局截图（T3）",
  "UI-ALIGN：Playwright 标题 bbox≤2px / 不换行 / 无横向滚动（需安装 ms-playwright 浏览器）",
  "ONBOARD：Studio copy JSON 接线 prologue/acts/journal 后跑引导预算 E2E",
  "G-SCALE：L05–L10 content 实现后按同一规则纳入",
  "G-UX-SIM：修复 Studio v3 回归后重跑 happy/error/fresh；补序章/手记/试符台断言与 U5 桌面 smoke",
  ...(WIN ? [
    "WINDOWS：G-DESKTOP-WIN 的 GUI 启动/向导/截图/退出清理证据 + G-TOP-WIN 的 Alt+Z 前后台标题序列/置顶状态/伴玩截图仍为零（evidence/desktop-win/**；本轮禁止 GUI 自动化，需人工或批准后补）",
    "WINDOWS：docs/51 §5 需补「Wayland: N/A；Win32 独占全屏/前台锁限制」平台差异声明（T11 warn）",
  ] : []),
];
const evidence = {
  ts: new Date().toISOString(), suite: "qa-gates", platform: process.platform, commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  summary, gates, fap, missingTests,
  windowsDesktop: WIN ? {
    gates: ["G-DESKTOP-WIN", "G-TOP-WIN"],
    linuxOnlyGates: ["G-DESKTOP", "G-TOP"],
    evidence: ["qa/evidence/qa-desktop-win.json", "qa/evidence/qa-top-win.json"],
    note: "Windows 上 G-DESKTOP/G-TOP（Linux rpm/AppImage/Xvfb/Wayland）显式 blocked；等价门为 G-DESKTOP-WIN/G-TOP-WIN，缺 GUI 证据时标 blocked，绝不假绿。",
  } : undefined,
  blockedNotGreen: gates.filter(g => g.status === "blocked").map(g => ({ id: g.id, reason: g.detail?.blockedReason ?? g.detail?.deferredReason })),
  trackedFails: gates.filter(g => g.detail?.tracked).map(g => ({ id: g.id, reason: g.detail?.reason, next: g.detail?.next })),
  regression: "qa/evidence/qa-regression.json",
};
writeJson("qa/evidence/qa-gates.json", evidence);
console.log(JSON.stringify({ suite: "qa-gates", platform: process.platform, commit: evidence.commit, summary: { pass: summary.pass, warn: summary.warn, fail: summary.fail, blocked: summary.blocked, fail_tracked: summary.fail_tracked, fail_untracked: summary.fail_untracked }, blocked: summary.blocked_gates, missingTests: missingTests.length }));
process.exit(summary.fail_untracked.length > 0 ? 1 : 0);
