/**
 * L04 — 麦田的咒语（MockWorld 版）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准：织偶（不会猜你意思的工匠）、符文（一句只做一件事的短句）、
 * 散线（让东西忘记自己是啥的灰白线头）、织者之印（只有活人手能完成的最后一步）。
 * 数值与教学意图以 content/levels/L04-wheat-spell.md 为准（A4 循环）：
 * 三块田都要先收残株、再种满（水渠整行跳过），种子不够时种到没种子就停，最后回谷仓。
 *
 * T1 MockWorld 学生面只有 golem.moveTo/place/say/pos 与只读 world.vars
 * （docs/21 §2；docs/12 的 world.field / golem.plant / harvest 尚未接线），所以本文件用
 * 「等价动作」实现：
 *   田的数据 = world.vars.fieldA / fieldB / fieldC（字段同 registry 的 Field：rows/cols/x/z/waterRow/seeds）
 *   收割    = 走到格子边 place("air", x, 65, z)
 *   种下    = 同一格 place("wheat_sprout", x, 65, z)
 *   放稻草人 = 玩家节拍：playerPlace("pumpkin", 稻草人位置)
 * 真实 Paper 版接线后，学生代码换成 world.field() / golem.harvest / golem.plant，
 * 田数据与判定不变。
 */
import { defineLevel, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import type { ContentCopy } from "./L01.content";
import { banner, fenceLine, groundPatch, lampPost, pathLine, SCENE_PALETTE, tree } from "../scenes/scene-kit";

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
 * L04 场景美术（docs/35：午后金麦田 + 水渠/田垄 + 谷仓/石仓 + 稻草人 + 篱笆/树/农具）。
 *
 * 真实客户端坐标约定（与 L05 一致，Lead 已在 L05 修过一次同类问题）：
 * paper-port 的 deriveGroundY(L04) = 65（vars 里 y=65 的点最多）→ 插件 finalizeScene 取
 * floorY = groundY - 1 = 64（moss 地板层）、groundY = 65（站立层）。
 * 所以「看得见的平地」是 y=64 那层；y=65 的田块（farmland/water/wheat/hay_block）在插件里
 * 属于 logical plane，只进快照不进物理世界（否则织偶会被一堵 1 格高的田墙挡住）——
 * 田的**视觉**必须画在 y=64 地板层（farmland/coarse_dirt 土色 + hay_block 金麦 + prismarine 水渠蓝），
 * 立体道具从 y=65 起摆；y=65 的田块坐标上一格都不能放实体，否则会破坏逻辑层。
 *
 * playerSpawn = 区域中心 (12, 65, 8)（content.prepare 的 clearRegion 决定）；
 * 场景截图机位建议 spawn + [0, 5, 26] = (12, 70, 34) 朝北看（scene-shot.mjs --y 5 --z 26）。
 */
export const L04_SCENE = {
  time: 8000, // 午后偏晚：金麦田的长影子
  weather: "clear" as const,
  floorY: 64,
  groundY: 65,
  materials: ["moss_block", "coarse_dirt", "farmland", "hay_block", "prismarine", "stone_bricks", "spruce_planks", "dark_oak_planks"],
  lights: { warm: ["lantern", "campfire"], natural: ["daylight"] },
  landmarks: ["三块麦田", "水渠", "谷仓", "风车", "石仓", "稻草人", "篱笆"],
  /** 主视角：playerSpawn(12,65,8) + (0,5,26)，朝北看三块田。 */
  mainCamera: { pos: [12, 70, 34], lookAt: [12, 66, 8], time: 8000, fov: 75 },
  /** 给 Lead 的机位偏移：scene-shot.mjs --y 5 --z 26。 */
  cameraHint: { base: "playerSpawn", baseAt: [12, 65, 8], offset: [0, 5, 26], yaw: 180, pitch: 10 },
  /** 主视角一屏内应看到的东西（Lead 重拍时按这个清单对）。 */
  expectedVisible: [
    "三块金麦田：y=64 地板上 farmland 土色 + 成熟格 hay_block 金麦 + 水渠 prismarine 蓝，田埂是 hay_block 金边",
    "谷仓：左前方深色木谷仓（石砖地基 + 坡屋顶 + 门口暖灯 + 旁边干草垛）",
    "风车：左后方白帆风车（稳定方块，远景地标）",
    "石仓：正前方偏左的石砖小仓（圆顶 + 暖灯）",
    "稻草人：右侧近景干草身体 + 木手臂 + 草帽（南瓜头由玩家最后放上）",
    "篱笆/树/农具：东侧篱笆、田边云杉+杜鹃树、木桶/堆肥桶/工作台/营火暖光",
  ],
  screenshotSpots: [
    { name: "主视角：三块麦田 + 谷仓/风车/石仓", pos: [12, 70, 34], lookAt: [12, 66, 8], time: 8000 },
    { name: "田垄近景：金麦 + 水渠 + 稻草人", pos: [12, 67, 24], lookAt: [12, 65, 8], time: 8000 },
    { name: "谷仓与干草垛", pos: [4, 68, 26], lookAt: [-6, 66, 16], time: 8000 },
    { name: "风车与石仓", pos: [2, 70, 6], lookAt: [-8, 65, -12], time: 8000 },
  ],
  /** 主路走廊（真实地面以上 y65–67 净空；农道 + 谷仓前空地 + 出生点小院）。 */
  corridor: [
    { x0: 7, z0: -12, x1: 9, z1: 30 },
    { x0: -6, z0: 12, x1: 8, z1: 16 },
    { x0: 6, z0: -12, x1: 9, z1: -8 },
  ],
} as const;

export type Field = {
  rows: number;
  cols: number;
  x: number;
  z: number;
  waterRow: number;
  waterRow2?: number;
  seeds: number;
  plantable: number;
};

/** 可复现的伪随机（不用 Math.random：同一 seed 同一块田，测试与录像都能复现）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由 seed 生成一块田（随机尺寸 + 一条水渠行 + 随机种子数 + 随机残株格）。 */
export function layoutFor(seed: number, seedBudgetRatio = 1, z = -8): { field: Field; matureCells: Pos[] } {
  const rnd = mulberry32(seed);
  const rows = 4 + Math.floor(rnd() * 4); // 4..7 行
  const cols = 4 + Math.floor(rnd() * 5); // 4..8 列
  const waterRow = 1 + Math.floor(rnd() * Math.max(1, rows - 2));
  const plantable = rows * cols - cols;
  const seeds = Math.max(1, Math.round(plantable * seedBudgetRatio));
  const field: Field = { rows, cols, x: 10, z, waterRow, seeds, plantable };
  const cells: Pos[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== waterRow) cells.push([field.x + c, 65, field.z + r]);
    }
  }
  const shuffled = [...cells];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const matureCells = shuffled.slice(0, Math.round(plantable * 0.4));
  return { field, matureCells };
}

