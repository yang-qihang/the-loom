# 06b — Level-Kit 实现规格（@loom/level-spec · @loom/grading · @loom/worlddigest）

> 状态：v1 草稿｜负责人：scout-prior-art（Lead 委派）｜最后更新：2026-10-31｜上游：docs/06、content/level-spec.schema.json、docs/07 §4/§5/§8/§9/§10、docs/12、research/assurance-notes.md §6、docs/08-appendix-templates.md §A.6–A.8
> 定位：把 docs/06 的 spec 体系下沉为「Day 1 可照写」的实现规格。**本文件不改 docs/06 与 schema**；发现的冲突列在 §8「待 Lead 裁决」。
> 版本依据：zod 4.6.7 / fast-check 4.10.2 / Vitest 5.0.5 / esbuild 0.28.2 / TypeScript 6.0.3 均为 docs/07 §10 已锁版本（2026-10-31 经 npm registry 复核）；候选库 yaml 2.9.1、acorn 8.19.0、expect-type 1.4.0 同日查得。

## 0. TL;DR（8 条）

1. 三个包都是**纯数据/纯函数**：level-spec 产类型与 Issue，grading 读 `WorldSnapshot` 产 `GradeReport`，worlddigest 负责快照归一化/hash/ASCII/diff；都不碰文件、网络、时钟、随机。
2. 唯一契约源是 zod schema：`defineLevel()` 只做 `z.infer` + 运行期兜底；JSON Schema 由 `z.toJSONSchema(..., { target: "draft-7" })` 生成，不再手写 `content/level-spec.schema.json`（见 §8 D-1）。
3. validator 固定 **10 个 Issue 码 SPEC-01…SPEC-10**（映射 docs/06 §6.1 的 14 条机器规则）+ 1 个断言语义码 SPEC-11；编号与 docs/08 附录 §A.6 的 SM-1…SM-5 对齐。
4. 判定优先用**结构化 `expect` DSL**（纯数据、无 eval）；`check` JS 字符串只作逃生舱：acorn 解析 + AST 白名单 + grading-worker 内 `vm.compileFunction` + 2s 硬超时。
5. 每次 check 500ms（docs/07 §11），一次 evaluation 总预算 2s；`g` 全部方法是冻结快照上的只读纯函数，抛错/超时判该条失败并记 GR 码，不静默 pass。
6. trials/hidden 的种子 = `sha256(levelId:trialId:sessionSeed)` 取前 8 位十六进制；**hidden 种子不含 attempt**，防止反复提交"钓鱼"；每次验收的种子写进报告可复现。
7. WorldDigest 归一化后做递归键排序再 sha256；ASCII 是确定性的俯视字符图；golden diff 先比 hash、不等再输出结构化 diff。
8. 实现顺序：Day1 AM 先冻结 `WorldSnapshot`/`LevelDef` 类型 → level-spec validator → grading/expect → worlddigest → CLI/MockWorld 验收链。level-spec 必须最先可用，否则内容 agent 无法开工。

## 1. 包边界与冻结接口

```mermaid
graph LR
  LS[@loom/level-spec] -->|LevelDef/Check/Trial 类型| GR[@loom/grading]
  WD[@loom/worlddigest] -->|WorldSnapshot/DigestDiff| GR
  LS -->|validateSpec / CLI| CI[content/levels/*.level.ts]
  GR -->|GradeReport| RUN[apps/runner]
  WD -->|hash/ascii/diff| RUN
```

| 包 | 职责 | 明确不做 | 对外入口 |
|---|---|---|---|
| `packages/level-spec` | zod schema、`defineLevel`、`validateSpec`、tsconfig 生成、starter 注入、`level:validate`/`level:verify` CLI | 不跑学生代码、不读世界 | `src/index.ts` + `bin/level-kit.mjs` |
| `packages/grading` | `g` 判定 API、`expect` 解释器、`check` 沙箱、trials/hidden 评分汇总 | 不做场景重置、不管 RPC | `src/index.ts`（仅纯函数） |
| `packages/worlddigest` | `WorldSnapshot` 类型、归一化、`digestHash`、ASCII、golden diff | 不解释关卡、不判分 | `src/index.ts` + `bin/worlddigest.mjs` |

共同约束：ESM、`sideEffects: false`、无 top-level IO；所有公开函数输入不可变（`Readonly<T>`），输出可 JSON 序列化；`schemaVersion` 字段必须存在，破坏性变更升版本。

## 2. @loom/level-spec

### 2.1 `defineLevel()` 与 zod schema

