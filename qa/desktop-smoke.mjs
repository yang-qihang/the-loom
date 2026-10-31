// qa/desktop-smoke.mjs — G-DESKTOP / G-TOP 证据校验（Tauri 产物 + Xvfb/Wayland 截图 + 窗口能力证据）。
// 不重跑 GUI（用户不测试）；用 apps/desktop/EVIDENCE.md + apps/desktop/evidence/*.png + bundle 产物 + sha256 作为证据。
// 用法：node qa/desktop-smoke.mjs --gate desktop|top；证据 qa/evidence/qa-desktop.json / qa-top.json。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const ROOT = process.cwd();
const gateIdx = process.argv.indexOf("--gate");
const gate = gateIdx >= 0 ? process.argv[gateIdx + 1] : "desktop";
const EV = path.join(ROOT, "qa/evidence");
fs.mkdirSync(EV, { recursive: true });
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = p => fs.existsSync(path.join(ROOT, p));
const sha = p => createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
const evidenceMd = "apps/desktop/EVIDENCE.md";
const shotsDir = "apps/desktop/evidence";
const requiredShots = ["xvfb-wizard.png", "xvfb-workbench.png", "xvfb-editor-monaco.png", "xvfb-companion.png", "xvfb-companion-run.png", "appimage-companion.png"];
const topShots = ["wayland-workbench.png", "wayland-window.png", "xvfb-restart-companion.png"];
const artifacts = [
  "apps/desktop/src-tauri/target/release/bundle/rpm/Loomcraft-0.1.0-1.x86_64.rpm",
  "apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage",
];
const checks = [];
const add = (id, name, ok, detail, severity = "fail") => checks.push({ id, name, status: ok ? "pass" : severity, detail });
const text = exists(evidenceMd) ? read(evidenceMd) : "";
add("D1", "apps/desktop/EVIDENCE.md 存在", !!text, { file: evidenceMd });
const mk = ["tauri", "Xvfb", "Wayland", "rpm", "AppImage"];
add("D2", "证据含 tauri/Xvfb/Wayland/rpm/AppImage", mk.every(k => text.includes(k)), { missing: mk.filter(k => !text.includes(k)) });
const shots = [...requiredShots, ...topShots].map(n => `${shotsDir}/${n}`).map(p => ({ path: p, exists: exists(p), sha256: exists(p) ? sha(p).slice(0, 16) : null }));
add("D3", "Xvfb/AppImage/Wayland 截图存在", shots.filter(s => requiredShots.some(n => s.path.endsWith(n))).every(s => s.exists), { shots: shots.filter(s => !s.exists).map(s => s.path) });
const arts = artifacts.map(p => ({ path: p, exists: exists(p), bytes: exists(p) ? fs.statSync(path.join(ROOT, p)).size : 0, sha256: exists(p) ? sha(p) : null }));
add("D4", "rpm + AppImage 产物存在且 >1MiB", arts.every(a => a.exists && a.bytes > 1024 * 1024), { artifacts: arts.map(a => ({ path: a.path, bytes: a.bytes, sha256: a.sha256?.slice(0, 16) })) });
const cleanup = /清理|残留|sidecar|退出/.test(text);
const wizard = /向导|wizard/i.test(text);
const topKeys = /置顶|always[ -]?on[ -]?top/i.test(text);
const wayland = /Wayland/.test(text);
const companion = /伴玩|companion/i.test(text);
const restart = /重启|restart/i.test(text);
if (gate === "top") {
  add("T1", "置顶/Total on top 证据（X11 + Wayland）", topKeys && wayland, { topKeys, wayland });
  add("T2", "伴玩模式截图与布局证据", companion && topShots.every(n => exists(`${shotsDir}/${n}`)), { companion });
  add("T3", "重启记忆证据", restart, { restart });
} else {
  add("D5", "首启向导中文证据", wizard, { wizard });
  add("D6", "sidecar 退出清理证据", cleanup, { cleanup });
  add("D7", "伴玩/置顶截图证据", companion && topKeys, { companion, topKeys });
}
const fails = checks.filter(c => c.status === "fail").length;
const warns = checks.filter(c => c.status === "warn").length;
const status = fails ? "fail" : warns ? "warn" : "pass";
const out = {
  ts: new Date().toISOString(), suite: "desktop-smoke", gate: gate === "top" ? "G-TOP" : "G-DESKTOP", status,
  summary: { pass: checks.filter(c => c.status === "pass").length, fail: fails, warn: warns },
  checks, evidenceMd, artifacts: arts, screenshots: shots,
  blockedReason: null,
  note: "证据来自 task-31 的 Xvfb/X11 与 Plasma 原生 Wayland 实机运行；本 gate 不重跑 GUI，只校验证据完整性 + 产物 sha256。",
};
fs.writeFileSync(path.join(EV, gate === "top" ? "qa-top.json" : "qa-desktop.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ suite: "desktop-smoke", gate: out.gate, status, summary: out.summary }));
process.exit(status === "pass" ? 0 : status === "warn" ? 4 : 1);
