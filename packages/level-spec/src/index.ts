import { LevelMetaSchema, type LevelMeta, type WorldEvent, type WorldSnapshot } from "../../protocol/src/index";

export interface GraderApi {
  var(name: string): unknown;
  block(pos: number[]): { id: string };
  events(type: string): WorldEvent[];
  agent(id: string): { pos: [number, number, number] };
  npc(name: string): { pos: [number, number, number] };
  withinRadius(a: { pos: number[] }, b: { pos: number[] }, radius: number): boolean;
}

export interface Check {
  id: string;
  text: string;
  check: (g: GraderApi) => boolean;
}

export interface Trial {
  id: string;
  name: string;
  setup: Record<string, unknown>;
  assertions: Check[];
}

/**
 * 玩家可见的任务进度（Studio 目标面板的每一条）。
 *
 * 这是「任务打勾」的唯一真值：引擎每次 verify（run / player-beat）用同一份快照评估，
 * 发 `objective` 事件；Studio 按 id 更新，不再从 grading criteria 猜 index。
 *
 * `player: true` 的步骤必须由玩家在世界里亲手完成（织者之印）；它之前的所有步骤都 done
 * 之后，玩家节拍才解锁（playerBeatReady）。没有 player 步骤的关卡，全部步骤 done 即解锁。
 */
export interface ProgressStep {
  id: string;
  /** 玩家可见文字（docs/20：≤20 字/条、每关 ≤3 条）。 */
  text: string;
  check: (g: GraderApi) => boolean;
  player?: boolean;
  /**
   * 这一步的详细引导（2–4 句）：怎样才算完成、可以照抄的写法、坐标从哪来。
   * 会话在失败/完成时按此向游戏内 actionbar 与 Studio 教练卡推送（docs/48 §1.4）。
   */
  hint?: string;
}

/** 代码要求的判定种类（由 runner 的 AST 分析器实现；content 只写声明式数据，浏览器打包安全）。 */
export type CodeRequirementKind =
  | "calls"
  | "variables"
  | "mutable-variable"
  | "branch"
  | "loop"
  | "function"
  | "object"
  | "higher-order"
  | "async"
  | "promise-combinator"
  | "template"
  | "custom";

/** 代码要求：关卡声明「必须真的用到的抽象」，会话在 verify 时用 AST 统计逐条判定。 */
export interface CodeRequirement {
  id: string;
  text: string;
  kind: CodeRequirementKind;
  /** 数量下限（calls/variables/function 等，默认见 runner 的实现）。 */
  min?: number;
  /** 额外说明（可给学生看的原因）。 */
  detail?: string;
  /** 自定义判定（仅 Node 侧可用；content 优先用 kind，避免浏览器打包 typescript）。 */
  test?: (source: string) => boolean;
}

/** 关卡声明的命名坐标点：注入沙箱为同名全局常量（如 eira、barrel），并显示在指令手册/HUD。 */
export interface NamedPoint {
  /** 世界坐标 [x, y, z]（y 用于 place/collect 的目标高度；moveTo 只用 x/z）。 */
  pos: [number, number, number];
  /** 学生可见名字（如「艾拉」「木桶」）。 */
  name: string;
}

export interface ProgressResult {
  id: string;
  text: string;
  passed: boolean;
  player: boolean;
}

export interface ProgressReport {
  steps: ProgressResult[];
  /** 织偶/世界侧已完成，轮到玩家亲手完成最后一步。 */
  playerBeatReady: boolean;
}

export interface ChallengeDef {
  id: string;
  title: string;
  goal: string;
  reference?: string;
  check: (g: GraderApi) => boolean;
}

export interface NarrativeDef {
  worldState: string;
  opening: [string, string, string];
  whyYou: string;
}