```ts
// packages/level-spec/src/schema.ts（节选；完整字段 1:1 对应 content/level-spec.schema.json）
import { z } from "zod";

export const PosLikeSchema = z.union([
  z.tuple([z.number(), z.number(), z.number()]),
  z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/), // "x,y,z"
]);

const I18n = z.strictObject({ zh: z.string().min(1), en: z.string().optional() });

const Check = z.union([
  z.strictObject({ id: z.string().min(1), text: z.string().max(80), check: z.string().min(8) }),
  z.strictObject({ id: z.string().min(1), text: z.string().max(80), expect: z.unknown() }),
]);

export const LevelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  meta: z.strictObject({
    id: z.string().regex(/^(L(0[1-9]|1[0-1])|LAB-[A-Z])$/),
    title: I18n,
    act: z.number().int().min(1).max(3),
    order: z.number().int().min(1),
    priority: z.enum(["P0", "P1", "P2", "P3"]),
    prerequisites: z.array(z.string()),
    estimatedMinutes: z.number().int().min(5).max(35),
    difficulty: z.number().int().min(1).max(5),
    abstractions: z.array(z.string().regex(/^(A([0-9]|1[0-4])|X[12])$/)).min(1).max(2),
    apiIntroduced: z.array(z.string()),
    apiAllowlist: z.array(z.string()),
    syntaxIntroduced: z.array(z.string()),
    reward: z.strictObject({
      rune: z.string().regex(/^(A([0-9]|1[0-4])|X[12])$/),
      advancement: z.string().regex(/^loomcraft\/[a-z0-9_/]+$/),
      codexPage: z.string().regex(/^(A([0-9]|1[0-4])|X[12])$/),
    }),
  }),
  task: z.strictObject({
    mainTask: z.string().max(600),
    makeTask: z.string().max(400),
    playerBeat: z.string().max(200),
    successCriteria: z.array(Check).min(1),
    trials: z.array(z.unknown()).default([]),
    hiddenTests: z.array(z.unknown()).min(1),
  }),
  code: z.strictObject({
    starterCode: z.string().min(20),
    referenceSolution: z.string().min(20),
    expectedLoc: z.number().int().min(3).max(120),
    languageLevel: z.enum(["act1", "act2", "act3"]),
  }),
  // narrative / world / pedagogy / feedback / boundaries / acceptance 按 schema 1:1 补齐
});

export type PosLike = z.infer<typeof PosLikeSchema>;
export type LevelDef = z.infer<typeof LevelSchema>;

export function defineLevel(def: LevelDef): LevelDef {
  const r = LevelSchema.safeParse(def);
  if (!r.success) {
    throw new Error(r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  return r.data;
}
```

`defineLevel` 是恒等函数：**编译期由 `tsc`（level 自己的 tsconfig）拦截，运行期 safeParse 兜底**；内容文件里写错字段必须直接红，不允许静默丢弃（`strictObject`）。

### 2.2 `validateSpec(spec, ctx): Issue[]`

```ts
export type IssueCode = `SPEC-${string}` | `SPEC-W${string}`;
export interface Issue {
  code: IssueCode;              // SPEC-01…SPEC-11
  severity: "error" | "warn";
  path: string;                 // "meta.apiIntroduced[1]"（zod issue.path 拼接）
  message: string;              // 一句话，可读
  hint?: string;                // 修法提示（给内容 agent）
  doc?: string;                 // 对应 docs/06 §6.1 的规则号，如 "docs/06 §6.1#5"
}
export interface ValidateContext {
  levels: LevelDef[];           // 课程全量（建图用）
  registry: ApiRegistry;        // 由 docs/12 生成的机器可读表（见 §8 D-2）
  syntaxByLevel: Record<string, string[]>;
  runLevelCheck?: "off" | "compile" | "full"; // full 才跑 SPEC-07/08 的编译与 MockWorld
}
export function validateSpec(spec: LevelDef, ctx: ValidateContext): Issue[];
```

### 2.3 `npm run level:validate` CLI

实现机制：用已锁的 esbuild 0.28.2 把 `content/levels/*.level.ts` bundle 成 ESM（学生不可见、内容 author 也不需要构建配置），再 `import()` 拿到 `LevelDef`；**不引入 tsx/jiti 新依赖**。

| 参数 | 行为 |
|---|---|
| 无参数 | 全量：`content/levels/**/*.level.ts`，输出表（level/code/path/message） |
| `--level L03` | 只验一关，调试用 |
| `--format json` | 机器可读输出（CI 用）；默认 text |
| `--strict` | warn 视为 error（CI L2 用；本地开发不加） |
| `--no-code` | 跳过 SPEC-07/08（不需要起 MockWorld 的快速路径） |
| `--write-json-schema` | 从 zod 生成 `contracts/level-spec.schema.json`（`gen-json-schema --check` 用） |

退出码：`0` 全绿；`1` 有 error；`2` 用法错误；`3` 环境缺失（缺 registry 生成物/MockWorld 不可用）。与 docs/08 附录 §A.6 的 `qa/spec-mutation.mjs` 约定一致：破坏 spec 后必须 exit 1。

### 2.4 按关 tsconfig 生成

```ts
// packages/level-spec/src/tsconfig.ts
export type LanguageLevel = "act1" | "act2" | "act3";
export interface GeneratedTsconfig {
  compilerOptions: Record<string, unknown>;
  files: string[];
}
export function tsconfigFor(level: LevelDef): GeneratedTsconfig; // 纯函数，无 IO
```

| languageLevel | strict | noImplicitAny | strictNullChecks | target/module | 说明 |
|---|---|---|---|---|---|
| act1（L1–L4） | false | false | false | ES2022 / ESNext | 零类型注解；编辑器只做补全 |
| act2（L5–L7） | false | false | false | 同上 | `type`/联合可出现；`Array<T>` 自然形态 |
| act3（L8–L10） | true | true | true | 同上 | 类型是教具，但诊断不阻断运行（docs/03 §3.2） |

同一函数产出的 JSON 同时喂 Monaco（`setCompilerOptions`）与 runner 的 esbuild（`tsconfigRaw`），保证「编辑器显示」与「实际编译」一致；`noUnusedLocals` 等 4 项永不开启（docs/03 §3.2）。

### 2.5 starter 骨架注入与 `level:verify`

```ts
export interface EditorFile { path: string; content: string; readonly?: boolean }
export function buildEditorFiles(level: LevelDef): EditorFile[];
export function buildRunnerInput(level: LevelDef, which: "starter" | "reference" | "student", files?: EditorFile[]): {
  entry: string; files: Record<string, string>; languageLevel: LanguageLevel;
};
```

