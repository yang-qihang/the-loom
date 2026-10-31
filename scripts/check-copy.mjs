// scripts/check-copy.mjs — 文案门禁（禁用词 + UI 纯中文）。
// 默认模式：docs/20 §2 禁用词扫描（报告型）。
// --pure-zh：docs/20 §3b 纯中文检测——扫描 Studio copy JSON、content UI 字段、level-spec 常量，
//            对叙述串里的连续拉丁字母（≥2）判定：合法代码引用（反引号/标识符/文件名/行号/CLI/占位符）
//            记豁免；Minecraft/TypeScript 需有中文解释；UI 英文标签（Run/Stop/Mock…）直接 FAIL。
// 用法（结构化读取 TS 常量需要 tsx）：
//   npx tsx scripts/check-copy.mjs --pure-zh --json qa/evidence/qa-copy.json
//   node scripts/check-copy.mjs --json qa/evidence/qa-copy.json        # 仅禁用词扫描
// 退出码：0=报告（默认）；--strict 且存在 UI FAIL / 纯中文违规 → 1。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const PURE_ZH = args.includes("--pure-zh");
const STRICT = args.includes("--strict");
const SELF_TEST = args.includes("--self-test");
const outFile = jsonIdx >= 0 ? args[jsonIdx + 1] : PURE_ZH ? "qa/evidence/qa-copy.json" : null;

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (exts.some(e => p.endsWith(e))) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}
function writeJson(file, data) {
  const abs = path.resolve(ROOT, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------- 一、禁用词（docs/20 §2） ----------------
function loadBannedWords() {
  const fallback = ["赋能", "闭环", "抓手", "生态位", "一站式", "助力", "打造", "极致", "深度", "颠覆", "革命性", "显著提升", "众所周知", "底层逻辑", "顶层设计", "全链路", "组合拳", "心智", "范式", "沉浸式", "丝滑", "惊艳"];
  try {
    const doc = read(path.join(ROOT, "docs/20-quality-bar.md"));
    const sec = doc.split("## 2.")[1]?.split("## 3.")[0] ?? "";
    const line = sec.split("\n").find(l => l.includes("赋能"));
    if (!line) return { words: fallback, source: "fallback" };
    const words = line.replace(/（[^）]*）/g, "").split("、").map(w => w.trim()).filter(w => w.length >= 2 && !w.startsWith("**"));
    return { words: words.length ? words : fallback, source: "docs/20 §2" };
  } catch {
    return { words: fallback, source: "fallback" };
  }
}
function scanMarkdown(text) {
  const lines = text.split("\n");
  const hits = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) inFence = !inFence;
    if (inFence) return;
    hits.push({ line: i + 1, text: line.replace(/`[^`]*`/g, "") });
  });
  return hits;
}
function extractStrings(text) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\]){0,400})\1/g;
  let m;
  while ((m = re.exec(text))) out.push({ line: text.slice(0, m.index).split("\n").length, text: m[2] });
  return out;
}
const { words: banned, source: bannedSource } = loadBannedWords();
const uiFiles = listFiles(path.join(ROOT, "apps/studio"), [".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css"]);
const contentTs = listFiles(path.join(ROOT, "content/levels"), [".content.ts"]);
const contentMd = listFiles(path.join(ROOT, "content/levels"), [".md"]);
const bannedHits = [];
function scanBanned(name, file, units, severity) {
  for (const unit of units) {
    for (const w of banned) {
      let idx = unit.text.indexOf(w);
      while (idx >= 0) {
        bannedHits.push({ scope: name, file: path.relative(ROOT, file), line: unit.line, word: w, severity, context: unit.text.slice(Math.max(0, idx - 12), idx + w.length + 12).trim() });
        idx = unit.text.indexOf(w, idx + w.length);
      }
    }
  }
}
for (const f of uiFiles) scanBanned("ui", f, extractStrings(read(f)), "FAIL");
for (const f of contentTs) scanBanned("content-ts", f, extractStrings(read(f)), "FAIL");
for (const f of contentMd) scanBanned("content-md", f, scanMarkdown(read(f)), "WARN");

// ---------------- 二、纯中文（docs/20 §3b） ----------------
const BANNED_UI_WORDS = new Map([
  ["Run", "运行"], ["Stop", "停止"], ["Reset", "重置"], ["Level", "关卡"],
  ["Objective", "目标"], ["Coach", "教练"], ["Result", "结果 / 结算"], ["Mock", "模拟"],
  ["Start", "开始"], ["Next", "下一步"],
]);
const LANGUAGE_KEYWORDS = new Set(["const", "let", "var", "while", "else", "if", "for", "switch", "case", "type", "interface", "function", "return", "await", "async", "class", "new", "import", "export", "break", "continue", "of", "in", "true", "false", "null", "undefined"]);
const KEY_NAMES = new Set(["Ctrl", "Alt", "Shift", "Tab", "Enter", "Esc", "Space", "Cmd", "Backspace"]);
const KEY_COMBO_RE = /(Ctrl|Alt|Shift|Cmd)\s*\+\s*(Enter|Esc|Tab|Space|[A-Z])/;
const PROPERS = new Set(["Minecraft", "TypeScript"]);
const BRAND_WORDS = new Set(["THE", "LOOM"]);
const API_WORDS = new Set([
  "golem", "world", "allay", "agent", "grader", "moveTo", "place", "say", "where", "pos", "count", "collect", "deposit",
  "ringBell", "placeTorch", "patrol", "plant", "harvest", "fill", "clear", "placeSign", "giveTool", "give", "assign",
  "release", "runTablet", "treatZombieVillager", "ringDawnBell", "keystone", "send", "receive", "tryReceive", "waitIdle",
  "machines", "lever", "supply", "container", "containers", "jobs", "caravan", "plot", "field", "scenario", "countEntities",
  "entities", "clock", "startBrewing", "hasItem", "brewStand", "items", "pipe", "map", "filter", "reduce", "take", "repeat", "when", "assert",
  "vars", "rows", "cols", "waterRow", "banked", "seeds", "planted", "block", "text", "passed", "total",
]);
const DATA_KEY_RE = /^(id|status|priority|act|order|minutes|levelId|kind|en|codeRefs?|.*Refs?)$/i;
const PROTECTED_PATTERNS = [
  { name: "backtick", re: /`[^`]*`/g },
  { name: "placeholder", re: /\{[^{}]*\}/g },
  { name: "filepath", re: /\b[\w.-]+\/[\w./:-]*\b/g },
  { name: "filename", re: /\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|md|sh|java|yml|yaml)\b/g },
  { name: "cli", re: /\b(?:npm|npx|node|bash|pnpm)\s+[\w:.-]+(?:\s+[\w:.-]+)*/g },
  { name: "tscode", re: /\bTS\d{4}\b/g },
  { name: "lineno", re: /第\s*\d+\s*行/g },
  { name: "quotedLiteral", re: /"[^"\n]{0,24}"|'[^'\n]{0,24}'/g },
  { name: "codeexpr", re: /\b\w+\s*(?:===|!==|==|=|\(|\+)\s*[^\s，。！？]*/g },
  { name: "codeoperand", re: /(?:[+\-*/<>]=?|&&|\|\|)\s*[A-Za-z_][\w.]*/g },
];
function hasChineseGloss(str, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${esc}\\s*[（(][^）)]*[\\u4e00-\\u9fff][^）)]*[）)]`).test(str)
    || new RegExp(`[\\u4e00-\\u9fff]{1,12}\\s*[（(]\\s*${esc}\\s*[）)]`).test(str)
    || new RegExp(`${esc}\\s*[：:]\\s*[\\u4e00-\\u9fff]`).test(str);
}
function classifyString(str) {
  let work = str;
  const exemptions = [];
  for (const p of PROTECTED_PATTERNS) {
    const found = work.match(p.re) ?? [];
    if (found.length) {
      const reason = p.name === "lineno" ? "行号" : p.name === "quotedLiteral" ? "代码字符串" : p.name === "codeexpr" ? "代码表达式" : p.name;
      exemptions.push(...found.map(t => ({ token: t.slice(0, 40), reason })));
      work = work.replace(p.re, " ");
    }
  }
  const tokens = [...work.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]);
  const violations = [];
  const warnings = [];
  const tokenExemptions = [];
  for (const token of new Set(tokens)) {
    if (KEY_NAMES.has(token)) { tokenExemptions.push({ token, reason: "按键名（docs/20 §3b 允许）" }); continue; }
    if (LANGUAGE_KEYWORDS.has(token)) { tokenExemptions.push({ token, reason: "语言关键字 / 代码引用" }); warnings.push({ token, reason: "叙述里含裸语言关键字（宜用反引号或换世界观说法）" }); continue; }
    if (API_WORDS.has(token)) { tokenExemptions.push({ token, reason: "API/代码标识符" }); warnings.push({ token, reason: "叙述里含裸 API 名（宜用反引号）" }); continue; }
    if (token.includes(".") || /^[a-z]+[A-Z]/.test(token)) { tokenExemptions.push({ token, reason: "代码标识符" }); continue; }
    if (BRAND_WORDS.has(token) && /[\u4e00-\u9fff]/.test(str)) { tokenExemptions.push({ token, reason: "品牌名（与中文「织界」并列）" }); continue; }
    if (BANNED_UI_WORDS.has(token)) {
      violations.push({ token, reason: "UI 标签使用英文（docs/20 §3b 禁止）", suggestion: `改为「${BANNED_UI_WORDS.get(token)}」` });
      continue;
    }
    if (PROPERS.has(token)) {
      if (hasChineseGloss(str, token)) tokenExemptions.push({ token, reason: "专有名词 + 中文解释" });
      else violations.push({ token, reason: "专有名词无中文解释", suggestion: token === "Minecraft" ? "改「我的世界」，首次出现写「我的世界（Minecraft）」" : "改「这门语言」，首次出现写「TypeScript（这门语言）」" });
      continue;
    }
    if (API_WORDS.has(token.toLowerCase())) { tokenExemptions.push({ token, reason: "API/代码引用（小写）" }); continue; }
    violations.push({ token, reason: "叙述串里出现连续拉丁字母（既非代码引用也非已解释专名）", suggestion: "删掉或改成中文动词/名词；必须引用接口时用反引号包起来（如 `golem.moveTo`）" });
  }
  const keyCombo = KEY_COMBO_RE.test(str);
  return { exemptions, tokenExemptions, violations, warnings, keyCombo };
}


// ---------------- 自检（--self-test）：给分类器固定用例，防规则回归 ----------------
function runSelfTest() {
  const cases = [
    { text: "按「运行」，看右侧目标有没有全部点亮。", expect: 0, why: "纯中文" },
    { text: "让灰崽走到 1 号灯下，再点亮它。", expect: 0, why: "纯中文叙述" },
    { text: "用 `golem.moveTo` 走到灯下。", expect: 0, why: "反引号代码引用豁免" },
    { text: "第 3 行少了一个右引号，把 \"lantern\" 补全。", expect: 0, why: "行号 + 代码字符串豁免" },
    { text: "我的世界（Minecraft）里有村庄。", expect: 0, why: "专有名词 + 中文解释" },
    { text: "用 closure 来建模。", expect: 1, why: "叙述夹英文术语" },
    { text: "点击 Run 运行程序。", expect: 1, why: "UI 英文标签 Run" },
    { text: "Mock 验收工具。", expect: 1, why: "UI 英文标签 Mock" },
    { text: "去 Minecraft 里右键。", expect: 1, why: "专有名词无中文解释" },
    { text: "键盘：Ctrl + Enter 运行。", expect: 1, why: "按键组合当文案主语" },
  ];
  const results = cases.map((c, i) => {
    const r = classifyString(c.text);
    const got = r.keyCombo ? 1 : r.violations.length;
    return { i: i + 1, text: c.text, expect: c.expect, got, status: got === c.expect ? "PASS" : "FAIL", why: c.why, violations: r.violations, warnings: r.warnings };
  });
  const failed = results.filter(r => r.status === "FAIL");
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeJson("qa/evidence/qa-copy-selftest.json", { ts: new Date().toISOString(), suite: "check-copy-selftest", ...summary });
  console.log(JSON.stringify({ suite: "check-copy-selftest", total: summary.total, passed: summary.passed, failed: summary.failed, evidence: "qa/evidence/qa-copy-selftest.json" }));
  process.exit(failed.length === 0 ? 0 : 1);
}
if (SELF_TEST) runSelfTest();

/** 在 git HEAD 的 copy 快照上跑分类器（证明检测器能抓到真实违规；不参与门禁）。 */
function proofOnHead() {
  const out = { available: false, ref: null, violations: 0, samples: [] };
  try {
    const files = ["apps/studio/src/copy/catalog.json", "apps/studio/src/copy/levels.json"];
    const refs = execFileSync("git", ["log", "--format=%h", "-n", "20"], { encoding: "utf8" }).trim().split("\n");
    let violations = [];
    for (const ref of refs) {
      violations = [];
      for (const f of files) {
      let raw;
      try { raw = execFileSync("git", ["show", `${ref}:${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { continue; }
      const obj = JSON.parse(raw);
      const localUnits = [];
      const push = (field, value) => { if (typeof value === "string" && /[A-Za-z]{2,}/.test(value)) localUnits.push({ file: f, field, value }); };
      const walk = (o, field = "") => {
        if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${field}[${i}]`)); return; }
        if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) { if (DATA_KEY_RE.test(k)) continue; walk(v, field ? `${field}.${k}` : k); } return; }
        push(field, o);
      };
      walk(obj);
      for (const u of localUnits) {
        const r = classifyString(u.value);
        const items = r.keyCombo ? [{ token: "(key-combo)", reason: "按键组合" }] : r.violations;
        for (const it of items) violations.push({ file: u.file, field: u.field, string: u.value, token: it.token, reason: it.reason });
      }
    }
      if (violations.length > 0) { out.ref = ref; break; }
    }
    out.available = true;
    out.violations = violations.length;
    out.strings = new Set(violations.map(v => `${v.file}::${v.field}`)).size;
    const byToken = new Map();
    for (const v of violations) byToken.set(v.token, (byToken.get(v.token) ?? 0) + 1);
    out.byToken = [...byToken.entries()].sort((a, b) => b[1] - a[1]).map(([token, count]) => ({ token, count }));
    out.samples = violations.slice(0, 8);
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

const units = [];
function pushUnit(file, field, value) {
  if (typeof value !== "string" || !value.trim()) return;
  if (!/[A-Za-z]{2,}/.test(value)) return; // 纯中文/无拉丁：不需要报
  units.push({ file, field, value });
}
function walkJson(obj, file, fieldPath = "") {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) { obj.forEach((v, i) => walkJson(v, file, `${fieldPath}[${i}]`)); return; }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = fieldPath ? `${fieldPath}.${k}` : k;
      if (DATA_KEY_RE.test(k)) continue;
      walkJson(v, file, p);
    }
    return;
  }
  if (typeof obj === "string") pushUnit(file, fieldPath, obj);
}
for (const f of ["apps/studio/src/copy/levels.json", "apps/studio/src/copy/catalog.json"]) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) walkJson(JSON.parse(read(abs)), f);
}

// level-spec L01 常量 + content 的 LevelDef：结构化读取（需 tsx）；失败则文本回退
let structured = false;
const structuredErrors = [];
try {
  const { L01 } = await import(pathToFileURL(path.join(ROOT, "packages/level-spec/src/index.ts")).href);
  if (L01) {
    structured = true;
    const defs = [{ file: "packages/level-spec/src/index.ts", label: "level-spec.L01", def: L01 }];
    for (const abs of contentTs) {
      const mod = await import(pathToFileURL(abs).href);
      for (const [name, val] of Object.entries(mod)) {
        if (val && typeof val === "object" && val.def && val.def.task) {
          defs.push({ file: path.relative(ROOT, abs), label: `${path.basename(abs)}.${name}`, def: val.def });
        }
      }
    }
    for (const { file, label, def } of defs) {
      const push = (field, value) => pushUnit(file, `${label}.${field}`, value);
      def.meta?.objectives?.forEach((o, i) => {
        push(`meta.objectives[${i}].learnerView`, o.learnerView);
        if (typeof o.evidence === "string") push(`meta.objectives[${i}].evidence`, o.evidence);
      });
      push("task.mainTask", def.task?.mainTask);
      push("task.makeTask", def.task?.makeTask);
      push("task.playerBeat", def.task?.playerBeat);
      def.task?.successCriteria?.forEach((c, i) => push(`task.successCriteria[${i}].text`, c.text));
      def.task?.hiddenTests?.forEach((t, i) => {
        push(`task.hiddenTests[${i}].name`, t.name);
        t.assertions?.forEach((a, j) => push(`task.hiddenTests[${i}].assertions[${j}].text`, a.text));
      });
    }
  }
} catch (err) {
  structuredErrors.push(err instanceof Error ? err.message : String(err));
}
if (!structured) {
  const FIELD_RE = /(?:learnerView|mainTask|makeTask|playerBeat|text|name)\s*:\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
  for (const file of ["packages/level-spec/src/index.ts", ...contentTs.map(f => path.relative(ROOT, f))]) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    const src = read(abs);
    for (const m of src.matchAll(FIELD_RE)) pushUnit(file, "text-fallback", m[2]);
  }
}

const pureZh = { unitsScanned: units.length, violations: [], exemptions: [], warnings: [], counts: { violations: 0, exemptTokens: 0, exemptStrings: 0, warnings: 0 } };
const exemptionCounter = new Map();
for (const unit of units) {
  const { exemptions, tokenExemptions, violations, warnings, keyCombo } = classifyString(unit.value);
  if (keyCombo) {
    pureZh.violations.push({ file: unit.file, field: unit.field, string: unit.value, token: "(key-combo)", reason: "把英文按键组合当作文案主语（docs/20 §3b 反例）", suggestion: "改「回车运行」或「按回车」" });
    continue;
  }
  if (violations.length === 0) {
    if (warnings.length > 0) {
      pureZh.warnings.push({ file: unit.file, field: unit.field, string: unit.value, notes: warnings });
      pureZh.counts.warnings += 1;
    }
    const exemptCount = exemptions.length + tokenExemptions.length;
    if (exemptCount > 0) {
      pureZh.counts.exemptStrings += 1;
      pureZh.counts.exemptTokens += exemptCount;
      const all = [...exemptions, ...tokenExemptions];
      for (const e of all) exemptionCounter.set(e.reason, (exemptionCounter.get(e.reason) ?? 0) + 1);
      pureZh.exemptions.push({ file: unit.file, field: unit.field, string: unit.value, exempt: all });
    }
    continue;
  }
  for (const v of violations) {
    pureZh.violations.push({ file: unit.file, field: unit.field, string: unit.value, token: v.token, reason: v.reason, suggestion: v.suggestion });
  }
  if (warnings.length > 0) {
    pureZh.warnings.push({ file: unit.file, field: unit.field, string: unit.value, notes: warnings, exempt: [...exemptions, ...tokenExemptions] });
    pureZh.counts.warnings += 1;
  }
}
pureZh.counts.violations = pureZh.violations.length;
pureZh.counts.warnings = pureZh.warnings.length;
pureZh.exemptionSummary = [...exemptionCounter.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
pureZh.mode = { structured, structuredErrors };
pureZh.sources = {
  json: ["apps/studio/src/copy/levels.json", "apps/studio/src/copy/catalog.json"],
  ts: ["packages/level-spec/src/index.ts", ...contentTs.map(f => path.relative(ROOT, f))],
};

// ---------------- 汇总输出 ----------------
const bySeverity = { FAIL: bannedHits.filter(h => h.severity === "FAIL").length, WARN: bannedHits.filter(h => h.severity === "WARN").length };
const evidence = {
  ts: new Date().toISOString(),
  suite: "check-copy",
  bannedWordsSource: bannedSource,
  bannedWordCount: banned.length,
  scanned: { ui: uiFiles.length, contentTs: contentTs.length, contentMd: contentMd.length },
  hits: bannedHits,
  summary: { total: bannedHits.length, ...bySeverity },
  pureZh: PURE_ZH ? pureZh : undefined,
  proofOnHead: PURE_ZH ? proofOnHead() : undefined,
  note: PURE_ZH
    ? "pure-zh：扫描 Studio copy JSON + level-spec/content 叙述字段；代码引用（反引号/标识符/文件名/行号/CLI/占位符）与按键名豁免；Minecraft/TypeScript 需中文解释；UI 英文标签（Run/Stop/Mock…）FAIL。"
    : "content-md 命中为 WARN；ui/content-ts 命中为 FAIL。",
};
if (outFile) writeJson(outFile, evidence);

const base = { suite: "check-copy", scanned: evidence.scanned, banned: evidence.summary, evidence: outFile ?? null };
if (!PURE_ZH) {
  console.log(JSON.stringify(base));
  process.exit(STRICT && bySeverity.FAIL > 0 ? 1 : 0);
}
const pureSummary = {
  stringsWithLatin: pureZh.unitsScanned,
  violations: pureZh.counts.violations,
  violationFiles: [...new Set(pureZh.violations.map(v => v.file))],
  exemptStrings: pureZh.counts.exemptStrings,
  exemptTokens: pureZh.counts.exemptTokens,
  exemptionSummary: pureZh.exemptionSummary,
  warnings: pureZh.counts.warnings,
  structured: pureZh.mode.structured,
};
console.log(JSON.stringify({ ...base, pureZh: pureSummary }));
process.exit(STRICT && pureZh.counts.violations > 0 ? 1 : 0);
