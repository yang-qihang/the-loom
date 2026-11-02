// qa/desktop-smoke-win.mjs — Windows 桌面壳证据门（G-DESKTOP-WIN / G-TOP-WIN）。
//
// 定位：qa/desktop-smoke.mjs 的 Windows 等价物。Linux 版写死 rpm/AppImage/Xvfb/Wayland 证据，
// 在 Windows 上设计上不可能通过；本脚本只读校验 Windows 证据，**不启动 GUI、不创建窗口、
// 不抢焦点、不截图、不切虚拟桌面**（本轮验收明令禁止，见 tmp/audit/requirements-checklist.md W10/W11）。
//
// 输入（全部只读）：
//   - HEAD 构建产物：apps/desktop/src-tauri/target/release/loomcraft-desktop.exe
//     + target/release/bundle/nsis/Loomcraft_0.1.0_x64-setup.exe（sha256/size/mtime）
//   - 安装结果：%LOCALAPPDATA%\Loomcraft\{loomcraft-desktop.exe,uninstall.exe,runtime\real\...}
//     + HKCU 卸载键 + 包内 runtime 关键文件 hash/版本
//   - 打包 staged runtime：target/release/runtime/real（与安装 runtime 交叉校验）
//   - headless 证据：tmp/audit/packaged-e2e.json（task-3 的包内 runtime 全链路 e2e，若存在）
//   - GUI 证据：evidence/desktop-win/**、apps/desktop/EVIDENCE-WIN.md（当前为零 → 明确 blocked）
//   - 窗口证据：~/.loomcraft/logs/{lifecycle,shortcut}.log、settings.json、desktop.lock
//   - 代码存在性：apps/desktop/src-tauri/src/main.rs（Alt+Z / 置顶 / 伴玩 / 重启记忆 / Win32 focus / focus-follow）
//
// 输出：qa/evidence/qa-desktop-win.json、qa/evidence/qa-top-win.json。
// 状态：pass / warn / blocked / fail —— **缺证据 = blocked，绝不默认 pass**。
// exit code：0 pass、4 warn、3 blocked、1 fail。
// 用法：node qa/desktop-smoke-win.mjs [--gate desktop|top]（默认 both）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const WIN = process.platform === "win32";
const EV = path.join(ROOT, "qa/evidence");
fs.mkdirSync(EV, { recursive: true });

// ---------- 通用只读工具 ----------
const P = rel => path.join(ROOT, rel);
const existsRel = rel => fs.existsSync(P(rel));
// Windows 构建日志常为 PowerShell 输出的 UTF-16LE（带 BOM）；统一按 BOM 解码，避免跨编码读空。
const readText = rel => {
  try {
    const buf = fs.readFileSync(P(rel));
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
    return buf.toString("utf8");
  } catch { return ""; }
};
const readJsonRel = rel => { try { return JSON.parse(readText(rel)); } catch { return null; } };
const statRel = rel => { try { return fs.statSync(P(rel)); } catch { return null; } };
const sha256 = abs => { try { return createHash("sha256").update(fs.readFileSync(abs)).digest("hex"); } catch { return null; } };
const sizeOf = abs => { try { return fs.statSync(abs).size; } catch { return null; } };
const mtimeOf = abs => { try { return fs.statSync(abs).mtime.toISOString(); } catch { return null; } };
const relPath = abs => path.relative(ROOT, abs).split(path.sep).join("/");
const mib = bytes => (bytes == null ? null : `${(bytes / 1024 / 1024).toFixed(1)} MiB`);
const walkFiles = (dirAbs, filter, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walkFiles(abs, filter, out);
    else if (!filter || filter(abs)) out.push(abs);
  }
  return out;
};
const tryRun = (abs, args, timeout = 20000) => {
  try {
    const r = spawnSync(abs, args, { encoding: "utf8", timeout });
    return { status: r.status, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim(), error: r.error ? String(r.error.message ?? r.error) : null };
  } catch (err) { return { status: null, stdout: "", stderr: "", error: String(err?.message ?? err) }; }
};
const git = args => {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 20000 }).replace(/\r?\n$/, ""); } catch { return null; }
};
const afterHead = iso => {
  if (!iso || !HEAD.commitMs || Number.isNaN(HEAD.commitMs)) return null;
  return Date.parse(iso) > HEAD.commitMs;
};

// ---------- HEAD / 工作树 ----------
const dirty = (git(["status", "--porcelain"]) ?? "").split(/\r?\n/).filter(Boolean);
const HEAD = {
  full: git(["rev-parse", "HEAD"]),
  short: git(["rev-parse", "--short", "HEAD"]),
  commitTime: git(["show", "-s", "--format=%cI", "HEAD"]),
  commitMs: NaN,
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  workingTreeDirty: dirty.length > 0,
  dirtyCount: dirty.length,
  dirtyFiles: dirty.slice(0, 40),
};
HEAD.commitMs = HEAD.commitTime ? Date.parse(HEAD.commitTime) : NaN;

// ---------- 路径常量 ----------
const ARTIFACT = {
  nsisDir: "apps/desktop/src-tauri/target/release/bundle/nsis",
  releaseExe: "apps/desktop/src-tauri/target/release/loomcraft-desktop.exe",
  stagedRuntime: "apps/desktop/src-tauri/target/release/runtime/real",
  repoRuntime: "apps/desktop/src-tauri/runtime/real",
  buildLog: "tmp/audit-nsis.log",
};
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? os.homedir(), "AppData", "Local"), "Loomcraft");
const RUNTIME_REQUIRED = [
  "engine.mjs",
  "bot/manager.mjs",
  "node/bin/node.exe",
  "node_modules",
  "java/bin/java.exe",
  "paper/paper.jar",
  "paper/plugins/loomcraft-plugin.jar",
  "paper/world/.loom-world-version",
  "studio/index.html",
  "studio/companion.html",
];
const RUNTIME_HASH_FILES = ["engine.mjs", "paper/paper.jar", "paper/plugins/loomcraft-plugin.jar", "studio/index.html"];
const GUI_DIRS = ["evidence/desktop-win", "apps/desktop/evidence-win", "qa/evidence/desktop-win"];
const E2E_CANDIDATES = ["tmp/audit/packaged-e2e.json", "qa/evidence/packaged-e2e.json", "evidence/desktop-win/packaged-e2e.json"];
const MAIN_RS = "apps/desktop/src-tauri/src/main.rs";
const LOOM_DIR = path.join(process.env.USERPROFILE ?? os.homedir(), ".loomcraft");

// ---------- 证据采集（只读） ----------
// 1) NSIS 安装包（同目录取最新；不写死 version 号）
let nsis = null;
if (existsRel(ARTIFACT.nsisDir)) {
  const candidates = fs.readdirSync(P(ARTIFACT.nsisDir))
    .filter(f => /^Loomcraft_.*_x64-setup\.exe$/i.test(f))
    .map(f => { const abs = path.join(P(ARTIFACT.nsisDir), f); const st = fs.statSync(abs); return { file: f, abs, bytes: st.size, mtime: st.mtime.toISOString(), mtimeMs: st.mtimeMs }; })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates[0]) {
    const c = candidates[0];
    nsis = { path: relPath(c.abs), file: c.file, bytes: c.bytes, mib: mib(c.bytes), mtime: c.mtime, sha256: sha256(c.abs), afterHeadCommit: afterHead(c.mtime), allCandidates: candidates.map(x => ({ path: relPath(x.abs), bytes: x.bytes, mtime: x.mtime })) };
  }
}

// 2) release exe
const releaseExeAbs = P(ARTIFACT.releaseExe);
const releaseExe = fs.existsSync(releaseExeAbs)
  ? { path: ARTIFACT.releaseExe, bytes: sizeOf(releaseExeAbs), mib: mib(sizeOf(releaseExeAbs)), mtime: mtimeOf(releaseExeAbs), sha256: sha256(releaseExeAbs), afterHeadCommit: afterHead(mtimeOf(releaseExeAbs)) }
  : null;