- `starter`：注入 `main.ts`（=`code.starterCode`）+ 可选 `blueprints.ts`（L5 起）；SDK 类型来自 `packages/sdk`，学生不写 import（docs/03 §3.1）。
- 契约（对应 SPEC-07）：同一 MockWorld + 同一 seed 下，`starter` 必须**判定失败**且不含 hidden 常量；`reference` 必须**判定通过**。CLI：

```bash
npm run level:verify -- --level L01          # 依次跑 starter(期望 fail) → reference(期望 pass) → 记录 seed
# 退出码 0=两支都对；1=契约破坏（starter 通过 / reference 不过）；2=用法错；3=环境缺失
```

### 2.6 14 条机器规则 → 实现映射（固定 10 个 Issue 码）

| # | docs/06 §6.1 规则 | 实现（读字段 + 算法 + 库） | Issue 码 | 可机器 |
|---|---|---|---|---|
| 1 | JSON Schema | `LevelSchema.safeParse`；zod issue → path/message；`strictObject` 拒绝多余字段 | SPEC-01 | ✅ |
| 2 | prerequisites 存在且已解锁 | 由 `ctx.levels` 建 DAG：id 存在、`order` 小于当前、无环（dfs）；运行时"解锁"不在本包 | SPEC-02 | ✅（顺序） |
| 3 | abstractions 合法且 ≤2 | 正则白名单 + `length ≤ 2` + `reward.rune/codexPage ∈ abstractions` | SPEC-02 | ✅ |
| 4 | objectives.evidence 有机器落点 | evidence 用前缀引用：`trial:<id>`、`hidden:<id>`、`criterion:<id>`、`predict:<id>`；前三种必须命中，`predict:` 记 warn | SPEC-03 | 部分 |
| 5 | apiAllowlist 不越级 | 从 docs/12 生成的 `registry.json`（symbol → 引入关卡）取并集；`apiIntroduced` 必须属于本关允许集合，`apiAllowlist ⊆ 前置并集 ∪ apiIntroduced` | SPEC-05 | ✅ |
| 6 | syntaxIntroduced 合法 | `syntaxByLevel`（docs/05 §7.1 机器化）子集检查；token 级启发式扫描 starter/reference（正则） | SPEC-08 | ✅ |
| 7 | starter/reference 可编译；reference 通过；starter 必失败 | `tsc --noEmit`（GeneratedTsconfig）+ esbuild bundle；MockWorld 跑两支；starter 通过即 error | SPEC-07 | ✅（full 模式） |
| 8 | hiddenTests ≥1；随机化 ≥1 且 hiddenOnly | `hiddenTests.length ≥ 1`（L1/L2 允许静态换位变体，用 `variants` 兼容）；`randomization.hiddenOnly === true` | SPEC-06 | ✅ |
| 9 | 教练文本/提示/目标/字数预算 | hints 恰好 3 且 level 1..3、dialog ≤10、objective ≤3、单条 ≤45、narrative ≤400、mainTask ≤120 | SPEC-04 | ✅ |
| 10 | playerBeat 可检测；wow 有音效+粒子 | `playerBeat` 必须命中动作白名单（右键/放方块/交易/敲钟…）；`wowMoment` 文本启发式匹配 `sound`+`particle` 关键词（或建议加机器字段，见 §8 D-6） | SPEC-10 | 部分 |
| 11 | advancement 全局唯一；rune 与课程一致 | 跨 `ctx.levels` 收集 advancement，重复即 error；rune/codexPage 与 docs/05 表比对 | SPEC-09 | ✅ |
| 12 | 英文标识符/中文术语 | api 名 ⊆ registry ∪ 语言关键字；术语表（BRIEF §7）包含的专名不出现在学生可见文本的"新造词"里（启发式） | SPEC-09 | 部分 |
| 13 | 提示恰好 3 级/单条 ≤45/UI 目标 ≤3 | 同 #9，逐数组计数 | SPEC-04 | ✅ |
| 14 | 叙事 ≤400 字、任务说明 ≤120 字 | 中文字符计数（`[...text].length`，不含代码块） | SPEC-04 | ✅ |

**SPEC-11（断言语义，warn/error 混合）**：`qa/spec-mutation.mjs` SM-5 要抓「断言恒真」。实现：对 `check` 做 AST 白名单 + 三模式检测（`() => true`、字面量 `true`、无 `return`/箭头体不是表达式）；`expect` 检查 `all` 空数组、`not` 与明显矛盾组合。静态可证 → error；其余 → warn。该码是 docs/08 附录 §A.6 的 SM-5 落点。

### 2.7 无法机器检查的部分（留给 rubric / agent）

`content/` 评审的 docs/06 §6.2 R1–R10 中，以下只能人工/LLM 评审：R1 教学对齐（声明的抽象是否真的被教）、R2 painBeat 情绪强度、R3 starter→reference 的坡度是否平滑（只查代码增量倍数）、R4 MC 地道性、R5 可玩性/啊哈瞬间、R7 提示质量（是否"逐级加强但不给答案"）、R8 wow 的画面可行性、R10 场景可实现性（坐标/区域/重置安全）。validator 只保证「可机器验证的前置条件」，不代替评审。

## 3. @loom/grading

### 3.1 入口与报告类型

```ts
import type { WorldSnapshot } from "@loom/worlddigest";
import type { LevelDef } from "@loom/level-spec";

export type RunKind = "main" | "trial" | "hidden";
export interface GradeOptions { kind: RunKind; trialId?: string; checkTimeoutMs?: number }  // 默认 500
export interface Outcome { id: string; ok: boolean; message?: string; errorCode?: string }
export interface GradeReport {
  ok: boolean;                 // 主判定 + 全部 trials + 全部 hidden
  stars: 0 | 1 | 2 | 3;        // 1=主判定全过，2=+trials，3=+hidden（建议口径，见 §8 D-4）
  criteria: Outcome[];
  trials: Outcome[];           // 每次验收的 trials 汇总
  hidden: Outcome[];
  seedLog: SeedRecord[];       // {levelId, trialId, sessionSeed, trialSeed}
}
export function evaluate(level: LevelDef, snap: WorldSnapshot, opts: GradeOptions): GradeReport;
```

