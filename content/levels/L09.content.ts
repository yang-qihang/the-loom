/**
 * L09 — 入夜之前（MockWorld 版 · 显式 await 草稿；原设计名「破晓之前」，Lead 决策改黄昏 12500，文案同步）
 *
 * 设计意图与数值以 content/levels/L09-before-dawn.md 为准（A12 异步 / 并发 / 错误处理）。
 * 本文件是「显式 await 版」草稿：依赖 task-51（显式 await 运行时）完成后接上跑通；
 * 运行层面用 `runStudentProgram(..., "explicit")` 验证，Engine/Session 的 runMode 接线
 * 等 task-51 交付后由 Lead 集成（本文件不改 engine catalog）。
 *
 * T1 MockWorld 学生面仍只有 `golem.moveTo/place/say/pos` 与只读 `world.vars`
 * （docs/21 §2；docs/12 的 world.startBrewing / golem.treatZombieVillager 等尚未接线），
 * 因此本文件用「等价动作」实现：
 *   世界时钟 = world.vars.dawn（秒数文案，仅用于台词；MockWorld 没有真实计时）
 *   等待     = 事件交错：两坛「开酿」都发生之后，才允许出现第一坛「出坛」（顺序版必失败）
 *   缺材料   = world.vars.materials[台号] 为「缺」；学生用 try/catch 改投备方原料
 *   开酿     = 走到酿造台，place("water_bottle", 台位)
 *   投料     = 走到材料架，place(原料, 架位)（备方就是另一种原料）
 *   出坛     = 走回酿造台，place("potion", 台位)
 *   取金苹果 = 走到木桶，place("air", 桶位)
 *   交付     = 走到炼药锅，place("potion", 锅位) 三次
 *   治愈准备 = 走到牢笼，place("golden_apple", 笼位)
 *   玩家节拍 = playerPlace("potion", 笼位) + playerPlace("bell", 钟位)
 * 真实 Paper 版接线后：学生代码换成 world.startBrewing / golem.treatZombieVillager /
 * golem.ringDawnBell，时间与并发由真实计时驱动；关卡数据、阶段与判定口径不变。
 */
