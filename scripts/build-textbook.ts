// 教材构建与校验：Markdown（apps/studio/src/textbook/content/*.md）→ 结构化 TS 数据
// （apps/studio/src/textbook/library.generated.ts），并做质量校验。
//
// 用法：npx tsx scripts/build-textbook.ts [--check|--write]
//   --check  只校验，不写文件（默认）
//   --write  校验通过后写 apps/studio/src/textbook/library.generated.ts
//
// Markdown 方言见 apps/studio/src/textbook/README.md。校验项：
//   - front matter 字段齐全且合法；10 章（L01–L10）齐全、order/id 唯一
//   - 每章正文汉字数下限、代码块数量/行数、代码可被 esbuild 解析
//   - 代码示例只用本关及之前引入的 API（api-registry sinceLevel）+ 禁用符号清单
//   - 术语 ≥5、warn callout ≥1、标题层级合法
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { API_REGISTRY } from "../packages/sdk/src/api-registry";
import type { TextbookBlock, TextbookChapter, TextbookLibrary } from "../apps/studio/src/textbook/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "apps/studio/src/textbook/content");
const OUT_FILE = path.join(ROOT, "apps/studio/src/textbook/library.generated.ts");
const LEVEL_IDS = Array.from({ length: 10 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`);

/** 每章正文（不含代码）汉字数下限。用户要求「接近教材质量、篇幅明显长」。 */
const MIN_CJK_CHARS = Number(process.env.TEXTBOOK_MIN_CJK ?? 5500);
const MIN_CODE_BLOCKS = 4;
const MAX_CODE_LINES = 30;
const MIN_TERMS = 5;

// 明确禁止出现的「设计稿 / 未接线」符号（来自 2026-11-01 侦察）。
const FORBIDDEN_SYMBOLS = [
  "world.scenario", "world.field(", "world.plot", "world.machines(", "world.lever(",
  "world.containers(", "world.items", "world.give", "world.clock", "world.runTablet",
  "ringBell(", "placeTorch(", "countEntities(", "startBrewing(", "treatZombieVillager",
  "ringDawnBell(", "allay", "pipe(", "tryReceive(", "writeRune(", "golem.fill(",
  "golem.placeSign(", "world.supply(", // world.supply 仅 L10 允许，单独处理
].filter((symbol) => symbol !== "world.supply(");

const errors: string[] = [];
const warnings: string[] = [];
const stats: Array<Record<string, unknown>> = [];

function fail(message: string, file?: string): void {
  errors.push(file ? `${file}: ${message}` : message);
}

/* ------------------------------ front matter ------------------------------ */

interface FrontMatter {
  [key: string]: string | string[] | undefined;
}

function parseScalar(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontMatter(lines: string[], file: string): { meta: FrontMatter; bodyStart: number } {
  if (lines[0]?.trim() !== "---") {
    fail("缺少 YAML front matter（文件第一行应为 ---）", file);
    return { meta: {}, bodyStart: 0 };
  }
  const meta: FrontMatter = {};
  let index = 1;
  let pendingListKey: string | null = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") {
      index += 1;
      break;
    }
    if (/^\s*$/.test(line) || line.trim().startsWith("#")) continue;
    const listMatch = /^\s*-\s+(.*)$/.exec(line);
    if (listMatch) {
      if (!pendingListKey) {
        fail(`列表项没有对应的 key：${line.trim()}`, file);
        continue;
      }
      const current = meta[pendingListKey];
      const list = Array.isArray(current) ? current : [];
      list.push(parseScalar(listMatch[1] ?? ""));
      meta[pendingListKey] = list;
      continue;
    }
    const keyMatch = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!keyMatch) {
      fail(`无法解析 front matter 行：${line.trim()}`, file);
      continue;
    }
    const key = keyMatch[1] ?? "";
    const value = (keyMatch[2] ?? "").trim();
    if (value === "") {
      pendingListKey = key;
      meta[key] = [];
    } else {
      pendingListKey = null;
      meta[key] = parseScalar(value);
    }
  }
  return { meta, bodyStart: index };
}

/* -------------------------------- blocks ---------------------------------- */

function isCjk(char: string): boolean {
  return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(char);
}

/** 合并被手工换行的段落：中文与中文之间不插空格，其余用空格。 */
function joinParagraph(lines: string[]): string {
  let text = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!text) {
      text = line;
      continue;
    }
    const last = text[text.length - 1] ?? "";
    const first = line[0] ?? "";
    text += isCjk(last) && isCjk(first) ? line : ` ${line}`;
  }
  return text;
}

function parseBlocks(lines: string[], bodyStart: number, file: string, levelId: string): { blocks: TextbookBlock[]; terms: TextbookBlock | null; title: string; subtitle: string } {
  const blocks: TextbookBlock[] = [];
  let termsBlock: TextbookBlock | null = null;
  let index = bodyStart;
  let title = "";
  let subtitle = "";
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let inTermsSection = false;
  let termItems: Array<{ zh: string; en: string; def: string; example?: string }> = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = joinParagraph(paragraph);
    paragraph = [];
    if (text) blocks.push({ kind: "p", text });
  };
  const flushList = (): void => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push({ kind: "list", ...(ordered ? { ordered: true } : {}), items });
  };
  const flushTerms = (): void => {
    if (!inTermsSection) return;
    if (termItems.length > 0) {
      if (termItems.length < MIN_TERMS) warnings.push(`${file}: 术语数量 ${termItems.length} < ${MIN_TERMS}`);
      termsBlock = { kind: "terms", items: termItems };
    }
    termItems = [];
    inTermsSection = false;
  };

  const parseTerm = (item: string): void => {
    // 形式：中文名（English）— 定义。示例：`code` [可选，用 "；示例：" 分隔]
    const match = /^([^（(]+)[（(]([^）)]+)[）)]\s*[—\-:：]\s*(.+)$/.exec(item.trim());
    if (!match) {
      fail(`术语行格式应为「中文名（English）— 定义」：${item.trim()}`, file);
      return;
    }
    const [, zhRaw, enRaw, restRaw] = match;
    let def = (restRaw ?? "").trim();
    let example: string | undefined;
    const exampleMatch = /\s*[；;]\s*示例\s*[:：]\s*(.+)$/.exec(def);
    if (exampleMatch) {
      example = (exampleMatch[1] ?? "").trim();
      def = def.slice(0, exampleMatch.index).trim();
    }
    const zh = (zhRaw ?? "").trim();
    const en = (enRaw ?? "").trim();
    if (!zh || !en || !def) {
      fail(`术语缺字段：${item.trim()}`, file);
      return;
    }
    termItems.push({ zh, en, def, ...(example ? { example } : {}) });
  };

  for (; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // 代码围栏
    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      const info = trimmed.slice(3).trim();
      const lang = info.split(/\s+/)[0] ?? "";
      if (!["ts", "typescript"].includes(lang)) {
        // 允许无语言标注的代码块，但要求正文说明
        warnings.push(`${file}: 代码块语言标注为 "${lang}"，建议用 ts 围栏`);
      }
      const captionMatch = /caption[:：]\s*(.+)$/.exec(info);
      const codeLines: string[] = [];
      index += 1;
      for (; index < lines.length; index += 1) {
        if (/^```\s*$/.test((lines[index] ?? "").trim())) break;
        codeLines.push(lines[index] ?? "");
      }
      const code = codeLines.join("\n").replace(/\s+$/, "");
      if (code.length === 0) fail("空代码块", file);
      if (codeLines.length > MAX_CODE_LINES) fail(`代码块 ${codeLines.length} 行 > ${MAX_CODE_LINES} 行（${trimmed}）`, file);
      blocks.push({ kind: "code", code, ...(captionMatch ? { caption: (captionMatch[1] ?? "").trim() } : {}) });
      continue;
    }

    // callout
    const calloutMatch = /^:::(tip|warn|aside)(?:\s+(.+))?$/.exec(trimmed);
    if (calloutMatch) {
      flushParagraph();
      flushList();
      const tone = calloutMatch[1] as "tip" | "warn" | "aside";
      const titleText = (calloutMatch[2] ?? "").trim();
      const inner: string[] = [];
      index += 1;
      for (; index < lines.length; index += 1) {
        if ((lines[index] ?? "").trim() === ":::") break;
        inner.push(lines[index] ?? "");
      }
      const text = inner
        .reduce<string[]>((acc, item) => {
          if (item.trim() === "") acc.push("\n");
          else acc.push(item);
          return acc;
        }, [])
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!text) fail("空 callout", file);
      blocks.push({ kind: "callout", tone, ...(titleText ? { title: titleText } : {}), text });
      continue;
    }

    // 标题
    const headingMatch = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushTerms();
      const text = (headingMatch[2] ?? "").trim();
      if ((headingMatch[1] ?? "").length === 2) {
        blocks.push({ kind: "h2", text });
        if (text === "术语" || text === "术语表") {
          inTermsSection = true;
        }
      } else {
        blocks.push({ kind: "h3", text });
      }
      continue;
    }
    if (trimmed.startsWith("# ")) {
      // 章标题行（若 front matter 没有 title 则用它）
      title = trimmed.slice(2).trim();
      continue;
    }
    if (/^>\s?/.test(trimmed) && !subtitle) {
      subtitle = trimmed.replace(/^>\s?/, "").trim();
      continue;
    }

    // rule
    if (trimmed === "---") {
      flushParagraph();
      flushList();
      blocks.push({ kind: "rule" });
      continue;
    }

    // list
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const nextOrdered = Boolean(orderedMatch);
      if (list.length > 0 && nextOrdered !== ordered) flushList();
      ordered = nextOrdered;
      const item = (bulletMatch?.[1] ?? orderedMatch?.[1] ?? "").trim();
      if (inTermsSection && bulletMatch) parseTerm(item);
      else list.push(item);
      continue;
    }

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushTerms();
  return { blocks, terms: termsBlock, title, subtitle };
}