`evaluate` 是纯函数：同一 `(level, snap, opts)` 必须得到逐字节相同的报告；实现内部 `structuredClone` + `deepFreeze` 快照，禁止读取 `Date`/`Math.random`/环境变量。

### 3.2 `g` 判定 API（冻结）

```ts
import type { BlockId, ItemId, LevelDef, PosLike } from "@loom/level-spec";
import type { WorldSnapshot } from "@loom/worlddigest";

export type RegionLike = { from: PosLike; to: PosLike } | { center: PosLike; radius: number };
export interface EntitySelector { type?: string; tag?: string; name?: string; radius?: { center: PosLike; r: number } }
export interface EntityView { id: string; type: string; pos: [number, number, number]; name?: string }
export interface AgentView { id: string; pos: [number, number, number]; state: string; holding: ItemId | null }
export interface WorldEventView { seq: number; type: string; actor: string; pos?: [number, number, number]; tick: number }
export interface TrialView { trialId: string; snapshot: WorldSnapshot }

export interface G {
  block(pos: PosLike): BlockId | null;                       // null=快照外或未知
  blocks(list: readonly PosLike[]): (BlockId | null)[];
  countBlocks(region: RegionLike, id?: BlockId): number;     // region: {from,to} 或 {center,radius}
  itemCount(container: PosLike | string, item?: ItemId): number; // 省略 item 返回总件数
  containersEqual(a: PosLike, b: PosLike, opts?: { ignoreNames?: boolean }): boolean;
  entities(sel?: EntitySelector): EntityView[];              // 按 id 排序，纯读
  agent(id: string): AgentView;                              // 见 §8 D-9：只按 id 重载
  events(type?: string): WorldEventView[];                   // 按 seq 升序
  trial(trialId: string): TrialView;                         // 仅验收上下文；缺数据 → GR-06
  time(): { ticks: number; phase: "day" | "dusk" | "night" | "dawn"; day: number };
  allOf(...xs: boolean[]): boolean;
  anyOf(...xs: boolean[]): boolean;
  not(x: boolean): boolean;
}
```

| 方法 | 输入 | 输出 | 语义/边界 | 错误 |
|---|---|---|---|---|
| `block` | `PosLike` | BlockId 或 null | 坐标非整数按 `Math.round`；快照外→null；空气返回 `minecraft:air` | GR-05 |
| `countBlocks` | region + 可选 id | number | region 与 `protectedBlocks` 无关；越界裁剪不报错 | GR-07（region 非法） |
| `itemCount` | 容器 pos 或 id | number | 取归一化后 items 计数；缺容器→0 并 warn | GR-05 |
| `containersEqual` | 两容器 | boolean | 先聚合同 item、去零、忽略顺序；`ignoreNames` 默认 false | GR-05 |
| `entities` | selector | 数组 | selector 字段：`type? tag? name? radius?`；结果按 id 字典序 | GR-05 |
| `agent` | id | AgentView | id 不存在时抛 GR-05（区别于返回 null） | GR-05 |
| `events` | 可选 type | 数组 | 已按 seq 排序并去重（归一化保证） | — |
| `trial` | trialId | TrialView | 只在一次验收内可查先前 trial 的快照；主判定里调用会缺数据 | GR-06 |
| `time` | — | 时间视图 | 由 `snap.time` 与 `dimension` 派生 phase（`0–12000` day / `12000–13800` dusk / `13800–22200` night / `22200–24000` dawn） | — |
| 组合子 | boolean | boolean | 只允许返回 boolean；非 boolean 直接判 false + GR-02 | GR-02 |

每个 check 的超时：默认 500ms（docs/07 §11）；超时记 `GR-01 CHECK_TIMEOUT`，该条**判失败**，不静默通过。

### 3.3 `check` JS 字符串的沙箱（逃生舱）

**两条路线，推荐 A**：

| | A（推荐） | B |
|---|---|---|
| 解析 | acorn 8.19.0 + acorn-walk 做 ESTree 白名单 | meriyah 7.4.1（更快的 ESTree parser） |
| 执行 | `grading-worker`（worker_threads，`resourceLimits`）内 `vm.compileFunction(code, ["g"])` | 只允许 `expect`，禁用 `check`（把现有 check 全改写） |
| 静态防线 | 白名单：标识符仅 `g`、字面量、运算符、箭头/三元、局部 const/let、数组方法；黑名单命中即 SPEC-11 | — |
| 动态防线 | 冻结快照 + 注入只读 `g`；worker 2s 硬超时 `terminate`；无 `require`/`process`/`fetch` 可达 | — |
| 成本 | 一个 worker/次 evaluation，约 +15ms | 最低，但表达力不足 |

黑名单（命中即拒绝）：`require`、`import`、`process`、`globalThis`、`fetch`、`WebSocket`、`Date`、`Math.random`、`setTimeout`、`setInterval`、`eval`、`Function`、`Atomics`、`SharedArrayBuffer`、`console`。AST 白名单是**主防线**（内容由 AI 生成，可能被污染）；`vm` 只作纵深防御，不把它当安全边界（docs/07 §4 已明确 `node:vm` 不是安全机制）。