import { defineLevel, type ChallengeDef, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { fenceLine, groundPatch, lampPost, pathLine, SCENE_PALETTE } from "../scenes/scene-kit";

type Pos = [number, number, number];
const C = "minecraft:";

const pos = (p: unknown): Pos => p as Pos;
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const blockOf = (e: { data?: Record<string, unknown> }): string => String(e.data?.block ?? "");
const agentPlaces = (g: GraderApi, block: string) =>
  g.events("block.place").filter(e => e.actorType === "agent" && blockOf(e) === C + block);
const seqOf = (e: { seq?: number }): number => e.seq ?? 0;

export type StandSpec = {
  id: string;
  name: string;
  stand: Pos;
  shelf: Pos;
  ingredient: string;
  backup: string;
};

/** 两座酿造台（左虚弱、右治疗）：台位与材料架分开，学生要跑两处。 */
export const BASE_STANDS: StandSpec[] = [
  {
    id: "weakness",
    name: "左酿造台",
    stand: [-2, 65, -5],
    shelf: [-2, 65, -3],
    ingredient: "fermented_spider_eye",
    backup: "spider_eye",
  },
  {
    id: "healing",
    name: "右酿造台",
    stand: [2, 65, -5],
    shelf: [2, 65, -3],
    ingredient: "glistering_melon",
    backup: "melon_slice",
  },
];

const BASE = {
  brewStands: BASE_STANDS,
  materials: { weakness: "够", healing: "够" } as Record<string, string>,
  cage: [10, 65, 7] as Pos,
  chest: [0, 65, -6] as Pos,
  cauldron: [-10, 65, -8] as Pos,
  bell: [0, 65, 14] as Pos,
  eira: [0, 65, 6] as Pos,
  dawn: 70,
};

/**
 * L09 场景美术（Lead 决策：时间改「入夜前」黄昏 12500，画面是黄昏；文案不得再写午夜/破晓）。
 *
 * 真实客户端坐标约定（同 L04/L05）：paper-port deriveGroundY(L09)=65 → 插件 finalizeScene
 * 取 floorY=64（moss 地板层）、groundY=65（站立层）。看得见的平地是 y=64；
 * 立体道具从 y=65 起摆，评分点（酿造台/材料架/木桶/炼药锅/牢笼/钟）一格不盖。
 *
 * playerSpawn = 区域中心 (0, 65, 0)；默认 scene-shot 机位在 spawn+14=(0,69,14)，
 * 但钟正好在 (0,65,14)——所以主视角建议 spawn + (0, 5, 28) = (0,70,28) 朝北：
 * `node scripts/scene-shot.mjs --level L09 --y 5 --z 28 --time 12500`
 */
export const L09_SCENE = {
  time: 12500, // 入夜前的黄昏（Lead 实拍矩阵：12500 mean .280/std .142 过门；夜/午夜过暗）
  weather: "clear" as const,
  floorY: 64,
  groundY: 65,
  /**
   * 用户红线（2026-10-31）：不许阴间搭配/荧光色/彩色塑料。
   * 主色 60% 泥土（coarse_dirt/moss/gravel）+ 次色 30% 石灰与木（stone_bricks/wood/canvas）
   * + 点缀 ≤10%（火光/灯/花/玻璃瓶），每种颜色都有材质或功能理由。
   */
  palette: {
    main: ["coarse_dirt", "moss_block", "gravel"],
    secondary: ["stone_bricks", "mossy_stone_bricks", "cobblestone", "spruce_log", "spruce_planks", "dark_oak_planks", "white_wool", "brown_wool"],
    accent: ["lantern", "torch", "campfire", "shroomlight", "glass_pane", "poppy", "dandelion"],
    accentBudget: 0.1,
    forbidden: ["lime_", "magenta_", "purple_", "pink_", "blue_wool", "light_blue_", "red_wool", "grass_block", "oak_leaves"],
  },
  materials: ["coarse_dirt", "stone_bricks", "gravel", "spruce_planks", "dark_oak_planks", "moss_block", "iron_bars"],
  lights: { warm: ["torch", "lantern", "campfire", "shroomlight"], natural: ["moonlight"] },
  landmarks: ["营地", "三座酿造台", "材料架", "牢笼", "帐篷", "钟架", "炼药锅"],
  /** 主视角：playerSpawn(0,65,0) + (0,5,28)，朝北看营地；钟架在正前方。 */
  mainCamera: { pos: [0, 70, 28], lookAt: [0, 65, 8], time: 12500, fov: 75 },
  cameraHint: { base: "playerSpawn", baseAt: [0, 65, 0], offset: [0, 5, 28], yaw: 180, pitch: 10 },
  expectedVisible: [
    "钟架：正中偏前的石砖门架 + 横梁下吊钟（铁链落地结构成立），柱顶挂暖灯",
    "中央营火：偏右的营火堆 + 石砖火圈 + 长凳，火光照亮营地",
    "三座酿造台：正前方一排（两座功能台 + 一座备料台），台后是材料架",
    "材料架：木柱落地 + 横梁 + 上层木架，摆木桶、玻璃药瓶与草药",
    "帐篷：两侧的帆布帐篷（白/棕布、云杉杆落地、坡顶），门口摆木桶与灯",
    "牢笼：右前方铁栏杆围栏（正面留门），里面是生病的村民",
    "炼药锅：左前方石砖台上的铁锅，旁边有营火与草药架",
  ],
  screenshotSpots: [
    { name: "主视角：营地 + 钟架 + 三座酿造台", pos: [0, 70, 28], lookAt: [0, 65, 8], time: 12500 },
    { name: "酿造台与材料架近景", pos: [0, 68, 4], lookAt: [0, 65, -6], time: 12500 },
    { name: "牢笼与帐篷", pos: [-4, 68, 10], lookAt: [10, 65, 7], time: 12500 },
    { name: "钟架与营火", pos: [4, 68, 18], lookAt: [0, 65, 9], time: 12500 },
  ],
  /** 主路走廊（真实地面以上 y65–67 净空）：出生点→酿造区、西去炼药锅、东去牢笼、南去钟架。 */
  corridor: [
    { x0: -1, z0: -8, x1: 1, z1: 0 },
    { x0: -10, z0: -9, x1: 0, z1: -7 },
    { x0: 3, z0: 6, x1: 8, z1: 8 },
    { x0: -1, z0: 8, x1: 1, z1: 13 },
  ],
} as const;

const standsOf = (g: GraderApi): StandSpec[] => g.var("brewStands") as StandSpec[];
const materialsOf = (g: GraderApi): Record<string, string> => (g.var("materials") as Record<string, string>) ?? {};
const waterAt = (g: GraderApi, 台: StandSpec) => agentPlaces(g, "water_bottle").filter(e => samePos(e.pos, 台.stand));
const potionAt = (g: GraderApi, 台: StandSpec) => agentPlaces(g, "potion").filter(e => samePos(e.pos, 台.stand));
const ingredientEventsAt = (g: GraderApi, 台: StandSpec) =>
  g.events("block.place").filter(e => e.actorType === "agent" && samePos(e.pos, 台.shelf));
const ingredientAt = (g: GraderApi, 台: StandSpec) =>
  ingredientEventsAt(g, 台).map(e => blockOf(e).replace(C, ""));
const potionsAtCauldron = (g: GraderApi) => agentPlaces(g, "potion").filter(e => samePos(e.pos, pos(g.var("cauldron"))));
const appleTaken = (g: GraderApi) => agentPlaces(g, "air").filter(e => samePos(e.pos, pos(g.var("chest"))));

/** 每座酿造台都按「开酿 → 投料 → 出坛」的顺序完成（原料可以是主料或备方）。 */
function brewedOk(g: GraderApi): boolean {
  return standsOf(g).every(台 => {
    const water = waterAt(g, 台);
    const potion = potionAt(g, 台);
    const ingredientEvents = ingredientEventsAt(g, 台).filter(e => {
      const name = blockOf(e).replace(C, "");
      return name === 台.ingredient || name === 台.backup;
    });
    if (water.length === 0 || potion.length === 0 || ingredientEvents.length === 0) return false;
    const firstWater = Math.min(...water.map(seqOf));
    const firstIngredient = Math.min(...ingredientEvents.map(seqOf));
    const firstPotion = Math.min(...potion.map(seqOf));
    return firstWater < firstIngredient && firstIngredient < firstPotion;
  });
}

/** 并发判定：所有台都开酿之后，才出现第一坛出坛（顺序版会在第一次出坛上失败）。 */
function brewedConcurrently(g: GraderApi): boolean {
  const stands = standsOf(g);
  const starts = stands.map(台 => {
    const water = waterAt(g, 台);
    return water.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...water.map(seqOf));
  });
  const finishes = stands.map(台 => {
    const potion = potionAt(g, 台);
    return potion.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...potion.map(seqOf));
  });
  return Math.max(...starts) < Math.min(...finishes);
}