// 3) 构建日志（支持性证据，不单独作为 pass 条件）
const buildLogText = readText(ARTIFACT.buildLog);
const bundlePathInLog = (buildLogText.match(/([A-Za-z]:\\[^\r\n]*?Loomcraft_[^\r\n]*?_x64-setup\.exe)/) ?? [])[1] ?? null;
const bundleMibInLog = (buildLogText.match(/\(([\d.]+)\s*\r?\n?\s*MiB\)/) ?? [])[1] ?? null;
const buildLog = {
  path: ARTIFACT.buildLog,
  exists: buildLogText.length > 0,
  bytes: sizeOf(P(ARTIFACT.buildLog)),
  mtime: mtimeOf(P(ARTIFACT.buildLog)),
  packageOk: /\[package\] OK/.test(buildLogText),
  exitZero: /exit=0/.test(buildLogText),
  bundlePathInLog,
  bundleMiBInLog: bundleMibInLog == null ? null : Number(bundleMibInLog),
  hasCommitField: /git rev-parse|HEAD=/.test(buildLogText),
};

// 4) 安装结果
const installedExeAbs = path.join(INSTALL_DIR, "loomcraft-desktop.exe");
const installRuntimeAbs = path.join(INSTALL_DIR, "runtime", "real");
const installedHash = sha256(installedExeAbs);
const installed = {
  dir: INSTALL_DIR,
  dirExists: fs.existsSync(INSTALL_DIR),
  exe: fs.existsSync(installedExeAbs) ? { path: installedExeAbs, bytes: sizeOf(installedExeAbs), mib: mib(sizeOf(installedExeAbs)), mtime: mtimeOf(installedExeAbs), sha256: installedHash } : null,
  uninstall: fs.existsSync(path.join(INSTALL_DIR, "uninstall.exe")) ? { path: path.join(INSTALL_DIR, "uninstall.exe"), bytes: sizeOf(path.join(INSTALL_DIR, "uninstall.exe")), mtime: mtimeOf(path.join(INSTALL_DIR, "uninstall.exe")) } : null,
  runtimeDir: installRuntimeAbs,
  runtimeDirExists: fs.existsSync(installRuntimeAbs),
};
const hashEqualsRelease = installed.exe?.sha256 && releaseExe?.sha256 ? installed.exe.sha256 === releaseExe.sha256 : null;

// 安装版 exe 内的 Win32 焦点切换导入符号（二进制只读证据；自动 pointer follow 已按 docs/45 移除）
const HEAD_ONLY_IMPORT_TOKENS = ["EnumWindows", "SetForegroundWindow", "AttachThreadInput", "keybd_event"];
let installedBinaryTokens = { checked: false, tokens: [], missing: HEAD_ONLY_IMPORT_TOKENS.slice(), source: null };
try {
  if (installed.exe) {
    const buf = fs.readFileSync(installedExeAbs);
    const found = HEAD_ONLY_IMPORT_TOKENS.filter(t => buf.includes(Buffer.from(t, "utf8")));
    installedBinaryTokens = { checked: true, tokens: found, missing: HEAD_ONLY_IMPORT_TOKENS.filter(t => !found.includes(t)), source: installedExeAbs };
  }
} catch (err) { installedBinaryTokens = { checked: false, tokens: [], missing: HEAD_ONLY_IMPORT_TOKENS.slice(), source: installedExeAbs, error: String(err?.message ?? err) }; }

// 5) 包内 runtime 布局 / hash / 版本
const runtimeFiles = RUNTIME_REQUIRED.map(rel => {
  const abs = path.join(installRuntimeAbs, rel);
  const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
  return { path: rel, exists: !!st, directory: st?.isDirectory() ?? false, bytes: st && !st.isDirectory() ? st.size : null };
});
const runtimeHashes = {};
for (const rel of RUNTIME_HASH_FILES) {
  const abs = path.join(installRuntimeAbs, rel);
  runtimeHashes[rel] = fs.existsSync(abs) ? sha256(abs) : null;
}
const nodeExeAbs = path.join(installRuntimeAbs, "node", "bin", "node.exe");
const javaExeAbs = path.join(installRuntimeAbs, "java", "bin", "java.exe");
const runtimeVersions = {
  node: fs.existsSync(nodeExeAbs) ? tryRun(nodeExeAbs, ["--version"]) : null,
  java: fs.existsSync(javaExeAbs) ? tryRun(javaExeAbs, ["-version"]) : null,
};
const worldVersionFile = path.join(installRuntimeAbs, "paper", "world", ".loom-world-version");
const worldVersionText = fs.existsSync(worldVersionFile) ? fs.readFileSync(worldVersionFile, "utf8").trim() : null;

// staged runtime 交叉校验（安装包由 target/release/runtime/real 组装）
const stagedRuntimeExists = existsRel(ARTIFACT.stagedRuntime);
const stagedHashes = {};
if (stagedRuntimeExists) {
  for (const rel of RUNTIME_HASH_FILES) {
    const abs = P(path.join(ARTIFACT.stagedRuntime, rel));
    stagedHashes[rel] = fs.existsSync(abs) ? sha256(abs) : null;
  }
}
const repoRuntimeExists = existsRel(ARTIFACT.repoRuntime);
const repoHashes = {};
if (repoRuntimeExists) {
  for (const rel of RUNTIME_HASH_FILES) {
    const abs = P(path.join(ARTIFACT.repoRuntime, rel));
    repoHashes[rel] = fs.existsSync(abs) ? sha256(abs) : null;
  }
}
const sameHashes = (a, b) => RUNTIME_HASH_FILES.every(rel => a[rel] && a[rel] === b[rel]);
const sameHashesDetail = (a, b) => RUNTIME_HASH_FILES.map(rel => ({ path: rel, installed: a[rel], staged: b[rel], equal: !!(a[rel] && a[rel] === b[rel]) }));

// HKCU 卸载键
let registry = { checked: false, ok: false, key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Loomcraft", values: {} };
if (WIN) {
  const r = tryRun("reg", ["query", registry.key], 15000);
  const stdout = r.stdout ?? "";
  const values = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(\w+)\s+REG_\w+\s+(.+?)\s*$/);
    if (m) values[m[1]] = m[2];
  }
  registry = { checked: true, ok: r.status === 0 && values.InstallLocation != null, key: registry.key, values, status: r.status, error: r.error };
}