### 3.4 `expect` 结构化 DSL（推荐主路径）

```ts
export type ExpectNode =
  | { op: "all"; nodes: ExpectNode[] }
  | { op: "any"; nodes: ExpectNode[] }
  | { op: "not"; node: ExpectNode }
  | { op: "block"; pos: PosLike; is: BlockId }
  | { op: "countBlocks"; region: RegionLike; block: BlockId; min?: number; max?: number }
  | { op: "itemCount"; container: PosLike; item: ItemId; eq?: number; min?: number }
  | { op: "containersEqual"; a: PosLike; b: PosLike; ignoreNames?: boolean }
  | { op: "agentNear"; id: string; pos: PosLike; radius: number }
  | { op: "events"; type: string; min?: number; max?: number }
  | { op: "trialAttr"; trial: string; path: string; eq: unknown };
```

`expect` 是**纯数据**：validate 时用 zod 校验（见 §2.1 的 `Check`），evaluation 时由固定解释器逐 op 调 `g`，零 `eval`。它覆盖 L01 的四类断言（灯亮/回家/玩家点灯/顺序）与 L03 的 trial 断言；表达不了时用 `check`。`trialAttr` 的 `path` 用点路径（如 `"bellRang"`、`"events.bell.ring"`），解释器用只读路径取值，非法路径 → GR-06。

### 3.5 trials / hiddenTests 重跑协议与种子

```ts
// packages/grading/src/seed.ts —— 纯函数，node:crypto
import { createHash } from "node:crypto";

export function trialSeed(levelId: string, trialId: string, sessionSeed: number): number {
  const hex = createHash("sha256").update(`${levelId}:${trialId}:${sessionSeed}`).digest("hex");
  return parseInt(hex.slice(0, 8), 16) >>> 0; // uint32
}
```

| 步骤 | 动作 | 失败处理 |
|---|---|---|
| 1 | runner 调 `worldPort.beginTrial(levelId, trialSeed)`（docs/07 §5） | 重试 1 次；仍失败 → 该条 error（不判学生失败） |
| 2 | 场景重置（`rebuild_region`）+ 注入 `worldPatch`/variant | 重置失败 → 回退 `reload_world`；仍失败 → env error |
| 3 | 新 worker 跑学生代码（3s 超时/指令预算，docs/07 §4） | 超时 → 该 trial 失败并给方向性提示 |
| 4 | 插件权威快照 → `normalize` → `evaluate(level, snap, {kind:"trial", trialId})` | 断言异常 → GR-02，判失败 |
| 5 | 记录 `seedLog`（levelId/trialId/sessionSeed/trialSeed） | 缺记录 = 验收无效 |

隔离：trial 之间**新建 WorldPort 会话 + 新 worker + 新场景重置**；`normalize` 必须带 `trialId`，跨 trial 快照串用直接 error。hiddenTests 同协议但不在 UI 展示；其随机变体种子同样**不含 attempt**（防止重试钓鱼），失败只给方向性提示（docs/06 §5.2）。

### 3.6 部分成功与错误码

- 建议星级（见 §8 D-4）：0 星 = 主判定未过；1 星 = 主判定全过；2 星 = +全部 trials；3 星 = +全部 hidden。报告同时给 `partial = passed / total`，UI 只渲染 0–3 星。
- `GR` 错误码：GR-01 CHECK_TIMEOUT、GR-02 CHECK_THREW、GR-03 BANNED_API、GR-04 NONDETERMINISTIC、GR-05 INVALID_POS、GR-06 UNKNOWN_TRIAL、GR-07 INVALID_REGION、GR-08 SNAPSHOT_STALE（snapshot 的 levelId/trialId 与请求不符）。

### 3.7 易错语义的测试样例（每条 3–5 个）

```ts
// (a) 穷举：类型级 + 运行期双保险
// packages/grading/src/expect.ts
function assertNever(x: never): never { throw new Error(`unreachable op: ${String(x)}`); }
function explain(node: ExpectNode, g: G): boolean {
  switch (node.op) {
    case "all": return node.nodes.every((n) => explain(n, g));
    case "any": return node.nodes.some((n) => explain(n, g));
    case "not": return !explain(node.node, g);
    // …其余 7 个 case 一律调对应 g 方法
    default: return assertNever(node);   // 新增 op 未处理时 tsc 报“不能把 X 赋给 never”
  }
}
// packages/grading/test/exhaustive.test-d.ts：op 联合必须与 schema 同步
expectTypeOf<ExpectNode["op"]>().toEqualTypeOf<
  "all" | "any" | "not" | "block" | "countBlocks" | "itemCount"
  | "containersEqual" | "agentNear" | "events" | "trialAttr"
>();
// 运行期：未知 op（Zod 校验被绕过时）→ GR-02，绝不 pass
expect(evalExpect({ op: "unknown" } as unknown as ExpectNode, g).ok).toBe(false);
// 变体穷举：Check 只允许 check/expect 两种载体，新增第三种必须同步 zod 与 evaluate
type Variant = "expect" | "check";
// @ts-expect-error 编译器拒绝未声明载体
const _notAllowed: Variant = "script";
// trialAttr 的非法 path → GR-06，不静默 false
expect(evalExpect({ op: "trialAttr", trial: "quiet", path: "no.such", eq: true }, g).errorCode).toBe("GR-06");
```

