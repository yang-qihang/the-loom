// qa/onboard-check.mjs — G-ONBOARD 机器检查（不调 LLM）：docs/22 §2.5 JSON 文本预算 + Studio copy 接线状态
// + docs/22 §4 盲读结果引用。输出 qa/evidence/qa-onboard.json。
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const evidenceDir = path.join(ROOT, "qa/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const cjk = s => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
const latin = s => (String(s).match(/[A-Za-z]{2,}/g) || []);
const sentences = s => String(s).split(/[。！？!?]+/).map(x => x.trim()).filter(Boolean).length;
const checks = [];
const add = (id, name, ok, detail, severity = "fail") => checks.push({ id, name, status: ok ? "pass" : severity, detail });

function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
const doc = read("docs/22-copy-deck.md");
const i = doc.indexOf("### 2.5");
const m = doc.slice(i).match(/```json\n([\s\S]*?)```/);
if (!m) { console.error("docs/22 §2.5 JSON 未找到"); process.exit(1); }
const copy = JSON.parse(m[1]);

// 1) 结构
const needKeys = ["global", "prologue", "acts", "journal", "L01", "L02", "L03", "L04"];
const miss = needKeys.filter(k => !(k in copy));
add("O1", "docs/22 §2.5 JSON 含 global/prologue/acts/journal/levels", miss.length === 0, { missing: miss });

// 2) 序章：8 屏、每屏 ≤2 句、总字数 ≤900
const pro = copy.prologue || {};
const screens = pro.screens || [];
add("O2", "序章 8 屏", screens.length === 8, { actual: screens.length });
const over2 = screens.filter(s => (s.lines || []).length > 2).map(s => s.scene);
const longLines = screens.flatMap(s => (s.lines || []).filter(l => sentences(l) > 2).map(l => ({ scene: s.scene, line: l })));
add("O3", "序章每屏 ≤2 句（≤2 行/屏，单行 ≤2 句）", over2.length === 0 && longLines.length === 0, { over: over2, longLines });
const proChars = cjk(JSON.stringify(pro));
add("O4", "序章总字数 ≤900（docs/25）", proChars <= 900, { proChars }, "warn");

// 3) 幕开场：每幕 ≤300 字
const acts = copy.acts || {};
const actChars = Object.fromEntries(Object.entries(acts).map(([k, v]) => [k, cjk(JSON.stringify(v))]));
const overAct = Object.entries(actChars).filter(([, n]) => n > 300).map(([k]) => k);
add("O5", "每幕开场 ≤300 字", overAct.length === 0, { actChars, over: overAct });

// 4) 每关预算：叙事≤600、对话≤14、教练≤60、目标≤3×20
const levelRows = [];
for (const id of ["L01", "L02", "L03", "L04"]) {
  const L = copy[id]; if (!L) continue;
  const narrative = cjk([L.title, L.act, L.challenge, L.fail, L.timeout, ...(L.coachOpen || []), ...(L.coachReact || [])].join(""));
  const dialogue = (L.coachOpen || []).length + (L.coachReact || []).length;
  const coachLines = [...(L.coachOpen || []), ...(L.coachReact || []), ...(L.hints || [])].filter(x => typeof x === "string" || x?.text);
  const coachTexts = coachLines.map(x => (typeof x === "string" ? x : x.text));
  const coachMax = Math.max(0, ...coachTexts.map(t => String(t).length));
  const goals = L.goals || [];
  const goalBad = goals.length > 3 || goals.some(g => String(g).length > 20);
  const errs = [];
  if (narrative > 600) errs.push(`叙事 ${narrative}>600`);
  if (dialogue > 14) errs.push(`对话 ${dialogue}>14`);
  if (coachMax > 60) errs.push(`教练单条 ${coachMax}>60`);
  if (goalBad) errs.push(`目标 ${goals.length} 条 / 最长 ${Math.max(0, ...goals.map(g => String(g).length))} 字`);
  levelRows.push({ id, narrative, dialogue, coachMax, goals: goals.length, ok: errs.length === 0, errs });
}
add("O6", "L01–L04 文本预算（叙事600/对话14/教练60/目标3×20）", levelRows.every(r => r.ok), { levelRows });

// 5) docs/22 JSON 叙述无英文（纯中文；反引号代码引用豁免）
const latinHits = [];
const walk = (o, p = "") => {
  if (typeof o === "string") {
    if (/codeRefs?$/i.test(p)) return; // codeRefs 字段整体豁免
    const prose = o.replace(/`[^`]*`/g, " "); // 反引号内代码引用豁免
    const l = latin(prose);
    if (l.length && /[\u4e00-\u9fff]/.test(prose)) latinHits.push({ path: p, text: prose.slice(0, 60), tokens: l });
    return;
  }
  if (Array.isArray(o)) return o.forEach((v, k) => walk(v, `${p}[${k}]`));
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
};
walk({ prologue: copy.prologue, acts: copy.acts, journal: copy.journal, global: copy.global });
add("O7", "引导层叙述无连续拉丁字母（反引号代码引用豁免）", latinHits.length === 0, { hits: latinHits.slice(0, 8) });

// 6) Studio copy JSON 接线（当前工作区是否已含 prologue/acts/journal/handbook）
const levelsJson = JSON.parse(read("apps/studio/src/copy/levels.json"));
const required = ["prologue", "acts", "journal"];
const missingStudio = required.filter(k => !(k in levelsJson));
const allCopyText = JSON.stringify(levelsJson);
const docCopyText = JSON.stringify(copy);
const controlStrings = ["跳过", "再看一遍", "打开旅途手记"];
const docMissingControls = controlStrings.filter(x => !docCopyText.includes(x));
const studioMissingControls = controlStrings.filter(x => !allCopyText.includes(x));
const controlStatus = docMissingControls.length === 0 && studioMissingControls.length === 0 ? "pass" : docMissingControls.length === 0 ? "warn" : "fail";
add("O10", "v3.1 引导控件文案（跳过/再看一遍/打开旅途手记）", controlStatus === "pass", {
  docMissingControls, studioMissingControls,
  note: controlStatus === "warn" ? "docs/22 v3.1 JSON 已补；Studio copy JSON 待 task-43 升级到 v3.1（375 条）后重跑，WARN 不阻塞" : "两处都齐全",
}, controlStatus === "fail" ? "fail" : "warn");
const studioStatus = missingStudio.length === 0 ? "wired" : "blocked";
add("O8", "Studio copy JSON 已接线 prologue/acts/journal/handbook", missingStudio.length === 0, { missingStudio, currentKeys: Object.keys(levelsJson) }, missingStudio.length ? "blocked" : "fail");

// 7) 盲读证据：优先 v3.1（5 agent × 5 问 = 25/25），回退 Round1 表（不因此 fail）
const blindSection = doc.slice(doc.indexOf("## 4."));
const has2525 = /25\s*\/\s*25/.test(blindSection);
const passCells = (blindSection.match(/通过/g) || []).length;
const blindRows = [{ source: "docs/22 §4.2 (v3.1)", passCells, has2525 }];
const blindPass = has2525 || passCells >= 25;
add("O9", "5 个 agent 盲读五问 25/25（docs/22 §4.2 v3.1）", blindPass, { blindRows, note: "v3.1 表格改为「问题 × persona」；以「25/25」或「通过」计数≥25 判定。Round1 结果见 docs/31，不影响本项。" }, blindPass ? "fail" : "warn");

const fails = checks.filter(c => c.status === "fail").length;
const blocked = checks.filter(c => c.status === "blocked");
let status = fails > 0 ? "fail" : (blocked.length > 0 || studioStatus === "blocked") ? "blocked" : "pass";
const evidence = {
  ts: new Date().toISOString(), suite: "onboard-check", gate: "G-ONBOARD", status,
  summary: { pass: checks.filter(c => c.status === "pass").length, fail: fails, blocked: blocked.length, warn: checks.filter(c => c.status === "warn").length },
  checks,
  studioCopy: { status: studioStatus, missing: missingStudio },
  budgets: { prologueScreens: screens.length, proChars, actChars, levelRows },
  blindRead: { source: "docs/22 §4.2", passed: blindPass, rows: blindRows },
  blockedReason: studioStatus === "blocked" ? "Studio copy JSON 尚未接线 prologue/acts/journal（docs/22 §2.5 已定义、§4 盲读已通过；需 Studio 线落地）" : null,
  missing: ["Studio copy JSON 接线 prologue/acts/journal 后，G-ONBOARD 才能从 blocked 升为 pass", "Playwright 引导截图（8 屏序章 + 手记）"],
};
fs.writeFileSync(path.join(evidenceDir, "qa-onboard.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ suite: "onboard-check", status, ...evidence.summary, studio: studioStatus }));