// 6) headless e2e 证据（task-3；tmp/ 为本地临时证据，gitignored）
const e2eRel = E2E_CANDIDATES.find(existsRel) ?? null;
const e2eRaw = e2eRel ? readJsonRel(e2eRel) : null;
const beatIds = ids => ids.filter(id => String(id).startsWith("api.beat."));
let headless = null;
if (e2eRaw) {
  const checks = Array.isArray(e2eRaw.checks) ? e2eRaw.checks : [];
  const failed = Array.isArray(e2eRaw.failedChecks) ? e2eRaw.failedChecks : checks.filter(c => !c.ok).map(c => c.id);
  const chainFailed = failed.filter(id => !String(id).startsWith("api.beat."));
  const instHashes = {
    engineMjsSha256: runtimeHashes["engine.mjs"],
    paperJarSha256: runtimeHashes["paper/paper.jar"],
    pluginJarSha256: runtimeHashes["paper/plugins/loomcraft-plugin.jar"],
    studioIndexSha256: runtimeHashes["studio/index.html"],
  };
  const recorded = e2eRaw.runtime?.hashes ?? {};
  const hashPairs = Object.keys(instHashes).map(k => ({ key: k, installed: instHashes[k], recorded: recorded[k] ?? null, equal: !!(instHashes[k] && recorded[k] && instHashes[k] === recorded[k]) }));
  headless = {
    path: e2eRel,
    task: e2eRaw.task ?? null,
    runner: e2eRaw.runner ?? null,
    startedAt: e2eRaw.startedAt ?? null,
    finishedAt: e2eRaw.finishedAt ?? null,
    durationMs: e2eRaw.durationMs ?? null,
    ok: e2eRaw.ok === true,
    failedChecks: failed,
    chainFailed,
    beatFailed: beatIds(failed),
    headGit: e2eRaw.head?.gitHead ?? null,
    headMatches: (e2eRaw.head?.gitHead ?? null) === HEAD.full,
    headAfterCommit: afterHead(e2eRaw.finishedAt ?? e2eRaw.startedAt),
    runtimePath: e2eRaw.runtime?.path ?? null,
    runtimeSource: e2eRaw.runtime?.source ?? null,
    runtimeIsInstalled: (e2eRaw.runtime?.path ?? "") === installRuntimeAbs,
    headlessFlags: {
      noGuiAutomation: e2eRaw.headless?.noGuiAutomation === true,
      tauriShellLaunched: e2eRaw.headless?.tauriShellLaunched === true,
      screenCaptured: e2eRaw.headless?.screenCaptured === true,
      windowApiCalls: e2eRaw.headless?.windowApiCalls ?? null,
      desktopSwitchAttempted: e2eRaw.headless?.desktopSwitchAttempted === true,
      staticScanClean: e2eRaw.headless?.staticScan?.clean === true,
    },
    api: {
      health: e2eRaw.api?.health ? { ok: e2eRaw.api.health.ok === true, port: e2eRaw.api.health.port ?? null, mcConnected: e2eRaw.api.health.mc?.connected === true, botConnected: e2eRaw.api.health.bot?.connected === true, sessionId: e2eRaw.api.health.mc?.sessionId ?? null } : null,
      studio: e2eRaw.api?.studio ? { rootStatus: e2eRaw.api.studio.root?.status ?? null, indexStatus: e2eRaw.api.studio.index?.status ?? null, companionStatus: e2eRaw.api.studio.companion?.status ?? null } : null,
      session: e2eRaw.api?.session ? { status: e2eRaw.api.session.status ?? null, sessionId: e2eRaw.api.session.sessionId ?? null, state: e2eRaw.api.session.state ?? null, port: e2eRaw.api.session.port ?? null } : null,
      run: e2eRaw.api?.run ? { status: e2eRaw.api.run.status ?? null, runId: e2eRaw.api.run.runId ?? null, finishedState: e2eRaw.api.run.finishedState ?? null } : null,
      beat: e2eRaw.api?.beat ? { status: e2eRaw.api.beat.status ?? null, simulate: e2eRaw.api.beat.simulate === true, passed: e2eRaw.api.beat.result?.passed ?? null, stars: e2eRaw.api.beat.result?.stars ?? null } : null,
    },
    clean: e2eRaw.cleanup ? { portsReleased: e2eRaw.cleanup.portsReleased ?? null, tempRemoved: e2eRaw.cleanup.tempRemoved ?? null } : null,
    hashPairs,
    hashesMatchInstalled: hashPairs.every(x => x.equal),
  };
}

// 7) GUI 证据（本轮为零；禁止伪造，缺省 blocked）与 ~/.loomcraft 窗口证据
const guiDirs = GUI_DIRS.filter(existsRel);
const guiShots = guiDirs.flatMap(dir => walkFiles(P(dir), abs => /\.(png|jpe?g|webp)$/i.test(abs)))
  .map(abs => ({ path: relPath(abs), bytes: sizeOf(abs), mtime: mtimeOf(abs), afterHeadCommit: afterHead(mtimeOf(abs)) }))
  .sort((a, b) => String(a.path).localeCompare(String(b.path)));
const guiJson = guiDirs.flatMap(dir => walkFiles(P(dir), abs => /\.json$/i.test(abs)))
  .map(abs => ({ path: relPath(abs), bytes: sizeOf(abs), mtime: mtimeOf(abs), json: (() => { try { return JSON.parse(fs.readFileSync(abs, "utf8")); } catch { return null; } })() }));
const evidenceWinMdRel = ["apps/desktop/EVIDENCE-WIN.md", "evidence/desktop-win/EVIDENCE-WIN.md"].find(existsRel) ?? null;
const evidenceWinText = evidenceWinMdRel ? readText(evidenceWinMdRel) : "";
const guiEvidence = {
  dirs: guiDirs,
  evidenceMd: evidenceWinMdRel,
  screenshots: guiShots,
  screenshotCount: guiShots.length,
  jsonEvidenceCount: guiJson.length,
  freshScreenshots: guiShots.filter(s => s.afterHeadCommit === true).length,
  note: "Windows GUI 启动/向导/截图/焦点行为证据：本轮禁止 GUI 自动化，未生成任何截图/窗口日志；缺省一律 blocked，不得用 Linux Xvfb/Wayland 证据顶替。",
};

const loomLog = name => {
  const abs = path.join(LOOM_DIR, "logs", name);
  const text = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  return { path: abs, exists: text.length > 0, mtime: mtimeOf(abs), bytes: sizeOf(abs), afterHeadCommit: afterHead(mtimeOf(abs)), text };
};
const lifecycle = loomLog("lifecycle.log");
const shortcut = loomLog("shortcut.log");
const settingsPathAbs = path.join(LOOM_DIR, "settings.json");
const settingsJson = (() => { try { return JSON.parse(fs.readFileSync(settingsPathAbs, "utf8")); } catch { return null; } })();
const settings = {
  path: settingsPathAbs,
  exists: fs.existsSync(settingsPathAbs),
  mtime: mtimeOf(settingsPathAbs),
  afterHeadCommit: afterHead(mtimeOf(settingsPathAbs)),
  json: settingsJson,
};
const lockPathAbs = path.join(LOOM_DIR, "desktop.lock");
const lockContent = fs.existsSync(lockPathAbs) ? (() => { try { return fs.readFileSync(lockPathAbs, "utf8").trim(); } catch { return null; } })() : null;
const lock = { path: lockPathAbs, exists: fs.existsSync(lockPathAbs), content: lockContent };
let desktopRunning = { checked: false, running: false, note: "win32 only" };
if (WIN) {
  const r = tryRun("tasklist", ["/FI", "IMAGENAME eq loomcraft-desktop.exe", "/FO", "CSV", "/NH"], 15000);
  const stdout = (r.stdout ?? "").toLowerCase();
  desktopRunning = { checked: true, running: stdout.includes("loomcraft-desktop.exe"), status: r.status, note: "只读 tasklist；不代表 HEAD 启动证据" };
}
const windowEvidence = {
  loomDir: LOOM_DIR,
  lifecycle: { path: lifecycle.path, exists: lifecycle.exists, mtime: lifecycle.mtime, afterHeadCommit: lifecycle.afterHeadCommit, stopLines: (lifecycle.text.match(/停止子进程/g) ?? []).length, spawnLines: (lifecycle.text.match(/engine spawn/g) ?? []).length, lastLines: lifecycle.text.split(/\r?\n/).filter(Boolean).slice(-4) },
  shortcut: { path: shortcut.path, exists: shortcut.exists, mtime: shortcut.mtime, afterHeadCommit: shortcut.afterHeadCommit, hasAltZ: /Alt\+Z/.test(shortcut.text), hasCtrlShiftL: /Ctrl\+Shift\+L/.test(shortcut.text) },
  settings,
  desktopLock: lock,
  desktopRunning,
  note: "日志/settings 均为旧运行（10:07，早于 HEAD commit）痕迹，不能作为 HEAD GUI 行为证据；desktop.lock 残留说明上次为异常退出。",
};