const L09_BASE: LevelDef = defineLevel({
  id: "L09",
  meta: {
    id: "L09",
    title: { zh: "入夜之前", en: "Before Nightfall" },
    act: 3,
    order: 9,
    priority: "P1",
    prerequisites: ["L08"],
    estimatedMinutes: 22,
    difficulty: 5,
    abstractions: ["A12"],
    objectives: [
      { id: "o-await", learnerView: "等待不再堵住程序：await 只让这一条线在这里等", evidence: { kind: "machine", ref: "brews-overlap" } },
      { id: "o-promise-value", learnerView: "「还没做好的事」可以先拿在手里，最后再一起等它好", evidence: { kind: "machine", ref: "apple-in-wait" } },
      { id: "o-error", learnerView: "缺材料不是崩溃，是走另一条路", evidence: { kind: "machine", ref: "h-shortage-backup" } },
    ],
    misconceptions: ["async-is-faster", "await-blocks-world", "promise-all-is-sequential", "forget-await", "catch-swallows-bug"],
    apiIntroduced: [],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.vars"],
    syntaxIntroduced: ["async 函数", "await", "Promise.all", "try/catch"],
    reward: { rune: "A12", advancement: "loomcraft/act3/before_dawn", codexPage: "A12" },
    languageLevel: "act3",
  },
  world: {
    vars: {
      brewStands: BASE_STANDS,
      materials: BASE.materials,
      cage: BASE.cage,
      chest: BASE.chest,
      cauldron: BASE.cauldron,
      bell: BASE.bell,
      eira: BASE.eira,
      dawn: BASE.dawn,
      requiredPotions: 3,
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "witch", role: "npc", id: "granny", name: "苔婆" },
      { type: "zombie_villager", role: "target", id: "sick", name: "生病的村民" },
    ],
    // 命名坐标点（docs/48 §1.1）：沙箱里可直接当全局变量用，如 golem.moveTo(eira)。
    points: {
      eira: { pos: [0, 65, 6], name: "艾拉" },
      cage: { pos: [10, 65, 7], name: "牢笼（放金苹果）" },
      chest: { pos: [0, 65, -6], name: "取金苹果的木桶" },
      cauldron: { pos: [-10, 65, -8], name: "苔婆的炼药锅" },
      bell: { pos: [0, 65, 14], name: "暮钟" },
      weakStand: { pos: [-2, 65, -5], name: "左酿造台（虚弱药水）" },
      healStand: { pos: [2, 65, -5], name: "右酿造台（治疗药水）" },
      weakShelf: { pos: [-2, 65, -3], name: "左材料架" },
      healShelf: { pos: [2, 65, -3], name: "右材料架" },
    },
    // 玩家出生点：营地南侧主路，朝北正对两座酿造台；离灰崽 (0,65,0) 有 10 格，不会怼脸。
    playerSpawn: [0, 65, 10],
  },
  code: {
    expectedLoc: 82,
    starterCode: `/**
 * L09 · 入夜之前
 *
 * 目标：
 *   1. 把「顺序版」改成 async 并发版：两坛药同时开酿，用 Promise.all 一起等
 *   2. 把取金苹果藏进酿造的等待里（两坛开火之后、出坛之前）
 *   3. 交付三瓶药水、把金苹果放到牢笼上，最后回艾拉身边报时
 *
 * 位置有两种写法（二选一，不要混用）：
 *   1. 用名字：golem.moveTo(weakStand) / golem.place("potion", weakStand)
 *      → 名字是关卡给好的，推荐；完整名单见「指令手册」
 *   2. 用坐标：golem.moveTo(-2, -5) / golem.place("potion", -2, 65, -5)
 *      → 分别是 x、z 和 x、y、z
 *
 * 数据：world.vars.brewStands 是两座酿造台（stand 台位 / shelf 材料架 / backup 备方）。
 *   world.vars.materials 是 { 台id: "够" | "缺" }，缺料时走备方。
 *
 * 步骤：
 *   [1] 类型、数据和两个 async 小函数已经给好（下面这些代码）
 *   [2] 补 安全酿(台)：缺材料时 throw，catch 里改用台.backup
 *   [3] 补 取苹果() / 交付() / 布置治愈()
 *   [4] 把最下面的顺序版改成并发版，用 Promise.all 一起等两坛
 *
 * 卡住时：打开「指令手册」查本关 API 与命名点；运行失败时看教练卡提示。
 */
type Pos = [number, number, number]
type Stand = {
  id: string
  name: string
  stand: Pos
  shelf: Pos
  ingredient: string
  backup: string
}
const vars = world.vars
const stands = vars.brewStands as Stand[]
const materials = vars.materials as Record<string, string>
const cage = vars.cage as Pos
const chest = vars.chest as Pos
const cauldron = vars.cauldron as Pos
const bell = vars.bell as Pos

async function 走到(点: Pos): Promise<void> {
  await golem.moveTo(点[0], 点[2])
}

async function 酿一坛(台: Stand, 用备方: boolean): Promise<void> {
  await 走到(台.stand)
  await golem.place("water_bottle", 台.stand[0], 台.stand[1], 台.stand[2])
  const 材料 = 用备方 ? 台.backup : 台.ingredient
  await 走到(台.shelf)
  await golem.place(材料, 台.shelf[0], 台.shelf[1], 台.shelf[2])
  await 走到(台.stand)
  await golem.place("potion", 台.stand[0], 台.stand[1], 台.stand[2])
}

async function 安全酿(台: Stand): Promise<void> {
  // [2] 缺材料时 throw，catch 里用台.backup 重酿
}

async function 取苹果(): Promise<void> {
  // [3] 走到 chest，用 place("air", chest) 把金苹果拿出来
}

async function 交付(): Promise<void> {
  // [3] 走到 cauldron 放三次 "potion"
}

async function 布置治愈(): Promise<void> {
  // [3] 在 cage 放 golden_apple，等织者泼药水
}

await 酿一坛(stands[0], false)
await 酿一坛(stands[1], false)
await 取苹果()
await 交付()
await 布置治愈()
await golem.say("天快亮了，钟留给织者敲")
`,
    referenceSolution: `/**
 * L09 · 入夜之前（参考解）
 *
 * 步骤：
 *   [1] 把动作拆成 async 小函数
 *   [2] 两坛同时开酿，用 Promise.all 一起等
 *   [3] 取苹果藏在等待里
 *   [4] 交付、治愈、报时
 *
 * 注意：缺材料走备方；最后一道钟留给玩家。
 */
type Pos = [number, number, number]
type Stand = {
  id: string
  name: string
  stand: Pos
  shelf: Pos
  ingredient: string
  backup: string
}
const vars = world.vars
const stands = vars.brewStands as Stand[]
const materials = vars.materials as Record<string, string>
const cage = vars.cage as Pos
const chest = vars.chest as Pos
const cauldron = vars.cauldron as Pos
const bell = vars.bell as Pos

async function 走到(点: Pos): Promise<void> {
  await golem.moveTo(点[0], 点[2])
}

async function 开酿(台: Stand): Promise<void> {
  await golem.place("water_bottle", 台.stand[0], 台.stand[1], 台.stand[2])
}

async function 投料(台: Stand, 材料: string): Promise<void> {
  await golem.place(材料, 台.shelf[0], 台.shelf[1], 台.shelf[2])
}

async function 出坛(台: Stand): Promise<void> {
  await golem.place("potion", 台.stand[0], 台.stand[1], 台.stand[2])
}

async function 酿一坛(台: Stand, 用备方: boolean): Promise<void> {
  await 开酿(台)
  const 材料 = 用备方 ? 台.backup : 台.ingredient
  await 投料(台, 材料)
  await 出坛(台)
}

async function 安全酿(台: Stand): Promise<void> {
  try {
    if (materials[台.id] === "缺") {
      throw new Error("材料不够")
    }
    await 酿一坛(台, false)
  } catch (错误) {
    await 酿一坛(台, true)
  }
}

async function 取苹果(): Promise<void> {
  await golem.place("air", chest[0], chest[1], chest[2])
  await golem.say("金苹果拿到手了")
}

async function 交付(): Promise<void> {
  await golem.moveTo(cauldron[0] + 8, cauldron[2])
  await golem.moveTo(cauldron[0] + 4, cauldron[2])
  for (let i = 0; i < 3; i++) {
    await golem.place("potion", cauldron[0], cauldron[1], cauldron[2])
  }
  await golem.say("三瓶节日药水交给苔婆")
}

async function 布置治愈(): Promise<void> {
  await golem.moveTo(cauldron[0] + 8, cauldron[2])
  await golem.moveTo(cauldron[0] + 10, cauldron[2])
  await golem.moveTo((stands[0].stand[0] + stands[1].stand[0]) / 2, stands[0].stand[2] + 3)
  await golem.moveTo(cage[0] - 6, cage[2] - 5)
  await golem.moveTo(cage[0] - 6, cage[2] - 1)
  await golem.moveTo(cage[0] - 2, cage[2] - 1)
  await golem.moveTo(cage[0] - 2, cage[2])
  await golem.place("golden_apple", cage[0], cage[1], cage[2])
  await golem.say("药水备好了，等织者泼下去")
}

async function 报时(): Promise<void> {
  const 剩余 = vars.dawn as number
  await golem.say("离入夜还有 " + 剩余 + " 秒")
}

async function 收尾(): Promise<void> {
    await golem.say("天快亮了，钟留给织者敲")
}

await golem.moveTo((stands[0].stand[0] + stands[1].stand[0]) / 2, stands[0].stand[2] + 1)
// 把每座台 map 成一个 Promise（还没做好的事情可以先拿在手里），再一起等
const 两坛 = stands.map(台 => 安全酿(台))
await 取苹果()
await Promise.all(两坛)
await 交付()
await 布置治愈()
await 报时()
await 收尾()
`,
  },
  task: {
    mainTask: "把顺序版改成能重叠的写法：两坛一起开酿、取苹果藏进酿造等待、治愈与交付并行；缺材料时换备方。",
    makeTask: "换一座更远的材料架，或换一个更短的入夜准备时间，仍然按同一套并发写法完成。",
    playerBeat: "你先把药水泼向笼中的村民，再亲手敲响暮钟。",
    playerBeatHint: "手持药水泼笼子，再持钟右键",
    successCriteria: [
      {
        id: "two-brews",
        text: "两座酿造台都按开酿、投料、出坛的顺序完成",
        check: g => brewedOk(g),
      },
      {
        id: "brews-overlap",
        text: "两坛真的同时开酿：都开火之后才出现第一坛出坛",
        check: g => brewedConcurrently(g),
      },
      {
        id: "apple-in-wait",
        text: "取金苹果藏在酿造的等待里（两坛开火之后、出坛之前）",
        check: g => {
          const apples = appleTaken(g);
          if (apples.length === 0) return false;
          const appleSeq = Math.min(...apples.map(seqOf));
          const stands = standsOf(g);
          const firstStart = Math.min(...stands.map(台 => Math.min(...waterAt(g, 台).map(seqOf))));
          const firstFinish = Math.min(...stands.map(台 => Math.min(...potionAt(g, 台).map(seqOf))));
          return appleSeq > firstStart && appleSeq < firstFinish;
        },
      },
      {
        id: "delivered",
        text: "三瓶节日药水交到苔婆的炼药锅里",
        check: g => potionsAtCauldron(g).length >= 3,
      },
      {
        id: "cure-ready",
        text: "金苹果放上牢笼，治愈仪式准备好",
        check: g => agentPlaces(g, "golden_apple").some(e => samePos(e.pos, pos(g.var("cage")))),
      },
      {
        id: "player-actions",
        text: "你亲手泼了药水，也亲手敲了暮钟",
        check: g =>
          g.events("block.place").some(e => e.actorType === "player" && blockOf(e) === C + "potion" && samePos(e.pos, pos(g.var("cage")))) &&
          g.events("block.place").some(e => e.actorType === "player" && blockOf(e) === C + "bell" && samePos(e.pos, pos(g.var("bell")))),
      },
    ],
    hiddenTests: [
      {
        id: "h-shortage-backup",
        name: "缺材料时换备方",
        setup: { note: "只会在缺料变体里显形：正常夜里材料够，用不到备方" },
        assertions: [
          {
            id: "backup-ingredient-used",
            text: "缺料的那座台改用备方原料，仍然出坛",
            check: g => {
              const materials = materialsOf(g);
              const 缺料台 = standsOf(g).filter(台 => materials[台.id] === "缺");
              if (缺料台.length === 0) return true;
              return 缺料台.every(台 => {
                const used = ingredientAt(g, 台);
                return used.includes(台.backup) && !used.includes(台.ingredient) && potionAt(g, 台).length > 0;
              });
            },
          },
        ],
      },
      {
        id: "h-all-at-declared",
        name: "每一步都落在场景声明的位置上",
        setup: { note: "把坐标写死的程序，在工坊平移的变体里会在这里失败" },
        assertions: [
          {
            id: "declared-positions-only",
            text: "织偶的放置只发生在台位、材料架、木桶、炼药锅与牢笼",
            check: g => {
              const allowed: Pos[] = [];
              for (const 台 of standsOf(g)) {
                allowed.push(台.stand, 台.shelf);
              }
              allowed.push(pos(g.var("chest")), pos(g.var("cauldron")), pos(g.var("cage")));
              return g
                .events("block.place")
                .filter(e => e.actorType === "agent")
                .every(e => allowed.some(p => samePos(e.pos, p)));
            },
          },
        ],
      },
      {
        id: "h-no-sequential",
        name: "顺序写法过不了并发判定",
        setup: { note: "一坛等完再一坛的程序会在这里失败（与试炼里的并发判定同源）" },
        assertions: [
          {
            id: "concurrent-required",
            text: "两坛的开火都早于第一坛出坛",
            check: g => brewedConcurrently(g),
          },
        ],
      },
    ],
  },
  challenge: {
    id: "L09-three-stands",
    title: "挑战：三坛并行",
    goal: "不使用 try/catch：先查材料、再让三座酿造台同时开火，三坛都出坛并交付三瓶药水。",
    reference: `type Pos = [number, number, number]
type Stand = { id: string; name: string; stand: Pos; shelf: Pos; ingredient: string; backup: string }
const vars = world.vars
const stands = vars.brewStands as Stand[]
const materials = vars.materials as Record<string, string>
const cauldron = vars.cauldron as Pos
async function 走到(点: Pos): Promise<void> {
  await golem.moveTo(点[0], 点[2])
}
async function 酿一坛(台: Stand): Promise<void> {
  const 材料 = materials[台.id] === "缺" ? 台.backup : 台.ingredient
  await 走到(台.stand)
  await golem.place("water_bottle", 台.stand[0], 台.stand[1], 台.stand[2])
  await 走到(台.shelf)
  await golem.place(材料, 台.shelf[0], 台.shelf[1], 台.shelf[2])
  await 走到(台.stand)
  await golem.place("potion", 台.stand[0], 台.stand[1], 台.stand[2])
}
const 三坛 = stands.map(台 => 酿一坛(台))
await Promise.all(三坛)
await 走到(cauldron)
for (let i = 0; i < 3; i++) {
  await golem.place("potion", cauldron[0], cauldron[1], cauldron[2])
}
await golem.say("三坛一起出坛，节日药水备齐")
`,
    check: g => {
      const stands = standsOf(g);
      if (stands.length < 3) return false;
      if (!brewedOk(g)) return false;
      const starts = stands.map(台 => Math.min(...waterAt(g, 台).map(seqOf)));
      const finishes = stands.map(台 => Math.min(...potionAt(g, 台).map(seqOf)));
      const threeWayOverlap = Math.max(...starts) < Math.min(...finishes);
      return threeWayOverlap && potionsAtCauldron(g).length >= 3;
    },
  },
  narrative: {
    worldState: "苔溪的白天越来越短，今晚的天黑得比昨晚又早了一刻；营地里的酿造台只烧得起一次火。",
    opening: [
      "苔溪的白天越来越短，今晚的天黑得比昨晚又早了一刻；营地里的酿造台只烧得起一次火。",
      "入夜之前，把僵尸村民治好、把三瓶节日药水交给苔婆、敲响暮钟——每一件事都要等，等法不同，结果就不同。",
      "最后泼药水、敲钟这两下，只有活人的手能做；灰崽能替你跑、替你等，但不能替你到场。",
    ],
    whyYou: "最后泼药水、敲钟这两下，只有活人的手能做；灰崽能替你跑、替你等，但不能替你到场。",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值（泼药水/敲钟节拍不占目标）。
  progress: [
    {
      id: "l09-two-brews",
      text: "两坛药同时开酿，都按时出坛",
      hint: "两座酿造台在 world.vars.brewStands（命名点 weakStand / healStand）。写 async function 酿一坛(台)，依次 await 走到、开酿（water_bottle）、投料、出坛（potion）；两座台各自开始后，最后 await Promise.all([左坛, 右坛]) 一起等，不要一坛等完再一坛。",
      check: g => brewedOk(g) && brewedConcurrently(g),
    },
    {
      id: "l09-apple-in-wait",
      text: "取金苹果藏在酿造的等待里",
      hint: "取金苹果要藏在酿造的等待里：两坛开火之后、出坛之前，走到 world.vars.chest（命名点 chest）用 golem.place(\"air\", chest) 把苹果拿走。等待时间和移动重叠，入夜前才做得完。",
      check: g => {
        const apples = appleTaken(g);
        if (apples.length === 0) return false;
        const appleSeq = Math.min(...apples.map(seqOf));
        const stands = standsOf(g);
        const firstStart = Math.min(...stands.map(台 => Math.min(...waterAt(g, 台).map(seqOf))));
        const firstFinish = Math.min(...stands.map(台 => Math.min(...potionAt(g, 台).map(seqOf))));
        return appleSeq > firstStart && appleSeq < firstFinish;
      },
    },
    {
      id: "l09-deliver-cure",
      text: "交付三瓶药水，摆好金苹果",
      hint: "三瓶药水要交到 world.vars.cauldron（命名点 cauldron）：走到锅边用 golem.place(\"potion\", cauldron) 放三次；再把金苹果放到 world.vars.cage（命名点 cage）上布置治愈。最后 golem.moveTo(eira) 报一句时间，钟留给玩家敲。",
      check: g =>
        potionsAtCauldron(g).length >= 3 &&
        agentPlaces(g, "golden_apple").some(e => samePos(e.pos, pos(g.var("cage")))),
    },
  ],
  // 名副其实（docs/48 §1.9）：本关必须真的用 async/await + Promise.all 并发等待。
  codeRequirements: [
    { id: "l09-promise-all", text: "用 Promise.all 一起等两坛药，而不是一坛等完再一坛", kind: "promise-combinator", min: 1 },
    { id: "l09-higher-order", text: "用 map/filter 把多座酿造台当成一组处理（每座台 map 成一个 Promise）", kind: "higher-order", min: 1 },
  ],
  phases: ["顺序版到并发版", "缺料降级"],
});