/** 三块主田：东、中、西（各自一个 seed，尺寸/水渠行/种子数都不同）。 */
const FIELD_A = layoutFor(7, 1, -8);
const FIELD_B = layoutFor(11, 1, 2);
const FIELD_C = layoutFor(3, 1, 12);

/** 挑战层用的「不规则田」：两行水渠 + 种子只够六成 + 比主线多两行。 */
function challengeLayout(): { field: Field; matureCells: Pos[] } {
  const { field, matureCells } = layoutFor(23, 0.6);
  const waterRow2 = 1 + ((field.waterRow + 2) % (field.rows - 1));
  const rows = Math.max(field.rows, 6);
  const cols = field.cols;
  const plantable = rows * cols - 2 * cols; // 两行水渠
  const seeds = Math.max(1, Math.round(plantable * 0.6));
  return {
    field: { ...field, rows, cols, z: -8, waterRow: field.waterRow % rows, waterRow2: waterRow2 % rows, seeds, plantable },
    matureCells,
  };
}

const CH = challengeLayout();

const FIELDS = ["fieldA", "fieldB", "fieldC"] as const;
const MATURE = ["matureCellsA", "matureCellsB", "matureCellsC"] as const;
const fieldOf = (g: GraderApi, key: (typeof FIELDS)[number]): Field => g.var(key) as Field;
const matureOf = (g: GraderApi, key: (typeof MATURE)[number]): Pos[] => g.var(key) as Pos[];

