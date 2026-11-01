/**
 * L06 — 商队的账本（MockWorld 版）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准：织偶（不会猜意思的无魂工匠）、符文（一句只做一件事的短句）、
 * 织者之印（只有活人的手能完成的最后一步）。
 * 教学意图与数值以 content/levels/L06-caravan-ledger.md 为准（A7 记录 + A8 可辨识联合/穷举）。
 *
 * T1 MockWorld 学生面只有 `golem.moveTo/place/say/pos` 与只读 `world.vars`
 * （docs/21 §2；docs/12 的 world.containers / golem.collect / golem.deposit / world.jobs / golem.giveTool
 *  尚未接线），因此本文件用「等价动作」实现，动作语义固定如下（真实 Paper 版由 MC 线替换动词，判定不动）：
 *   读账本     = world.vars.cargo（每件货有 id、kind、food；kind 只有 "tool"/"supply" 两种）
 *   取货       = 走到货箱边（moveTo）
 *   入桶       = 走到木桶格子上，place(货物编号, 格子坐标)；一格一件，放错格子就是放错桶
 *   配工具     = 走到工作点，place(需要的工具编号, 工作点坐标)
 *   交易       = 亲手节拍：playerPlace("loom_thread", 护符盒)，织者之印由活人完成
 * 真实 Paper 版接线后，学生代码换成 world.containers / golem.collect / golem.deposit / golem.giveTool，
 * 货物数据、三阶段结构与全部判定不变。
 */
import { defineLevel, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { SCENE_PALETTE, banner, fenceLine, groundPatch, lampPost, pathLine, tree } from "../scenes/scene-kit";

type Pos = [number, number, number];
type Kind = "tool" | "supply";
type CargoItem = { id: string; kind: Kind; food?: boolean };
type Boxes = { tools: Pos[]; materials: Pos[]; food: Pos[] };
type Job = { id: string; needs: string; station: Pos };

const C = "minecraft:";
const pos = (p: unknown): Pos => p as Pos;
const posList = (p: unknown): Pos[] => p as Pos[];
const cargoList = (p: unknown): CargoItem[] => p as CargoItem[];
const boxesOf = (p: unknown): Boxes => p as Boxes;
const jobsOf = (p: unknown): Job[] => p as Job[];
const blockId = (g: GraderApi, p: Pos): string => g.block(p).id;
const idOf = (g: GraderApi, p: Pos): string => blockId(g, p).replace(C, "");
const sameList = (a: string[], b: string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const agentPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "agent");
const playerPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "player");
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** 一件货该去哪个箱子：kind 是 tool；supply 再看 food。 */
const boxKeyOf = (item: CargoItem): keyof Boxes => (item.kind === "tool" ? "tools" : item.food ? "food" : "materials");

/**
 * 场景美术（傍晚商队营地）与真实机位：
 * `scripts/scene-shot.mjs` 固定取景 = session.status.playerSpawn（arena 中心，来自 prepare 的 clearRegion）
 *   → cam = [x, groundY + 4, z + 14]，yaw 180（朝北）、pitch 10。
 * deriveGroundY(L06)=65 → 插件 floorY=64（地板层）、groundY=65（站立高度）；
 * 所以美术从 y64 地板往上摆：y64 是地面/路/木桶底，y65–69 才是能看见的立体道具。
 * 本关把 clearRegion 设成 L06_CLEAR（中心 (8,12)），于是 playerSpawn=(8,65,12)、机位=(8,69,26)。
 */
export const L06_SCENE = {
  time: 12000,
  floorY: 64,
  groundY: 65,
  clear: { from: [-16, 55, -4] as Pos, to: [32, 85, 28] as Pos },
  camera: { pos: [8, 69, 26] as Pos, yaw: 180, pitch: 10, fovDeg: 70, aspect: 1.6, spawnCenter: [8, 12] as [number, number] },
  tents: {
    left: { min: [-9, 64, -1] as Pos, max: [-3, 67, 3] as Pos, center: [-6, 65, 1] as Pos },
    right: { min: [22, 64, -1] as Pos, max: [28, 67, 3] as Pos, center: [25, 65, 1] as Pos },
  },
  ledger: [10, 65, 19] as Pos,
  campfire: [11, 65, 21] as Pos,
  crates: [
    [2, 65, 20],
    [6, 65, 20],
    [-6, 65, 5],
    [-6, 65, 6],
    [18, 65, 2],
  ] as Pos[],
  llamas: [
    [3, 65, 20],
    [13, 65, 20],
  ] as Pos[],
  warmLights: [
    [2, 67, 18],
    [14, 67, 18],
    [11, 65, 21],
    [-6, 68, 1],
    [25, 68, 1],
  ] as Pos[],
};

/** 主路走廊（3 格宽，地面以上 y65–68 净空）：营地主轴、两翼通道、横巷。 */
export const L06_CORRIDOR = [
  { x0: 8, z0: 26, x1: 8, z1: 14 },
  { x0: 8, z0: 14, x1: -2, z1: 14 },
  { x0: -2, z0: 14, x1: -2, z1: 0 },
  { x0: 8, z0: 14, x1: 16, z1: 14 },
  { x0: 16, z0: 14, x1: 16, z1: 0 },
  { x0: -2, z0: 3, x1: 16, z1: 3 },
  { x0: 8, z0: 14, x1: 8, z1: 18 },
];

