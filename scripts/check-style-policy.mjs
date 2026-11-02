#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * 字体与行内代码契约静态检查（docs/61）。
 *
 * 1) 三轨道 token：--font-pixel 含 Zpix/Departure Mono；--font-text 主字体 MiSans VF；--font-code 主字体 Maple Mono。
 * 2) 代码类选择器不得使用像素字体；--font-code/--editor-font 不得含像素字。
 * 3) 所有含反引号的 copy/codex 字段，若作为 JSX 可见子节点直接渲染，必须包在 <RichText> 里。
 * 4) 禁止 JSX 纯文本里直接写未转义反引号。
 *
 * 用法：node scripts/check-style-policy.mjs [--verbose]
 * 退出码：0 通过；1 违规。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STUDIO = join(REPO, "apps", "studio", "src");
const STYLES = join(STUDIO, "styles.css");
const TYPO = join(STUDIO, "typography.css");
const COPY_DIR = join(STUDIO, "copy");
const CODEX = join(REPO, "content", "codex", "codex.json");
const failures = [];
const notes = [];
const verbose = process.argv.includes("--verbose");
const fail = (msg) => failures.push(msg);

function read(p) { return readFileSync(p, "utf8"); }
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.has(extname(name))) out.push(full);
  }
  return out;
}

// ---------- 1) CSS token / 代码禁用像素 ----------
const styles = read(STYLES);
const typo = read(TYPO);
const tokenChecks = [
  [/--font-pixel:\s*"Zpix",\s*"Departure Mono"/, "--font-pixel 必须保留 Zpix + Departure Mono 主栈"],
  [/--font-text:\s*"MiSans VF",\s*"MiSans"/, "--font-text 主字体必须是 MiSans VF"],
  [/--font-code:\s*"Maple Mono"/, "--font-code 主字体必须是 Maple Mono"],
];
for (const [re, msg] of tokenChecks) if (!re.test(styles)) fail(`styles.css: ${msg}`);
if (!/MiSansVF\.min\.css/.test(typo)) fail("typography.css: 缺少 MiSans @import");
if (/--font-code:[^;]*(Zpix|Departure Mono)/i.test(styles)) fail("--font-code 含像素字体");
if (/--editor-font:[^;]*(Zpix|Departure Mono)/i.test(styles)) fail("--editor-font 含像素字体");
if (!/code,\s*pre,\s*kbd,\s*\.mono,\s*\.inline-code\s*\{[^}]*font-family:\s*var\(--font-code\)/s.test(styles)) {
  fail("styles.css: code/pre/kbd/.mono/.inline-code 必须统一 var(--font-code)");
}

// 解析 CSS 规则，代码类选择器不得出现像素字
const codeSelectorRe = /(^|[\s,>+~])(code|pre|kbd|\.mono|\.inline-code|\.solution-code|\.gd-signature|\.gd-example|\.codex-code|\.repl-input|\.hud-value)(?=[\s,{:.#]|$)/;
for (const m of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim();
  const body = m[2];
  if (!codeSelectorRe.test(selector)) continue;
  const font = /font-family:([^;]+);/.exec(body)?.[1] ?? "";
  if (/Zpix|Departure Mono/i.test(font)) fail(`代码选择器使用像素字体：${selector.slice(0, 120)}`);
  if (font && !/var\(--font-code\)|var\(--editor-font\)|Maple Mono|monospace/.test(font)) {
    fail(`代码选择器未用代码字体栈：${selector.slice(0, 120)} → ${font.trim()}`);
  }
}

// ---------- 2) 已知富文本字段 / 上下文（docs/61 §2） ----------
// 只检查「简单的」JSX 子表达式（属性访问/函数调用/裸变量）；含 JSX/map/三元表达式交给
// style-policy.spec.ts 的 DOM 审计。避免把静态标签（chrome.codex.mechanism）误判成数据字段。
const RISKY_FIELD_NAMES = new Set([
  "footHint", "coordHint", "coordNamed", "coordPos", "helpHint", "helpOpened",
  "noPoints", "mcHelpSteps", "predict", "hints", "coachOpen", "coachReact",
]);
const RISKY_TEXT = [
  /\b(selected|page)\.(solve|mechanism|cost|inGame|misconception|title|subtitle)\b/,
  /\bblock\.text\b/,
  /\bchapter\.(title|subtitle|goals|prereq)\b/,
  /\bterm\.(zh|en)\b/,
];
const RAW_TEXT_IDENTIFIERS = new Set(["error", "notice"]);
const containsJsx = (node) => {
  let found = false;
  const visit = (child) => {
    if (!found && (ts.isJsxElement(child) || ts.isJsxFragment(child) || ts.isJsxSelfClosingElement(child))) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
};
const propNames = (node, out = []) => {
  if (!node) return out;
  if (ts.isPropertyAccessExpression(node)) out.push(node.name.text);
  ts.forEachChild(node, (child) => propNames(child, out));
  return out;
};
const insideRichText = (node) => {
  let p = node.parent;
  while (p) {
    if (ts.isJsxAttribute(p) && p.name.text === "text") {
      const opening = p.parent?.parent;
      if (opening && ts.isJsxOpeningElement(opening) && opening.tagName.getText().endsWith("RichText")) return true;
    }
    if (ts.isJsxElement(p)) return false;
    p = p.parent;
  }
  return false;
};

// ---------- 3) TSX AST：裸渲染已知富文本字段 ----------
const files = walk(STUDIO, new Set([".tsx"]));
for (const file of files) {
  const sourceText = read(file);
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      const isChild = parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent));
      const expr = node.expression;
      const simple =
        ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr) || ts.isIdentifier(expr);
      if (isChild && !insideRichText(node) && simple && !containsJsx(expr)) {
        const text = expr.getText(sf);
        const names = propNames(expr);
        const hitField = names.find((name) => RISKY_FIELD_NAMES.has(name));
        const hitText = RISKY_TEXT.some((re) => re.test(text));
        const hitIdentifier = ts.isIdentifier(expr) && RAW_TEXT_IDENTIFIERS.has(expr.text);
        if (hitField || hitText || hitIdentifier) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          fail(`${relative(REPO, file)}:${pos.line + 1}:{${text.slice(0, 90)}} 直接渲染富文本字段（${hitField ?? (hitText ? "data context" : "text variable")}），必须包 <RichText>`);
        }
      }
    }
    if (ts.isJsxText(node) && node.getText(sf).includes("`")) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      fail(`${relative(REPO, file)}:${pos.line + 1}: JSX 纯文本含反引号，必须改用 RichText/代码元素`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------- 输出 ----------
for (const n of notes) console.log(`[style-policy] ${n}`);
if (failures.length) {
  console.error(`[style-policy] 发现 ${failures.length} 条违规（docs/61）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[style-policy] OK：三轨道 token、代码禁像素、${files.length} 个 TSX 已检查`);