/** 内容层文案：错误点名行号与改哪个符号，不用「循环边界」这类黑话（FR-023/FR-024）。 */
export const L04_COPY: ContentCopy = {
  coordinateRule: "括号里的两个数是横着第几格、前后第几格；先写 moveTo 走到格子边，再写 place 收残株或下种。",
  golemNote: "golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。",
  hints: [
    "田多大不用数：问田地一句，它会报出行数和列数。",
    "别把行数、列数写进代码；外层走行，内层走列，水渠那一行跳过。",
    "种子不够时，用按条件停的循环来种，种到没种子就停下。",
  ],
  errors: [
    {
      line: 8,
      reason: "第 8 行走多了一格：最后一格本来不用碰。",
      fix: "把 <= 改成 <，再运行一次，看是不是刚好种满。照抄：",
      sample: "for (let r = 0; r < f.rows; r++) {",
    },
    {
      line: 9,
      reason: "第 9 行把 5 固定住了：田换了大小就种得不对。",
      fix: "行数用 f.rows，列数用 f.cols，它们会自己报数。照抄：",
      sample: "for (let c = 0; c < f.cols; c++) {",
    },
    {
      line: 10,
      reason: "第 10 行把种子下到了水渠里，那一行不能种。",
      fix: "判断里跳过 f.waterRow 这一行。照抄：",
      sample: "if (r !== f.waterRow) {",
    },
    {
      line: 12,
      reason: "第 12 行的循环停不下来：r 一直没有加 1。",
      fix: "在循环末尾补一句 r = r + 1，让它一行一行往下走。照抄：",
      sample: "r = r + 1",
    },
    {
      line: 13,
      reason: "第 13 行少了先收残株这一步，成熟麦挡着种不下去。",
      fix: "同一格先收掉残株，再放新麦苗。照抄：",
      sample: 'golem.place("air", f.x + c, 65, f.z + r)',
    },
    {
      line: 20,
      reason: "第 20 行田种完了还没回谷仓。",
      fix: "最后走到谷仓门口（-4, 14），就算收工。照抄：",
      sample: "golem.moveTo(-4, 14)",
    },
  ],
  timeout: "灰崽走了很久还没走完，八成是同一步在绕圈。按「重置」再来一遍，看看 r 有没有一步一步往前走。",
};