const corridorCells = (): Set<string> => {
  const cells = new Set<string>();
  for (const seg of L06_CORRIDOR) {
    const dx = Math.sign(seg.x1 - seg.x0);
    const dz = Math.sign(seg.z1 - seg.z0);
    const steps = Math.max(Math.abs(seg.x1 - seg.x0), Math.abs(seg.z1 - seg.z0));
    for (let i = 0; i <= steps; i++) {
      const x = seg.x0 + dx * i;
      const z = seg.z0 + dz * i;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        if (ox !== 0 && oz !== 0) continue;
        for (let y = 64; y <= 68; y++) cells.add(`${x + ox},${y},${z + oz}`);
      }
    }
  }
  return cells;
};

const rowOf = (x0: number, z: number): Pos[] => {
  const slots: Pos[] = [];
  for (let i = 0; i < 8; i++) slots.push([x0 + i * 2, 65, z]);
  return slots;
};

const MAIN_CARGO: CargoItem[] = [
  { id: "iron_axe", kind: "tool" },
  { id: "iron_pickaxe", kind: "tool" },
  { id: "iron_sword", kind: "tool" },
  { id: "raw_iron", kind: "supply", food: false },
  { id: "coal", kind: "supply", food: false },
  { id: "honeycomb", kind: "supply", food: false },
  { id: "bread", kind: "supply", food: true },
  { id: "carrot", kind: "supply", food: true },
];
const MAIN_BOXES: Boxes = { tools: rowOf(0, 0), materials: rowOf(0, 6), food: rowOf(0, 12) };
const MAIN_JOBS: Job[] = [
  { id: "chop", needs: "iron_axe", station: [20, 65, 0] },
  { id: "mine", needs: "iron_pickaxe", station: [20, 65, 6] },
  { id: "fight", needs: "iron_sword", station: [20, 65, 12] },
];
const CHALLENGE_CARGO: CargoItem[] = [
  ...MAIN_CARGO,
  { id: "iron_hoe", kind: "tool" },
  { id: "shears", kind: "tool" },
];

