// 纯中文 UI 门禁：copy 文案里除反引号代码引用、codeRefs、中文占位符、数据键外，不得出现连续拉丁字母。
// 用法：node scripts/check-pure-zh.mjs [--json evidence/qa-pure-zh.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const outFile = jsonIndex >= 0 ? args[jsonIndex + 1] : null;

const DATA_KEY_RE = /^(id|status|priority|act|order|minutes|levelId|kind|en|codeRefs?|.*Refs?|scene|speaker)$/i;
const SKIP_KEYS = new Set(["_meta"]);

/** 允许出现拉丁字母的结构性数据键（关卡编号等），不进叙述。 */
const DATA_PATHS = /(^|\.)levels\[\d+\]\.id$/;

function walk(value, path, hits) {
  if (typeof value === "string") {
    if (DATA_PATHS.test(path)) return;
    const withoutCode = value.replace(/`[^`]*`/g, "").replace(/\{[^{}]*\}/g, "");
    const latin = withoutCode.match(/[A-Za-z]{2,}/g);
    if (latin) hits.push({ path, text: value, latin });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  if (value && typeof value === "object") {
    // codeRefs 对象：text 是文案，codeRefs 是允许的代码引用。
    if (typeof value.text === "string" && Array.isArray(value.codeRefs)) {
      walk(value.text, path, hits);
      const copy = { ...value, codeRefs: undefined };
      for (const [key, item] of Object.entries(copy)) {
        if (key !== "text" && item !== undefined) walk(item, `${path}.${key}`, hits);
      }
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (SKIP_KEYS.has(key) || DATA_KEY_RE.test(key)) continue;
      walk(item, path ? `${path}.${key}` : key, hits);
    }
  }
}

const report = { ts: new Date().toISOString(), files: [], hits: [] };
for (const file of ["src/copy/levels.json", "src/copy/catalog.json"]) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  const hits = [];
  walk(value, "", hits);
  report.files.push({ file, checked: true, hits: hits.length });
  report.hits.push(...hits.map((hit) => ({ file, ...hit })));
}
report.summary = { total: report.hits.length };
if (outFile) {
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(resolve(outFile), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ suite: "pure-zh", files: report.files, hits: report.summary.total, evidence: outFile }));
process.exit(report.summary.total === 0 ? 0 : 1);