const L04_BASE: LevelDef = defineLevel({
  id: "L04",
  meta: {
    id: "L04",
    title: { zh: "麦田的咒语", en: "The Wheat Spell" },
    act: 1,
    order: 4,
    priority: "P0",
    prerequisites: ["L03"],
    estimatedMinutes: 15,
    difficulty: 3,
    abstractions: ["A4"],
    objectives: [
      { id: "o-for", learnerView: "用 for 让同一件事重复做很多次，次数由田的大小决定", evidence: { kind: "machine", ref: "planted-full" } },
      { id: "o-nested", learnerView: "两层循环 = 一行一行把整片田走完", evidence: { kind: "machine", ref: "harvest-first" } },
      { id: "o-skip", learnerView: "循环里用 if 跳过水渠；种子用完就该停", evidence: { kind: "machine", ref: "planted-full" } },
    ],
    misconceptions: ["off-by-one", "hardcode-field-size", "seed-in-water", "skip-harvest", "while-never-stops"],
    apiIntroduced: ["world.field", "golem.plant", "golem.harvest"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.field", "golem.plant", "golem.harvest"],
    syntaxIntroduced: ["for", "while", "嵌套循环"],
    reward: { rune: "A4", advancement: "loomcraft/act1/wheat_spell", codexPage: "A4" },
    languageLevel: "act1",
  },
  world: {
    vars: {
      // RT-03：world.vars 是冻结只读副本，田数据在 def 里静态声明（测试克隆 def 换 seed）
      fieldA: { ...FIELD_A.field },
      fieldB: { ...FIELD_B.field },
      fieldC: { ...FIELD_C.field },
      matureCellsA: FIELD_A.matureCells.map(m => [...m]),
      matureCellsB: FIELD_B.matureCells.map(m => [...m]),
      matureCellsC: FIELD_C.matureCells.map(m => [...m]),
      challengeField: { ...CH.field },
      challengeMature: CH.matureCells.map(m => [...m]),
      barn: [-4, 65, 14],
      scarecrow: [14, 66, 26],
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
    ],
  },
  code: {
    expectedLoc: 56,
    starterCode: `// 三块田的数据在 world.vars.fieldA / fieldB / fieldC 里（行数、列数、水渠行、种子数都在里面）。
// 每格的活：先 golem.place("air", x, 65, z) 收掉残株，再 golem.place("wheat_sprout", x, 65, z) 种下。

// 现在只种了东田左上角一块固定的 5×5，另外两块田还没碰，也没先收残株。
const a = world.vars.fieldA
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    golem.moveTo(a.x + c, a.z + r)
    golem.place("wheat_sprout", a.x + c, 65, a.z + r)
  }
}

// 东田还没种对：行数和列数要读 a.rows、a.cols，水渠那一行跳过，种子用完就停。
// 中田、西田是同样的活：数据在 world.vars.fieldB 和 world.vars.fieldC 里。
// 三块田都种完以后，回谷仓（-4, 14）报一报各种了多少格。
golem.moveTo(-4, 14)
`,
    referenceSolution: `// 阶段一：东田——先收残株，再种新种；种子用完就停
const a = world.vars.fieldA
let seedsA = a.seeds
let rA = 0
while (rA < a.rows && seedsA > 0) {
  for (let cA = 0; cA < a.cols; cA++) {
    if (rA !== a.waterRow && seedsA > 0) {
      golem.moveTo(a.x + cA, a.z + rA)
      golem.place("air", a.x + cA, 65, a.z + rA)
      golem.place("wheat_sprout", a.x + cA, 65, a.z + rA)
      seedsA = seedsA - 1
    }
  }
  rA = rA + 1
}

// 阶段二：中田——同一段符文再走一遍
const b = world.vars.fieldB
let seedsB = b.seeds
let rB = 0
while (rB < b.rows && seedsB > 0) {
  for (let cB = 0; cB < b.cols; cB++) {
    if (rB !== b.waterRow && seedsB > 0) {
      golem.moveTo(b.x + cB, b.z + rB)
      golem.place("air", b.x + cB, 65, b.z + rB)
      golem.place("wheat_sprout", b.x + cB, 65, b.z + rB)
      seedsB = seedsB - 1
    }
  }
  rB = rB + 1
}

// 阶段三：西田——再来一遍
const c = world.vars.fieldC
let seedsC = c.seeds
let rC = 0
while (rC < c.rows && seedsC > 0) {
  for (let cC = 0; cC < c.cols; cC++) {
    if (rC !== c.waterRow && seedsC > 0) {
      golem.moveTo(c.x + cC, c.z + rC)
      golem.place("air", c.x + cC, 65, c.z + rC)
      golem.place("wheat_sprout", c.x + cC, 65, c.z + rC)
      seedsC = seedsC - 1
    }
  }
  rC = rC + 1
}

// 阶段四：回谷仓，报三块田各种了多少格
golem.moveTo(-4, 14)
golem.say("东田：种下了 " + (a.seeds - seedsA) + " 格")
golem.say("中田：种下了 " + (b.seeds - seedsB) + " 格")
golem.say("西田：种下了 " + (c.seeds - seedsC) + " 格")
golem.say("三块田都收好种好了")

// 收工前再走一遍东田的水渠，确认渠里没有种子
golem.moveTo(a.x, a.z + a.waterRow)
golem.say("东田水渠：干净")
golem.moveTo(-4, 14)
`,
  },
  task: {
    mainTask: "先把三块田里上一季的残株收掉，再把能种的格子都种上；水渠整行跳过，种完回谷仓。",
    makeTask: "种子只够六成时，种到没种子就停下，一粒也别浪费。",
    playerBeat: "雨停后，你把南瓜头放到干草捆上——稻草人立起来（织者之印）。",
    successCriteria: [
      {
        id: "harvest-first",
        text: "先收掉上一季的残株",
        check: g => {
          const airs = agentPlaces(g, "air");
          const sprouts = agentPlaces(g, "wheat_sprout");
          return MATURE.every(key =>
            matureOf(g, key).every(m => {
              const sprout = sprouts.find(e => samePos(e.pos, m));
              if (!sprout) return g.block(m).id === C + "wheat";
              const air = airs.find(e => samePos(e.pos, m));
              return !!air && (air.seq ?? 0) < (sprout.seq ?? 0) && g.block(m).id === C + "wheat_sprout";
            }),
          );
        },
      },
      {
        id: "planted-full",
        text: "把三块田都种上",
        check: g => {
          let plantedAll = 0;
          let expectedAll = 0;
          for (const key of FIELDS) {
            const f = fieldOf(g, key);
            expectedAll += Math.min(f.plantable, f.seeds);
            for (let r = 0; r < f.rows; r++) {
              for (let col = 0; col < f.cols; col++) {
                if (r === f.waterRow || r === f.waterRow2) continue;
                if (g.block([f.x + col, 65, f.z + r]).id === C + "wheat_sprout") plantedAll += 1;
              }
            }
          }
          return plantedAll === expectedAll;
        },
      },
      {
        id: "golem-home",
        text: "种完回谷仓",
        check: g => g.withinRadius(g.agent("golem"), { pos: pos(g.var("barn")) }, 5),
      },
    ],
    hiddenTests: [
      {
        id: "h-water-row",
        name: "水渠那一行不能下种",
        setup: { note: "把种子丢进水渠会在这里失败（挑战田有两行水渠）" },
        assertions: [
          {
            id: "water-clean",
            text: "所有水渠行还是水，种下的作物都在渠外",
            check: g => {
              for (const key of FIELDS) {
                const f = fieldOf(g, key);
                for (let col = 0; col < f.cols; col++) {
                  for (const wr of [f.waterRow, f.waterRow2]) {
                    if (wr === undefined) continue;
                    if (g.block([f.x + col, 65, f.z + wr]).id !== C + "water") return false;
                  }
                }
              }
              return agentPlaces(g, "wheat_sprout").every(e => {
                if (!e.pos) return false;
                for (const key of FIELDS) {
                  const f = fieldOf(g, key);
                  const col = e.pos[0] - f.x;
                  const r = e.pos[2] - f.z;
                  if (col >= 0 && col < f.cols && r >= 0 && r < f.rows) {
                    return r !== f.waterRow && r !== f.waterRow2;
                  }
                }
                return false;
              });
            },
          },
        ],
      },
      {
        id: "h-only-field",
        name: "只在田里动土，不往田外乱放",
        setup: { note: "写死坐标、把种撒到田外会在这里失败" },
        assertions: [
          {
            id: "inside-field",
            text: "所有放置都在三块田的范围内",
            check: g =>
              g
                .events("block.place")
                .filter(e => e.actorType === "agent")
                .every(e => {
                  if (!e.pos) return false;
                  return FIELDS.some(key => {
                    const f = fieldOf(g, key);
                    const col = e.pos![0] - f.x;
                    const r = e.pos![2] - f.z;
                    return col >= 0 && col < f.cols && r >= 0 && r < f.rows;
                  });
                }),
          },
        ],
      },
      {
        id: "h-no-double",
        name: "同一格不重复种",
        setup: { note: "循环写错、同一格种两次会在这里失败" },
        assertions: [
          {
            id: "no-double-plant",
            text: "每一格最多只种一次",
            check: g => {
              const seen = new Set<string>();
              for (const e of agentPlaces(g, "wheat_sprout")) {
                if (!e.pos) continue;
                const key = e.pos.join(",");
                if (seen.has(key)) return false;
                seen.add(key);
              }
              return true;
            },
          },
        ],
      },
    ],
  },
  phases: ["东中西三块田", "回谷仓复查"],
});

/**
 * 挑战层（可跳过、不计星）：不规则田——两行水渠、种子只够六成、还多两行。
 * 主线的符文只会跳一行水渠；这一层要把两行都跳过，还要在种子用完时自己停。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L04_CHALLENGE: LevelChallenge = {
  id: "L04-irregular-field",
  title: "挑战：不规则田",
  goal: "两行水渠、种子六成，也要种得刚刚好",
  reference: `const f = world.vars.challengeField
let seeds = f.seeds
let r = 0
while (r < f.rows && seeds > 0) {
  for (let col = 0; col < f.cols; col++) {
    if (r !== f.waterRow && r !== f.waterRow2 && seeds > 0) {
      golem.moveTo(f.x + col, f.z + r)
      golem.place("air", f.x + col, 65, f.z + r)
      golem.place("wheat_sprout", f.x + col, 65, f.z + r)
      seeds = seeds - 1
    }
  }
  r = r + 1
}
golem.moveTo(-4, 14)
golem.say("挑战田：两行水渠都让开了")
`,
  check: g => {
    const f = g.var("challengeField") as Field;
    let planted = 0;
    for (let r = 0; r < f.rows; r++) {
      for (let col = 0; col < f.cols; col++) {
        if (r === f.waterRow || r === f.waterRow2) {
          if (g.block([f.x + col, 65, f.z + r]).id !== C + "water") return false;
          continue;
        }
        if (g.block([f.x + col, 65, f.z + r]).id === C + "wheat_sprout") planted += 1;
      }
    }
    return planted === Math.min(f.plantable, f.seeds) && planted === f.seeds;
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L04: LevelDef & { challenge: LevelChallenge } = Object.assign(L04_BASE, {
  challenge: L04_CHALLENGE,
});

/** MockWorld 场景：三块田（随机尺寸/水渠/残株）、谷仓、稻草人底座与装饰。 */
export const L04Content: LevelContent & { challenge: LevelChallenge; copy: ContentCopy } = {
  def: L04,
  challenge: L04_CHALLENGE,
  copy: L04_COPY,
  async prepare(port) {
    const vars = port.world.vars; // deep-frozen 只读副本（RT-03）
    const F = L04_SCENE.floorY; // 64：真实客户端看得见的地板层
    const G = L04_SCENE.groundY; // 65：站立层 = 田块逻辑层（logical plane，不可放实体道具）
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const fields: Array<{ field: Field; mature: Pos[] }> = [
      { field: vars.fieldA as Field, mature: posList(vars.matureCellsA) },
      { field: vars.fieldB as Field, mature: posList(vars.matureCellsB) },
      { field: vars.fieldC as Field, mature: posList(vars.matureCellsC) },
    ];
    const fieldGrid = fields.map(({ field, mature }) => ({
      field,
      mature: new Set(mature.map(m => m.join(","))),
      rect: { x0: field.x, x1: field.x + field.cols - 1, z0: field.z, z1: field.z + field.rows - 1 },
    }));
    const inField = (x: number, z: number, margin = 0): boolean =>
      fieldGrid.some(({ rect }) => x >= rect.x0 - margin && x <= rect.x1 + margin && z >= rect.z0 - margin && z <= rect.z1 + margin);
    const inCorridor = (x: number, z: number): boolean =>
      L04_SCENE.corridor.some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);

    // ---- 功能方块（评分位）：与旧版完全一致，一个不改 ----
    const functional: Array<{ pos: Pos; block: string }> = [];
    const pushF = (x: number, y: number, z: number, block: string) => functional.push({ pos: [x, y, z], block });
    for (const { field } of fields) {
      const mature = new Set((fields.find(f => f.field === field)?.mature ?? []).map(m => m.join(",")));
      for (let r = 0; r < field.rows; r++) {
        for (let col = 0; col < field.cols; col++) {
          const p: Pos = [field.x + col, G, field.z + r];
          const isWater = r === field.waterRow || r === field.waterRow2;
          if (isWater) pushF(p[0], p[1], p[2], "water");
          else if (mature.has(p.join(","))) pushF(p[0], p[1], p[2], "wheat");
          else pushF(p[0], p[1], p[2], "farmland");
        }
      }
    }
    const barn = pos(vars.barn);
    pushF(barn[0], G, barn[2], "barrel");
    pushF(barn[0], G, barn[2] + 1, "oak_planks");
    pushF(barn[0] - 1, G, barn[2], "hay_block");
    const scarecrow = pos(vars.scarecrow);
    pushF(scarecrow[0], G, scarecrow[2], "hay_block");
    pushF(scarecrow[0], scarecrow[1], scarecrow[2], "hay_block");
    const functionalKeys = new Set(functional.map(({ pos: [x, y, z] }) => key(x, y, z)));

    // ---- 地板层美术（y=64，真机可见、可走；田的视觉全画在这一层）----
    const floor: Array<{ pos: Pos; block: string }> = [];
    const putFloor = (x: number, z: number, block: string) => floor.push({ pos: [x, F, z], block });
    // 泥土/砾石补丁，避免一整片同色绿
    for (const [x0, x1, z0, z1] of [[-14, -2, 15, 23], [0, 6, -10, -2], [20, 30, -18, 6], [20, 30, 18, 32]] as const) {
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) putFloor(x, z, "minecraft:coarse_dirt");
    }
    // 麦田西侧农道（x=7..9）+ 谷仓前空地（z=13..15）+ 出生点小院
    for (let z = -12; z <= 30; z += 1) for (let x = 7; x <= 9; x += 1) putFloor(x, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[0] : SCENE_PALETTE.path[1]);
    for (let x = -6; x <= 8; x += 1) for (let z = 13; z <= 15; z += 1) putFloor(x, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[1] : SCENE_PALETTE.path[0]);
    for (let x = 6; x <= 10; x += 1) for (let z = -12; z <= -8; z += 1) putFloor(x, z, SCENE_PALETTE.path[0]);
    // 三块田的床：水渠 prismarine 蓝 / 成熟格 hay_block 金麦 / 其余 farmland 土 —— 都画在 y=64
    for (const { field, mature } of fieldGrid) {
      for (let r = 0; r < field.rows; r++) {
        for (let col = 0; col < field.cols; col++) {
          const x = field.x + col;
          const z = field.z + r;
          const isWater = r === field.waterRow || r === field.waterRow2;
          putFloor(x, z, isWater ? "minecraft:prismarine" : mature.has([x, G, z].join(",")) ? "minecraft:hay_block" : "minecraft:farmland");
        }
      }
      // 田埂：整圈 hay_block 金边（放在田块外一圈，y=64）
      for (let col = -1; col <= field.cols; col += 1) {
        putFloor(field.x + col, field.z - 1, "minecraft:hay_block");
        putFloor(field.x + col, field.z + field.rows, "minecraft:hay_block");
      }
      for (let r = 0; r < field.rows; r += 1) {
        putFloor(field.x - 1, field.z + r, "minecraft:hay_block");
        putFloor(field.x + field.cols, field.z + r, "minecraft:hay_block");
      }
      // 水渠两端接一段石沿，想让水渠看起来是「贯穿田地的水线」
      putFloor(field.x - 2, field.z + field.waterRow, "minecraft:stone_bricks");
      putFloor(field.x + field.cols + 1, field.z + field.waterRow, "minecraft:stone_bricks");
    }
    // 东侧灌渠（水蓝，远处可见；不在织偶寻路上）与田边小池塘
    for (let z = -12; z <= 20; z += 1) {
      putFloor(21, z, "minecraft:water");
      putFloor(22, z, "minecraft:water");
      putFloor(20, z, "minecraft:prismarine");
      putFloor(23, z, "minecraft:prismarine");
    }
    for (let x = 4; x <= 7; x += 1) {
      for (let z = 27; z <= 30; z += 1) {
        const edge = x === 4 || x === 7 || z === 27 || z === 30;
        putFloor(x, z, edge ? "minecraft:stone_bricks" : "minecraft:water");
      }
    }
    // 谷仓前院石砖地
    for (let x = -12; x <= -2; x += 1) for (let z = 14; z <= 22; z += 1) putFloor(x, z, (x + z) % 2 === 0 ? SCENE_PALETTE.stone : SCENE_PALETTE.stoneAccent);

    // ---- 立体道具（y>=65）：谷仓 / 风车 / 石仓 / 稻草人 / 篱笆 / 农具 / 暖光 ----
    const art: Array<{ pos: Pos; block: string }> = [];
    const put = (x: number, y: number, z: number, block: string) => art.push({ pos: [x, y, z], block });

    // 地标 1：谷仓（目标位南侧，深色木 + 石砖地基 + 坡屋顶 + 门口暖灯 + 干草垛）
    const bx0 = -11, bx1 = -4, bz0 = 15, bz1 = 21;
    for (let x = bx0; x <= bx1; x += 1) {
      for (let z = bz0; z <= bz1; z += 1) {
        const edge = x === bx0 || x === bx1 || z === bz0 || z === bz1;
        if (!edge) continue;
        for (let y = G; y <= G + 2; y += 1) {
          const corner = (x === bx0 || x === bx1) && (z === bz0 || z === bz1);
          const win = !corner && (x + z) % 4 === 0 && y === G + 1;
          put(x, y, z, corner ? SCENE_PALETTE.log : win ? "minecraft:glass_pane" : SCENE_PALETTE.woodDark);
        }
      }
    }
    for (let x = bx0 - 1; x <= bx1 + 1; x += 1) for (let z = bz0 - 1; z <= bz1 + 1; z += 1) put(x, G + 3, z, SCENE_PALETTE.woodDeep);
    for (let x = bx0; x <= bx1; x += 1) for (let z = bz0; z <= bz1; z += 1) {
      const edge = x === bx0 || x === bx1 || z === bz0 || z === bz1;
      put(x, G + 4, z, edge ? "minecraft:dark_oak_stairs" : "minecraft:spruce_planks");
    }
    for (let x = bx0 + 1; x <= bx1 - 1; x += 1) put(x, G + 5, z0Mid(bz0, bz1), "minecraft:dark_oak_planks");
    function z0Mid(a: number, b: number): number { return Math.round((a + b) / 2); }
    // 谷仓门口：灯笼 + 干草垛 + 营火
    put(barn[0], G + 3, barn[2], SCENE_PALETTE.light);
    put(barn[0] - 3, G + 3, barn[2], SCENE_PALETTE.light);
    for (const [hx, hz] of [[-13, 18], [-13, 19], [-12, 20]] as const) { put(hx, G, hz, "minecraft:hay_block"); put(hx, G + 1, hz, "minecraft:hay_block"); }
    put(-9, G, 23, "minecraft:campfire");
    put(-8, G, 23, "minecraft:oak_stairs");
    put(-10, G, 23, "minecraft:oak_stairs");
    put(-2, G, 19, "minecraft:composter");
    put(-2, G, 18, "minecraft:barrel");
    put(-1, G, 17, "minecraft:crafting_table");
    put(-1, G, 16, "minecraft:cauldron");

    // 地标 2：风车（西北远景，白帆用 white_wool，稳定方块）
    for (let y = G; y <= G + 8; y += 1) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) put(-12 + dx, y, -12 + dz, SCENE_PALETTE.log);
    }
    for (let y = G + 6; y <= G + 8; y += 1) for (let x = -13; x <= -11; x += 1) for (let z = -13; z <= -11; z += 1) put(x, y, z, SCENE_PALETTE.wood);
    put(-12, G + 9, -12, "minecraft:white_wool"); // 风车轴
    // 风车十字白帆（1 格厚，稳定方块，远景可辨认）
    for (let d = 1; d <= 4; d += 1) {
      put(-12 - d, G + 9, -12, "minecraft:white_wool");
      put(-12 + d, G + 9, -12, "minecraft:white_wool");
      put(-12, G + 9, -12 - d, "minecraft:white_wool");
      put(-12, G + 9, -12 + d, "minecraft:white_wool");
    }

    // 地标 3：石仓（正前方偏左的石砖小仓，圆顶 + 暖灯）
    for (let y = G; y <= G + 4; y += 1) {
      for (let x = 1; x <= 4; x += 1) for (let z = -6; z <= -3; z += 1) {
        const edge = x === 1 || x === 4 || z === -6 || z === -3;
        if (!edge) continue;
        put(x, y, z, (x + y + z) % 3 === 0 ? SCENE_PALETTE.stoneAccent : SCENE_PALETTE.stone);
      }
    }
    for (let x = 1; x <= 4; x += 1) for (let z = -6; z <= -3; z += 1) put(x, G + 5, z, "minecraft:mossy_stone_bricks");
    put(2, G + 6, -4, "minecraft:stone_bricks");
    put(2, G + 4, -3, SCENE_PALETTE.light); // 仓门暖灯

    // 地标 4：稻草人（玩家最后放南瓜头；这里先把干草身体/木臂/草帽摆好）
    put(scarecrow[0] - 1, G + 1, scarecrow[2], "minecraft:oak_fence");
    put(scarecrow[0] + 1, G + 1, scarecrow[2], "minecraft:oak_fence");
    put(scarecrow[0], G + 2, scarecrow[2], "minecraft:hay_block"); // 草帽；南瓜头由玩家替换
    for (const [sx, sz] of [[scarecrow[0] - 1, scarecrow[2] - 1], [scarecrow[0] + 1, scarecrow[2] - 1], [scarecrow[0] - 1, scarecrow[2] + 1], [scarecrow[0] + 1, scarecrow[2] + 1]] as const) {
      put(sx, G, sz, "minecraft:oak_fence");
    }
    // 稻草人旁的花与木牌
    put(scarecrow[0] - 2, G, scarecrow[2], "minecraft:poppy");
    put(scarecrow[0] + 2, G, scarecrow[2], "minecraft:dandelion");
    put(scarecrow[0], G, scarecrow[2] - 2, "minecraft:flower_pot");

    // 篱笆：东侧田界 + 南北田头（留出农道口）
    art.push(...fenceLine(19, -10, 19, 20, G, 4));
    art.push(...fenceLine(6, -11, 19, -11, G, 4));
    art.push(...fenceLine(6, 21, 19, 21, G, 4));
    // 田间灯柱：田西侧农道边与东侧围栏边，暖光成排
    for (const [lx, lz] of [[6, -6], [6, 4], [6, 15], [24, -6], [24, 8], [24, 18]] as const) {
      art.push(...lampPost(lx, lz, F));
    }
    // 农具/木桶/干草：田角与谷仓前院（都在寻路走廊之外）
    for (const [ax, az] of [[6, 22], [18, 22], [6, -2], [18, -8], [2, 2]] as const) {
      put(ax, G, az, "minecraft:barrel");
      put(ax + 1, G, az, "minecraft:hay_block");
      put(ax, G + 1, az, "minecraft:flower_pot");
    }
    for (const [ax, az] of [[5, 18], [19, 12], [5, 24], [19, 26]] as const) put(ax, G, az, "minecraft:campfire");
    // 树：田边云杉 + 杜鹃叶（稳定方块，不用 oak_leaves）
    for (const [tx, tz] of [[-14, -2], [-14, 26], [26, -4], [26, 10], [26, 26], [2, 30], [-14, 6]] as const) {
      art.push(...tree(tx, tz, F));
    }
    // 农道两侧的灯笼列（前景暖光；x=5 不在农道 x7..9 上，也不在田块里）
    for (let z = -10; z <= 28; z += 6) {
      put(5, G, z, "minecraft:oak_fence");
      put(5, G + 1, z, SCENE_PALETTE.light);
    }
    // 东侧远景树带（挡住空地平线，仍用稳定方块）
    for (const [tx, tz] of [[30, 0], [32, -12], [34, 16], [30, 30], [-14, 34]] as const) {
      art.push(...tree(tx, tz, F));
    }
    art.push(...banner(4, G + 4, 26, 0), ...banner(-8, G + 4, 23, 1));

    // ---- 安全过滤：不压评分田块/功能位、不进主路走廊、不往逻辑层（y=65 田格）放实体 ----
    const safeArt = art.filter(({ pos: [x, y, z] }) => {
      const k = key(x, y, z);
      if (functionalKeys.has(k)) return false; // 评分位一格不盖
      if (inField(x, z, 0)) return false; // 田块正上方（含 y65 逻辑层）不放实体
      if (y > G && inField(x, z, 1)) return false; // 田块外一圈也留空，方便织偶走下田埂
      if (y <= G + 3 && inCorridor(x, z)) return false; // 主路 3 格宽净空
      return true;
    });

    await port.clearRegion([-16, 55, -24], [40, 85, 40]);
    await port.setBlocks([...floor, ...functional, ...safeArt]);
    await port.setTime(L04_SCENE.time); // 8000 午后偏晚
    await port.setWeather(L04_SCENE.weather);
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [8, G, -10], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: [8, G, 28], role: "npc" });
  },
  async playerBeat(port) {
    // 雨停后你把南瓜头放上干草捆：稻草人立起来（织者之印）
    await port.playerPlace("pumpkin", pos(L04_BASE.world.vars.scarecrow));
    await port.setWeather("clear");
    await port.setTime(1000);
  },
};