```ts
// (b) 事件顺序（worlddigest 归一化后）
it("同一 tick 内保持插件 seq 递增顺序", () => {
  const d = normalize(snap([ev(3, "b", 10), ev(1, "a", 10), ev(2, "c", 10)]));
  expect(d.events.map((e) => e.type)).toEqual(["a", "c", "b"]);
});
it("到达顺序打乱后仍按 seq 升序", () => { /* 打乱数组输入，断言 seq 单调不减 */ });
it("重复 seq 只保留第一次出现", () => { /* [ev(1,"a"),ev(1,"a2")] → 只剩 "a" */ });
it("snapshot tick 之后的事件被剔除", () => { /* tick=100，事件 tick=101 应消失 */ });
```

```ts
// (c) 容器比较
it("item 顺序不影响相等", () => expect(containersEqual(agg([egg, wheat]), agg([wheat, egg]))).toBe(true));
it("同一 item 的多个 ItemStack 先聚合", () => { /* [egg×2, egg×3] vs [egg×5] → true */ });
it("数量 0 的条目忽略", () => { /* {egg:0,wheat:1} vs {wheat:1} → true */ });
it("ignoreNames 默认 false：名字不同不等", () => { /* {egg,name:"A"} vs {egg,name:"B"} → false */ });
```

```ts
// (d) 纯函数/确定性
it("同一快照跑 100 次报告逐字节一致", () => { const a = evaluate(...); for (...) expect(evaluate(...)).toEqual(a); });
it("evaluate 不得修改输入快照", () => { const h = digestHash(snap); evaluate(level, snap); expect(digestHash(snap)).toBe(h); });
it("禁用 Date/Math.random：mock 成抛错后照样能评估", () => { vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("no clock"); }); expect(() => evaluate(level, snap, { kind: "main" })).not.toThrow(); });
it("报告可 JSON round-trip", () => { const r = evaluate(level, snap, { kind: "main" }); expect(JSON.parse(JSON.stringify(r))).toEqual(r); });
```

## 4. @loom/worlddigest

### 4.1 `WorldSnapshot`

```ts
export interface WorldSnapshot {
  schemaVersion: 1;
  levelId: string; trialId: string; sessionSeed: number;
  tick: number; time: { ticks: number }; weather: "clear" | "rain" | "thunder";
  dimension: "overworld" | "nether" | "end";
  agents: AgentSnap[];                       // { id, pos: [x,y,z], state, holding }
  objectives: { id: string; done: boolean; evidenceSeq: number }[];
  blocks: { changed: [[number, number, number], string][] };
  containers: { pos: [number, number, number]; items: Record<string, number> }[];
  events: WorldEvent[];                      // { seq, type, actor, pos?, tick }
  region: { from: [number, number, number]; to: [number, number, number] };
  digestHash?: string;                       // 可选，由 digestHash() 生成
}
```

坐标在快照里**一律用 `[x,y,z]` 数组**（紧凑、与 JSON 示例一致）；`g` 接受 `PosLike`（数组/对象/字符串）并在入口归一化。与 docs/12 的 `Vec3` 对象差异见 §8 D-3。

### 4.2 归一化规则

| 对象 | 规则 |
|---|---|
| `agents` | 按 `id` 字典序；`pos` 每分量 `round2`（半值向上：`Math.round(v*100)/100`，`-0` 归 0） |
| `objectives` | 按 `id` 排序；`done` 布尔强制 |
| `blocks.changed` | 坐标取整（方块坐标本就整数）；键 `"x,y,z"` 字典序；blockId 统一全名（保留 `minecraft:` 前缀），重复坐标取最后写入 |
| `containers` | 按 `pos` 字符串排序；`items` 只保留 `count>0`，按 itemId 排序 |
| `events` | 按 `seq` 升序；`seq` 重复只留第一次（记录 `meta.duplicates` 计数）；`tick > snap.tick` 的事件剔除 |
| 字符串 | 统一 NFC + trim；空字符串字段省略；`undefined` 不出现（JSON 无 undefined） |
| 数值 | 只允许有限数；`NaN`/`Infinity` → 校验 error（GR-05） |

`normalize(snap)` 必须**幂等**：`normalize(normalize(s))` 深度相等（PBT 第 2 条）。

### 4.3 hash

```ts
export function canonicalJson(v: unknown): string; // 递归键排序、round2、-0→0、紧凑分隔符
export function digestHash(s: WorldSnapshot): `sha256:${string}` {
  const { digestHash: _drop, ...body } = s;
  return `sha256:${createHash("sha256").update(canonicalJson(body), "utf8").digest("hex")}`;
}
```

hash 覆盖归一化后的全部字段（不含 `digestHash` 自身），因此「数组输入顺序不同」不影响 hash（先 normalize）；唯一例外是 `sessionSeed` 与 `session` 级随机化——两者都在快照里，**演示/CI 用 fixed seed 保证 golden 稳定**。

### 4.4 ASCII 渲染算法

1. 取 `region`（或全部 changed/agents/containers 的包围盒，外扩 1）作为范围；宽度上限 96、高度上限 48，超限按整数步长降采样。
2. 初始化网格为 `.`；`blocks.changed` 铺 `#`；containers 铺 `C`；objectives 为 `*`（依据 `pos` 标注，无 pos 的目标忽略）；agents 铺 `G`。
3. 同一格优先级：`G > C > * > # > .`（后写的覆盖先写的）。
4. 输出：第一行 x 轴刻度（每 10 格一个数字），左侧列 z 轴；末尾一行 `legend: . empty  # block  C container  * objective  G agent`。
5. 确定性：所有输入已归一化，渲染函数无随机/时间；快照相同的 ASCII 逐字节相同。

```
L03 zombie seed=123456  tick=18000
x: 0         10        20
z 0 ............G..........
z 1 ..........###..........
z 2 ..........#*#..........
z 3 ..........C#C..........
legend: . empty  # block  C container  * objective  G agent
```

### 4.5 golden 比较与 diff