// 8) 代码存在性（当前工作树；注意工作树可能有未提交改动）
const mainRsText = readText(MAIN_RS);
const mainRsLines = mainRsText.split(/\r?\n/);
const findMarkers = patterns => patterns.map(({ label, re }) => {
  const idx = mainRsLines.findIndex(line => re.test(line));
  return { label, present: idx >= 0, line: idx >= 0 ? idx + 1 : null };
});
const markerGroups = {
  altZ: findMarkers([
    { label: 'FOCUS_SHORTCUT 常量', re: /FOCUS_SHORTCUT/ },
    { label: '"Alt+Z" 定义', re: /"Alt\+Z"/ },
    { label: "Code::KeyZ 注册", re: /Code::KeyZ/ },
    { label: "focus_workbench()", re: /fn focus_workbench/ },
    { label: "focus_minecraft()", re: /fn focus_minecraft/ },
  ]),
  win32Focus: findMarkers([
    { label: "EnumWindows", re: /fn EnumWindows/ },
    { label: "SetForegroundWindow", re: /fn SetForegroundWindow/ },
    { label: "AttachThreadInput", re: /fn AttachThreadInput/ },
    { label: "keybd_event", re: /fn keybd_event/ },
    { label: "send_escape()", re: /fn send_escape/ },
    { label: "GetForegroundWindow", re: /fn GetForegroundWindow/ },
  ]),
  alwaysOnTop: findMarkers([
    { label: "set_always_on_top", re: /set_always_on_top/ },
    { label: "always_on_top 设置项", re: /always_on_top:\s*bool/ },
  ]),
  companion: findMarkers([
    { label: "COMPANION_WIDTH", re: /COMPANION_WIDTH/ },
    { label: "COMPANION_HEIGHT", re: /COMPANION_HEIGHT/ },
  ]),
  pinShortcut: findMarkers([
    { label: "PIN_SHORTCUT 常量", re: /PIN_SHORTCUT/ },
    { label: "Code::KeyL 注册", re: /Code::KeyL/ },
  ]),
  restartMemory: findMarkers([
    { label: "load_settings()", re: /fn load_settings/ },
    { label: "save_settings()", re: /fn save_settings/ },
    { label: "settings.window 几何持久化", re: /settings\.window/ },
    { label: "always_on_top 持久化", re: /stored\.always_on_top/ },
  ]),
  pointerFocusFollow: findMarkers([
    { label: "start_focus_follow()", re: /fn start_focus_follow/ },
    { label: "GetCursorPos", re: /GetCursorPos/ },
    { label: "140ms 轮询", re: /Duration::from_millis\(140\)/ },
  ]),
};
const groupState = group => ({ present: group.filter(x => x.present).length, total: group.length, missing: group.filter(x => !x.present).map(x => x.label), markers: group });
const codeEvidence = {
  file: MAIN_RS,
  exists: mainRsText.length > 0,
  lines: mainRsLines.length,
  sha256: sha256(P(MAIN_RS)),
  workingTreeDirty: HEAD.workingTreeDirty,
  groups: Object.fromEntries(Object.entries(markerGroups).map(([key, group]) => [key, groupState(group)])),
  installedBinaryTokens,
  note: "代码存在性只证明实现存在，不证明 Windows GUI 行为；工作树有未提交改动时不能把当前代码等同于 HEAD 安装包。",
};

// ---------- gate 构造 ----------
function makeGate(id, name) {
  const checks = [];
  const add = (cid, cname, status, detail = {}) => checks.push({ id: cid, name: cname, status, detail });
  const count = status => checks.filter(c => c.status === status).length;
  const finish = extra => {
    const fail = count("fail");
    const blocked = count("blocked");
    const warn = count("warn");
    const pass = count("pass");
    const status = fail ? "fail" : blocked ? "blocked" : warn ? "warn" : "pass";
    const attention = checks.filter(c => c.status === "fail" || c.status === "blocked").map(c => ({ id: c.id, name: c.name, status: c.status, reason: c.detail?.reason ?? null }));
    const blockedReason = attention.length
      ? `${id}: ${status.toUpperCase()}（${attention.map(c => `${c.id} ${c.name}${c.reason ? ` — ${c.reason}` : ""}`).join("；")}）`
      : null;
    const out = {
      ts: new Date().toISOString(),
      suite: "desktop-smoke-win",
      gate: id,
      name,
      status,
      platform: process.platform,
      head: HEAD,
      summary: { pass, warn, blocked, fail, total: checks.length },
      checks,
      blockedReason,
      attention,
      ...extra,
    };
    const file = id === "G-TOP-WIN" ? "qa/evidence/qa-top-win.json" : "qa/evidence/qa-desktop-win.json";
    fs.writeFileSync(P(file), JSON.stringify(out, null, 2) + "\n");
    return out;
  };
  add.finish = finish;
  add.checks = checks;
  return add;
}