/* ------------------------------- 校验 ------------------------------------- */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

function countCjk(blocks: TextbookBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    const texts: string[] = [];
    if (block.kind === "p" || block.kind === "h2" || block.kind === "h3") texts.push(block.text);
    else if (block.kind === "callout") texts.push(block.text);
    else if (block.kind === "list") texts.push(...block.items);
    else if (block.kind === "terms") texts.push(...block.items.map((item) => `${item.zh}${item.def}`));
    for (const text of texts) {
      for (const char of text) if (CJK.test(char)) count += 1;
    }
  }
  return count;
}

function allowedApiNames(levelId: string): Set<string> {
  const order = Number(levelId.slice(1));
  const names = new Set<string>();
  for (const entry of API_REGISTRY) {
    const since = Number(entry.sinceLevel.slice(1));
    if (since > order) continue;
    for (const match of entry.signature.matchAll(/(?:golem|world|agent|left|right)\.([A-Za-z_$][\w$]*)/g)) {
      names.add(match[1] ?? "");
    }
    if (entry.signature.includes("agent(")) names.add("agent");
  }
  // api-registry 目前只登记到 L04；L05–L10 的真实 API 主要在 world.vars/原生数组方法，
  // L10 额外有 agent/消息/供给/合龙石（见 packages/runner/src/sandbox.ts 注入面 +
  // content/levels/L10.content.ts 参考解）。这里按关卡补齐白名单，避免教材写作被误判。
  const extrasByLevel: Record<string, string[]> = {
    L05: ["vars", "points", "push", "length"],
    L06: ["vars", "points"],
    L07: ["vars", "points", "filter", "map"],
    L08: ["vars", "points", "filter", "map", "slice", "reverse"],
    L09: ["vars", "points", "filter", "map", "all"],
    L10: [
      "agent", "waitIdle", "send", "receive",
      "supply", "keystone", "vars", "points",
      "moveTo", "place", "say", "collect", "deposit", "count",
      "filter", "map", "all", "ceil", "floor",
    ],
  };
  const levelKey = levelId;
  for (const key of ["L05", "L06", "L07", "L08", "L09", "L10"]) {
    if (Number(key.slice(1)) <= order) for (const name of extrasByLevel[key] ?? []) names.add(name);
  }
  void levelKey;
  return names;
}