```ts
export interface DiffEntry { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown }
export function diffDigest(golden: WorldSnapshot, actual: WorldSnapshot): DiffEntry[];
// 先 digestHash 相等 → []（快速路径）；否则按 normalize 后逐字段递归比较，输出路径如 "agents[id=golem].pos[2]"
```

CLI：`npm run worlddigest -- --ascii --actual reports/L03-zombie.json`（渲染字符图）；`npm run worlddigest -- --compare content/goldens/L03/zombie.json --actual reports/L03-zombie.json --format text`（diff，`--format json` 给 agent）。`--ignore digestHash` 默认开启；有 diff 则 exit 1 并打印 `path` / `before` / `after` 三列表。golden 目录约定 `content/goldens/<levelId>/<trialId>.json`（fixed seed 生成，随 spec 一起冻结）。

## 5. Property-based 测试清单（fast-check 4.10.2）

| # | 性质 | 生成器（fast-check） | 断言 | 包 |
|---|---|---|---|---|
| P1 | 随机破坏 spec 必报错且不抛异常 | 从合法 L01 `LevelDef` 出发，`fc.array(fc.constantFrom("del","swapType","addKey","truncate"))` 应用 1–4 处 | `validateSpec` 返回 ≥1 个 error，且不 throw | level-spec |
| P2 | 归一化幂等 | `fc.record` 任意快照（数组乱序、浮点、重复 seq） | `deepEqual(normalize(normalize(s)), normalize(s))` | worlddigest |
| P3 | hash 与输入顺序无关 | 对同一快照做 `fc.shuffled` 各数组 | `digestHash` 不变 | worlddigest |
| P4 | grader 确定性 + 不修改输入 | 任意合法快照 + 任意 level | 结果 JSON 逐字节相等；`digestHash(snap)` 前后相等 | grading |
| P5 | trial 隔离无泄漏 | 两个 trial（A/B）任意顺序 | 先跑 A 再 B 的 B 结果 == 单独跑 B 的结果 | grading+runner |
| P6 | 种子纯函数 | `fc.string()`、`fc.integer()` | 同输入同 uint32；不同输入不同（可碰撞但概率极低，仅断言同输入） | grading |
| P7 | check 白名单不可绕过 | 对合法 check AST 随机注入黑名单标识符 | 全部被 SPEC-11 拒绝；合法 check 执行不变量 | grading |
| P8 | ASCII 确定且有界 | 任意快照 | 两次渲染相同；行≤48、列≤96 | worlddigest |

```ts
// 生成器骨架（packages/*/test/pbt/*.ts）
const opGen = fc.constantFrom("del", "swapType", "addKey", "truncate");      // P1
const mutatedLevel = opGen.map((op) => mutate(structuredClone(validL01), op));
const shuffledSnap = fc.shuffled<any>(snapArrays)                            // P3：数组顺序
  .chain((order) => fc.constant(reorder(validSnapshot, order)));
const anySnapshot = fc.record({ agents: fc.array(agentGen), events: fc.array(eventGen), blocks: fc.array(blockGen) }); // P2
```

命令：`PBT_NUM_RUNS=100 npx vitest run packages/{level-spec,grading,worlddigest} -- --property`（commit 档）；nightly `PBT_NUM_RUNS=1000` 且失败 seed 写 `test/fixtures/pbt-seeds.json`（research/assurance-notes.md §6 L3 已约定）。

## 6. 实现顺序与工作量（Day 1–Day 2）

| 顺序 | 项 | 包 | 估时（agent-h） | 完成判据 |
|---|---|---|---|---|
| 1 | 冻结 `WorldSnapshot` / `LevelDef` / `G` 接口（先于一切实现） | worlddigest + level-spec | 2 | `npx tsc --noEmit` 过；fixture 能构造 |
| 2 | zod schema + `defineLevel` + SPEC-01/02/03/04/05/08 规则 + `level:validate`（text/json） | level-spec | 5 | `npm run level:validate` 在 L01 移植件上绿、在 6 个变异 spec 上红 |
| 3 | `g` 方法 + `expect` 解释器 + `check` 沙箱（acorn 白名单）+ GR 码 | grading | 6 | 单测覆盖 ≥85%；L01 reference 通过、starter 失败 |
| 4 | `normalize`/`digestHash`/ASCII/`diffDigest` + golden 工具 | worlddigest | 4 | 自比 hash 相等；幂等 PBT 绿 |
| 5 | tsconfig 生成 + starter 注入 + `level:verify`（MockWorld） | level-spec | 4 | `npm run level:verify -- --level L01` 绿；README 可复跑 |
| 6 | SPEC-06/07/10 联调 + `qa/spec-mutation.mjs` SM-1…SM-5 | level-spec + qa | 4 | 5 个变异全部 exit 1 |
| 7 | PBT（P1–P8）+ type-level 测试 + mutation 首轮 | 三包 | 4 | verify.sh L1/L2/L3 绿；mutation break ≥60 |

合计约 29 agent-h：Day1 完成 1–3（可让内容 agent 先写 `*.level.ts`），Day2 完成 4–7。**level-spec 必须先于内容实现**：`defineLevel` 与 validator 是内容 author 的编译期契约，没有它，写出来的 spec 无法被校验也无法被 runner 消费；`WorldSnapshot` 类型必须在 Day1 AM 冻结，否则 grading 与插件会各写一套。

## 7. 库选型（两选项 + 推荐）