// ---------- G-DESKTOP-WIN ----------
function buildDesktopGate() {
  const add = makeGate("G-DESKTOP-WIN", "Windows 桌面壳（NSIS 产物 + 静默安装 + 包内 runtime + headless e2e；GUI 证据缺省 blocked）");

  // D1 NSIS 安装包
  if (!nsis) {
    add("D1", "HEAD NSIS 安装包存在", "fail", { path: `apps/desktop/src-tauri/target/release/bundle/nsis/Loomcraft_0.1.0_x64-setup.exe`, reason: "bundle/nsis 下没有 Loomcraft_*_x64-setup.exe（HEAD 构建产物缺失）" });
  } else {
    add("D1", "HEAD NSIS 安装包存在且体积合理（>100 MiB）", "pass", { path: nsis.path, bytes: nsis.bytes, mib: nsis.mib, mtime: nsis.mtime, sha256: nsis.sha256, afterHeadCommit: nsis.afterHeadCommit });
    if (nsis.bytes < 100 * 1024 * 1024) add("D1-size", "安装包体积阈值（>100 MiB）", "warn", { bytes: nsis.bytes, expected: "~349 MiB", reason: "体积明显偏小，可能是空壳/未打入 runtime" });
  }

  // D2 sha256 记录 + 构建日志交叉
  if (!nsis) {
    add("D2", "sha256 记录与构建日志交叉校验", "blocked", { reason: "缺 NSIS 安装包" });
  } else if (buildLog.exists && buildLog.bundleMiBInLog != null && Math.abs((nsis.bytes / 1024 / 1024) - buildLog.bundleMiBInLog) <= 1) {
    add("D2", "sha256 记录 + 构建日志体积一致", "pass", { sha256: nsis.sha256, bundleMiBInLog: buildLog.bundleMiBInLog, actualMiB: Number((nsis.bytes / 1024 / 1024).toFixed(2)), packageOk: buildLog.packageOk, exitZero: buildLog.exitZero, log: ARTIFACT.buildLog, logHasCommitField: buildLog.hasCommitField, note: buildLog.hasCommitField ? null : "构建日志无 git rev-parse HEAD 字段 → 产物与 commit 的绑定靠安装 exe 二进制特征 + git 时间（E2 缺口）" });
  } else {
    add("D2", "sha256 记录 + 构建日志交叉校验", "warn", { sha256: nsis.sha256, reason: buildLog.exists ? `构建日志存在但未解析出 bundle 体积（${ARTIFACT.buildLog}）` : `构建日志缺失（${ARTIFACT.buildLog}）`, buildLog: buildLog.exists ? { bundleMiBInLog: buildLog.bundleMiBInLog, packageOk: buildLog.packageOk } : null });
  }

  // D3 release exe
  if (!releaseExe) {
    add("D3", "HEAD release exe 存在", "fail", { path: ARTIFACT.releaseExe, reason: "target/release/loomcraft-desktop.exe 缺失" });
  } else {
    const order = nsis && Date.parse(releaseExe.mtime) <= Date.parse(nsis.mtime) + 5 * 60 * 1000;
    add("D3", "HEAD release exe 存在且先于安装包", order ? "pass" : "warn", { path: releaseExe.path, bytes: releaseExe.bytes, mib: releaseExe.mib, mtime: releaseExe.mtime, sha256: releaseExe.sha256, bundleTypePatchedAfter: order });
  }

  // D3b 工作树脏 → release exe 可能来自未提交改动，不能与 HEAD 安装包混为一谈
  add("D3b", "工作树与 HEAD 一致（release exe 与 HEAD 同源性可判定）", HEAD.workingTreeDirty ? "warn" : "pass", {
    workingTreeDirty: HEAD.workingTreeDirty,
    dirtyCount: HEAD.dirtyCount,
    dirtyFiles: HEAD.dirtyFiles,
    reason: HEAD.workingTreeDirty
      ? `工作树有 ${HEAD.dirtyCount} 个未提交改动（并行任务，含 main.rs）；当前 target/release exe 可能是工作树重建，不能等同于 HEAD 497172d 产物；HEAD NSIS 安装包构建于 ${nsis?.mtime ?? "?"}（早于这些改动），安装内容同源判定只依赖 HEAD 独有二进制特征`
      : null,
  });

  // D4 安装目录
  if (!installed.dirExists) {
    add("D4", "%LOCALAPPDATA%\\Loomcraft 安装目录存在", "fail", { dir: INSTALL_DIR, reason: "安装目录不存在（NTFS/NSIS 静默安装结果缺失）" });
  } else if (!installed.exe) {
    add("D4", "%LOCALAPPDATA%\\Loomcraft 安装目录 + exe", "fail", { dir: INSTALL_DIR, reason: "安装目录存在但 loomcraft-desktop.exe 缺失" });
  } else {
    add("D4", "%LOCALAPPDATA%\\Loomcraft 安装目录 + exe + uninstall.exe", installed.uninstall ? "pass" : "warn", { dir: INSTALL_DIR, exe: { bytes: installed.exe.bytes, mib: installed.exe.mib, mtime: installed.exe.mtime, sha256: installed.exe.sha256 }, uninstall: installed.uninstall, runtimeDirExists: installed.runtimeDirExists });
  }

  // D5 安装内容与 HEAD 同源
  if (!installed.exe) {
    add("D5", "安装内容与 HEAD 同源", "blocked", { reason: "安装 exe 缺失" });
  } else if (hashEqualsRelease === true) {
    add("D5", "安装 exe sha256 == HEAD release exe sha256", "pass", { sha256: installed.exe.sha256, match: true });
  } else if (installedBinaryTokens.checked && installedBinaryTokens.missing.length === 0) {
    add("D5", "安装内容与 HEAD 同源（hash 不同但有 HEAD 独有 Win32 focus 导入符号）", "pass", {
      hashMatch: false,
      installedSha256: installed.exe.sha256,
      releaseSha256: releaseExe?.sha256 ?? null,
      headBinaryTokens: installedBinaryTokens.tokens,
      note: "Tauri bundle-type patch 会让安装后 exe 与当前 release exe hash 不同；以 HEAD 497172d 独有 Win32 导入符号 + gitHead 绑定判定同源（与 requirements-checklist E3 一致）",
    });
  } else {
    add("D5", "安装内容与 HEAD 同源", "warn", { hashMatch: false, installedSha256: installed.exe.sha256, releaseSha256: releaseExe?.sha256 ?? null, headBinaryTokens: installedBinaryTokens.tokens, missingTokens: installedBinaryTokens.missing, reason: "hash 与 release exe 不同，且未找到 HEAD 独有 Win32 导入符号；无法证明安装内容来自 HEAD" });
  }

  // D6 runtime 布局
  const missingRequired = runtimeFiles.filter(f => !f.exists);
  if (!installed.runtimeDirExists) {
    add("D6", "包内 runtime/real 布局完整", "fail", { runtimeDir: installRuntimeAbs, reason: "runtime/real 不存在" });
  } else if (missingRequired.length) {
    add("D6", "包内 runtime/real 布局完整", "fail", { runtimeDir: installRuntimeAbs, missing: missingRequired.map(f => f.path), files: runtimeFiles });
  } else {
    add("D6", "包内 runtime/real 布局完整（engine/bot/node/java/paper/plugin/world/studio）", "pass", { runtimeDir: installRuntimeAbs, files: runtimeFiles });
  }

  // D7 runtime 关键文件 hash 与 staged runtime 一致
  if (!installed.runtimeDirExists || !runtimeHashes["engine.mjs"]) {
    add("D7", "runtime 关键文件 hash 记录 + 与 staged runtime 一致", "blocked", { reason: "安装 runtime 缺失" });
  } else if (!stagedRuntimeExists) {
    add("D7", "runtime 关键文件 hash 记录 + 与 staged runtime 交叉", "warn", { runtimeHashes, stagedRuntime: ARTIFACT.stagedRuntime, repoRuntimeExists, reason: "target/release/runtime/real 不存在，无法交叉校验安装包 payload 与构建 staging 一致" });
  } else {
    const detail = sameHashesDetail(runtimeHashes, stagedHashes);
    add("D7", "runtime 关键文件 hash == staged runtime（安装包 payload 一致）", sameHashes(runtimeHashes, stagedHashes) ? "pass" : "fail", { runtimeHashes, stagedHashes, files: detail });
  }

  // D8 runtime 可执行版本
  const nodeOk = runtimeVersions.node?.status === 0 && /^v\d+/.test(runtimeVersions.node?.stdout ?? "");
  const javaOk = runtimeVersions.java?.status === 0 && /version/i.test((runtimeVersions.java?.stderr ?? "") + (runtimeVersions.java?.stdout ?? ""));
  if (!runtimeVersions.node && !runtimeVersions.java) {
    add("D8", "包内 node/java 可执行（版本探测）", "blocked", { reason: "runtime 缺失，无法探测版本" });
  } else {
    add("D8", "包内 node/java 可执行（只读版本探测）", nodeOk && javaOk ? "pass" : "warn", {
      node: runtimeVersions.node ? { status: runtimeVersions.node.status, version: (runtimeVersions.node.stdout || runtimeVersions.node.stderr || "").split(/\r?\n/)[0] } : null,
      java: runtimeVersions.java ? { status: runtimeVersions.java.status, version: (runtimeVersions.java.stderr || runtimeVersions.java.stdout || "").split(/\r?\n/)[0] } : null,
      worldVersion: worldVersionText,
    });
  }

  // D9 HKCU 卸载键
  if (!WIN) {
    add("D9", "HKCU 卸载键", "blocked", { reason: "非 win32" });
  } else if (!registry.checked) {
    add("D9", "HKCU 卸载键", "blocked", { reason: "reg.exe 不可用" });
  } else {
    add("D9", "HKCU 卸载键（Loomcraft 0.1.0，currentUser 安装）", registry.ok ? "pass" : "warn", { key: registry.key, values: registry.values, reason: registry.ok ? null : "未找到 HKCU\\...\\Uninstall\\Loomcraft 或 InstallLocation 为空" });
  }

  // D10 产物新鲜度（HEAD commit 之后构建）
  if (!nsis) {
    add("D10", "产物新鲜度（晚于 HEAD commit）", "blocked", { reason: "缺 NSIS 安装包" });
  } else {
    const fresh = nsis.afterHeadCommit === true && releaseExe?.afterHeadCommit === true;
    add("D10", "产物新鲜度（release exe/NSIS mtime 晚于 HEAD commit）", fresh ? "pass" : "warn", { headCommitTime: HEAD.commitTime, releaseExeMtime: releaseExe?.mtime ?? null, nsisMtime: nsis.mtime, head: HEAD.short });
  }

  // D11 headless e2e 证据存在
  if (!headless) {
    add("D11", "包内 runtime headless e2e 证据存在", "blocked", { candidates: E2E_CANDIDATES, reason: "缺 tmp/audit/packaged-e2e.json（W8 链未验证；task-3 证据未产出）" });
  } else {
    add("D11", "包内 runtime headless e2e 证据存在", "pass", { path: headless.path, task: headless.task, durationMs: headless.durationMs, finishedAt: headless.finishedAt });
  }

  // D12 headless 证据绑定 HEAD + 新鲜
  if (!headless) {
    add("D12", "headless 证据绑定当前 HEAD 且新鲜", "blocked", { reason: "缺 headless e2e 证据" });
  } else {
    const ok = headless.headMatches && headless.headAfterCommit === true;
    add("D12", "headless 证据绑定当前 HEAD 且新鲜", ok ? "pass" : "warn", { headGit: headless.headGit, currentHead: HEAD.full, headMatches: headless.headMatches, afterHeadCommit: headless.headAfterCommit, finishedAt: headless.finishedAt, reason: ok ? null : "证据 gitHead 不是当前 HEAD 或早于 HEAD commit（过期证据不能当 HEAD 通过）" });
  }

  // D13 headless 链路健康（paper/engine/health/studio/session/run；beat 属于内容评分，单独看）
  if (!headless) {
    add("D13", "包内 runtime 链路健康（health/studio/session/run）", "blocked", { reason: "缺 headless e2e 证据" });
  } else {
    const a = headless.api;
    const chainOk = headless.chainFailed.length === 0
      && a.health?.ok === true && a.health?.mcConnected === true && a.health?.botConnected === true
      && a.studio?.rootStatus === 200 && a.studio?.indexStatus === 200 && a.studio?.companionStatus === 200
      && a.session?.status === 201 && (a.run?.status === 202);
    if (chainOk) {
      add("D13", "包内 runtime 链路健康（health/studio/session/run）", "pass", { api: a, chainFailed: headless.chainFailed });
    } else {
      add("D13", "包内 runtime 链路健康（health/studio/session/run）", "fail", { api: a, chainFailed: headless.chainFailed, failedChecks: headless.failedChecks, reason: "包内 paper/engine/bot 链路失败（桌面壳 runtime 问题，不是内容评分问题）" });
    }
  }

  // D14 headless e2e 全绿判定（beat/hidden 属于内容评分，失败归 warn + 归因 task-5，不冒充桌面壳 fail）
  if (!headless) {
    add("D14", "headless e2e 全绿（含 L01 3 星/player-beat）", "blocked", { reason: "缺 headless e2e 证据" });
  } else if (headless.ok) {
    add("D14", "headless e2e 全绿（含 L01 3 星/player-beat）", "pass", { failedChecks: [], beat: headless.api.beat });
  } else {
    add("D14", "headless e2e 全绿（含 L01 3 星/player-beat）", "warn", { failedChecks: headless.failedChecks, beatFailed: headless.beatFailed, beat: headless.api.beat, reason: "e2e 未全绿；若失败仅限 api.beat.*（内容评分/hidden test），归因给内容 e2e 审计而非桌面壳 runtime" });
  }

  // D15 headless 无 GUI 自动化（禁止项静态自检）
  if (!headless) {
    add("D15", "headless e2e 无 GUI 自动化（noGuiAutomation/无截图/静态扫描 clean）", "blocked", { reason: "缺 headless e2e 证据" });
  } else {
    const f = headless.headlessFlags;
    const violation = f.tauriShellLaunched || f.screenCaptured || f.desktopSwitchAttempted || (typeof f.windowApiCalls === "number" && f.windowApiCalls > 0) || f.staticScanClean === false;
    const fullyDeclared = f.noGuiAutomation === true && f.windowApiCalls != null && f.staticScanClean === true;
    add("D15", "headless e2e 无 GUI 自动化（noGuiAutomation/无截图/静态扫描 clean）", violation ? "fail" : fullyDeclared ? "pass" : "warn", { ...f, reason: violation ? "headless e2e 触发 GUI/窗口/截图禁止项" : fullyDeclared ? null : "证据未完整声明 headless 标志" });
  }

  // D16 headless e2e 使用的 runtime hash == 安装 runtime hash
  if (!headless) {
    add("D16", "headless e2e runtime 4 关键 hash == 安装 runtime hash", "blocked", { reason: "缺 headless e2e 证据" });
  } else if (headless.hashesMatchInstalled) {
    add("D16", "headless e2e runtime 4 关键 hash == 安装 runtime hash", "pass", { runtimePath: headless.runtimePath, runtimeSource: headless.runtimeSource, hashes: headless.hashPairs });
  } else {
    add("D16", "headless e2e runtime 4 关键 hash == 安装 runtime hash", "warn", { runtimePath: headless.runtimePath, hashes: headless.hashPairs, reason: "e2e 用的 runtime 关键文件 hash 与安装目录不一致，证据不能代表安装版" });
  }
  // D16b headless e2e 是否直接使用安装目录 runtime（内容 hash 一致但路径不同 → 部分可代表）
  if (!headless) {
    add("D16b", "headless e2e 直接使用安装目录 runtime", "blocked", { reason: "缺 headless e2e 证据" });
  } else {
    add("D16b", "headless e2e 直接使用安装目录 runtime", headless.runtimeIsInstalled ? "pass" : "warn", {
      runtimePath: headless.runtimePath,
      installedRuntime: installRuntimeAbs,
      runtimeSource: headless.runtimeSource,
      reason: headless.runtimeIsInstalled ? null : "e2e 用的是 repo/override runtime，不是 %LOCALAPPDATA% 安装目录；4 个关键 hash 与安装版一致可作为内容等价的部分证据（与 E4 记录一致），但不能声称「在安装目录实测」",
    });
  }

  // D17 GUI 启动/无浏览器/标题证据（缺省 blocked）
  const guiTextOk = !!evidenceWinMdRel && ["tauri", "NSIS", "启动", "织界", "截图", "清理"].every(k => evidenceWinText.includes(k));
  if (guiShots.length === 0 && !evidenceWinMdRel) {
    add("D17", "GUI 启动/无浏览器/窗口标题「织界」证据", "blocked", { reason: "零 GUI 证据（本轮禁止 GUI 自动化；需人工/批准后补 evidence/desktop-win/ 截图 + EVIDENCE-WIN.md）", guiDirs: GUI_DIRS });
  } else {
    add("D17", "GUI 启动/无浏览器/窗口标题「织界」证据", guiTextOk && guiShots.length >= 1 ? "pass" : "warn", { guiTextOk, evidenceMd: evidenceWinMdRel, screenshots: guiShots.length, hint: "需含 tauri/NSIS/启动/织界/截图/清理 标记 + ≥1 张启动截图" });
  }

  // D18 首启向导中文截图
  const wizardOk = /向导|wizard/i.test(evidenceWinText) && guiShots.length >= 1;
  add("D18", "首启向导中文证据（截图 + 文案）", wizardOk ? "pass" : "blocked", { reason: wizardOk ? null : "缺 Windows 首启向导截图/中文文案证据", hasWizardText: /向导|wizard/i.test(evidenceWinText), screenshots: guiShots.length });

  // D19 GUI 截图数量（向导/地图墙/工作台）
  if (guiShots.length === 0) {
    add("D19", "Windows GUI 截图（向导/地图墙/工作台 ≥2 张）", "blocked", { reason: "0 张 Windows 截图；Linux apps/studio/evidence/*.png 与 Xvfb 截图不能顶替 Windows 桌面壳证据" });
  } else if (guiShots.length < 2) {
    add("D19", "Windows GUI 截图（向导/地图墙/工作台 ≥2 张）", "warn", { screenshots: guiShots });
  } else {
    add("D19", "Windows GUI 截图（向导/地图墙/工作台 ≥2 张）", "pass", { screenshots: guiShots });
  }

  // D20 sidecar 退出清理证据
  if (lifecycle.afterHeadCommit === null) {
    add("D20", "sidecar 退出清理证据（clean close）", "blocked", { reason: "无法比较 HEAD commit 时间" });
  } else if (lifecycle.afterHeadCommit !== true) {
    add("D20", "sidecar 退出清理证据（clean close）", "blocked", {
      reason: `lifecycle.log 早于 HEAD commit（${lifecycle.mtime} < ${HEAD.commitTime}）→ 旧安装运行痕迹，不能作为 HEAD 清理证据`,
      lifecycleMtime: lifecycle.mtime,
      stopLines: windowEvidence.lifecycle.stopLines,
      desktopLockResidual: lock.exists,
      desktopLockContent: lock.content,
      desktopRunning: desktopRunning.running,
      note: "旧运行 lifecycle 无「停止子进程」行且 desktop.lock 残留 → 历史异常退出未清理；HEAD 正常关闭路径未验证",
    });
  } else if (windowEvidence.lifecycle.stopLines > 0 && !lock.exists && !desktopRunning.running) {
    add("D20", "sidecar 退出清理证据（clean close）", "pass", { lifecycleMtime: lifecycle.mtime, stopLines: windowEvidence.lifecycle.stopLines, desktopLockResidual: lock.exists, desktopRunning: desktopRunning.running });
  } else {
    add("D20", "sidecar 退出清理证据（clean close）", "fail", { lifecycleMtime: lifecycle.mtime, stopLines: windowEvidence.lifecycle.stopLines, desktopLockResidual: lock.exists, desktopRunning: desktopRunning.running, reason: "HEAD 之后有运行日志，但缺少「停止子进程」行 / desktop.lock 未删 / 进程仍残留" });
  }

  return add.finish({
    evidence: {
      nsis,
      releaseExe,
      buildLog,
      installed,
      runtime: { dir: installRuntimeAbs, files: runtimeFiles, hashes: runtimeHashes, versions: runtimeVersions, worldVersion: worldVersionText, stagedRuntimeExists, stagedHashes, repoRuntimeExists, repoHashes, sameAsStaged: stagedRuntimeExists ? sameHashes(runtimeHashes, stagedHashes) : null },
      registry,
      headless,
      guiEvidence,
      windowEvidence,
      codePresence: { file: MAIN_RS, exists: codeEvidence.exists, altZ: codeEvidence.groups.altZ, win32Focus: codeEvidence.groups.win32Focus, installedBinaryTokens },
    },
    notes: [
      "G-DESKTOP-WIN 只读校验证据，不启动 GUI/窗口，不抢焦点，不截图；GUI 行为缺证据时按 blocked 处理，不假绿。",
      "Linux 的 qa/evidence/qa-desktop.json（rpm/AppImage/Xvfb/Wayland）不适用于 Windows；本 gate 不读取它。",
      "工作树若有未提交改动（其他任务），当前源码不能等同于 HEAD 安装包；产物同源判定以 gitHead + 安装 exe 二进制特征为准。",
      "静态检查清单：NSIS 产物/安装目录/runtime 布局/headless e2e。GUI 启动/向导/截图/退出清理需人工或批准后的 GUI 自动化补证据（目前为零）。",
    ],
  });
}