function checkCode(code: string, levelId: string, file: string, index: number): void {
  const label = `${file} 代码块#${index + 1}`;
  try {
    // 学生代码在 runner 里会被包进 async 函数执行（packages/runner/src/transform.ts），
    // 所以 L09/L10 的顶层 await 是合法的；校验时用同样的包装，target 与运行侧一致。
    transformSync(`async function __loomTextbookMain__() {\n${code}\n}`, {
      loader: "ts",
      target: "es2022",
      format: "esm",
    });
  } catch (error) {
    fail(`${label} 语法无效：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, file);
  }
  const allowed = allowedApiNames(levelId);
  for (const match of code.matchAll(/\b(golem|world|agent|left|right)\.([A-Za-z_$][\w$]*)/g)) {
    const root = match[1] ?? "";
    const member = match[2] ?? "";
    // world.vars / world.points / world.container / world.supply / world.keystone 等以 registry 为准；
    // agent(...) 是函数不是属性。
    if (!allowed.has(member) && !["vars", "points"].includes(member)) {
      fail(`${label} 使用了本关未引入（或不存在）的 API：${root}.${member}`, file);
    }
  }
  for (const symbol of FORBIDDEN_SYMBOLS) {
    if (code.includes(symbol)) fail(`${label} 使用了禁止的设计稿/未接线符号：${symbol}`, file);
  }
}

/* ------------------------------- 主流程 ----------------------------------- */

function main(): void {
  const write = process.argv.includes("--write");
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only=")) ?? "";
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((item) => item.trim()).filter(Boolean) : [];
  if (!fs.existsSync(CONTENT_DIR)) {
    fail(`教材内容目录不存在：${CONTENT_DIR}`);
  }
  const allFiles = fs.existsSync(CONTENT_DIR) ? fs.readdirSync(CONTENT_DIR).filter((name) => name.endsWith(".md")).sort() : [];
  if (allFiles.length === 0) fail("没有任何 .md 教材文件");
  const files = only.length > 0 ? allFiles.filter((name) => only.includes(path.basename(name, ".md"))) : allFiles;

  const library: TextbookLibrary = {};
  for (const name of files) {
    const file = path.join(CONTENT_DIR, name);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const { meta, bodyStart } = parseFrontMatter(lines, name);
    const levelId = String(meta.levelId ?? "").trim();
    if (!/^L\d{2}$/.test(levelId)) fail(`front matter 的 levelId 不合法：${JSON.stringify(meta.levelId)}`, name);
    if (library[levelId]) fail(`levelId 重复：${levelId}`, name);
    const act = Number(meta.act ?? 0);
    const order = Number(meta.order ?? 0);
    const minutes = Number(meta.minutes ?? 0);
    if (![1, 2, 3].includes(act)) fail(`act 必须是 1/2/3：${JSON.stringify(meta.act)}`, name);
    if (!Number.isInteger(order) || order < 1 || order > 10) fail(`order 必须是 1–10：${JSON.stringify(meta.order)}`, name);
    if (!Number.isFinite(minutes) || minutes < 3) fail(`minutes 不合法：${JSON.stringify(meta.minutes)}`, name);
    const prereq = Array.isArray(meta.prereq) ? meta.prereq : [];
    const goals = Array.isArray(meta.goals) ? meta.goals : [];
    if (goals.length < 3 || goals.length > 5) fail(`goals 应为 3–5 条（当前 ${goals.length}）`, name);

    const { blocks, terms, title: h1Title, subtitle: quoteSubtitle } = parseBlocks(lines, bodyStart, name, levelId);
    const title = String(meta.title ?? h1Title ?? "").trim();
    const subtitle = String(meta.subtitle ?? quoteSubtitle ?? "").trim();
    if (!title) fail("缺少标题（front matter title 或 # 标题）", name);
    if (!subtitle) fail("缺少副标题（front matter subtitle 或 > 引用）", name);

    const allBlocks = terms ? [...blocks, terms] : blocks;
    const cjk = countCjk(allBlocks);
    if (cjk < MIN_CJK_CHARS) fail(`正文汉字数 ${cjk} < 下限 ${MIN_CJK_CHARS}`, name);
    const codeBlocks = allBlocks.filter((block) => block.kind === "code");
    if (codeBlocks.length < MIN_CODE_BLOCKS) fail(`代码块 ${codeBlocks.length} < ${MIN_CODE_BLOCKS}`, name);
    codeBlocks.forEach((block, index) => {
      const code = block.kind === "code" ? block.code : "";
      checkCode(code, levelId, name, index);
    });
    const warnCallouts = allBlocks.filter((block) => block.kind === "callout" && block.tone === "warn").length;
    if (warnCallouts < 1) fail("缺少 warn callout（常见误解）", name);
    if (terms) {
      const termItems = terms.kind === "terms" ? terms.items : [];
      for (const item of termItems) {
        if (!item.zh || !item.en || !item.def) fail(`术语字段不完整：${JSON.stringify(item)}`, name);
      }
      if (termItems.length < MIN_TERMS) fail(`术语数量 ${termItems.length} < ${MIN_TERMS}`, name);
    } else {
      fail("缺少「## 术语」小节", name);
    }

    const chapter: TextbookChapter = {
      levelId,
      act: act as 1 | 2 | 3,
      order,
      title,
      subtitle,
      minutes,
      prereq,
      goals,
      blocks: allBlocks,
    };
    library[levelId] = chapter;
    stats.push({ file: name, levelId, cjk, codeBlocks: codeBlocks.length, terms: terms && terms.kind === "terms" ? terms.items.length : 0, blocks: allBlocks.length });
  }

  // 10 章齐全 + order 唯一（--only 子集校验时跳过全局完整性）
  if (only.length === 0) {
    for (const levelId of LEVEL_IDS) {
      if (!library[levelId]) fail(`缺少章节：${levelId}`);
    }
    const orders = new Set<number>();
    for (const chapter of Object.values(library)) {
      if (orders.has(chapter.order)) fail(`order 重复：${chapter.order}`);
      orders.add(chapter.order);
    }
  } else if (write) {
    fail("--only 只能用于 --check 子集校验；写生成文件前请去掉 --only 并补齐全部章节");
  }

  const sorted = Object.fromEntries(Object.entries(library).sort(([a], [b]) => a.localeCompare(b)));
  const totalCjk = stats.reduce((sum, item) => sum + Number(item.cjk ?? 0), 0);

  console.log("[textbook] 章节统计：");
  for (const item of stats) {
    console.log(
      `  ${item.levelId}  ${String(item.cjk).padStart(6)} 字  ${String(item.codeBlocks).padStart(2)} 代码块  ${String(item.terms).padStart(2)} 术语  (${item.file})`,
    );
  }
  console.log(`[textbook] 合计 ${totalCjk} 字，${Object.keys(library).length} 章`);

  if (errors.length > 0) {
    console.error(`\n[textbook] 校验失败（${errors.length} 项）：`);
    for (const error of errors.slice(0, 80)) console.error(`  - ${error}`);
    process.exit(1);
  }
  for (const warning of warnings.slice(0, 40)) console.warn(`  warn: ${warning}`);

  if (write) {
    const banner = "// 由 scripts/build-textbook.ts 生成，请勿手改；源文件在 apps/studio/src/textbook/content/*.md\n";
    const content = `${banner}import type { TextbookLibrary } from "./types";\n\nexport const TEXTBOOK: TextbookLibrary = ${JSON.stringify(sorted, null, 2)};\n`;
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, content, "utf8");
    console.log(`[textbook] 已生成 ${path.relative(ROOT, OUT_FILE)}`);
  } else {
    console.log("[textbook] 校验通过（--write 才会更新生成文件）");
  }
}

main();