export interface LevelDef {
  id: string;
  meta: LevelMeta;
  world: {
    vars: Record<string, unknown>;
    entities: Array<{ type: string; role: string; id?: string; name?: string }>;
    /** 命名坐标点（docs/48 §1.1）：键名即沙箱全局变量名。 */
    points?: Record<string, NamedPoint>;
    /**
     * 玩家出生点（真人视角第一人称起点，docs/48 §1.8）：不应与 agentSpawn 重合、不应在方块里/贴脸 NPC。
     * 引擎 deriveLayout 的优先级：PAPER_SCENE_HINTS.playerSpawn > world.playerSpawn > arena 中心。
     */
    playerSpawn?: [number, number, number];
  };
  code: { starterCode: string; referenceSolution: string; expectedLoc: number };
  task: {
    mainTask: string;
    makeTask: string;
    playerBeat: string;
    /** 玩家节拍激活时在游戏内 actionbar 显示的短提示（≤24 字）；缺省用 playerBeat。 */
    playerBeatHint?: string;
    successCriteria: Check[];
    hiddenTests: Trial[];
  };
  /** 玩家可见的任务进度（≤3 条；Studio 目标面板按此逐条打勾）。 */
  progress?: ProgressStep[];
  /**
   * 「名副其实」代码要求（docs/48 §1.9）：本关必须真的用到的编程抽象，按学生源码判定。
   * 会话在 verify 时用 analyzeStudentCode 同时评估；结果并入可见 criteria（不满足则本关不通过）。
   * id 稳定、text 面向学生（如「用 let 变量记住已经收了几枚」）。
   */
  codeRequirements?: CodeRequirement[];
  /** 可跳过的挑战层：不计星，但必须有独立判定（docs/20 §3c）。 */
  challenge?: ChallengeDef;
  /** 引导（docs/25）：世界状态 / 三句开场 / 为什么是你。 */
  narrative?: NarrativeDef;
  /** 玩家可见的阶段名（docs/20 §3c；≥2，L01 例外）。 */
  phases?: string[];
}

/** 有效行数：去掉空行与纯注释行。 */
export function effectiveLines(code: string): number {
  return code
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*")).length;
}

function minimumLinesFor(act: number, id: string): number {
  // L01 是「顺序 + 函数调用」的最小样例：3 盏灯各 2 句 + 回艾拉 1 句 = 7 条有效行。
  if (id === "L01") return 7;
  if (act === 1) return 25;
  if (act === 2) return 50;
  return 60;
}

export function defineLevel(def: LevelDef): LevelDef {
  return def;
}

