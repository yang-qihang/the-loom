/**
 * L02 — 会数数的织偶（MockWorld 版）
 *
 * 设计意图与数值以 content/levels/L02-counting-golem.md 为准（A2 变量/记忆）：
 * 6 枚蛋、木桶、两趟搬运（筐最多 4 枚）、不能碰 3 个孵蛋窝、报数、回艾拉身边。
 *
 * Round 2（docs/48）起学生面用**语义 API + 命名点**：
 *   收蛋  = moveTo(perchN) + collect("egg", perchN)         // 目标格变空气，背包 +1
 *   倒蛋  = moveTo(barrel) + deposit("egg", barrel, n)      // 把 n 枚放进木桶边（容器计数累加）
 *   报数  = moveTo(eira) + world.container(barrel).count("egg") + say(...)  // 数字来自世界，不靠背
 *   喂鸡  = 玩家节拍：playerPlace("cake", cakeTower)
 * 评分仍读 legacy 事件（collect → place air、deposit → place egg），语义与旧版完全一致；
 * 真实 Paper 版由 PaperWorldPort 的 RichAgentActions 映射到同一套事件。
 */
import { defineLevel, type Check, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import type { ContentCopy } from "./L01.content";

type Pos = [number, number, number];

const C = "minecraft:";

const pos = (p: unknown): Pos => p as Pos;
const posList = (p: unknown): Pos[] => p as Pos[];
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const blockOf = (e: { data?: Record<string, unknown> }): string => String(e.data?.block ?? "");
const agentPlaces = (g: GraderApi, block: string) =>
  g.events("block.place").filter(e => e.actorType === "agent" && blockOf(e) === C + block);

/**
 * 分趟倒蛋的「第一轮事件」语义：每个蛋窝只认第一次收走、每次倒蛋只认真的带来新蛋的那次。
 * 语义 API 的 legacy 事件与旧写法一致：collect → 窝上 `place air` 事件；deposit → 桶边 `place egg` 事件。
 * 注意 deposit 会在倒蛋位上「向上找空气格」叠放（第二趟落在 y+1），所以倒蛋事件只比 x/z、不要求同一个 y。
 * 同一会话不重置连续跑两遍时，第二轮重复事件不会把趟数/顺序判错。
 */
function tripsOf(g: GraderApi): { perTrip: number[]; tail: number; firstRunClears: number } {
  const perches = posList(g.var("eggPerches"));
  const bucket = pos(g.var("bucket"));
  const seen = new Set<number>();
  const perTrip: number[] = [];
  let sinceDelivery = 0;
  for (const e of g.events("block.place")) {
    if (e.actorType !== "agent") continue;
    const block = blockOf(e);
    if (block === C + "air") {
      const index = perches.findIndex(p => samePos(e.pos, p));
      if (index < 0 || seen.has(index)) continue;
      seen.add(index);
      sinceDelivery += 1;
    } else if (block === C + "egg" && !!e.pos && e.pos[0] === bucket[0] && e.pos[2] === bucket[2]) {
      if (sinceDelivery > 0) {
        perTrip.push(sinceDelivery);
        sinceDelivery = 0;
      }
    }
  }
  return { perTrip, tail: sinceDelivery, firstRunClears: seen.size };
}

/** 内容层文案：术语统一为「带玻璃罩的窝 / 木桶 / 小筐」，错误固定「第 N 行 + 原因 + 可照抄写法」（FR-016/017/018/019）。 */
export const L02_COPY: ContentCopy = {
  coordinateRule:
    "括号里写名字最省事：perch1 到 perch6 是六个蛋窝、barrel 是木桶、eira 是艾拉，坐标在指令手册里都能查到。收蛋用 golem.collect(\"egg\", 窝的名字)，倒蛋用 golem.deposit(\"egg\", barrel)；先 moveTo 走过去，再动手。",
  golemNote: "golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。",
  hints: [
    "先看木桶：桶里现在有几枚蛋？你打算用哪个变量把这个数记住？",
    "数一数小筐里有几枚：代码里那行 golem.count 会回答你。",
    "两趟的写法一样：灰崽先 moveTo 到鸡窝旁 collect 收蛋，再 moveTo 到木桶边 deposit 倒进去。",
  ],
  errors: [
    {
      line: 5,
      reason: "第 5 行把你算的数固定住了，后面加不上去。",
      fix: "把行首的 const 改成 let，它就能跟着数变，数字别动。照抄：",
      sample: "let carried = 0",
    },
    {
      line: 6,
      reason: "第 6 行把 4 固定成数字了，换一间鸡舍就数不对。",
      fix: "改成问灰崽「这一趟收了几枚」——用变量 carried 记账，每收一枚就加一。照抄：",
      sample: "carried = carried + 1",
    },
    {
      line: 9,
      reason: "第 9 行停在了鸡窝边：小筐一次只装得下 4 枚，装满了要先回木桶倒一趟。",
      fix: "走到木桶边把蛋倒进桶里，再回去收剩下的。照抄：",
      sample: 'golem.deposit("egg", barrel, carried)',
    },
    {
      line: 12,
      reason: "第 12 行那个窝盖着玻璃罩，是留给母鸡孵小鸡的，不能碰。",
      fix: "只收没有玻璃罩的窝，别对 hatch1 到 hatch3 写 collect。照抄：",
      sample: 'golem.collect("egg", perch2)',
    },
    {
      line: 14,
      reason: "第 14 行还没报数，艾拉不知道木桶里有几枚。",
      fix: "回到艾拉身边，用 world.container(barrel).count(\"egg\") 现数，再 say 出来。照抄：",
      sample: 'golem.say("木桶里有 " + world.container(barrel).count("egg") + " 枚蛋")',
    },
  ],
  timeout: "灰崽走了很久还没走完，八成是同一件事在绕圈。按「重置」再来一遍，看看有没有哪一步一直重复。",
};

/**
 * L02 场景关键坐标：vars 与命名点共用同一份，避免「面板一套、代码一套」。
 * - barrel 命名点落在**桶边的倒蛋位**（deposit 的目标格），木桶方块在它旁边；
 * - 命名点键名就是沙箱里的同名全局常量（docs/48 §1.1）。
 */
const EGG_PERCHES: Pos[] = [
  [-16, 65, 10],
  [-14, 65, 10],
  [-12, 65, 10],
  [-10, 65, 10],
  [-8, 65, 10],
  [-6, 65, 10],
];
/** 3 个孵蛋窝：盖着玻璃罩，一枚都不能动。 */
const HATCH_NESTS: Pos[] = [
  [-16, 65, 12],
  [-14, 65, 12],
  [-12, 65, 12],
];
const BARREL_BLOCK: Pos = [0, 65, -6]; // 木桶方块
const DEPOSIT_POS: Pos = [1, 65, -6]; // 桶边的倒蛋位（deposit 落点）
const CAKE_TOWER: Pos = [4, 66, -6]; // 玩家节拍：塔基上方的空气格
const EIRA_POS: Pos = [0, 65, 6]; // 艾拉

const L02_POINTS: Record<string, { pos: Pos; name: string }> = {
  eira: { pos: EIRA_POS, name: "艾拉" },
  barrel: { pos: DEPOSIT_POS, name: "木桶" },
  cakeTower: { pos: CAKE_TOWER, name: "蛋糕塔" },
  ...Object.fromEntries(EGG_PERCHES.map((pos, index) => [`perch${index + 1}`, { pos, name: `${index + 1} 号蛋窝` }])),
  ...Object.fromEntries(HATCH_NESTS.map((pos, index) => [`hatch${index + 1}`, { pos, name: `带玻璃罩的窝 ${index + 1}` }])),
};

/**
 * L02「名副其实」代码要求（docs/48 §1.9）：本关教「变量 / 记忆」。
 * starter 里没有变量，三个要求都不满足；参考解用 let 记账、用 const 起名、用模板字符串报数。
 */
const CODE_REQUIREMENTS = [
  {
    id: "l02-let",
    text: "用 let 声明会变的数：这一趟收了几枚、已经倒进木桶几枚",
    kind: "mutable-variable" as const,
    min: 1,
  },
  {
    id: "l02-vars",
    text: "至少用两个变量给数字起名字（比如一趟最多装几枚、一共要收几枚）",
    kind: "variables" as const,
    min: 2,
  },
  {
    id: "l02-template",
    text: "报数时用模板字符串把桶里现数出来的枚数插进那句话",
    kind: "template" as const,
    min: 1,
  },
];

const L02_BASE: LevelDef = defineLevel({
  id: "L02",
  meta: {
    id: "L02",
    title: { zh: "会数数的织偶", en: "The Counting Golem" },
    act: 1,
    order: 2,
    priority: "P0",
    prerequisites: ["L01"],
    estimatedMinutes: 12,
    difficulty: 2,
    abstractions: ["A2"],
    objectives: [
      { id: "o-const", learnerView: "用 const 给不变的值起名字：一趟最多装几枚、一共要收几枚", evidence: { kind: "machine", ref: "six-collected" } },
      { id: "o-let", learnerView: "用 let 记住会变的数：已经收了几枚，每收一枚就加一", evidence: { kind: "machine", ref: "two-trips" } },
      { id: "o-report", learnerView: "报数时从木桶里现数，不把数字背下来", evidence: { kind: "machine", ref: "report-count" } },
    ],
    misconceptions: ["variable-is-not-a-counter", "assign-vs-compare", "bag-has-no-limit", "count-can-be-hardcoded"],
    apiIntroduced: ["golem.count", "golem.collect", "golem.deposit", "world.container"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "golem.count", "golem.collect", "golem.deposit", "world.container"],
    syntaxIntroduced: ["const 声明", "let 声明", "赋值（=）", "数字相加（+）"],
    reward: { rune: "A2", advancement: "loomcraft/act1/counting_golem", codexPage: "A2" },
    languageLevel: "act1",
  },
  world: {
    vars: {
      // 6 个可以收的蛋窝（一排，间隔 2 格；数值与 spec §3 一致）
      eggPerches: EGG_PERCHES,
      // 3 个孵蛋窝：盖着玻璃罩，一枚都不能动
      hatchNests: HATCH_NESTS,
      barrel: BARREL_BLOCK, // 木桶
      bucket: DEPOSIT_POS, // 桶边的倒蛋位（倒一次记一次）
      cakeTower: CAKE_TOWER, // 玩家节拍：塔基上方的空气格（塔基 stone_bricks 在 [4,65,-6]），玩家要把蛋糕放进来
      eira: EIRA_POS, // 艾拉
      need: 6, // 麦穗节要 6 枚蛋
    },
    // 命名点：孩子们不用背坐标，写 eira / barrel / perch3 就能走、收、倒、报数。
    points: L02_POINTS,
    // 玩家出生点：站在艾拉南侧的小径上朝北，能看到灰崽和艾拉，不在灰崽（0,65,0）体内。
    playerSpawn: [0, 65, 10],
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "chicken", role: "prop", id: "hens", name: "母鸡" },
    ],
  },
  code: {
    expectedLoc: 20,
    starterCode: `// golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。
// 这一关的点都有名字，指令手册里能查到坐标：
//   perch1 到 perch6 是六个能收的蛋窝，barrel 是木桶，eira 是艾拉，cakeTower 是蛋糕塔。
// 收蛋：先让灰崽走到窝边，再让它把蛋收进小筐：golem.collect("egg", perch1)
// 小筐一趟最多装 4 枚蛋，收满 4 枚就得先回木桶倒一次。
// 倒蛋：走到木桶边，让灰崽把筐里的蛋都倒进桶里：golem.deposit("egg", barrel, 4)
// 报数：最后走回 eira 身边，用 world.container(barrel).count("egg") 现数，再用 say 说给艾拉听。
// 带玻璃罩的窝是留给母鸡孵小鸡的，一枚都不能碰；只对 perch1 到 perch6 写。
// 第一枚蛋已经替你写好了，后面的照着写。

golem.moveTo(perch1)
golem.collect("egg", perch1)

// 第二枚到第四枚：照着上面两行写，只把 perch1 换成 perch2、perch3、perch4。
// 收满 4 枚以后：golem.moveTo(barrel)，再 golem.deposit("egg", barrel, 4)。
// 然后回来收 perch5、perch6，再倒一次；最后回 eira 身边报数。
// 报数的数字要用变量从桶里现算，不能自己写死 6。
`,
    referenceSolution: `// 数字先起名字：一趟最多装 4 枚，一共要收 6 枚
const eggsPerTrip = 4
const need = 6

// 第一趟：用 carried 记住这一趟筐里已经收了几枚
let carried = 0
golem.moveTo(perch1)
golem.collect("egg", perch1)
carried = carried + 1
golem.moveTo(perch2)
golem.collect("egg", perch2)
carried = carried + 1
golem.moveTo(perch3)
golem.collect("egg", perch3)
carried = carried + 1
golem.moveTo(perch4)
golem.collect("egg", perch4)
carried = carried + 1

// 筐满 4 枚，走去木桶倒蛋；倒完把这一趟记进 banked（已经倒进桶里的总数）
golem.moveTo(barrel)
golem.deposit("egg", barrel, carried)
let banked = carried
carried = 0

// 第二趟：还差 need - banked 枚，用 remaining 记住还差几枚
const remaining = need - banked
golem.moveTo(perch5)
golem.collect("egg", perch5)
carried = carried + 1
golem.moveTo(perch6)
golem.collect("egg", perch6)
carried = carried + 1

// 第二趟倒蛋：剩下的 remaining 枚全部倒进木桶
golem.moveTo(barrel)
golem.deposit("egg", barrel, remaining)
banked = banked + remaining

// 回艾拉身边报数：桶里有几枚，现场从桶里数，不靠背
golem.moveTo(eira)
const inBarrel = world.container(barrel).count("egg")
golem.say(\`木桶里有 \${inBarrel} 枚蛋\`)
`,
  },
  task: {
    mainTask: "麦穗节要做 6 个蛋糕，一个蛋糕一枚蛋。先让灰崽把 6 枚蛋收进木桶：小筐一趟只装得下 4 枚，所以分两趟收、两趟倒；最后回艾拉身边报数。",
    makeTask: "第二间鸡舍：窝换了位置，你只改窝的名字，别动别的写法。",
    playerBeat: "你喂鸡催下最后一枚蛋，再把最后一只蛋糕放上蛋糕塔。",
    playerBeatHint: "手持蛋糕，对准蛋糕塔按右键",
    successCriteria: [
      {
        id: "six-collected",
        text: "让灰崽收 6 枚蛋",
        check: g => {
          const perches = posList(g.var("eggPerches"));
          const cleared = agentPlaces(g, "air");
          return (
            perches.every(p => g.block(p).id === C + "air") &&
            perches.every(p => cleared.some(e => samePos(e.pos, p)))
          );
        },
      },
      {
        id: "hatch-intact",
        text: "别动 3 个带玻璃罩的窝",
        check: g => posList(g.var("hatchNests")).every(p => g.block(p).id === C + "glass"),
      },
      {
        id: "report-at-eira",
        text: "回艾拉身边报数",
        check: g => {
          const home = g.withinRadius(g.agent("golem"), { pos: pos(g.var("eira")) }, 4);
          const said = g.events("say").some(e => {
            const text = String(e.data?.text ?? "");
            const m = text.match(/桶[里内][^0-9]{0,6}(\d+)/);
            return m !== null && Number(m[1]) === 6;
          });
          return home && said;
        },
      },
    ],
    hiddenTests: [
      {
        id: "h-two-trips",
        name: "分两趟倒蛋（每趟不超过 4 枚）",
        setup: { note: "把 6 枚蛋一次搬完会失败：筐最多装 4 枚" },
        assertions: [
          {
            id: "two-trips",
            text: "倒蛋至少两次，每次不超过 4 枚，合计 6 枚",
            check: g => {
              const perches = posList(g.var("eggPerches"));
              const { perTrip, tail, firstRunClears } = tripsOf(g);
              return (
                firstRunClears === perches.length &&
                perTrip.length >= 2 &&
                perTrip.every(n => n >= 1 && n <= 4) &&
                perTrip.reduce((a, b) => a + b, 0) === 6 &&
                tail === 0
              );
            },
          },
        ],
      },
      {
        id: "h-only-eggs",
        name: "只动收蛋窝，不动孵蛋窝",
        setup: { note: "见蛋就收 9 个窝（含玻璃罩）的程序会在这里失败" },
        assertions: [
          {
            id: "only-egg-perches",
            text: "所有「收走」动作只发生在 6 个收蛋窝上",
            check: g => {
              const perches = posList(g.var("eggPerches"));
              const hatch = posList(g.var("hatchNests"));
              return agentPlaces(g, "air").every(
                e => perches.some(p => samePos(e.pos, p)) && !hatch.some(p => samePos(e.pos, p)),
              );
            },
          },
        ],
      },
    ],
  },
  // 「名副其实」：本关要求学生真的用变量记账（docs/48 §1.9）。
  codeRequirements: CODE_REQUIREMENTS,
  // 玩家可见任务进度：与 grading criteria/hiddenTests 共用同一份世界快照真值。
  progress: [
    {
      id: "l02-six-eggs",
      text: "让灰崽收 6 枚蛋，分两趟倒进木桶",
      hint:
        "先把六个蛋窝的蛋收进小筐：写 `golem.moveTo(perch1)` 再 `golem.collect(\"egg\", perch1)`；perch1 到 perch6 都是关卡给好的名字，坐标在指令手册里能查到。倒进木桶就是把蛋从筐里交到桶里：走到木桶边写 `golem.moveTo(barrel)`，再 `golem.deposit(\"egg\", barrel)`。小筐一趟最多 4 枚，所以收 4 枚先倒一趟，再收剩下的 2 枚倒第二趟。",
      check: g => {
        const perches = posList(g.var("eggPerches"));
        const cleared = agentPlaces(g, "air");
        const { perTrip, tail, firstRunClears } = tripsOf(g);
        return (
          perches.every(p => g.block(p).id === C + "air" && cleared.some(e => samePos(e.pos, p))) &&
          firstRunClears === perches.length &&
          perTrip.length >= 2 &&
          perTrip.every(n => n >= 1 && n <= 4) &&
          perTrip.reduce((a, b) => a + b, 0) === 6 &&
          tail === 0
        );
      },
    },
    {
      id: "l02-hatch-intact",
      text: "别动 3 个带玻璃罩的孵蛋窝",
      hint:
        "带玻璃罩的窝（hatch1 到 hatch3）是留给母鸡孵小鸡的，一个都不能碰；代码里只对 perch1 到 perch6 写 collect。如果不小心写到罩子上，灰崽会报「这一格没有可以收走的蛋」，按提示改掉再跑一遍。",
      check: g => posList(g.var("hatchNests")).every(p => g.block(p).id === C + "glass"),
    },
    {
      id: "l02-report",
      text: "回艾拉身边，把桶里的数报给她",
      hint:
        "先走回艾拉身边：`golem.moveTo(eira)`——eira 就是艾拉的名字，不用背坐标。再让她报数：`const n = world.container(barrel).count(\"egg\")` 从木桶里现数，然后 `golem.say(\`木桶里有 \${n} 枚蛋\`)` 说给艾拉听。报数要用变量现数，不能自己写死 6。",
      check: g => {
        const home = g.withinRadius(g.agent("golem"), { pos: pos(g.var("eira")) }, 4);
        const said = g.events("say").some(e => {
          const text = String(e.data?.text ?? "");
          const m = text.match(/桶[里内][^0-9]{0,6}(\d+)/);
          return m !== null && Number(m[1]) === 6;
        });
        return home && said;
      },
    },
  ],
  narrative: {
    opening: ["麦穗节要到了，六个蛋糕还差六枚蛋。", "灰崽没有记性：收了几枚、倒了几枚，得你替它记。", "它的小筐一趟只装得下 4 枚，所以得分两趟。"],
    worldState: "鸡舍攒了六枚蛋，天亮前要全部收进谷仓门口的木桶。",
    whyYou: "计数这件事，织偶自己记不住；你写的变量就是它借来的记性。",
  },
  phases: ["两趟收蛋", "复查鸡舍", "回艾拉报数"],
});

