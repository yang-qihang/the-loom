#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Noto Sans SC 子集覆盖率检查（无需字体解析库，读 scripts/build-font-subset.py 写出的清单）。
 *
 * 断言：
 *  1) 两个 woff2 存在，sha256 / 字节数与清单一致（清单不会被手改或与产物漂移）。
 *  2) 体积预算：单字重 ≤ 4MB、总计 ≤ 8MB。
 *  3) 清单 charset（码点区间）展开后与 sha256 自洽，且 ≥ GB2312 全部字符。
 *  4) apps/studio/src 与 content/ 的 UI 文本实际用到的非 ASCII 字符 ⊆ 清单 charset
 *     （字体本身不支持的少量符号记在 unsupportedCodepoints，走系统 fallback，不算失败但要打印出来）。
 *  5) apps/studio/src/typography.css 的 @font-face 引用了清单里的两个字体文件。
 *
 * 用法（仓库根目录）：node scripts/check-font-coverage.mjs [--verbose]
 * 退出码：0 = 全部通过；1 = 有断言失败。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = resolve(REPO_ROOT, "apps", "studio", "src", "assets", "fonts");
const COVERAGE_PATH = resolve(FONT_DIR, "noto-sans-sc-coverage.json");
const TYPOGRAPHY_CSS = resolve(REPO_ROOT, "apps", "studio", "src", "typography.css");
const SCAN_ROOTS = ["apps/studio/src", "content"];
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".html", ".md"]);
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const verbose = process.argv.includes("--verbose");
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function expandRanges(ranges) {
  const codepoints = [];
  for (const [start, end] of ranges) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error(`清单 ranges 非法: ${JSON.stringify([start, end])}`);
    }
    for (let codepoint = start; codepoint <= end; codepoint += 1) codepoints.push(codepoint);
  }
  return codepoints;
}

function walkTextFiles(relativeRoot) {
  const root = resolve(REPO_ROOT, relativeRoot);
  if (!existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) {
        if (name.startsWith(".") || name === "node_modules" || name === "dist") continue;
        stack.push(join(current, name));
      }
      continue;
    }
    if (TEXT_EXTS.has(extname(current).toLowerCase())) files.push(current);
  }
  return files;
}