export function validateLevel(level: LevelDef): string[] {
  const issues: string[] = [];
  const parsed = LevelMetaSchema.safeParse(level.meta);
  if (!parsed.success) issues.push(`meta: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (level.id !== level.meta.id) issues.push("id 与 meta.id 不一致");
  if (level.task.successCriteria.length === 0) issues.push("没有 successCriteria");
  if (level.task.hiddenTests.length === 0) issues.push("没有 hiddenTests");
  if (level.code.starterCode.trim() === level.code.referenceSolution.trim()) issues.push("starter 与 reference 相同（starter 已是答案）");
  if (level.meta.apiIntroduced.length > 5) issues.push("教学符号超过 5 个");

  const minLines = minimumLinesFor(level.meta.act, level.id);
  const refLines = effectiveLines(level.code.referenceSolution);
  if (refLines < minLines) issues.push(`参考解有效行数 ${refLines} < 该幕下限 ${minLines}（docs/20 §3c）`);
  const starterLines = effectiveLines(level.code.starterCode);
  if (refLines - starterLines < Math.ceil(minLines / 2)) {
    issues.push(`starter 与 reference 有效行差 ${refLines - starterLines} < 下限的一半（${Math.ceil(minLines / 2)}）`);
  }
  const minHidden = level.id === "L01" ? 1 : 2;
  if (level.task.hiddenTests.length < minHidden) issues.push(`隐藏测试 ${level.task.hiddenTests.length} < ${minHidden}`);
  if (level.id !== "L01" && !level.challenge) issues.push("缺少挑战层 challenge（可跳过、不计星，但必须有）");
  if (level.narrative) {
    if (level.narrative.opening.length !== 3) issues.push("narrative.opening 必须恰好 3 句（世界状态/任务/为什么是你）");
    if (level.narrative.opening.some(line => line.trim().length === 0)) issues.push("narrative.opening 有空句");
    if (!level.narrative.worldState.trim() || !level.narrative.whyYou.trim()) issues.push("narrative.worldState/whyYou 不能为空");
  }
  if (level.id !== "L01" && (!level.phases || level.phases.length < 2)) issues.push("phases 至少 2 个（docs/20 §3c）");
  if (level.progress) {
    if (level.progress.length < 2 || level.progress.length > 3) issues.push("progress 必须是 2–3 条（docs/20 Q6/Q7：目标 ≤3 条）");
    const ids = new Set<string>();
    for (const step of level.progress) {
      if (!step.id.trim()) issues.push("progress 存在空 id");
      if (ids.has(step.id)) issues.push(`progress id 重复：${step.id}`);
      ids.add(step.id);
      if (!step.text.trim()) issues.push(`progress ${step.id} 文字为空`);
    }
    const firstPlayer = level.progress.findIndex(step => step.player === true);
    if (firstPlayer === 0) issues.push("progress 第一条不能是 player 步骤（玩家节拍必须在织偶阶段之后）");
  }
  return issues;
}

/** 从世界快照构造 grader API（评分与进度评估共用，保证同一真值）。 */
export function makeGraderApi(snapshot: WorldSnapshot): GraderApi {
  const key = (p: number[]): string => p.join(",");
  const dist = (a: { pos: number[] }, b: { pos: number[] }): number =>
    Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  return {
    var: name => snapshot.vars[name],
    block: pos => ({ id: snapshot.blocks[key(pos)] ?? "minecraft:air" }),
    events: type => snapshot.events.filter(e => e.type === type),
    agent: id => {
      const a = snapshot.agents[id];
      if (!a) throw new Error(`未知 agent: ${id}`);
      return { pos: a.pos };
    },
    npc: name => {
      const n = snapshot.npcs?.[name];
      if (!n) throw new Error(`未知 npc: ${name}`);
      return { pos: n.pos };
    },
    withinRadius: (a, b, radius) => dist(a, b) <= radius,
  };
}

/** 求值 progress（每条独立 try/catch；单条抛错按未完成处理，不拖垮整关）。 */
export function evaluateProgress(level: LevelDef, snapshot: WorldSnapshot): ProgressReport {
  const steps = level.progress ?? [];
  const g = makeGraderApi(snapshot);
  const results: ProgressResult[] = steps.map(step => {
    let passed = false;
    try {
      passed = step.check(g) === true;
    } catch {
      passed = false;
    }
    return { id: step.id, text: step.text, passed, player: step.player === true };
  });
  const firstPlayer = results.findIndex(step => step.player);
  const playerBeatReady =
    results.length > 0 &&
    (firstPlayer === -1 ? results.every(step => step.passed) : results.slice(0, firstPlayer).every(step => step.passed));
  return { steps: results, playerBeatReady };
}

/** Studio 渲染目标面板所需的最小视图（函数不能过 JSON）。 */
export function progressView(level: LevelDef): Array<{ id: string; text: string; player: boolean; hint?: string }> {
  return (level.progress ?? []).map(step => ({
    id: step.id,
    text: step.text,
    player: step.player === true,
    ...(step.hint ? { hint: step.hint } : {}),
  }));
}

/** 命名坐标点视图（含自动派生项），供引擎 / HUD / 指令手册使用。 */
export function pointsView(level: LevelDef): Record<string, NamedPoint> {
  const points: Record<string, NamedPoint> = { ...(level.world.points ?? {}) };
  const vars = level.world.vars as Record<string, unknown>;
  const asPos = (value: unknown): [number, number, number] | null =>
    Array.isArray(value) && value.length === 3 && value.every(v => typeof v === "number")
      ? [value[0] as number, value[1] as number, value[2] as number]
      : null;
  const fallback: Array<[string, string]> = [
    ["eira", "艾拉"],
    ["barrel", "木桶"],
    ["bucket", "倒蛋位"],
    ["barn", "谷仓"],
    ["gate", "北门"],
    ["well", "井"],
    ["bell", "钟"],
    ["keystone", "合龙石基座"],
  ];
  for (const [key, name] of fallback) {
    if (!points[key]) {
      const pos = asPos(vars[key]);
      if (pos) points[key] = { pos, name };
    }
  }
  return points;
}

const samePos = (a: number[] | undefined, b: number[]): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const lampsOf = (g: GraderApi): number[][] => g.var("lamps") as number[][];

/** L01 — 第一缕光（第一版可运行实现；场景细节在 MockWorld/插件里补齐）。 */
export const L01: LevelDef = defineLevel({
  id: "L01",
  meta: {
    id: "L01",
    title: { zh: "第一缕光", en: "First Light" },
    act: 1,
    order: 1,
    priority: "P0",
    prerequisites: [],
    estimatedMinutes: 10,
    difficulty: 1,
    abstractions: ["A0", "A1"],
    objectives: [
      { id: "o-sequence", learnerView: "我写的每一条指令会严格按顺序执行", evidence: { kind: "machine", ref: "four-lamps-lit" } },
      { id: "o-call", learnerView: "函数调用就是「对织偶说一句咒语」，括号里的数字是位置", evidence: { kind: "machine", ref: "golem-home" } },
      { id: "o-notional", learnerView: "程序不是许愿，它只会照字面执行", evidence: { kind: "predict", ref: "predict-1" } },
    ],
    misconceptions: ["program-will-infer-intent", "order-does-not-matter"],
    apiIntroduced: ["golem.moveTo", "golem.place", "golem.say", "golem.pos"],
    apiAllowlist: ["golem.moveTo", "golem.place", "golem.say", "golem.pos"],
    syntaxIntroduced: ["函数调用", "数字/字符串字面量", "注释"],
    reward: { rune: "A1", advancement: "loomcraft/act1/first_light", codexPage: "A1" },
    languageLevel: "act1",
  },
  world: {
    vars: {
      lamps: [[-12, 14, 10], [-12, 14, -2], [2, 14, -2], [2, 14, 16]],
      optionalLamp: [[2, 14, 24]],
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
    ],
  },
  code: {
    expectedLoc: 12,
    starterCode: `// 灯柱坐标（右侧面板会同步显示）
// 1 号: (-12, 10)   2 号: (-12, -2)   3 号: (2, -2)   4 号: (2, 16)

// 第一盏：走过去，点亮它
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)

// 第二盏：抄上面的写法
// TODO: golem.moveTo(?, ?)
// TODO: golem.place("lantern", ?, ?, ?)

// 第三盏、第四盏、回艾拉身边：你来写
`,
    referenceSolution: `golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(2, 16)
golem.moveTo(0, 6)
`,
  },
  task: {
    mainTask: "点亮 1–3 号路灯；走到 4 号灯下，你亲手点亮；回到艾拉身边。",
    makeTask: "回程顺路点亮桥另一侧的第 5 盏灯（可选）。",
    playerBeat: "4 号灯由你右键点亮。",
    successCriteria: [
      {
        id: "four-lamps-lit",
        text: "4 盏路灯全部点亮",
        check: g => lampsOf(g).every(p => g.block(p).id === "minecraft:lantern"),
      },
      {
        id: "golem-home",
        text: "灰崽回到艾拉身边",
        check: g => g.withinRadius(g.agent("golem"), g.npc("eira"), 4),
      },
      {
        id: "player-lit-fourth",
        text: "第 4 盏灯由你亲手点亮",
        check: g => g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, lampsOf(g)[3])),
      },
      {
        id: "no-shortcut",
        text: "1→2→3 号灯顺序正确",
        check: g => {
          const lamps = lampsOf(g);
          // 只看每盏灯的「第一次」放置：玩家不重置直接再跑一遍时，重复的放置事件不能把顺序判错。
          const firstOrder: number[] = [];
          const seen = new Set<number>();
          for (const event of g.events("block.place")) {
            if (event.actorType !== "agent") continue;
            const index = lamps.slice(0, 3).findIndex(p => samePos(event.pos, p));
            if (index < 0 || seen.has(index)) continue;
            seen.add(index);
            firstOrder.push(index);
          }
          return (
            firstOrder.length === 3 &&
            firstOrder.every((value, i) => (i === 0 ? value === 0 : value > firstOrder[i - 1]))
          );
        },
      },
    ],
    hiddenTests: [
      {
        id: "h-physical-walk",
        name: "织偶真的走到每盏灯下才放置",
        setup: {},
        assertions: [
          {
            id: "h1",
            text: "每次放置前，织偶都到达过灯柱 2 格内",
            check: g => {
              const lamps = lampsOf(g);
              const events = g.events("block.place").filter(e => e.actorType === "agent");
              for (const e of events) {
                const lamp = lamps.find(p => samePos(e.pos, p));
                if (!lamp) continue;
                const moved = g.events("agent.move").some(
                  m => (m.seq ?? 0) < (e.seq ?? 0) && !!m.pos && Math.hypot(m.pos[0] - lamp[0], m.pos[2] - lamp[2]) <= 2,
                );
                if (!moved) return false;
              }
              return true;
            },
          },
        ],
      },
      {
        id: "h-no-extra",
        name: "只落在灯位上、不乱放",
        setup: {},
        assertions: [
          {
            id: "h2",
            text: "织偶的放置只发生在 4 个灯位或可选第 5 盏上",
            check: g => {
              const allowed = [...lampsOf(g), ...((g.var("optionalLamp") as number[][]) ?? [])];
              const placements = g.events("block.place").filter(e => e.actorType === "agent");
              return placements.every(e => allowed.some(p => samePos(e.pos, p)));
            },
          },
        ],
      },
    ],
  },
});
