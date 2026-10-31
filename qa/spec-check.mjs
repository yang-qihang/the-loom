// qa/spec-check.mjs — 13 份关卡 spec（设计期 Markdown）的 meta 机器校验 + 报告渲染。
// 用 python3 的 PyYAML 解析 meta 块（不依赖网络/外部服务），再用 zod LevelMetaSchema 校验。
// 运行：npx tsx qa/spec-check.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LevelMetaSchema, nowIso, writeEvidence } from "./_lib.mjs";

const ROOT = process.cwd();
const LEVELS_DIR = path.join(ROOT, "content/levels");
const EXPECTED_COUNT = 13;

const PY = String.raw`
import sys, json, re, glob
import yaml
root = sys.argv[1]
out = []
for f in sorted(glob.glob(root + "/content/levels/*.md")):
    s = open(f, encoding="utf-8").read()
    meta = None
    err = None
    for m in re.finditer(r"\`\`\`yaml\n(.*?)\`\`\`", s, re.S):
        try:
            d = yaml.safe_load(m.group(1))
        except Exception as e:
            err = str(e)
            continue
        if isinstance(d, dict) and isinstance(d.get("meta"), dict):
            meta = d["meta"]
            break
    out.append({"file": f.replace(root + "/", ""), "meta": meta, "yamlError": err})
print(json.dumps(out, ensure_ascii=False))
`;

function parseSpecs() {
  const raw = execFileSync("python3", ["-c", PY, ROOT], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(raw);
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