// ---------- G-TOP-WIN ----------
function buildTopGate() {
  const add = makeGate("G-TOP-WIN", "Windows 置顶/伴玩/Alt+Z/focus-follow（代码存在性 + 行为证据缺省 blocked）");
  const g = codeEvidence.groups;
  const grp = key => ({ present: g[key].present, total: g[key].total, missing: g[key].missing, markers: g[key].markers });

  // T1 main.rs 存在
  if (!codeEvidence.exists) {
    add("T1", "桌面壳源码存在（main.rs）", "fail", { file: MAIN_RS, reason: "apps/desktop/src-tauri/src/main.rs 缺失" });
  } else {
    add("T1", "桌面壳源码存在（main.rs）", "pass", { file: MAIN_RS, lines: codeEvidence.lines, sha256: codeEvidence.sha256, workingTreeDirty: codeEvidence.workingTreeDirty });
  }

  // T2 Alt+Z 全局快捷键代码
  const altZ = grp("altZ");
  add("T2", "Alt+Z 焦点切换代码存在（FOCUS_SHORTCUT/Code::KeyZ/focus_workbench/focus_minecraft）", altZ.present === altZ.total ? "pass" : "fail", { ...altZ, note: "代码存在 ≠ 快捷键在真实桌面生效" });

  // T3 Win32 前台切换代码
  const win32 = grp("win32Focus");
  add("T3", "Win32 前台切换代码存在（EnumWindows/SetForegroundWindow/AttachThreadInput/keybd_event/send_escape）", win32.present === win32.total ? "pass" : "fail", { ...win32 });

  // T4 置顶代码
  const aot = grp("alwaysOnTop");
  add("T4", "置顶代码存在（set_always_on_top + always_on_top 设置）", aot.present === aot.total ? "pass" : "fail", { ...aot });

  // T5 伴玩布局代码
  const companion = grp("companion");
  add("T5", "伴玩 420×620 布局代码存在（COMPANION_WIDTH/HEIGHT）", companion.present === companion.total ? "pass" : "fail", { ...companion });

  // T6 Ctrl+Shift+L 代码
  const pin = grp("pinShortcut");
  add("T6", "Ctrl+Shift+L 全局快捷键代码存在（PIN_SHORTCUT/Code::KeyL）", pin.present === pin.total ? "pass" : "fail", { ...pin });

  // T7 重启记忆代码
  const memory = grp("restartMemory");
  add("T7", "重启记忆/窗口几何持久化代码存在（load_settings/save_settings/settings.window）", memory.present === memory.total ? "pass" : "fail", { ...memory });

  // T8 自动焦点跟随：docs/45 决策为「不做自动焦点切换」；Windows 仅保留 Alt+Z 显式切换。
  const follow = grp("pointerFocusFollow");
  const autoFollowRemoved = !/GetCursorPos/.test(mainRsText) && !/start_focus_follow\(app\.handle/.test(mainRsText);
  if (autoFollowRemoved) {
    add("T8", "自动焦点跟随按 docs/45 禁用（Alt+Z 显式切换保留）", "pass", { ...follow, note: "docs/45 决策：不做自动焦点切换；Windows 仅保留 Alt+Z 显式切换，未启动指针跟随线程" });
  } else {
    add("T8", "自动焦点跟随代码存在", "warn", { ...follow, reason: "检测到自动焦点跟随代码，但 docs/45 决策为不做自动切换；需 Lead 定性" });
  }

  // T9 安装版 exe 含 HEAD Win32 导入符号（产物来自 HEAD 代码的二进制证据）
  if (!installed.exe) {
    add("T9", "安装版 exe 含 HEAD Win32 focus 导入符号", "blocked", { reason: "安装 exe 缺失" });
  } else {
    const tokens = installedBinaryTokens;
    add("T9", "安装版 exe 含 Win32 焦点切换导入符号（EnumWindows/SetForegroundWindow/AttachThreadInput/keybd_event）", tokens.checked && tokens.missing.length === 0 ? "pass" : "warn", { tokens: tokens.tokens, missing: tokens.missing, installedExeSha256: installed.exe.sha256, reason: tokens.checked && tokens.missing.length === 0 ? null : "未找到全部 Win32 焦点切换导入符号；无法证明安装 exe 来自当前代码" });
  }

  // T10 GUI 行为证据（Alt+Z 前后台标题序列 / 置顶状态 / 快捷键日志 / 截图）
  const topEvidenceJson = guiJson.filter(x => /top|title|focus|window/i.test(x.path) || /序号|foreground|title/i.test(JSON.stringify(x.json ?? "")));
  const freshShortcut = shortcut.afterHeadCommit === true && /Alt\+Z/.test(shortcut.text);
  const topShots = guiShots.filter(s => /top|companion|wayland|window|focus/i.test(s.path));
  if (guiShots.length === 0 && guiJson.length === 0 && !freshShortcut) {
    add("T10", "Windows GUI 行为证据（Alt+Z 前后台标题序列/置顶状态/快捷键日志/伴玩截图）", "blocked", {
      reason: "无 Windows GUI/窗口行为证据；本轮禁止 GUI 自动化/抢焦点，无法验证 Alt+Z 真实生效、置顶变化、伴玩布局、重启记忆",
      shortcutLog: { path: shortcut.path, exists: shortcut.exists, mtime: shortcut.mtime, afterHeadCommit: shortcut.afterHeadCommit, hasAltZ: shortcut.hasAltZ, hasCtrlShiftL: shortcut.hasCtrlShiftL },
      settings: { path: settings.path, exists: settings.exists, mtime: settings.mtime, afterHeadCommit: settings.afterHeadCommit, alwaysOnTop: settings.json?.alwaysOnTop ?? null, focusFollow: settings.json?.focusFollow ?? null, mode: settings.json?.mode ?? null, page: settings.json?.page ?? null },
      desktopLockResidual: lock.exists,
      desktopRunning: desktopRunning.running,
      guiDirs: GUI_DIRS,
      note: "旧运行（10:07，早于 HEAD commit）的 shortcut.log 曾记录 Alt+Z/Ctrl+Shift+L 注册成功，但那是旧安装包 + 旧 exe，不能作为 HEAD GUI 行为证据。",
    });
  } else {
    const ok = topEvidenceJson.length > 0 && freshShortcut && topShots.length >= 1;
    add("T10", "Windows GUI 行为证据（Alt+Z 前后台标题序列/置顶状态/快捷键日志/伴玩截图）", ok ? "pass" : "warn", { probeJson: topEvidenceJson.map(x => x.path), freshShortcut, screenshots: topShots.map(s => s.path), reason: ok ? null : "证据不完整：需 HEAD 之后的前后台标题序列 JSON + 新鲜 shortcut.log + 伴玩/置顶截图" });
  }

  // T11 平台差异声明（Wayland N/A / Win32 前台锁限制）
  const crossDoc = readText("docs/51-windows-cross-platform.md");
  const hasWindows = /Windows/.test(crossDoc);
  const hasWaylandOrX11 = /Wayland|X11/.test(crossDoc);
  add("T11", "平台差异声明（Windows 无 Wayland/X11；Wayland: N/A + Win32 前台锁限制）", hasWindows && hasWaylandOrX11 ? "pass" : "warn", {
    doc: "docs/51-windows-cross-platform.md",
    hasWindowsSection: hasWindows,
    hasWaylandOrX11Note: hasWaylandOrX11,
    reason: hasWindows && hasWaylandOrX11 ? null : "docs/51 §5 未写明「Wayland: N/A；Win32 独占全屏/前台锁限制」；Linux 要求的「X11 与 Wayland 各一次」在 Windows 不适用，需文档声明（Lead/docs 任务）",
  });

  // T12 settings.json 快照（旧运行痕迹，仅记录不判绿）
  if (!settings.exists) {
    add("T12", "settings.json 快照（置顶/伴玩/窗口持久化）", "warn", { reason: "~/.loomcraft/settings.json 不存在（HEAD 未启动过或已被清理）" });
  } else {
    add("T12", "settings.json 快照（置顶/伴玩/窗口持久化）", settings.afterHeadCommit === true ? "pass" : "warn", {
      mtime: settings.mtime,
      afterHeadCommit: settings.afterHeadCommit,
      keys: settings.json ? Object.keys(settings.json) : null,
      alwaysOnTop: settings.json?.alwaysOnTop ?? null,
      focusFollow: settings.json?.focusFollow ?? null,
      mode: settings.json?.mode ?? null,
      page: settings.json?.page ?? null,
      reason: settings.afterHeadCommit === true ? null : "settings.json 早于 HEAD commit（旧运行痕迹），不能作为 HEAD 重启记忆/置顶状态证据；当前 focusFollow=false/alwaysOnTop=false 来自旧默认",
    });
  }

  return add.finish({
    evidence: {
      codePresence: {
        file: MAIN_RS,
        exists: codeEvidence.exists,
        lines: codeEvidence.lines,
        sha256: codeEvidence.sha256,
        workingTreeDirty: codeEvidence.workingTreeDirty,
        markerGroups: g,
        installedBinaryTokens,
      },
      windowEvidence,
      guiEvidence,
      settingsSnapshot: settings,
      shortcutLog: { path: shortcut.path, mtime: shortcut.mtime, afterHeadCommit: shortcut.afterHeadCommit, hasAltZ: shortcut.hasAltZ, hasCtrlShiftL: shortcut.hasCtrlShiftL },
    },
    notes: [
      "G-TOP-WIN 在 Windows 用 Win32 窗口 API + 前台规则代替 X11/Wayland；「X11 与 Wayland 各一次」在 Windows 不适用，必须显式记录 Wayland: N/A。",
      "本 gate 只校验代码存在性 + 只读日志/截图证据；Alt+Z 真实切换、置顶状态、伴玩布局、重启记忆属于 GUI 行为，缺证据 = blocked，绝不假绿。",
      "Linux 的 qa/evidence/qa-top.json（X11/Wayland 证据）不能移植到 Windows；本 gate 不读取它。",
      "HEAD 497172d 的 Win32 pointer focus-follow 与 docs/45「不做自动焦点切换」存在决策冲突，需 Lead 定性；代码存在性单独记录，不作为行为通过证据。",
    ],
  });
}

// ---------- 主流程 ----------
const gateArgIdx = process.argv.indexOf("--gate");
const gateArg = gateArgIdx >= 0 ? process.argv[gateArgIdx + 1] : "both";
const wantDesktop = gateArg === "both" || gateArg === "desktop";
const wantTop = gateArg === "both" || gateArg === "top";
const unknown = gateArg !== "both" && gateArg !== "desktop" && gateArg !== "top";

const results = [];
if (!WIN) {
  // 非 Windows：明确 blocked，不伪造（该脚本只对 Windows 证据有意义）
  const blocked = {
    ts: new Date().toISOString(), suite: "desktop-smoke-win", platform: process.platform,
    status: "blocked", head: HEAD,
    blockedReason: "qa/desktop-smoke-win.mjs 仅在 win32 运行；Linux 请用 qa/desktop-smoke.mjs（rpm/AppImage/Xvfb/Wayland 证据）",
    checks: [], summary: { pass: 0, warn: 0, blocked: 1, fail: 0, total: 1 },
  };
  for (const [gate, file] of [["G-DESKTOP-WIN", "qa/evidence/qa-desktop-win.json"], ["G-TOP-WIN", "qa/evidence/qa-top-win.json"]]) {
    fs.writeFileSync(P(file), JSON.stringify({ ...blocked, gate }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ suite: "desktop-smoke-win", platform: process.platform, status: "blocked", reason: "win32 only" }));
  process.exit(3);
}

if (unknown) {
  console.error("用法：node qa/desktop-smoke-win.mjs [--gate desktop|top]（默认 both）");
  process.exit(2);
}
if (wantDesktop) results.push(buildDesktopGate());
if (wantTop) results.push(buildTopGate());

const rank = { pass: 0, warn: 1, blocked: 2, fail: 3 };
const worst = results.reduce((acc, r) => (rank[r.status] > rank[acc] ? r.status : acc), "pass");
const exitCode = worst === "pass" ? 0 : worst === "warn" ? 4 : worst === "blocked" ? 3 : 1;
for (const r of results) {
  console.log(JSON.stringify({ suite: "desktop-smoke-win", gate: r.gate, status: r.status, summary: r.summary, blockedReason: r.blockedReason }));
}
process.exit(exitCode);