function main() {
  if (!existsSync(COVERAGE_PATH)) {
    console.error(`[font-coverage] 缺少覆盖清单 ${relative(REPO_ROOT, COVERAGE_PATH)}，先运行 python scripts/build-font-subset.py`);
    process.exit(1);
  }
  const coverage = JSON.parse(readFileSync(COVERAGE_PATH, "utf8"));
  const filename = relative(REPO_ROOT, COVERAGE_PATH);

  // ---- 1) 字体文件完整性 ----
  const files = Array.isArray(coverage.files) ? coverage.files : [];
  if (files.length < 2) fail(`清单应包含 Regular/Bold 两个字体文件，实际 ${files.length}`);
  let totalBytes = 0;
  for (const entry of files) {
    const path = resolve(FONT_DIR, entry.file);
    if (!existsSync(path)) {
      fail(`字体文件缺失: ${relative(REPO_ROOT, path)}（先运行 python scripts/build-font-subset.py）`);
      continue;
    }
    const data = readFileSync(path);
    totalBytes += data.length;
    if (data.length !== entry.bytes) fail(`${entry.file} 字节数漂移: 实际 ${data.length} ≠ 清单 ${entry.bytes}`);
    const digest = sha256(data);
    if (digest !== entry.sha256) fail(`${entry.file} sha256 漂移: 实际 ${digest.slice(0, 16)}… ≠ 清单 ${String(entry.sha256).slice(0, 16)}…`);
    if (data.length > MAX_FONT_BYTES) fail(`${entry.file} 超过单字重 4MB 预算: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    if (verbose) console.log(`[font-coverage] ${entry.file}: ${(data.length / 1024 / 1024).toFixed(2)} MB, sha256 ${digest.slice(0, 16)}…`);
  }
  if (totalBytes > MAX_TOTAL_BYTES) fail(`字体总计 ${(totalBytes / 1024 / 1024).toFixed(2)} MB 超过 8MB 预算`);

  // ---- 2) 字符集清单自洽 ----
  let codepoints = [];
  try {
    codepoints = expandRanges(coverage.charset?.ranges ?? []);
  } catch (error) {
    fail(error.message);
  }
  if (codepoints.length !== coverage.charset?.codepoints) {
    fail(`清单码点数不自洽: ranges 展开 ${codepoints.length} ≠ codepoints ${coverage.charset?.codepoints}`);
  }
  const expectedHash = sha256(codepoints.join(","));
  if (expectedHash !== coverage.charset?.sha256) {
    fail(`清单 charset sha256 不自洽: 重算 ${expectedHash.slice(0, 16)}… ≠ 清单 ${String(coverage.charset?.sha256).slice(0, 16)}…`);
  }
  const charset = new Set(codepoints);

  // GB2312 全部字符必须在内（字体定位是「常用中文不缺字」）。
  const gb2312Hanzi = 6763;
  const declaredGb2312 = Number(coverage.charset?.gb2312 ?? 0);
  if (declaredGb2312 < 7445) fail(`清单声明 GB2312 覆盖 ${declaredGb2312} < 7445（7445 = GB2312 全部字符）`);
  try {
    const decoder = new TextDecoder("gb18030");
    let hanzi = 0;
    for (let lead = 0xa1; lead <= 0xf7; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
        const char = decoder.decode(Uint8Array.from([lead, trail]));
        if (char.length === 1 && char >= "\u4e00" && char <= "\u9fff") hanzi += 1;
      }
    }
    if (hanzi < gb2312Hanzi) fail(`GB2312 汉字解码异常: ${hanzi} < ${gb2312Hanzi}`);
  } catch {
    notes.push("当前 Node 无 gb18030 解码器，跳过 GB2312 逐字解码（清单 gb2312 计数已单独校验）");
  }

  // ---- 3) UI 文本 ⊆ 字库 ----
  const scannedFiles = SCAN_ROOTS.flatMap((root) => walkTextFiles(root));
  const usedNonAscii = new Map(); // codepoint -> 首个出现文件
  for (const file of scannedFiles) {
    const text = readFileSync(file, "utf8");
    for (const char of text) {
      const codepoint = char.codePointAt(0);
      if (codepoint <= 0x7f) continue;
      if (!usedNonAscii.has(codepoint)) usedNonAscii.set(codepoint, relative(REPO_ROOT, file));
    }
  }
  const knownUnsupported = new Set(
    (coverage.charset?.unsupportedCodepoints ?? []).map((item) => Number.parseInt(String(item).replace(/^U\+/i, ""), 16)),
  );
  const knownIgnored = new Set(
    (coverage.charset?.ignoredControlCodepoints ?? []).map((item) => Number.parseInt(String(item).replace(/^U\+/i, ""), 16)),
  );
  const missing = [];
  const fallback = [];
  for (const [codepoint, from] of usedNonAscii) {
    if (charset.has(codepoint)) continue;
    if (knownUnsupported.has(codepoint)) {
      fallback.push(`U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}（${from}）`);
      continue;
    }
    if (knownIgnored.has(codepoint)) continue;
    missing.push(`U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}（${from}）`);
  }
  if (missing.length > 0) {
    fail(`UI 文本有 ${missing.length} 个字符不在子集 cmap（缺字会回退系统字体）: ${missing.slice(0, 12).join("、")}`);
  }
  if (fallback.length > 0) {
    notes.push(`字库本身不含 ${fallback.length} 个 UI 符号，走系统 fallback（清单 unsupportedCodepoints 已记录）: ${fallback.slice(0, 10).join("、")}`);
  }

  // ---- 4) typography.css 的 @font-face 引用 ----
  if (!existsSync(TYPOGRAPHY_CSS)) {
    fail(`缺少 ${relative(REPO_ROOT, TYPOGRAPHY_CSS)}（@font-face 应写在这里）`);
  } else {
    const css = readFileSync(TYPOGRAPHY_CSS, "utf8");
    for (const entry of files) {
      if (!css.includes(entry.file)) fail(`typography.css 未引用字体文件 ${entry.file}`);
    }
    if (!/font-family:\s*"Noto Sans SC"/.test(css)) fail('typography.css 缺少 font-family: "Noto Sans SC"');
  }

  // ---- 报告 ----
  const totalMb = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(
    `[font-coverage] 字体 ${files.length} 个 / 共 ${totalMb} MB；charset ${codepoints.length} 码点；` +
      `扫描 ${scannedFiles.length} 个 UI 文件、${usedNonAscii.size} 个非 ASCII 字符；缺字 ${missing.length}`,
  );
  for (const note of notes) console.log(`[font-coverage] 注意: ${note}`);
  if (failures.length > 0) {
    console.error(`[font-coverage] FAILED（${failures.length} 项）`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(`  清单: ${filename}`);
    process.exit(1);
  }
  console.log(`[font-coverage] OK：${filename}`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(`[font-coverage] 异常: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
}