const L06_BASE: LevelDef = defineLevel({
  id: "L06",
  meta: {
    id: "L06",
    title: { zh: "商队的账本", en: "The Ledger of the Caravan" },
    act: 2,
    order: 6,
    priority: "P1",
    prerequisites: ["L05"],
    estimatedMinutes: 20,
    difficulty: 4,
    abstractions: ["A7", "A8"],
    objectives: [
      { id: "o-record", learnerView: "把相关的几个数绑成一条记录：工具 = 编号 + 类别", evidence: { kind: "machine", ref: "tools-box" } },
      { id: "o-union", learnerView: "用类别区分两种互斥的货，用分支各走一路", evidence: { kind: "machine", ref: "supply-boxes" } },
      { id: "o-exhaustive", learnerView: "新增一种情况时，在原来的分支里补一格", evidence: { kind: "machine", ref: "all-cargo-placed" } },
    ],
    misconceptions: ["string-compare-is-enough", "default-is-handled", "food-is-not-a-kind", "record-is-more-work"],
    apiIntroduced: ["world.containers", "world.jobs", "golem.giveTool", "world.caravan"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.containers", "world.jobs", "golem.giveTool", "world.caravan"],
    syntaxIntroduced: ["type 类型别名与记录", "可辨识联合（kind）", "switch 分支", "assertNever 穷举兜底"],
    reward: { rune: "A8", advancement: "loomcraft/act2/caravan_ledger", codexPage: "A8" },
    languageLevel: "act2",
  },
  world: {
    vars: {
      cargo: MAIN_CARGO.map(item => ({ ...item })),
      boxes: {
        tools: MAIN_BOXES.tools.map(p => [...p]),
        materials: MAIN_BOXES.materials.map(p => [...p]),
        food: MAIN_BOXES.food.map(p => [...p]),
      },
      jobs: MAIN_JOBS.map(job => ({ ...job, station: [...job.station] })),
      cargoBox: [4, 65, 20],
      trader: [10, 65, 20],
      shrine: [13, 65, 20],
      eira: [16, 65, 22],
      challengeCargo: CHALLENGE_CARGO.map(item => ({ ...item })),
      challengeBoxes: {
        tools: rowOf(-24, 0),
        materials: rowOf(-24, 6),
        food: rowOf(-24, 12),
      },
      challengeNewTools: ["iron_hoe", "shears"],
      challengeHooks: [
        [-24, 65, 20],
        [-22, 65, 20],
      ],
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "trader", role: "npc", id: "taka", name: "旅商塔卡" },
      { type: "llama", role: "mount", id: "llama-a", name: "驮货的羊驼" },
      { type: "llama", role: "mount", id: "llama-b", name: "小羊驼" },
      { type: "donkey", role: "prop", id: "donkey", name: "驴" },
    ],
    // 命名坐标点（docs/48 §1.1）：沙箱里可直接当全局变量用，如 golem.moveTo(trader)。
    points: {
      eira: { pos: [16, 65, 22], name: "艾拉" },
      cargoBox: { pos: [4, 65, 20], name: "混装货箱" },
      trader: { pos: [10, 65, 20], name: "旅商塔卡" },
      shrine: { pos: [13, 65, 20], name: "护符盒" },
      toolsBox: { pos: [0, 65, 0], name: "工具桶（入口格）" },
      materialsBox: { pos: [0, 65, 6], name: "材料桶（入口格）" },
      foodBox: { pos: [0, 65, 12], name: "食物桶（入口格）" },
      chopStation: { pos: [20, 65, 0], name: "锯木工作点" },
      mineStation: { pos: [20, 65, 6], name: "采矿工作点" },
      fightStation: { pos: [20, 65, 12], name: "守卫工作点" },
    },
    // 玩家出生点：营地北侧主路，朝北正对三只桶；离灰崽 (9,65,26) 有 14 格，不会怼脸。
    playerSpawn: [8, 65, 12],
  },
  code: {
    expectedLoc: 60,
    starterCode: `/**
 * L06 · 商队的账本
 *
 * 目标：
 *   1. 用记录（record，把几个字段绑成一条）给货建模，再用 switch 分类
 *   2. 把八件货分进工具桶、材料桶、食物桶
 *   3. 给三个工作点配好工具，回旅商塔卡身边对账
 *
 * 位置有两种写法（二选一，不要混用）：
 *   1. 用名字：golem.moveTo(cargoBox) / golem.place(货.id, 木桶.tools[0])
 *      → 名字是关卡给好的，推荐；格子在 world.vars.boxes 里
 *   2. 用坐标：golem.moveTo(4, 20) / golem.place("iron_axe", 0, 65, 0)
 *      → 分别是 x、z 和 x、y、z
 *
 * 数据：world.vars.cargo 每件货是 { id, kind, food }，kind 只有 "tool" 和 "supply"。
 *   world.vars.boxes 是三只桶的格子；world.vars.jobs 是工作点（needs 工具 / station 坐标）。
 *
 * 步骤：
 *   [1] 先放第一件货（斧头）进工具桶，运行看效果（下面 3 行已写好）
 *   [2] 写 function 类别Of(货)，用 switch 把货判成「工具 / 材料 / 食物」
 *   [3] 写 function 放货(货)，算出这件货该进哪一格
 *   [4] 用 for 循环把八件货各处理一次，再给三个工作点配工具
 *   [5] golem.moveTo(trader) 找塔卡对账
 *
 * 卡住时：打开「指令手册」查本关 API 与命名点；运行失败时看教练卡提示。
 */
type 货物 = { id: string; kind: "tool" | "supply"; food?: boolean }
type 木桶 = { tools: number[][]; materials: number[][]; food: number[][] }
const 货物表 = world.vars.cargo as 货物[]
const 木桶 = world.vars.boxes as 木桶

const 第一件 = 货物表[0]
golem.moveTo(木桶.tools[0][0], 木桶.tools[0][2])
golem.place(第一件.id, 木桶.tools[0][0], 木桶.tools[0][1], 木桶.tools[0][2])
`,
    referenceSolution: `/**
 * L06 · 商队的账本（参考解）
 *
 * 步骤：
 *   [1] 用记录建模货物，switch 分类，assertNever 兜底
 *   [2] 用对象账本记住每只桶的下一格
 *   [3] 逐件放货，再给工作点配工具
 *   [4] 回塔卡身边对账
 */
// 记录（record）：把一件货的 id、kind、food 绑成一条；可辨识联合：kind 只有 tool / supply 两种。
type 货物 = { id: string; kind: "tool" | "supply"; food?: boolean }
type 木桶 = { tools: number[][]; materials: number[][]; food: number[][] }
type 工作 = { id: string; needs: string; station: [number, number, number] }
type 类别 = "工具" | "材料" | "食物"

const 货物表 = world.vars.cargo as 货物[]
const 木桶 = world.vars.boxes as 木桶
const 工作台 = world.vars.jobs as 工作[]
const 货箱 = world.vars.cargoBox as [number, number, number]

// 穷举兜底：以后多出一种没登记的类别，这里当场报错，不会悄悄分错桶。
function 漏掉的类别(货的类别: never): never {
  throw new Error("账本里出现了没登记过的类别：" + String(货的类别))
}

// 用 switch 把货判成三类；food 是 supply 里的一个特例。
function 类别Of(货: 货物): 类别 {
  switch (货.kind) {
    case "tool":
      return "工具"
    case "supply":
      if (货.food === true) {
        return "食物"
      }
      return "材料"
    default:
      return 漏掉的类别(货.kind)
  }
}

// 记录（record）：一只桶的账 = 名字 + 格子 + 下一个空格子 + 已放件数。
type 桶账 = { 名字: string; 格子: number[][]; 下一个: number; 已放: number }
const 账本: Record<类别, 桶账> = {
  工具: { 名字: "工具桶", 格子: 木桶.tools, 下一个: 0, 已放: 0 },
  材料: { 名字: "材料桶", 格子: 木桶.materials, 下一个: 0, 已放: 0 },
  食物: { 名字: "食物桶", 格子: 木桶.food, 下一个: 0, 已放: 0 },
}

// 第一阶段：先按类别清点账本（对象记账，不用背数量）。
let 工具数 = 0
let 杂货数 = 0
for (const 货 of 货物表) {
  if (类别Of(货) === "工具") {
    工具数 = 工具数 + 1
  } else {
    杂货数 = 杂货数 + 1
  }
}
golem.say("账本：工具 " + 工具数 + " 件，杂货 " + 杂货数 + " 件。")

// 放货只做「记录层面的决定」：这件货该进哪一格，返回 [货物编号, x, y, z]。
// （移动与摆放留在顶层循环里：自动 await 只会改写顶层的 SDK 调用。）
function 放货(货: 货物): [string, number, number, number] {
  const 桶 = 账本[类别Of(货)]
  if (桶.下一个 >= 桶.格子.length) {
    throw new Error(桶.名字 + "放不下了")
  }
  const 格 = 桶.格子[桶.下一个]
  桶.下一个 = 桶.下一个 + 1
  桶.已放 = 桶.已放 + 1
  return [货.id, 格[0], 格[1], 格[2]]
}

// 第二阶段：逐件认货、进对应的桶
for (const 货 of 货物表) {
  golem.moveTo(货箱[0] + 4, 货箱[2])
  const 格 = 放货(货)
  golem.moveTo(9, 3)
  golem.moveTo(格[1], 格[3] + 2)
  golem.place(格[0], 格[1], 格[2], 格[3])
}
golem.say("八件货都进桶了。")

// 第三阶段：给三个工作点配工具（记录数组顺序扫描）
let 序号 = 0
while (序号 < 工作台.length) {
  const 工 = 工作台[序号]
  golem.moveTo(18, 3)
  golem.moveTo(工.station[0] - 2, 工.station[2])
  golem.place(工.needs, 工.station[0], 工.station[1], 工.station[2])
  序号 = 序号 + 1
}

// 第四阶段：回塔卡身边对账
golem.moveTo(world.vars.trader[0], world.vars.trader[2] - 2)
golem.say("账清了，塔卡。")
`,
  },
  task: {
    mainTask: "把混装货箱的货分进工具、材料、食物三只桶，给每份工作配好工具，最后和塔卡对账。",
    makeTask: "换一批货物与木桶位置，程序不改行数也能分对；验收还会送来一种没见过的工具。",
    playerBeat: "对完账，你把织线插进护符盒（织者之印）。",
    playerBeatHint: "手持线团，对准护符盒按右键",
    successCriteria: [
      {
        id: "tools-box",
        text: "工具全部进工具桶，没有掉进别的桶",
        check: g => {
          const cargo = cargoList(g.var("cargo"));
          const boxes = boxesOf(g.var("boxes"));
          const expected = cargo.filter(item => boxKeyOf(item) === "tools").map(item => item.id);
          const got = boxes.tools.map(p => idOf(g, p)).filter(id => id !== "air");
          const strays = [...boxes.materials, ...boxes.food].map(p => idOf(g, p)).filter(id => id !== "air");
          return sameList(got, expected) && expected.every(id => !strays.includes(id));
        },
      },
      {
        id: "supply-boxes",
        text: "材料与食物各进各桶，食物的货没有混进材料桶",
        check: g => {
          const cargo = cargoList(g.var("cargo"));
          const boxes = boxesOf(g.var("boxes"));
          const expectedMaterials = cargo.filter(item => boxKeyOf(item) === "materials").map(item => item.id);
          const expectedFood = cargo.filter(item => boxKeyOf(item) === "food").map(item => item.id);
          const gotMaterials = boxes.materials.map(p => idOf(g, p)).filter(id => id !== "air");
          const gotFood = boxes.food.map(p => idOf(g, p)).filter(id => id !== "air");
          return sameList(gotMaterials, expectedMaterials) && sameList(gotFood, expectedFood);
        },
      },
      {
        id: "jobs-tooled",
        text: "每份工作都拿到了正确类别的工具",
        check: g => jobsOf(g.var("jobs")).every(job => blockId(g, pos(job.station)) === C + job.needs),
      },
      {
        id: "ledger-clean",
        text: "货物没有丢失、重复或放错地方",
        check: g => {
          const cargo = cargoList(g.var("cargo"));
          const boxes = boxesOf(g.var("boxes"));
          const placed = [...boxes.tools, ...boxes.materials, ...boxes.food].map(p => idOf(g, p)).filter(id => id !== "air");
          return sameList(placed, cargo.map(item => item.id));
        },
      },
    ],
    hiddenTests: [
      {
        id: "h-kind-rules",
        name: "换一批货物（含新工具种类），分拣规则仍然对",
        setup: { note: "验收会换货物数量、顺序，并送来一种没见过的工具；写死清单的程序必挂" },
        assertions: [
          {
            id: "h1a",
            text: "每件货都按自己的类别进了对应的桶",
            check: g => {
              const cargo = cargoList(g.var("cargo"));
              const boxes = boxesOf(g.var("boxes"));
              for (const item of cargo) {
                const key = boxKeyOf(item);
                if (!boxes[key].some(p => idOf(g, p) === item.id)) return false;
              }
              const total = [...boxes.tools, ...boxes.materials, ...boxes.food].filter(p => idOf(g, p) !== "air").length;
              return total === cargo.length;
            },
          },
          {
            id: "h1b",
            text: "三个工作点都配好了工具",
            check: g => jobsOf(g.var("jobs")).every(job => blockId(g, pos(job.station)) === C + job.needs),
          },
        ],
      },
      {
        id: "h-no-stray",
        name: "只往木桶格子和工作点上放东西",
        setup: { note: "把货物丢在路边的程序会被这里拦住" },
        assertions: [
          {
            id: "h2a",
            text: "所有摆放动作都发生在木桶格子或工作点上",
            check: g => {
              const boxes = boxesOf(g.var("boxes"));
              const allowed = new Set<string>(
                [...boxes.tools, ...boxes.materials, ...boxes.food, ...jobsOf(g.var("jobs")).map(job => pos(job.station))].map(p => p.join(",")),
              );
              return agentPlaces(g).every(e => !!e.pos && allowed.has(e.pos.join(",")));
            },
          },
        ],
      },
    ],
  },
  narrative: {
    worldState: "商队的羊驼在营地边打转，三只木桶还空着；塔卡说日中就走，账再对不上，这趟货就留在原地了。",
    opening: [
      "商队的羊驼在营地边打转，三只木桶还空着。",
      "把混装货箱的货一件件认清楚，分进工具、材料、食物三只桶，再给每份工作配好工具。",
      "账本上最后一笔要你和塔卡当面点清；织偶只认字，分不清斧和镐，得靠你写清楚。",
    ],
    whyYou: "账本上最后一笔要你和塔卡当面点清；织偶只认字，分不清斧和镐，得靠你写清楚。",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值（护符盒节拍不占目标）。
  progress: [
    {
      id: "l06-tools-box",
      text: "工具全进工具桶，一件没混",
      hint: "world.vars.cargo 里每件货是一条记录 { id, kind, food }，kind 为 \"tool\" 的是工具。工具桶是 world.vars.boxes.tools 里的格子（命名点 toolsBox 是入口）；把工具一件件 golem.place(item.id, 格子) 放进去，一格一件。",
      check: g => {
        const cargo = cargoList(g.var("cargo"));
        const boxes = boxesOf(g.var("boxes"));
        const expected = cargo.filter(item => boxKeyOf(item) === "tools").map(item => item.id);
        const got = boxes.tools.map(p => idOf(g, p)).filter(id => id !== "air");
        const strays = [...boxes.materials, ...boxes.food].map(p => idOf(g, p)).filter(id => id !== "air");
        return sameList(got, expected) && expected.every(id => !strays.includes(id));
      },
    },
    {
      id: "l06-supplies",
      text: "材料和食物各进各桶，一件不丢",
      hint: "kind 为 \"supply\" 的货再看 food：food 为 true 进 boxes.food（食物桶），否则进 boxes.materials（材料桶）。用 switch 先按 kind 分路、再在 supply 分支里看 food，默认分支用 assertNever 兜底，漏一种类别会当场报错而不是悄悄放错。",
      check: g => {
        const cargo = cargoList(g.var("cargo"));
        const boxes = boxesOf(g.var("boxes"));
        const expectedMaterials = cargo.filter(item => boxKeyOf(item) === "materials").map(item => item.id);
        const expectedFood = cargo.filter(item => boxKeyOf(item) === "food").map(item => item.id);
        const gotMaterials = boxes.materials.map(p => idOf(g, p)).filter(id => id !== "air");
        const gotFood = boxes.food.map(p => idOf(g, p)).filter(id => id !== "air");
        const placed = [...boxes.tools, ...boxes.materials, ...boxes.food].map(p => idOf(g, p)).filter(id => id !== "air");
        return (
          sameList(gotMaterials, expectedMaterials) &&
          sameList(gotFood, expectedFood) &&
          sameList(placed, cargo.map(item => item.id))
        );
      },
    },
    {
      id: "l06-jobs-tooled",
      text: "每个工作点都配到对的工具",
      hint: "三个工作点都在 world.vars.jobs 里：job.needs 是要放的工具，job.station 是工作点坐标（命名点 chopStation / mineStation / fightStation）。放完货后走到每个 job.station 旁边，golem.place(job.needs, job.station) 把工具放上去，最后 golem.moveTo(trader) 找塔卡对账。",
      check: g => jobsOf(g.var("jobs")).every(job => blockId(g, pos(job.station)) === C + job.needs),
    },
  ],
  // 名副其实（docs/48 §1.9）：本关必须真的用记录（对象）与可辨识联合的分支，不能靠字符串硬记。
  codeRequirements: [
    { id: "l06-record", text: "用记录（对象字面量）把货/桶的字段绑在一起，而不是散装字符串", kind: "object", min: 2 },
    { id: "l06-branch", text: "用 switch/if 按 kind 分路（分支至少 2 处），漏一类要能看出来", kind: "branch", min: 2 },
    { id: "l06-function", text: "把「这件货该进哪个桶」写成可复用的 function", kind: "function", min: 2 },
  ],
  phases: ["记录与清点", "三桶分拣与配工具", "新工具与对账"],
});

/**
 * 挑战层（可跳过、不计星）：新增工具种类。
 * 商队又带来锄头和剪刀：主线那套分拣要把它们也认成工具放进工具桶，
 * 还要把这两件新工具挂到工具架的两个钩子上。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L06_CHALLENGE: LevelChallenge = {
  id: "L06-new-tool-kinds",
  title: "挑战：新增工具种类",
  goal: "锄头和剪刀也要被认成工具：进工具桶、挂上工具架的钩子",
  reference: `const cargo = world.vars.challengeCargo
const boxes = world.vars.challengeBoxes
const hooks = world.vars.challengeHooks
const newTools = world.vars.challengeNewTools

function kindOf(item) {
  if (item.kind === "tool") { return "tool" }
  if (item.food) { return "food" }
  return "material"
}

let toolSlot = 0
let materialSlot = 0
let foodSlot = 0
let i = 0
while (i < cargo.length) {
  const item = cargo[i]
  const kind = kindOf(item)
  if (kind === "tool") {
    const slot = boxes.tools[toolSlot]
    golem.moveTo(9, 3)
    golem.moveTo(slot[0], slot[2] + 2)
    golem.place(item.id, slot[0], slot[1], slot[2])
    toolSlot = toolSlot + 1
  } else if (kind === "food") {
    const slot = boxes.food[foodSlot]
    golem.moveTo(9, 3)
    golem.moveTo(slot[0], slot[2] + 2)
    golem.place(item.id, slot[0], slot[1], slot[2])
    foodSlot = foodSlot + 1
  } else {
    const slot = boxes.materials[materialSlot]
    golem.moveTo(9, 3)
    golem.moveTo(slot[0], slot[2] + 2)
    golem.place(item.id, slot[0], slot[1], slot[2])
    materialSlot = materialSlot + 1
  }
  i = i + 1
}

let h = 0
while (h < newTools.length) {
  const hook = hooks[h]
  golem.moveTo(hook[0], hook[2])
  golem.place(newTools[h], hook[0], hook[1], hook[2])
  h = h + 1
}
golem.say("挑战：新工具也挂上钩子了。")
`,
  check: g => {
    const cargo = cargoList(g.var("challengeCargo"));
    const boxes = boxesOf(g.var("challengeBoxes"));
    const hooks = posList(g.var("challengeHooks"));
    const newTools = (g.var("challengeNewTools") as string[]) ?? [];
    const placed = [...boxes.tools, ...boxes.materials, ...boxes.food].map(p => idOf(g, p)).filter(id => id !== "air");
    const hooksOk = newTools.every((id, index) => hooks[index] !== undefined && blockId(g, hooks[index]) === C + id);
    return sameList(placed, cargo.map(item => item.id)) && hooksOk;
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L06: LevelDef & { challenge: LevelChallenge } = Object.assign(L06_BASE, {
  challenge: L06_CHALLENGE,
});

/** MockWorld 场景：三排木桶格、货箱、工作点、护符盒与装饰（数值见 spec §3）。 */
export const L06Content: LevelContent & { challenge: LevelChallenge } = {
  def: L06,
  challenge: L06_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const boxes = boxesOf(vars.boxes);
    const jobs = jobsOf(vars.jobs);
    const floorY = L06_SCENE.floorY;
    const art: Array<{ pos: Pos; block: string }> = [];
    const functional: Array<{ pos: Pos; block: string }> = [];

    // 净空保护：三排木桶的放货格（y65）、工作点（y65）、货箱/旅商/护符盒、主路走廊（y64–68）
    const slotCells = new Set<string>();
    const slotXZ = new Set<string>();
    for (const row of [boxes.tools, boxes.materials, boxes.food]) {
      for (const slot of row) {
        slotCells.add(`${slot[0]},${slot[1]},${slot[2]}`);
        slotXZ.add(`${slot[0]},${slot[2]}`);
      }
    }
    const stationCells = new Set(jobs.map(job => `${job.station[0]},${job.station[1]},${job.station[2]}`));
    const stationXZ = new Set(jobs.map(job => `${job.station[0]},${job.station[2]}`));
    const furniture = [pos(vars.cargoBox), pos(vars.trader), pos(vars.shrine)];
    const furnitureCells = new Set(furniture.map(p => p.join(",")));
    const furnitureXZ = new Set(furniture.map(p => `${p[0]},${p[2]}`));
    const challengeBoxes = boxesOf(vars.challengeBoxes);
    const challengeCells = new Set<string>();
    for (const row of [challengeBoxes.tools, challengeBoxes.materials, challengeBoxes.food]) {
      for (const slot of row) challengeCells.add(`${slot[0]},${slot[1]},${slot[2]}`);
    }
    for (const hook of posList(vars.challengeHooks)) challengeCells.add(hook.join(","));
    const protectedXZ = new Set([...slotXZ, ...stationXZ, ...furnitureXZ]);
    const road = corridorCells();
    const blocked = (x: number, y: number, z: number): boolean => {
      const key = `${x},${y},${z}`;
      return slotCells.has(key) || stationCells.has(key) || furnitureCells.has(key) || challengeCells.has(key) || road.has(key);
    };
    const putArt = (x: number, y: number, z: number, block: string): void => {
      if (!blocked(x, y, z)) art.push({ pos: [x, y, z], block });
    };
    const putMany = (cells: Array<{ pos: Pos; block: string }>): void => {
      for (const cell of cells) putArt(cell.pos[0], cell.pos[1], cell.pos[2], cell.block);
    };
    const putFloor = (x: number, z: number, block: string): void => {
      if (protectedXZ.has(`${x},${z}`)) return;
      art.push({ pos: [x, floorY, z], block });
    };
    const patch = (x0: number, x1: number, z0: number, z1: number, block: string): void => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) putFloor(x, z, block);
    };
    const path = (x0: number, z0: number, x1: number, z1: number): void => {
      for (const b of pathLine(x0, z0, x1, z1, floorY)) putFloor(b.pos[0], b.pos[2], b.block);
    };

    // 1) 地面：苔藓底 + 土褐营地空场 + 砂砾/圆石路（傍晚色温偏暖）
    patch(-15, 31, -3, 27, SCENE_PALETTE.ground);
    patch(-12, -2, 4, 16, "minecraft:coarse_dirt");
    patch(16, 30, 4, 16, "minecraft:coarse_dirt");
    patch(0, 16, -3, 10, "minecraft:coarse_dirt");
    patch(-8, 20, 16, 24, "minecraft:coarse_dirt");
    for (const seg of L06_CORRIDOR) path(seg.x0, seg.z0, seg.x1, seg.z1);

    // 2) 三排「贴标签的木桶」：每个放货格下面是一只木桶（y64 地板层），桶前一排木牌
    for (const row of [boxes.tools, boxes.materials, boxes.food]) {
      for (const slot of row) art.push({ pos: [slot[0], floorY, slot[2]], block: "barrel" });
    }
    for (const [x, z] of [[-8, 0], [-8, 6], [-3, 12]] as const) {
      putArt(x, floorY + 1, z, "minecraft:oak_fence");
      putArt(x, floorY + 2, z, "minecraft:oak_sign");
    }

    // 3) 两顶自然白/棕帆布帐篷（阶梯式实心，避免悬空/插件补柱）：左侧帐篷、右侧帐篷
    // 帆布脊式帐篷：白帆布墙基（7×5）→ 收进的白色坡面（5×3）→ 棕色帆布屋脊（3×1），层层落地
    const tent = (minX: number, minZ: number): void => {
      const w = 7;
      const d = 5;
      for (let x = minX; x <= minX + w - 1; x++) {
        for (let z = minZ; z <= minZ + d - 1; z++) putArt(x, floorY + 1, z, "minecraft:white_wool");
      }
      for (let x = minX + 1; x <= minX + w - 2; x++) {
        for (let z = minZ + 1; z <= minZ + d - 2; z++) putArt(x, floorY + 2, z, "minecraft:white_wool");
      }
      const midZ = minZ + Math.floor(d / 2);
      for (let x = minX + 1; x <= minX + w - 2; x++) {
        putArt(x, floorY + 3, midZ, "minecraft:brown_wool");
      }
      // 帐篷两端落地木柱（撑起屋脊的立柱，不做悬空）
      for (const x of [minX + 1, minX + w - 2] as const) {
        for (let y = floorY + 1; y <= floorY + 3; y++) putArt(x, y, midZ, "minecraft:spruce_log");
      }
      // 四角落地木柱 + 门口帆布翻边
      for (const [cx, cz] of [[minX - 1, minZ - 1], [minX + w, minZ - 1], [minX - 1, minZ + d], [minX + w, minZ + d]] as const) {
        putArt(cx, floorY + 1, cz, "minecraft:spruce_log");
        putArt(cx, floorY + 2, cz, "minecraft:spruce_log");
      }
      for (let x = minX + 1; x <= minX + w - 2; x++) for (let z = minZ + 1; z <= minZ + d - 2; z++) putFloor(x, z, "minecraft:hay_block");
      putArt(minX + 3, floorY + 1, minZ + d - 1, "minecraft:brown_wool");
      putArt(minX + 3, floorY + 1, minZ + d - 2, "minecraft:brown_wool");
      // 脊顶灯笼（1 格暖光，压在屋脊上）
      art.push({ pos: [minX + 3, floorY + 4, midZ], block: "lantern" });
    };
    tent(-9, -1);
    tent(22, -1);
    // 帐篷拉绳与地钉（全部落地，读到的是营地绳索而不是悬空装饰）
    for (const [x, z] of [[-10, 5], [-8, 6], [-6, 6], [29, 5], [27, 6], [25, 6]] as const) {
      putArt(x, floorY + 1, z, "minecraft:oak_fence");
    }

    // 4) 货摊与木箱/木桶堆（全部落地成叠，不悬空）
    for (const crate of L06_SCENE.crates) {
      art.push({ pos: [crate[0], crate[1], crate[2]], block: "chest" });
      if (blocked(crate[0], crate[1] + 1, crate[2]) === false) art.push({ pos: [crate[0], crate[1] + 1, crate[2]], block: "barrel" });
    }
    for (const [x, z] of [[3, 19], [5, 19], [7, 19], [-8, 6], [18, 2]] as const) {
      putArt(x, floorY + 1, z, "minecraft:crafting_table");
    }
    for (const [x, z] of [[2, 21], [6, 21], [-7, 7], [19, 4]] as const) {
      putArt(x, floorY + 1, z, "minecraft:hay_block");
      putArt(x, floorY + 2, z, "minecraft:hay_block");
    }

    // 5) 账本桌（讲台）+ 旅商木桶 + 营火与两只原木坐凳
    art.push({ pos: [10, floorY + 1, 19], block: "lectern" });
    putArt(11, floorY + 1, 19, "minecraft:barrel");
    putArt(9, floorY + 1, 19, "minecraft:crafting_table");
    art.push({ pos: [11, floorY + 1, 21], block: "campfire" });
    putArt(10, floorY + 1, 21, "minecraft:spruce_log");
    putArt(12, floorY + 1, 21, "minecraft:spruce_log");
    for (let x = 9; x <= 13; x++) putFloor(x, 21, "minecraft:cobblestone");
    // 主路两侧的落地货堆（近景可辨认，全部成叠不悬空）
    for (const [x, z] of [[4, 18], [12, 18], [2, 17], [14, 17], [3, 23], [13, 23], [5, 15], [11, 15]] as const) {
      putArt(x, floorY + 1, z, "minecraft:barrel");
      putArt(x, floorY + 2, z, "minecraft:hay_block");
    }
    for (const [x, z] of [[4, 16], [12, 16], [5, 18], [11, 18], [2, 19], [14, 19]] as const) {
      putArt(x, floorY + 1, z, "minecraft:chest");
      if (Math.abs(x - 8) >= 8) putArt(x, floorY + 2, z, "minecraft:barrel");
    }
    for (const [x, z] of [[2, 15], [14, 15], [3, 21], [13, 21], [1, 19], [15, 19], [0, 21], [16, 21], [6, 22], [10, 22], [2, 23], [14, 23]] as const) {
      putArt(x, floorY + 1, z, "minecraft:barrel");
      if (Math.abs(x - 8) >= 6) putArt(x, floorY + 2, z, (x + z) % 2 === 0 ? "minecraft:hay_block" : "minecraft:oak_planks");
    }


    // 6) 篱笆、拴驼桩与营地外围木栅（全部地面层/落地）
    for (const [x, z] of [[-4, 17], [18, 17]] as const) {
      putArt(x, floorY + 1, z, "minecraft:oak_fence");
      putArt(x, floorY + 2, z, "minecraft:yellow_wool");
    }
    for (let x = -14; x <= 30; x += 4) putArt(x, floorY + 1, 27, "minecraft:oak_fence");
    for (let z = 0; z <= 26; z += 4) {
      putArt(-15, floorY + 1, z, "minecraft:oak_fence");
      putArt(31, floorY + 1, z, "minecraft:oak_fence");
    }
    // 营地北侧实心木栅/货栈背墙（两层，落地，不悬空）
    for (let x = -12; x <= 26; x++) {
      if (x % 6 < 2) continue;
      putArt(x, floorY + 1, -2, "minecraft:spruce_planks");
      putArt(x, floorY + 2, -2, "minecraft:spruce_planks");
    }

    // 7) 暖光：两座灯柱 + 帐篷顶灯笼 + 营火 + 账本桌旁灯笼
    putMany(lampPost(2, 18, floorY));
    putMany(lampPost(14, 18, floorY));


    // 8) 花与干草点缀（1 格/小丛；只用自然色）
    for (const [fx, fz] of [[-2, 4], [16, 4], [6, 17], [4, 24], [13, 24], [-12, 12], [30, 12]] as const) {
      putFloor(fx, fz, SCENE_PALETTE.flowers[(fx + fz + 100) % SCENE_PALETTE.flowers.length]);
    }
    for (const [x, z] of [[-2, 22], [16, 22], [-14, 4], [30, 4]] as const) {
      putArt(x, floorY + 1, z, "minecraft:hay_block");
    }
    putArt(-8, floorY + 1, 18, "minecraft:flower_pot");
    putArt(18, floorY + 1, 18, "minecraft:flower_pot");

    // 功能块（评分相关，最后写入）：三只标签桶之外的货箱、旅商、织线护符盒
    functional.push({ pos: pos(vars.cargoBox), block: "chest" });
    functional.push({ pos: pos(vars.trader), block: "barrel" });
    functional.push({ pos: pos(vars.shrine), block: "chiseled_stone_bricks" });

    await port.clearRegion(L06_SCENE.clear.from, L06_SCENE.clear.to);
    // 真实可走通道：只清“站位/过道”，不碰木桶格、工作点和货箱评分格。
    const laneAir: Array<{ pos: Pos; block: string }> = [];
    const occupied = new Set([...art, ...functional].map((b) => b.pos.join(",")));
    const protectedCells = new Set<string>();
    for (const row of [boxes.tools, boxes.materials, boxes.food]) for (const slot of row) protectedCells.add(slot.join(","));
    for (const job of jobsOf(vars.jobs)) protectedCells.add(job.station.join(","));
    for (const key of [vars.cargoBox, vars.trader, vars.shrine]) protectedCells.add(pos(key as Pos).join(","));
    const clearLine = (x0: number, z0: number, x1: number, z1: number) => {
      const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
      const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      for (let i = 0; i <= n; i++) for (const y of [65, 66]) {
        const x = x0 + dx * i, z = z0 + dz * i, key = `${x},${y},${z}`;
        if (!occupied.has(key) || protectedCells.has(key)) continue;
        laneAir.push({ pos: [x, y, z], block: "minecraft:air" });
      }
    };
    clearLine(9, 26, 9, 3);
    clearLine(-2, 3, 16, 3);
    clearLine(0, 2, 14, 2);
    clearLine(0, 8, 14, 8);
    clearLine(0, 14, 14, 14);
    clearLine(18, 0, 18, 12);
    clearLine(10, 18, 10, 22);
    // 真实服务端会给高处暖灯补一根石砖支撑；Mock 侧也把它算进场景，digest 才一致。
    await port.setBlocks([...art, ...functional, ...laneAir]);
    await port.setBlocks([{ pos: [18, 65, 2], block: "minecraft:stone_bricks" }]);
    await port.setTime(L06_SCENE.time);
    await port.setWeather("clear"); // 商队黄昏：薄云 + 暖光
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [9, 65, 26], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "trader", id: "taka", name: "旅商塔卡", pos: pos(vars.trader), role: "npc" });
    for (let i = 0; i < L06_SCENE.llamas.length; i++) {
      const llama = L06_SCENE.llamas[i];
      await port.spawnEntity({ type: "llama", id: i === 0 ? "llama-a" : "llama-b", name: i === 0 ? "驮货的羊驼" : "小羊驼", pos: llama, role: "mount" });
    }
    await port.spawnEntity({ type: "donkey", id: "donkey", name: "驴", pos: [15, 65, 22], role: "prop" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:string", 8);
  },
  async playerBeat(port) {
    // 织者之印：对完账，你把换来的织线插进护符盒。
    await port.playerPlace("loom_thread", pos(port.world.vars.shrine));
  },
};