/**
 * 挑战层（可跳过、不计星）：一趟搬完。
 * 主线要求分两趟（筐只装 4 枚）；挑战要求「一口气收完 6 枚再倒一次」——
 * 符文写得更紧，也要先看一遍三个孵蛋窝的玻璃罩。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L02_CHALLENGE: LevelChallenge = {
  id: "L02-one-trip",
  title: "挑战：一趟搬完",
  goal: "6 枚蛋一口气搬进木桶，只倒一次",
  reference: `golem.moveTo(perch1)
golem.collect("egg", perch1)
golem.moveTo(perch2)
golem.collect("egg", perch2)
golem.moveTo(perch3)
golem.collect("egg", perch3)
golem.moveTo(perch4)
golem.collect("egg", perch4)
golem.moveTo(perch5)
golem.collect("egg", perch5)
golem.moveTo(perch6)
golem.collect("egg", perch6)
golem.moveTo(barrel)
golem.deposit("egg", barrel, 6)
golem.moveTo(eira)
golem.say("木桶里有 6 枚蛋")
golem.moveTo(hatch1)
golem.say("带玻璃罩的窝：罩子还在")
golem.moveTo(eira)
golem.say("一趟倒完了，桶里 6 枚")`,
  check: g => {
    const perches = posList(g.var("eggPerches"));
    const hatch = posList(g.var("hatchNests"));
    const clears = agentPlaces(g, "air");
    const trips = tripsOf(g);
    const said = g.events("say").some(e => {
      const text = String(e.data?.text ?? "");
      const m = text.match(/桶[里内][^0-9]{0,6}(\d+)/);
      return m !== null && Number(m[1]) === 6;
    });
    return (
      // 一趟搬完：第一轮事件里只出现一次倒蛋（不重置重跑的第二轮重复事件不计）。
      trips.perTrip.length === 1 &&
      trips.perTrip[0] === perches.length &&
      trips.tail === 0 &&
      perches.every(p => clears.some(e => samePos(e.pos, p))) &&
      clears.every(e => perches.some(p => samePos(e.pos, p)) && !hatch.some(p => samePos(e.pos, p))) &&
      hatch.every(p => g.block(p).id === C + "glass") &&
      said &&
      g.withinRadius(g.agent("golem"), { pos: pos(g.var("eira")) }, 4)
    );
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L02: LevelDef & { challenge: LevelChallenge } = Object.assign(L02_BASE, {
  challenge: L02_CHALLENGE,
});

/** MockWorld 场景：鸡舍一排窝 + 3 个玻璃罩 + 谷仓木桶 + 装饰（固定布景，数值见 spec §3）。 */
export const L02Content: LevelContent & { challenge: LevelChallenge; copy: ContentCopy } = {
  def: L02,
  challenge: L02_CHALLENGE,
  copy: L02_COPY,
  async prepare(port) {
    const vars = port.world.vars;
    const perches = posList(vars.eggPerches);
    const hatch = posList(vars.hatchNests);
    const barrel = pos(vars.barrel);
    const tower = pos(vars.cakeTower);
    const blocks: Array<{ pos: Pos; block: string }> = [];

    // ---- 美术 pass：村西鸡舍与谷仓，不再是一片光石台 ----
    const art: Array<{ pos: Pos; block: string }> = [];
    const putArt = (x: number, y: number, z: number, block: string) => art.push({ pos: [x, y, z], block });
    // 苔藓草地与碎石/土径
    for (let x = -24; x <= 12; x += 1) for (let z = -18; z <= 24; z += 1) putArt(x, 64, z, "minecraft:moss_block");
    for (let z = -8; z <= 20; z += 1) for (let x = -1; x <= 1; x += 1) putArt(x, 64, z, z % 3 === 0 ? "minecraft:cobblestone" : "minecraft:gravel");
    for (let x = -18; x <= 0; x += 1) for (let z = 15; z <= 17; z += 1) putArt(x, 64, z, (x + z) % 4 === 0 ? "minecraft:cobblestone" : "minecraft:gravel");
    // 谷仓（村西）：木墙、石基、深色屋顶、灯笼与干草垛
    for (let x = -22; x <= -18; x += 1) for (let z = -8; z <= -2; z += 1) {
      const edge = x === -22 || x === -18 || z === -8 || z === -2;
      if (edge) {
        putArt(x, 65, z, "minecraft:spruce_planks");
        putArt(x, 66, z, z === -5 ? "minecraft:lantern" : "minecraft:spruce_planks");
        putArt(x, 67, z, "minecraft:spruce_planks");
      }
    }
    for (let x = -23; x <= -17; x += 1) for (let z = -9; z <= -1; z += 1) putArt(x, 68, z, "minecraft:dark_oak_planks");
    putArt(-20, 65, -1, "minecraft:hay_block"); putArt(-19, 65, -1, "minecraft:hay_block");
    putArt(-18, 65, -1, "minecraft:oak_fence_gate");
    // 鸡舍：围栏、屋顶、干草、灯笼（避开蛋窝与走道）
    for (let x = -18; x <= -4; x += 4) { putArt(x, 65, 15, "minecraft:oak_fence"); putArt(x, 65, 19, "minecraft:oak_fence"); }
    for (let z = 15; z <= 19; z += 2) { putArt(-18, 65, z, "minecraft:oak_fence"); putArt(-4, 65, z, "minecraft:oak_fence"); }
    for (let x = -17; x <= -5; x += 1) for (let z = 16; z <= 19; z += 1) putArt(x, 68, z, (x + z) % 2 === 0 ? "minecraft:hay_block" : "minecraft:oak_planks");
    putArt(-17, 65, 18, "minecraft:lantern"); putArt(-5, 65, 18, "minecraft:lantern");
    putArt(-11, 65, 20, "minecraft:barrel"); putArt(-10, 65, 20, "minecraft:hay_block");
    // 水槽、花圃、树
    for (let x = 3; x <= 6; x += 1) for (let z = 8; z <= 9; z += 1) putArt(x, 64, z, "minecraft:water");
    for (let x = 2; x <= 7; x += 1) { putArt(x, 64, 7, "minecraft:stone_bricks"); putArt(x, 64, 10, "minecraft:stone_bricks"); }
    for (let x = 3; x <= 6; x += 1) for (let z = 8; z <= 9; z += 1) putArt(x, 65, z, (x + z) % 2 === 0 ? "minecraft:poppy" : "minecraft:cornflower");
    for (const [tx, tz] of [[-21, 12], [8, -12], [9, 20], [-22, 22]] as const) {
      for (let y = 65; y <= 68; y += 1) putArt(tx, y, tz, "minecraft:spruce_log");
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) if (Math.abs(dx) + Math.abs(dz) <= 3) putArt(tx + dx, 69, tz + dz, (dx + dz) % 2 === 0 ? "minecraft:azalea" : "minecraft:flowering_azalea");
    }
    putArt(-8, 65, -2, "minecraft:campfire"); putArt(7, 65, 2, "minecraft:barrel"); putArt(-17, 65, 4, "minecraft:flower_pot");

    // 蛋窝：干草垫 + 蛋
    for (const p of perches) {
      blocks.push({ pos: [p[0], 64, p[2]], block: "hay_block" });
      blocks.push({ pos: p, block: "egg" });
    }
    // 孵蛋窝：玻璃罩（判定不变量：罩子还在 = 没被碰）
    for (const p of hatch) {
      blocks.push({ pos: [p[0], 64, p[2]], block: "hay_block" });
      blocks.push({ pos: p, block: "glass" });
    }
    // 谷仓：地板 + 木桶 + 蛋糕塔座（塔座 1 格 stone_bricks，塔座上方 cakeTower 保持空气给玩家放蛋糕）
    for (let x = -2; x <= 3; x++) blocks.push({ pos: [x, 64, -7], block: "oak_planks" });
    blocks.push({ pos: barrel, block: "barrel" });
    blocks.push({ pos: [tower[0], tower[1] - 1, tower[2]], block: "stone_bricks" });
    // 装饰（docs/19：灯笼/营火/花盆/栅栏，≥8 个非功能点）
    blocks.push({ pos: [-6, 65, 6], block: "lantern" });
    blocks.push({ pos: [3, 65, 2], block: "lantern" });
    blocks.push({ pos: [2, 65, 6], block: "campfire" });
    blocks.push({ pos: [-4, 65, 8], block: "flower_pot" });
    // 倒蛋位（DEPOSIT_POS = 命名点 barrel）必须留空：语义 deposit 会从这一格向上找空气格，
    // 第一趟落在 y=65、第二趟叠在 y=66；评分只认「桶边 x/z」的 egg 事件，不要求同一个高度。
    blocks.push({ pos: [0, 65, 2], block: "hay_block" });
    blocks.push({ pos: [2, 65, 8], block: "oak_fence" });
    blocks.push({ pos: [-6, 64, 6], block: "cobblestone" });

    await port.clearRegion([-32, 60, -32], [32, 80, 32]);
    await port.setBlocks([...art, ...blocks]);
    await port.setTime(1000); // 麦穗节清晨：天已亮、太阳刚升起（verifier 实拍：22500/23200 都偏暗带星，玩家出生第一眼过暗）
    await port.setWeather("clear");
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, 65, 0], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(L02.world.vars.eira), role: "npc" });
    await port.spawnEntity({ type: "chicken", id: "hens", name: "母鸡", pos: [-11, 65, 13], role: "prop" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:cake", 8);
  },
  async playerBeat(port) {
    // 玩家节拍：喂鸡催下的第 6 枚蛋由 setup 预置；这里模拟玩家把最后一只蛋糕放上蛋糕塔。
    await port.playerPlace("cake", pos(L02.world.vars.cakeTower));
  },
};