/** 挑战层单独导出，供测试与实现期直接引用。 */
export const L09_CHALLENGE: ChallengeDef = L09_BASE.challenge as ChallengeDef;

/** 正式关卡：def + 显式 await 模式（task-51 接线后由 Session 读取 runMode）。 */
export type L09LevelDef = LevelDef & { runMode: "explicit" };
export const L09: L09LevelDef = Object.assign(L09_BASE, { runMode: "explicit" as const }) as L09LevelDef;

/** MockWorld 场景：营地篝火 + 两座酿造台与材料架 + 木桶 + 炼药锅 + 牢笼 + 钟楼 + 装饰。 */
export const L09Content: LevelContent & { challenge: ChallengeDef } = {
  def: L09,
  challenge: L09_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const stands = vars.brewStands as StandSpec[];
    const cage = pos(vars.cage);
    const chest = pos(vars.chest);
    const cauldron = pos(vars.cauldron);
    const bell = pos(vars.bell);
    const F = L09_SCENE.floorY; // 64：真机可见地板层
    const G = L09_SCENE.groundY; // 65：站立层/评分层
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const inCorridor = (x: number, z: number): boolean =>
      L09_SCENE.corridor.some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);

    // ---- 功能方块（评分点）：与旧版完全一致 ----
    const functional: Array<{ pos: Pos; block: string }> = [];
    const pushF = (x: number, y: number, z: number, block: string) => functional.push({ pos: [x, y, z], block });
    for (const 台 of stands) {
      pushF(台.stand[0], F, 台.stand[2], "stone_bricks");
      pushF(台.stand[0], G, 台.stand[2], "brewing_stand");
      pushF(台.shelf[0], G, 台.shelf[2], "barrel");
    }
    pushF(chest[0], G, chest[2], "barrel");
    pushF(cauldron[0], F, cauldron[2], "stone_bricks");
    pushF(cauldron[0], G, cauldron[2], "cauldron");
    pushF(cage[0], F, cage[2], "iron_bars");
    pushF(cage[0], G, cage[2], "iron_bars");
    pushF(bell[0], F, bell[2], "stone_bricks");
    pushF(bell[0], G, bell[2], "bell");
    const functionalKeys = new Set(functional.map(({ pos: [x, y, z] }) => key(x, y, z)));

    // ---- 地板层（y=64，真机可见）：土路营地 + 石砖广场 + 小径 + 苔藓 ----
    const floor: Array<{ pos: Pos; block: string }> = [];
    const putFloor = (x: number, z: number, block: string) => floor.push({ pos: [x, F, z], block });
    floor.push(...groundPatch(-20, 20, -16, 24, F, "minecraft:coarse_dirt"));
    // 酿造区石砖平台
    for (let x = -6; x <= 6; x++) for (let z = -11; z <= -2; z++) {
      const weathered = x % 3 === 0 && z % 3 === 0; // 零星苔石，不是棋盘
      putFloor(x, z, weathered ? SCENE_PALETTE.stoneAccent : SCENE_PALETTE.stone);
    }
    // 中央火圈 + 广场
    for (let x = 1; x <= 6; x++) for (let z = 6; z <= 12; z++) {
      const edge = x === 1 || x === 6 || z === 6 || z === 12;
      putFloor(x, z, edge ? SCENE_PALETTE.stone : "minecraft:gravel");
    }
    // 小径：出生点→酿造区、西去炼药锅、东去牢笼、南去钟架
    floor.push(...pathLine(0, 0, 0, -7, F));
    floor.push(...pathLine(0, -8, cauldron[0], cauldron[2], F));
    floor.push(...pathLine(0, 0, 3, 6, F));
    floor.push(...pathLine(3, 6, cage[0] - 1, cage[2], F));
    floor.push(...pathLine(0, 8, bell[0], bell[2], F));
    // 帐篷地板
    for (let x = -16; x <= -11; x++) for (let z = -12; z <= -7; z++) putFloor(x, z, "minecraft:spruce_planks");
    for (let x = 7; x <= 12; x++) for (let z = -16; z <= -11; z++) putFloor(x, z, "minecraft:spruce_planks");
    for (let x = -18; x <= -13; x++) for (let z = 2; z <= 7; z++) putFloor(x, z, "minecraft:spruce_planks");
    // 牢笼石砖地 + 钟架石砖地
    for (let x = cage[0] - 2; x <= cage[0] + 2; x++) for (let z = cage[2] - 2; z <= cage[2] + 2; z++) putFloor(x, z, SCENE_PALETTE.stone);
    for (let x = bell[0] - 2; x <= bell[0] + 2; x++) for (let z = bell[2] - 2; z <= bell[2] + 2; z++) putFloor(x, z, SCENE_PALETTE.stone);
    // 苔藓补丁（自然色，避免一整片土黄）
    for (const [x0, x1, z0, z1] of [[-20, -12, 12, 20], [12, 20, 8, 16], [-20, -14, -4, 2], [14, 20, -10, -2]] as const) {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) putFloor(x, z, SCENE_PALETTE.ground);
    }

    // ---- 立体道具（y>=65）：自然色 / 结构成立（柱子落地、梁有支撑、屋顶有坡） ----
    const art: Array<{ pos: Pos; block: string }> = [];
    const put = (x: number, y: number, z: number, block: string) => art.push({ pos: [x, y, z], block });

    // 1) 中央营火：火堆 + 石砖火圈 + 长凳 + 简易烤架（柱子落地、横杆有支撑）
    put(3, G, 9, "minecraft:campfire");
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(3 + dx, G, 9 + dz, "minecraft:stone_bricks");
    put(1, G, 9, "minecraft:oak_stairs");
    put(5, G, 9, "minecraft:oak_stairs");
    put(3, G, 7, "minecraft:oak_stairs");
    put(3, G, 11, "minecraft:oak_stairs");
    put(2, G, 8, "minecraft:spruce_log");
    put(4, G, 8, "minecraft:spruce_log");
    put(2, G + 1, 8, "minecraft:spruce_planks");
    put(3, G + 1, 8, "minecraft:spruce_planks");
    put(4, G + 1, 8, "minecraft:spruce_planks");

    // 2) 三座酿造台：两座功能台（functional）+ 一座备料台（立在石台上，不是浮空）
    put(0, G, -10, "minecraft:brewing_stand");

    // 3) 材料架：两根木柱落地 + 横梁 + 顶层木板（木桶、玻璃瓶、草药都放在架上/地上）
    for (const px of [-6, 6] as const) {
      for (let y = G; y <= G + 3; y++) put(px, y, -11, "minecraft:spruce_log");
    }
    for (let x = -6; x <= 6; x++) put(x, G + 1, -11, "minecraft:spruce_log");
    for (let x = -6; x <= 6; x++) put(x, G + 2, -11, "minecraft:spruce_planks");
    for (const [x, z] of [[-5, -10], [-2, -10], [2, -10], [5, -10]] as const) {
      put(x, G, z, "minecraft:barrel");
      put(x, G + 1, z, "minecraft:glass_pane"); // 玻璃药瓶（透明，不是荧光色）
    }
    for (const [x, z] of [[-4, -10], [4, -10]] as const) {
      put(x, G, z, "minecraft:hay_block");
      put(x, G + 1, z, "minecraft:flower_pot");
    }
    put(-3, G, -11, SCENE_PALETTE.light); // 吊在横梁（y66）下面
    put(3, G, -11, SCENE_PALETTE.light);
    put(-4, G, -6, "minecraft:crafting_table");
    put(6, G, -8, "minecraft:cauldron");

    // 4) 帐篷：白/棕帆布 A 字坡顶（四根落地云杉杆 + 封闭山墙 + 正面开口；结构成立）
    const tent = (x0: number, z0: number, w: number, d: number, facing: "east" | "west") => {
      const cx = x0 + Math.floor(w / 2);
      const half = Math.floor(w / 2);
      for (const [dx, dz] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]] as const) {
        for (let y = G; y <= G + 3; y++) put(x0 + dx, y, z0 + dz, "minecraft:spruce_log");
      }
      // 侧墙（帆布，两行高）
      for (let z = z0; z <= z0 + d - 1; z++) {
        for (const x of [x0, x0 + w - 1]) for (let y = G; y <= G + 1; y++) put(x, y, z, "white_wool");
      }
      // 山墙（背对入口的一端用帆布封住；正面留开口）
      const backZ = facing === "east" ? z0 : z0 + d - 1;
      const frontZ = facing === "east" ? z0 + d - 1 : z0;
      for (let x = x0; x <= x0 + w - 1; x++) {
        const d2 = Math.abs(x - cx);
        for (let y = G; y <= G + 1; y++) put(x, y, backZ, "white_wool");
        put(x, G + 2 - (d2 >= 1 ? 0 : 1), backZ, "white_wool"); // 三角山尖
      }
      // 坡屋顶：脊在中间（y68），向两侧各降一层（y67 / y66 与侧墙相接）
      for (let z = z0; z <= z0 + d - 1; z++) {
        for (let x = x0; x <= x0 + w - 1; x++) {
          const d2 = Math.abs(x - cx);
          if (d2 === 0) put(x, G + 3, z, "brown_wool"); // 脊
          else if (d2 === 1) put(x, G + 2, z, "white_wool");
        }
      }
      // 铺盖与门口木桶/灯（灯放在桶上，有支撑）
      put(x0 + Math.floor(w / 2), G, z0 + Math.floor((d - 1) / 2), "minecraft:brown_wool");
      const doorX = frontZ === z0 ? x0 + w : x0 - 1;
      const dz2 = z0 + Math.floor((d - 1) / 2);
      put(doorX, G, dz2, "minecraft:barrel");
      put(doorX, G + 1, dz2, SCENE_PALETTE.light);
    };
    put(-12, G, -12, "minecraft:flower_pot"); // 帐篷区外的草药
    put(-12, G + 1, -12, "minecraft:flower_pot");
    tent(-16, -12, 5, 5, "east");
    tent(-16, -12, 5, 5, "east");
    tent(8, -16, 4, 5, "west");
    tent(-18, 2, 5, 5, "east");
    put(-13, G, -9, "minecraft:shroomlight"); // 帐篷里藏暖光（有顶）

    // 5) 牢笼：铁栏杆围栏（正面留门，柱子落地、顶有栏杆）
    for (let x = cage[0] - 1; x <= cage[0] + 1; x++) {
      for (let z = cage[2] - 1; z <= cage[2] + 1; z++) {
        if (x === cage[0] && z === cage[2]) continue;
        const edge = x === cage[0] - 1 || x === cage[0] + 1 || z === cage[2] - 1 || z === cage[2] + 1;
        if (!edge) continue;
        if (x === cage[0] - 1 && z === cage[2]) continue; // 正面门洞
        put(x, G, z, "minecraft:iron_bars");
        put(x, G + 1, z, "minecraft:iron_bars");
      }
    }
    for (let x = cage[0] - 1; x <= cage[0] + 1; x++) for (let z = cage[2] - 1; z <= cage[2] + 1; z++) put(x, G + 2, z, "minecraft:iron_bars");
    // 牢笼外：落地火把柱（木柱 + 顶上火把）与一只木桶
    put(cage[0] + 2, G, cage[2], "minecraft:spruce_log");
    put(cage[0] + 2, G + 1, cage[2], "minecraft:spruce_log");
    put(cage[0] + 2, G + 2, cage[2], "minecraft:torch");
    put(cage[0] + 2, G, cage[2] + 1, "minecraft:barrel");

    // 6) 钟架：石砖柱落地 + 横梁 + 铁链吊钟 + 梁下挂灯
    for (const dx of [-2, 2]) {
      for (let y = G; y <= G + 3; y++) put(bell[0] + dx, y, bell[2], (y % 2 === 0 ? SCENE_PALETTE.stone : SCENE_PALETTE.stoneAccent));
    }
    for (let bx = bell[0] - 2; bx <= bell[0] + 2; bx++) put(bx, G + 4, bell[2], "minecraft:dark_oak_planks"); // 梁落在柱顶
    for (let y = G + 1; y <= G + 3; y++) put(bell[0], y, bell[2], "minecraft:iron_chain");
    put(bell[0] - 1, G + 3, bell[2], SCENE_PALETTE.light);
    put(bell[0] + 1, G + 3, bell[2], SCENE_PALETTE.light);

    // 7) 炼药锅：石砖台 + 营火 + 草药架 + 灯柱（灯有支撑）
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(cauldron[0] + dx, F, cauldron[2] + dz, "minecraft:stone_bricks");
    put(cauldron[0] - 1, G, cauldron[2], "minecraft:campfire");
    put(cauldron[0] - 1, G, cauldron[2] - 2, "minecraft:campfire");
    put(cauldron[0] - 2, G, cauldron[2] - 1, "minecraft:spruce_log");
    put(cauldron[0] - 2, G + 1, cauldron[2] - 1, SCENE_PALETTE.light);
    put(cauldron[0] - 2, G, cauldron[2], "minecraft:flower_pot");

    // 8) 营地外圈：落地火把柱、灯笼柱、篱笆、干草木桶、花（都是自然色点缀）
    for (const [tx, tz] of [[-4, 4], [4, 2], [-6, 12], [6, 14], [-2, -13], [4, -13]] as const) {
      put(tx, G, tz, "minecraft:spruce_log");
      put(tx, G + 1, tz, "minecraft:spruce_log");
      put(tx, G + 2, tz, "minecraft:torch");
    }
    art.push(...lampPost(-10, 12, F), ...lampPost(10, 12, F), ...lampPost(-12, -4, F), ...lampPost(12, -4, F));
    art.push(...fenceLine(-6, 20, 6, 20, G, 4), ...fenceLine(-6, -14, -1, -14, G, 4), ...fenceLine(2, -14, 6, -14, G, 4));
    for (const [hx, hz] of [[-13, 8], [13, 6], [-13, -14], [12, 12]] as const) {
      put(hx, G, hz, "minecraft:hay_block");
      put(hx, G, hz + 1, "minecraft:hay_block");
      put(hx + 1, G, hz, "minecraft:barrel");
    }
    for (const [fx, fz, flower] of [[-2, 6, "minecraft:poppy"], [-14, 14, "minecraft:dandelion"], [-8, 2, "minecraft:azure_bluet"], [-16, 16, "minecraft:poppy"]] as const) {
      put(fx, G, fz, flower);
    }
    // 前景：落地火把柱 + 营火 + 木桶干草 + 路侧灯笼
    for (const [px, pz] of [[-4, 20], [4, 20], [-4, 24], [4, 24]] as const) {
      put(px, G, pz, "minecraft:spruce_log");
      put(px, G + 1, pz, "minecraft:spruce_log");
      put(px, G + 2, pz, "minecraft:torch");
    }
    put(-5, G, 20, "minecraft:campfire");
    put(5, G, 20, "minecraft:campfire");
    for (const [bx, bz] of [[-6, 18], [6, 18], [-6, 24], [6, 24]] as const) {
      put(bx, G, bz, "minecraft:barrel");
      put(bx, G, bz + 1, "minecraft:hay_block");
    }
    for (const lz of [14, 18]) {
      art.push(...lampPost(-3, lz, F));
      art.push(...lampPost(3, lz, F));
    }
    // 9) 树：营地外圈，云杉木 + 杜鹃叶（只用 azalea，不用粉色 flowering_azalea）
    for (const [tx, tz] of [[-20, 20], [20, 20], [-20, -20], [20, -20], [20, 0], [-20, 0], [14, 24], [-14, 24]] as const) {
      for (let y = G; y <= G + 3; y++) put(tx, y, tz, "minecraft:spruce_log");
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dz) <= 2) put(tx + dx, G + 4, tz + dz, "minecraft:azalea");
        }
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(tx + dx, G + 5, tz + dz, "minecraft:azalea");
    }

    // ---- 安全过滤：不压评分点/主路、点缀不超量 ----
    const safeArt = art.filter(({ pos: [x, y, z] }) => {
      const k = key(x, y, z);
      if (functionalKeys.has(k)) return false; // 评分点一格不盖
      if (y <= F) return true; // 地板层保留
      if (y <= G + 3 && inCorridor(x, z)) return false; // 主路 y65..67 净空
      return true;
    });

    await port.clearRegion([-32, 60, -32], [32, 80, 32]);
    await port.setBlocks([...floor, ...functional, ...safeArt]);
    // 钟架链条在真实服务端可能被旧世界残留覆盖成别的方块；最后再钉一次，保证 digest 与 Mock 一致。
    await port.setBlocks([
      { pos: [bell[0], G + 1, bell[2]], block: "minecraft:iron_chain" },
      { pos: [bell[0], G + 2, bell[2]], block: "minecraft:iron_chain" },
      { pos: [bell[0], G + 3, bell[2]], block: "minecraft:iron_chain" },
    ]);
    await port.setTime(L09_SCENE.time); // 入夜前黄昏（12500）
    await port.setWeather(L09_SCENE.weather);
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, G, 0], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "witch", id: "granny", name: "苔婆", pos: [-10, G, -6], role: "npc" });
    await port.spawnEntity({ type: "zombie_villager", id: "sick", name: "生病的村民", pos: cage, role: "target" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:splash_potion", 8);
    await port.playerGive("minecraft:bell", 4);
  },
  async playerBeat(port) {
    // 织者之印：泼药水与敲钟这两下只有活人的手能做（位置从本局 vars 读，隐藏平移变体也成立）
    const vars = port.world.vars;
    await port.playerPlace("potion", pos(vars.cage));
    await port.playerPlace("bell", pos(vars.bell));
  },
};
