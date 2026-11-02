// qa/spec-check.mjs — 13 份关卡 spec（设计期 Markdown）的 meta 机器校验 + 报告渲染。
// 用跨平台 `yaml` 包解析 meta 块（Windows/Linux 一致，不依赖 python3/PyYAML），再用 zod LevelMetaSchema 校验。
// 运行：npx tsx qa/spec-check.mjs
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { LevelMetaSchema, nowIso, writeEvidence } from "./_lib.mjs";

const ROOT = process.cwd();
const LEVELS_DIR = path.join(ROOT, "content/levels");
const EXPECTED_COUNT = 13;

function parseSpecs() {
  return fs
    .readdirSync(LEVELS_DIR)
    .filter(file => file.endsWith(".md"))
    .sort()
    .map(file => {
      const source = fs.readFileSync(path.join(LEVELS_DIR, file), "utf8");
      let meta = null;
      let yamlError = null;
      for (const match of source.matchAll(/```yaml\r?\n([\s\S]*?)```/g)) {
        try {
          const parsed = parseYaml(match[1]);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.meta === "object") {
            meta = parsed.meta;
            break;
          }
        } catch (error) {
          yamlError = error instanceof Error ? error.message : String(error);
        }
      }
      return { file: path.posix.join("content/levels", file), meta, yamlError };
    });
}

const specs = parseSpecs();
const rows = [];
const advancements = new Map();
const ids = new Map();
for (const spec of specs) {
  const errors = [];
  const warnings = [];
  if (!spec.meta) {
    errors.push(spec.yamlError ? `meta YAML 解析失败: ${spec.yamlError}` : "找不到 meta YAML 块");
  } else {
    const parsed = LevelMetaSchema.safeParse(spec.meta);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`));
    }
    const meta = spec.meta;
    if (meta.id) {
      if (ids.has(meta.id)) errors.push(`id 重复: ${meta.id}（另见 ${ids.get(meta.id)}）`);
      ids.set(meta.id, spec.file);
    }
    if (meta.reward?.advancement) {
      const adv = meta.reward.advancement;
      if (advancements.has(adv)) errors.push(`advancement 重复: ${adv}（另见 ${advancements.get(adv)}）`);
      advancements.set(adv, spec.file);
    }
    if (meta.reward?.rune && Array.isArray(meta.abstractions) && !meta.abstractions.includes(meta.reward.rune)) {
      errors.push(`reward.rune=${meta.reward.rune} 不在 abstractions=[${meta.abstractions.join(",")}]`);
    }
    if (!Array.isArray(meta.objectives) || meta.objectives.length === 0) errors.push("objectives 为空");
    if (!Array.isArray(meta.apiIntroduced)) errors.push("apiIntroduced 缺失");
  }
  rows.push({
    file: spec.file,
    id: spec.meta?.id ?? null,
    title: spec.meta?.title?.zh ?? null,
    act: spec.meta?.act ?? null,
    priority: spec.meta?.priority ?? null,
    status: errors.length ? "FAIL" : warnings.length ? "WARN" : "PASS",
    errors,
    warnings,
  });
}

const expectedFiles = fs.readdirSync(LEVELS_DIR).filter(f => f.endsWith(".md"));
const failCount = rows.filter(r => r.status === "FAIL").length;
const evidence = {
  ts: nowIso(),
  suite: "spec-check",
  specCount: rows.length,
  expectedCount: EXPECTED_COUNT,
  mdFileCount: expectedFiles.length,
  status: failCount === 0 && rows.length === EXPECTED_COUNT ? "PASS" : "FAIL",
  summary: {
    pass: rows.filter(r => r.status === "PASS").length,
    warn: rows.filter(r => r.status === "WARN").length,
    fail: failCount,
  },
  rows,
};
const file = writeEvidence("qa-spec-check.json", evidence);
console.log(JSON.stringify({ suite: "spec-check", specCount: rows.length, ...evidence.summary, status: evidence.status, evidence: file }));
process.exit(evidence.status === "PASS" ? 0 : 1);
