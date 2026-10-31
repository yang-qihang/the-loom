#!/usr/bin/env node
// 从 docs/13-codex-cross-language.md 抽取《织典》页，生成 content/codex/codex.json。
// 不改正文，只做结构化：标题/解决/机制/代价/跨语言代码块/在我们游戏里/常见误解。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "docs/13-codex-cross-language.md"), "utf8");
const lines = src.split("\n");

const pages = [];
let cur = null;
let fence = null;
let fenceLang = "";
let fenceBuf = [];
const flush = () => {
  if (cur) {
    cur.crossLanguage = cur.crossLanguage.filter(x => x.code.trim().length > 0);
    pages.push(cur);
    cur = null;
  }
};

for (const raw of lines) {
  const line = raw;
  const h = line.match(/^### ([AX]\d+) (.*?)（(.*?)）\s*$/);
  if (h) {
    flush();
    const [, id, cn, en] = h;
    const m = cn.match(/^(.*?)\s*—\s*(.*)$/);
    cur = {
      id,
      title: m ? m[1] : cn,
      subtitle: m ? m[2] : "",
      en: en,
      solve: "", mechanism: "", cost: "",
      crossLanguage: [],
      inGame: "", misconception: "",
      unlock: unlockFor(id),
    };
    continue;
  }
  if (!cur) continue;
  if (line.startsWith("**解决**")) cur.solve = line.replace(/\*\*解决\*\*[：:]\s*/, "").trim();
  else if (line.startsWith("**机制**")) cur.mechanism = line.replace(/\*\*机制\*\*[：:]\s*/, "").trim();
  else if (line.startsWith("**代价**")) cur.cost = line.replace(/\*\*代价\*\*[：:]\s*/, "").trim();
  else if (line.startsWith("**在我们游戏里**")) cur.inGame = line.replace(/\*\*在我们游戏里\*\*[：:]\s*/, "").trim();
  else if (line.startsWith("**常见误解**")) cur.misconception = line.replace(/\*\*常见误解\*\*[：:]\s*/, "").trim();
  else if (line.startsWith("```")) {
    if (fence === null) { fence = "open"; fenceLang = line.slice(3).trim(); fenceBuf = []; }
    else { cur.crossLanguage.push({ lang: fenceLang || "text", code: fenceBuf.join("\n") }); fence = null; fenceLang = ""; fenceBuf = []; }
  } else if (fence === "open") fenceBuf.push(line);
}
flush();

function unlockFor(id) {
  const n = Number(id.slice(1));
  if (id === "A0" || id === "A1") return "L01";
  if (id === "A2") return "L02";
  if (id === "A3") return "L03";
  if (id === "A4") return "L04";
  if (id === "A5" || id === "A6") return "L05";
  if (id === "A7" || id === "A8") return "L06";
  if (id === "A9" || id === "A10") return "L07";
  if (id === "A11") return "L08";
  if (id === "A12") return "L09";
  if (id === "A13") return "L10";
  if (id === "A14") return "EP";
  if (id === "X1") return "LAB-R";
  if (id === "X2") return "LAB-T";
  return "?";
}

const out = { generatedFrom: "docs/13-codex-cross-language.md", count: pages.length, pages };
fs.mkdirSync(path.join(root, "content/codex"), { recursive: true });
fs.writeFileSync(path.join(root, "content/codex/codex.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`codex: ${pages.length} pages -> content/codex/codex.json`);