| 用途 | 选项 A（推荐） | 选项 B | 推荐理由 |
|---|---|---|---|
| 设计期 YAML 抽取（MD→spec） | yaml 2.9.1 | js-yaml 5.5.0 | 自带 TS 类型、活跃维护；我们只抽机器块，性能不敏感 |
| check AST 解析/白名单 | acorn 8.19.0 + acorn-walk | meriyah 7.4.1 | ESTree 生态最稳、仅 validate 期使用 |
| 加载 `*.level.ts` | 复用 esbuild 0.28.2 | tsx | 不新增依赖；runner 已用 esbuild，行为一致 |
| 类型级测试 | expect-type 1.4.0 | tsd | 与 Vitest 同进程，CI 无需第二个命令 |
| golden 结构化 diff | 自写 canonical JSON diff（~80 行） | deep-diff / jest-diff | 输出格式要进报告与 agent prompt，需完全可控 |

zod 4.6.7、fast-check 4.10.2、Vitest 5.0.5 为 docs/07 §10 版本锁，不再选型。

## 8. 与 docs/06 / schema / docs/12 的差异 → 待 Lead 裁决

| # | 冲突/歧义 | 位置 | 影响 | 我的建议 |
|---|---|---|---|---|
| D-1 | `primitive` 定义自相矛盾：`additionalProperties:false` + 非法键 `additionalPropertiesThatAreNotOp`，带参 step 全部 schema 失败；enum 缺 `unlockHint` | schema:27-33；L01:84 | 所有 staging step 不可校验；runner 无法消费 | 改为「从 zod 生成 JSON Schema（draft-7）」；primitive 参数用 per-op `oneOf`；补 `unlockHint` 或删该 step（与 docs/00 P0#1 同源） |
| D-2 | 断言载体与 `g` 契约三方不一致：schema 允许 `check`/`expect` 但 docs/06 只写 `check`；docs/06 §5.2 的 g 最小集缺 L01/L09 用到的 `g.lamps/npc/withinRadius/equalsAny`；docs/07 §3.3 事件表缺 `cure.splash`/`bell.ring` | docs/06 §5.2、schema、L01 §4、L09 | grader/插件/关卡各写一套，无法实现 | 以本文件 §3.2/§3.3/§3.4 为单一契约：`expect` 为主、`check` 逃生舱；docs/06 §5.2 与 docs/07 §3.3 同步扩表 |
| D-3 | 快照坐标表示：docs/07 §8 用数组、docs/12 用 `Vec3` 对象 | docs/07 §8、docs/12 §2 | 归一化/hash/断言比较标准不一 | 快照用数组，`g` 入口收 `PosLike` 统一归一化（本文件 §4.1） |
| D-4 | 部分成功/星级未定义 | docs/06 §5.2 | UI 无法稳定渲染，评估数据口径不一 | 采用 0–3 星模型（§3.6），报告另给 partial 比例 |
| D-5 | `languageLevel` 在 `meta` 与 `code` 重复 | schema:112、163 | 两处冲突时以谁为准不明 | 只保留 `code.languageLevel`；schema v2 移除 meta 字段 |
| D-6 | `wowMoment` 无机器字段，无法机器检查「至少 1 音效 + 1 粒子」 | docs/06 §6.1#11、schema feedback | 规则 11 只能启发式 | feedback 增加 `{wow: {sound: string, particle: string}}` 机器字段（schema v2），文本保留给人读 |
| D-7 | rule 4 要求 evidence 对应断言，但 Predict 题无法对应 | docs/06 §6.1#4 | L01 的「Predict 2/2」永远红 | evidence 前缀设 `predict:`/`reflection:`，这两类记 warn 不记 error |
| D-8 | 设计期 MD 格式不统一：L01/L08/L09 只有 meta YAML，其余是完整 YAML | docs/00 P0#3 | validator 无法机械转换 | `level:validate` 只验 `*.level.ts`（error）；`level:lint` 验 MD（warn），Day1 不阻塞 |
| D-9 | `g.agent(pos/id)` 签名歧义 | docs/06 §5.2 | 实现与断言写法不一致 | 拆为 `agent(id)` + `agentNear(pos, radius)`，旧重载标 deprecated |
| D-10 | 超时预算只写了 500ms/check，未定义 evaluate 总预算 | docs/07 §11 | 长断言可能拖死验收 | 500ms/check + 2s/evaluation（超时 terminate worker）；CI 单 check worker 模式兜底 |
| D-11 | L01「starter 可直接抄坐标」与 hidden「换灯柱位置」矛盾 | docs/00 P0#2、L01:132/168 | 9 关样板会被复制 | 内容层修：hidden 只改不可见参数，或加只读 `world.quest`；不由 level-kit 兜底 |

> 以上 D-1…D-11 需要 Lead 拍板后由对应 owner 回写 docs/06/schema/docs/07；本文件只把实现口径写死，**不擅自改契约**。

## 9. 待实测 / 风险

- `expect` DSL 是否覆盖 10 关绝大多数断言：先用 L01/L03/L09 三关各 3 条对照写，覆盖不足再加 `trialAttr.path` 谓词。
- `check` 的 acorn 白名单可能误伤合法写法（如 `Array.from`）：Day1 用 5 个真实 check 做回归，白名单只增不改。
- worker 内 `vm.compileFunction` 的启动成本（每次 evaluation 新建 worker）需实测；若 >100ms，改为 per-session 复用 worker + per-run 重建 sandbox。
- `content/goldens/` 未生成：Day2 用 fixed seed 跑 L01–L03 生成，作为 L5 集成层基准。
- 本文件所有代码块为**语法可信的规格代码**（zod 4.6.7 的 `strictObject`/`discriminatedUnion`、Vitest 5、fast-check 4.10 经本机 tsc 6.0.3 类型检查验证），但包尚未创建，未做完整编译。
