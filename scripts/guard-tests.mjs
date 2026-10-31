#!/usr/bin/env node
/**
 * scripts/guard-tests.mjs — 测试/红队脚本 hash 冻结（QA 红队 RT-06）。
 *
 * 覆盖文件：
 *   packages/**\/*.test.ts
 *   content/**\/*.test.ts
 *   qa/red-team.mjs
 *
 * 用法：
 *   node scripts/guard-tests.mjs                 # 生成/更新 manifest（test/guard-manifest.json）
 *   node scripts/guard-tests.mjs --update        # 同上
 *   node scripts/guard-tests.mjs --check         # 有改动/新增/删除 → exit 1 并打印 diff
 *   node scripts/guard-tests.mjs --check --warn  # 有改动只告警，exit 0（feature freeze 前的 verify l0 用）
 *   node scripts/guard-tests.mjs --check --json evidence/guard-tests.json
 *
 * 可测试参数：
 *   --root <dir>      扫描根目录（默认仓库根）
 *   --manifest <path> manifest 路径（默认 <root>/test/guard-manifest.json）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { mode: "update", warn: false, root: DEFAULT_ROOT, manifest: undefined, json: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--check":
        options.mode = "check";
        break;
      case "--update":
        options.mode = "update";
        break;
      case "--warn":
        options.warn = true;
        break;
      case "--root":
        options.root = resolve(argv[++index] ?? "");
        break;
      case "--manifest":
        options.manifest = resolve(argv[++index] ?? "");
        break;
      case "--json":
        options.json = resolve(argv[++index] ?? "");
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`unknown arg: ${arg}`);
        printHelp();
        process.exit(2);
    }
  }
  options.manifest ??= join(options.root, "test", "guard-manifest.json");
  return options;
}

function printHelp() {
  console.log(
    [
      "guard-tests: 测试/红队脚本 hash 冻结",
      "  node scripts/guard-tests.mjs                 生成/更新 test/guard-manifest.json",
      "  node scripts/guard-tests.mjs --check         有改动 → exit 1 + diff",
      "  node scripts/guard-tests.mjs --check --warn  有改动仅告警（exit 0，verify l0 用）",
      "  --root <dir> / --manifest <path> / --json <path>",
    ].join("\n"),
  );
}

const GLOBS = [
  { dir: "packages", test: /\.test\.ts$/ },
  { dir: "content", test: /\.test\.ts$/ },
];
const SINGLE_FILES = ["qa/red-team.mjs"];

function walk(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function collectFiles(root) {
  const files = [];
  for (const glob of GLOBS) {
    const base = join(root, glob.dir);
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      const rel = relative(root, file).split("\\").join("/");
      if (glob.test.test(rel)) files.push(rel);
    }
  }
  for (const rel of SINGLE_FILES) {
    if (existsSync(join(root, rel))) files.push(rel);
  }
  return files.sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function scan(root) {
  const files = collectFiles(root);
  const hashes = {};
  for (const rel of files) hashes[rel] = hashFile(join(root, rel));
  return { root, files: hashes, count: files.length };
}

function diffManifest(previous, current) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const file of Object.keys(current.files)) {
    if (!(file in previous.files)) added.push(file);
    else if (previous.files[file] !== current.files[file]) changed.push(file);
  }
  for (const file of Object.keys(previous.files)) {
    if (!(file in current.files)) removed.push(file);
  }
  return { added, removed, changed };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.root) || !statSync(options.root).isDirectory()) {
    console.error(`GUARD_TESTS_ERROR 扫描根目录不存在：${options.root}`);
    process.exit(3);
  }
  const current = scan(options.root);
  if (options.mode === "update") {
    const manifest = { version: 1, generatedAt: new Date().toISOString(), ...current };
    writeJson(options.manifest, manifest);
    if (options.json) writeJson(options.json, { ok: true, mode: "update", manifest: options.manifest, count: current.count });
    console.log(`GUARD_TESTS UPDATED ${options.manifest} (${current.count} files)`);
    return;
  }

  if (!existsSync(options.manifest)) {
    console.error(`GUARD_TESTS_ERROR manifest 不存在：${options.manifest}（先运行 node scripts/guard-tests.mjs）`);
    if (options.json) writeJson(options.json, { ok: false, mode: "check", error: "manifest-missing", manifest: options.manifest });
    process.exit(1);
  }
  const previous = JSON.parse(readFileSync(options.manifest, "utf8"));
  const result = diffManifest(previous, current);
  const changed = result.added.length + result.removed.length + result.changed.length > 0;
  if (!changed) {
    console.log(`GUARD_TESTS OK (${current.count} files)`);
    if (options.json) writeJson(options.json, { ok: true, mode: "check", count: current.count });
    return;
  }
  const lines = [];
  for (const file of result.added) lines.push(`+ ${file}（新增测试/红队文件）`);
  for (const file of result.removed) lines.push(`- ${file}（测试/红队文件被删除）`);
  for (const file of result.changed) lines.push(`~ ${file}（内容被修改）`);
  const heading = options.warn ? "GUARD_TESTS WARN" : "GUARD_TESTS DRIFT";
  console.error(`${heading}：测试/红队文件与 guard-manifest 不一致`);
  for (const line of lines) console.error(`  ${line}`);
  if (options.json) writeJson(options.json, { ok: false, mode: "check", warn: options.warn, diff: result });
  if (options.warn) {
    console.error("（--warn：不阻塞；feature freeze 后改为 --check 判红）");
    return;
  }
  process.exit(1);
}

main();
