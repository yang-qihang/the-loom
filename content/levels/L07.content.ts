/**
 * L07 — 信风与织线（MockWorld 版）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准：织偶（不会猜意思的无魂工匠）、符文（一句只做一件事的短句）、
 * 散线（让东西忘记自己该做什么的灰白线头）、织者之印（只有活人的手能完成的最后一步）；
 * 悦灵 = 信风谷里替人搬东西的小风灵，认规矩不认命令。
 * 教学意图与数值以 content/levels/L07-trade-winds.md 为准（A9 闭包/做法作为值 + A10 流水线）。
 *
 * T1 MockWorld 学生面只有 `golem.moveTo/place/say/pos` 与只读 `world.vars`
 * （docs/21 §2；docs/12 的 allay.assign / allay.patrol / world.give 尚未接线），
 * 因此本文件用「等价动作」实现，动作语义固定如下（真实 Paper 版由 MC 线替换动词，判定不动）：
 *   规矩       = 纯函数（吃货物、吐是/不是），学生代码自己定义；真实 MC 里交给 allay.assign
 *   分拣       = 学生代码按规矩算出「每件货去哪个格子」，再走到格子 place(货物编号, 格子坐标)
 *   流水线     = pipe / filter / map 的等价物在脚本里就地定义（真实 MC 里由织线库预置注入）
 *   开笼       = 亲手节拍：playerPlace("oak_trapdoor", 笼门坐标)，织者之印由活人完成
 *   巡逻挑战   = 生成器写一条无限路线 + 只取前五站（真实 MC 里是 allay.patrol(take(5)(...))）
 * 真实 Paper 版接线后，学生代码换成 allay.assign / allay.patrol / world.give，
 * 货物数据、三阶段结构与全部判定不变。
 */
import { defineLevel, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { groundPatch, pathLine, lampPost, fenceLine, banner, type SceneBlock } from "../scenes/scene-kit";

type Pos = [number, number, number];
type Kind = "ore" | "wood" | "food";
type CargoItem = { id: string; kind: Kind };
type BoxKey = Kind;

const C = "minecraft:";
const pos = (p: unknown): Pos => p as Pos;
const posList = (p: unknown): Pos[] => p as Pos[];
const cargoList = (p: unknown): CargoItem[] => p as CargoItem[];
const boxesOf = (p: unknown): Record<BoxKey, Pos[]> => p as Record<BoxKey, Pos[]>;
const blockId = (g: GraderApi, p: Pos): string => g.block(p).id;
const idOf = (g: GraderApi, p: Pos): string => blockId(g, p).replace(C, "");
const sameList = (a: string[], b: string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const agentPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "agent");
const playerPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "player");

const rowOf = (x0: number, z: number): Pos[] => {
  const slots: Pos[] = [];
  for (let i = 0; i < 8; i++) slots.push([x0 + i * 2, 65, z]);
  return slots;
};

const MAIN_CARGO: CargoItem[] = [
  { id: "raw_iron", kind: "ore" },
  { id: "coal", kind: "ore" },
  { id: "oak_log", kind: "wood" },
  { id: "spruce_log", kind: "wood" },
  { id: "bread", kind: "food" },
  { id: "carrot", kind: "food" },
];
const MAIN_BOXES: Record<BoxKey, Pos[]> = { ore: rowOf(0, 0), wood: rowOf(0, 6), food: rowOf(0, 12) };
const MAIN_RECHECK: CargoItem[] = [
  { id: "raw_iron", kind: "ore" },
  { id: "oak_log", kind: "wood" },
  { id: "bread", kind: "food" },
  { id: "coal", kind: "ore" },
];
const RECHECK_BOXES: Record<BoxKey, Pos[]> = { ore: rowOf(20, 0), wood: rowOf(20, 6), food: rowOf(20, 12) };
const CAGES: Pos[] = [
  [-10, 65, 0],
  [-10, 65, 6],
  [-10, 65, 12],
];
const CHALLENGE_HOME: Pos = [30, 65, 30];
const CHALLENGE_RING: Pos[] = [
  [22, 65, 22],
  [38, 65, 22],
  [38, 65, 38],
  [22, 65, 38],
];

const L07_BASE: LevelDef = defineLevel({
  id: "L07",
  meta: {
    id: "L07",
    title: { zh: "信风与织线", en: "The Trade Winds" },
    act: 2,
    order: 7,
    priority: "P1",
    prerequisites: ["L06"],
    estimatedMinutes: 20,
    difficulty: 4,
    abstractions: ["A9", "A10"],
    objectives: [
      { id: "o-fn-value", learnerView: "把一条规矩写成做法交给悦灵，让它自己判断每一件货", evidence: { kind: "machine", ref: "cargo-boxes" } },
      { id: "o-closure", learnerView: "做法会记住它被创建时身边的变量", evidence: { kind: "machine", ref: "recheck-boxes" } },
      { id: "o-pipeline", learnerView: "用流水线把筛哪些、交给谁串起来，行为与逐件循环一致", evidence: { kind: "machine", ref: "pipeline-match" } },
    ],
    misconceptions: ["call-vs-reference", "closure-copies-value", "filter-vs-map", "pipeline-order"],
    apiIntroduced: ["allay", "allay.assign", "allay.patrol", "world.give"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "allay", "allay.assign", "allay.patrol", "world.give"],
    syntaxIntroduced: ["箭头函数（做法作为值）", "闭包", "map/filter（流水线零件）", "pipe 流水线"],
    reward: { rune: "A10", advancement: "loomcraft/act2/trade_winds", codexPage: "A10" },
    languageLevel: "act2",
  },
  world: {
    vars: {
      cargo: MAIN_CARGO.map(item => ({ ...item })),
      boxes: {
        ore: MAIN_BOXES.ore.map(p => [...p]),
        wood: MAIN_BOXES.wood.map(p => [...p]),
        food: MAIN_BOXES.food.map(p => [...p]),
      },
      recheck: MAIN_RECHECK.map(item => ({ ...item })),
      recheckBoxes: {
        ore: RECHECK_BOXES.ore.map(p => [...p]),
        wood: RECHECK_BOXES.wood.map(p => [...p]),
        food: RECHECK_BOXES.food.map(p => [...p]),
      },
      cargoBox: [0, 65, 20],
      cages: CAGES.map(p => [...p]),
      home: [0, 65, 16],
      eira: [4, 65, 18],
      challengeHome: [...CHALLENGE_HOME],
      challengeRing: CHALLENGE_RING.map(p => [...p]),
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "allay", role: "prop", id: "allays", name: "悦灵" },
    ],
  },
  code: {
    expectedLoc: 70,
    starterCode: `// 数据：world.vars.cargo 与 world.vars.recheck（每件货有 id、kind：ore / wood / food）。
// boxes 里是箱子格子坐标（ore / wood / food）；recheckBoxes 是复核箱的三个去处。
// 分拣 = 走到格子，place(货物编号, 格子坐标)；一格一件。
// 现在只把第一件货放进了矿石箱。
const cargo = world.vars.cargo
const boxes = world.vars.boxes
const first = cargo[0]
golem.moveTo(boxes.ore[0][0], boxes.ore[0][2])
golem.place(first.id, boxes.ore[0][0], boxes.ore[0][1], boxes.ore[0][2])
golem.say("先放了一件。")

// TODO 第一阶段：写三条分辨货物的小规矩（矿石/木料/食物），先清点货堆。
// TODO 第二阶段：把货堆分进三只箱子；再用一条流水线把复核箱的错货送回原处。
// TODO 第三阶段：逐箱点数报给艾拉听，再开笼放悦灵。
`,
    referenceSolution: `// 第一阶段：三条分辨货物的规矩（做法当作值，能交给别人反复用）
const cargo = world.vars.cargo
const boxes = world.vars.boxes

const makeRule = kind => {
  return item => item.kind === kind
}
const isOre = makeRule("ore")
const isWood = makeRule("wood")
const isFood = makeRule("food")

let oreCount = 0
let woodCount = 0
let foodCount = 0
let i = 0
while (i < cargo.length) {
  if (isOre(cargo[i])) { oreCount = oreCount + 1 }
  if (isWood(cargo[i])) { woodCount = woodCount + 1 }
  if (isFood(cargo[i])) { foodCount = foodCount + 1 }
  i = i + 1
}
golem.say("货堆清点：矿石" + oreCount + "件，木料" + woodCount + "件，食物" + foodCount + "件。")

// 第二阶段：送法记住自己的格子（闭包），按规矩把货堆分进三只箱子
const planFor = slots => {
  let n = 0
  return item => {
    const slot = slots[n]
    n = n + 1
    return [item.id, slot[0], slot[1], slot[2]]
  }
}
const planOre = planFor(boxes.ore)
const planWood = planFor(boxes.wood)
const planFood = planFor(boxes.food)
const placements = []
i = 0
while (i < cargo.length) {
  if (isOre(cargo[i])) { placements.push(planOre(cargo[i])) }
  if (isWood(cargo[i])) { placements.push(planWood(cargo[i])) }
  if (isFood(cargo[i])) { placements.push(planFood(cargo[i])) }
  i = i + 1
}
let k = 0
while (k < placements.length) {
  const cell = placements[k]
  golem.moveTo(cell[1], cell[3] + 2)
  golem.place(cell[0], cell[1], cell[2], cell[3])
  k = k + 1
}

// 第三阶段：流水线重排复核箱——先筛，再规划格子，最后逐件送过去
const recheck = world.vars.recheck
const recheckBoxes = world.vars.recheckBoxes

const filter = test => {
  return items => {
    const out = []
    for (let q = 0; q < items.length; q = q + 1) {
      if (test(items[q])) { out.push(items[q]) }
    }
    return out
  }
}
const mapAll = plan => {
  return items => {
    const out = []
    for (let q = 0; q < items.length; q = q + 1) { out.push(plan(items[q])) }
    return out
  }
}
const pipe = (value, first, second) => second(first(value))

const planRecheckOre = planFor(recheckBoxes.ore)
const planRecheckWood = planFor(recheckBoxes.wood)
const planRecheckFood = planFor(recheckBoxes.food)
const oreStep = pipe(recheck, filter(isOre), mapAll(planRecheckOre))
const woodStep = pipe(recheck, filter(isWood), mapAll(planRecheckWood))
const foodStep = pipe(recheck, filter(isFood), mapAll(planRecheckFood))
const recheckPlacements = []
let q = 0
while (q < oreStep.length) { recheckPlacements.push(oreStep[q]); q = q + 1 }
q = 0
while (q < woodStep.length) { recheckPlacements.push(woodStep[q]); q = q + 1 }
q = 0
while (q < foodStep.length) { recheckPlacements.push(foodStep[q]); q = q + 1 }
q = 0
while (q < recheckPlacements.length) {
  const cell = recheckPlacements[q]
  golem.moveTo(cell[1], cell[3] + 2)
  golem.place(cell[0], cell[1], cell[2], cell[3])
  q = q + 1
}

golem.moveTo(world.vars.home[0], world.vars.home[2] + 2)
golem.say("对上了：三只箱子都归位了。")
`,
  },
  task: {
    mainTask: "写三条分辨货物的规矩，把货堆分进三只箱子；再用流水线把复核箱的错货送回原处，最后逐箱报数。",
    makeTask: "换一批货物、换箱子位置也要能跑，只来两类货的清单也不许翻车。",
    playerBeat: "分拣完成后，你打开三只笼门放出悦灵（织者之印）。",
    successCriteria: [
      {
        id: "cargo-boxes",
        text: "货堆按三条规矩分进三只箱子，没有遗漏与错箱",
        check: g => {
          const cargo = cargoList(g.var("cargo"));
          const boxes = boxesOf(g.var("boxes"));
          const placed: string[] = [];
          for (const key of ["ore", "wood", "food"] as BoxKey[]) placed.push(...boxes[key].map(p => idOf(g, p)).filter(id => id !== "air"));
          return sameList(placed, cargo.map(item => item.id));
        },
      },
      {
        id: "recheck-boxes",
        text: "复核箱的错货按同一套规矩送回原处",
        check: g => {
          const recheck = cargoList(g.var("recheck"));
          const boxes = boxesOf(g.var("recheckBoxes"));
          const placed: string[] = [];
          for (const key of ["ore", "wood", "food"] as BoxKey[]) placed.push(...boxes[key].map(p => idOf(g, p)).filter(id => id !== "air"));
          return sameList(placed, recheck.map(item => item.id));
        },
      },
      {
        id: "no-stray",
        text: "所有分拣动作都发生在箱子格子里",
        check: g => {
          const boxes = boxesOf(g.var("boxes"));
          const recheckBoxes = boxesOf(g.var("recheckBoxes"));
          const allowed = new Set<string>(Object.values(boxes).flat().concat(Object.values(recheckBoxes).flat()).map(p => p.join(",")));
          return agentPlaces(g).every(e => !!e.pos && allowed.has(e.pos.join(",")));
        },
      },
    ],
    hiddenTests: [
      {
        id: "h-rules-generic",
        name: "换一批货、只来两类货，规矩仍然对",
        setup: { note: "验收会换货物数量与种类；写死清单的程序必挂" },
        assertions: [
          {
            id: "h1a",
            text: "每件货都按规矩进了对应的箱子（件数也对）",
            check: g => {
              const cargo = cargoList(g.var("cargo"));
              const boxes = boxesOf(g.var("boxes"));
              for (const key of ["ore", "wood", "food"] as BoxKey[]) {
                const expected = cargo.filter(item => item.kind === key).map(item => item.id);
                const got = boxes[key].map(p => idOf(g, p)).filter(id => id !== "air");
                if (!sameList(got, expected)) return false;
              }
              return true;
            },
          },
          {
            id: "h1b",
            text: "复核箱的货也都按同一套规矩归位了（件数也对）",
            check: g => {
              const recheck = cargoList(g.var("recheck"));
              const boxes = boxesOf(g.var("recheckBoxes"));
              for (const key of ["ore", "wood", "food"] as BoxKey[]) {
                const expected = recheck.filter(item => item.kind === key).map(item => item.id);
                const got = boxes[key].map(p => idOf(g, p)).filter(id => id !== "air");
                if (!sameList(got, expected)) return false;
              }
              return true;
            },
          },
        ],
      },
      {
        id: "h-cages-only-player",
        name: "笼门只有活人的手能开",
        setup: { note: "织偶伸手去碰笼门的程序会被这里拦住" },
        assertions: [
          {
            id: "h2a",
            text: "三只笼门都不是织偶打开的",
            check: g => {
              const cages = posList(g.var("cages"));
              return agentPlaces(g).every(e => !cages.some(cage => samePos(e.pos, cage)));
            },
          },
        ],
      },
    ],
  },
  narrative: {
    worldState: "信风谷的三只笼子还锁着，散线把货堆缠在营地中间；今天的信风一过，这些货就归散线了。",
    opening: [
      "信风谷的三只笼子还锁着，散线把货堆缠在营地中间。",
      "给三只悦灵各一条分辨货物的规矩，让它们把货堆搬进三只箱子，再用一条流水线把复核箱里的错货送回原处。",
      "笼门只有你的手能开；悦灵认的是你给的规矩，不是一声命令。",
    ],
    whyYou: "笼门只有你的手能开；悦灵认的是你给的规矩，不是一声命令。",
  },
  phases: ["三条规矩与清点", "箱子与流水线", "逐箱报数与开笼"],
});

/**
 * 挑战层（可跳过、不计星）：无限巡逻与惰性预算。
 * 生成器写一条无限路线，只取前五站（四角 + 回家），三十秒内走完；
 * 先把无限路线整个装进口袋的写法会超预算。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L07_CHALLENGE: LevelChallenge = {
  id: "L07-lazy-patrol",
  title: "挑战：无限巡逻",
  goal: "无限路线只取前五站：四角绕一圈，最后回家里",
  reference: `const home = world.vars.challengeHome
const ring = world.vars.challengeRing

function* patrol() {
  while (true) {
    for (let i = 0; i < ring.length; i = i + 1) {
      yield ring[i]
    }
    yield home
  }
}

function take(n) {
  return points => {
    const out = []
    for (const point of points) {
      if (out.length >= n) { break }
      out.push(point)
    }
    return out
  }
}

const route = take(5)(patrol())
for (let i = 0; i < route.length; i = i + 1) {
  golem.moveTo(route[i][0], route[i][2])
}
golem.say("挑战：巡逻五站，回到家里。")
`,
  check: g => {
    const home = pos(g.var("challengeHome"));
    const ring = posList(g.var("challengeRing"));
    const moves = g.events("agent.move").filter(e => !!e.pos);
    const wanted = [...ring, home];
    if (moves.length !== wanted.length) return false;
    for (let i = 0; i < wanted.length; i++) {
      if (!samePos(moves[i].pos, wanted[i])) return false;
    }
    return agentPlaces(g).length === 0;
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L07: LevelDef & { challenge: LevelChallenge } = Object.assign(L07_BASE, {
  challenge: L07_CHALLENGE,
});

export type ShotPosition = { id: string; label: string; pos: Pos; yaw: number; pitch: number; mustSee: string[] };

/**
 * 真实 Paper 的 region 布局（与 packages/worldport 的 deriveLayout 对齐）：
 * playerSpawn = arena 中心；scene-shot 相机 = playerSpawn + (0,4,14)。
 * 本关居中到 [0,65,2]，自动机位 [0,69,16] 朝北正对货箱阵与信风谷风车。
 * 所有 y>65 的方块都在 prepare 里自带落地骨架，插件不会再给高点补灰石柱。
 */
export const L07_REAL_LAYOUT = {
  clearFrom: [-42, 55, -40] as Pos,
  clearTo: [42, 85, 44] as Pos,
  groundY: 65,
  playerSpawn: [0, 65, 2] as Pos,
  autoCamera: [0, 69, 16] as Pos,
  yaw: 180,
  pitch: 10,
} as const;

export const L07_SHOT_POSITIONS: ShotPosition[] = [
  { id: "auto", label: "自动机位：货场南侧朝北", pos: [0, 69, 16], yaw: 180, pitch: 10, mustSee: ["货箱阵", "风车", "货架", "暖光"] },
  { id: "manual", label: "人工机位：货场门口朝北", pos: [0, 66, 14], yaw: 180, pitch: 0, mustSee: ["货箱阵", "风车", "货架"] },
];

/** MockWorld 场景：三排箱子格、货堆与复核箱、三只笼子、家与装饰（数值见 spec §3）。 */
export const L07Content: LevelContent & { challenge: LevelChallenge } = {
  def: L07,
  challenge: L07_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const boxes = boxesOf(vars.boxes);
    const recheckBoxes = boxesOf(vars.recheckBoxes);
    const layout = new Map<string, string>();
    const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;
    const put = (x: number, y: number, z: number, block: string): void => {
      layout.set(keyOf(x, y, z), block);
    };
    const putAll = (list: SceneBlock[]): void => {
      for (const b of list) put(b.pos[0], b.pos[1], b.pos[2], b.block);
    };

    // ── 草坡与石径：踩实的土货场 + 三条石板道 + 苔石压边（自然色）
    putAll(groundPatch(-14, 16, 0, 14, 64, "minecraft:coarse_dirt"));
    putAll(groundPatch(-18, -15, -2, 16, 64, "minecraft:moss_block"));
    putAll(groundPatch(35, 38, -2, 16, 64, "minecraft:moss_block"));
    putAll(groundPatch(-14, -12, 0, 14, 64, "minecraft:moss_block"));
    putAll(groundPatch(12, 16, 0, 14, 64, "minecraft:moss_block"));
    putAll(groundPatch(-8, -4, 4, 10, 64, "minecraft:moss_block"));
    putAll(pathLine(0, 26, 0, -6, 64));
    putAll(pathLine(-14, 3, 40, 3, 64));
    putAll(pathLine(-14, 9, 40, 9, 64));
    putAll(pathLine(-14, 15, 40, 15, 64));
    putAll(groundPatch(-16, -15, 0, 14, 64, "minecraft:mossy_stone_bricks"));
    putAll(groundPatch(39, 40, 0, 14, 64, "minecraft:mossy_stone_bricks"));

    // ── 三排货箱格：格下是木桶/木板/干草垛（货箱阵的地基），格子本身留空给分拣
    const rows: Array<{ slots: Pos[]; floor: string }> = [
      { slots: boxes.ore, floor: "minecraft:barrel" },
      { slots: boxes.wood, floor: "minecraft:oak_planks" },
      { slots: boxes.food, floor: "minecraft:barrel" },
    ];
    for (const row of rows) {
      for (const slot of row.slots) put(slot[0], 64, slot[2], row.floor);
    }
    for (const key of ["ore", "wood", "food"] as BoxKey[]) {
      for (const slot of recheckBoxes[key]) put(slot[0], 64, slot[2], "minecraft:cobblestone");
    }
    put(0, 65, 20, "minecraft:chest"); // 货堆箱（评分点，保持原样）
    for (const cage of posList(vars.cages)) put(cage[0], 65, cage[2], "minecraft:iron_bars");

    // ── 地标：信风谷风车（实心塔身 + 正面白色帆面 + 两翼伸出）
    const windX0 = 3;
    const windX1 = 9;
    const windZ0 = -20;
    const windZ1 = -16;
    for (let x = windX0; x <= windX1; x += 1) {
      for (let z = windZ0; z <= windZ1; z += 1) {
        for (let y = 65; y <= 73; y += 1) {
          const edge = x === windX0 || x === windX1 || z === windZ0 || z === windZ1;
          if (y <= 66) put(x, y, z, y === 65 ? "minecraft:cobblestone" : "minecraft:stone_bricks");
          else if (y <= 69) put(x, y, z, edge ? "minecraft:spruce_log" : "minecraft:oak_planks");
          else put(x, y, z, edge ? "minecraft:spruce_log" : "minecraft:oak_planks");
        }
      }
    }
    for (let x = windX0; x <= windX1; x += 1) {
      for (let z = windZ0; z <= windZ1; z += 1) put(x, 74, z, "minecraft:oak_planks");
    }
    // 屋檐与两级坡屋顶（都是压在实心塔身上，不悬空）
    for (let x = windX0 + 1; x <= windX1 - 1; x += 1) {
      for (let z = windZ0 + 1; z <= windZ1 - 1; z += 1) put(x, 75, z, "minecraft:dark_oak_stairs");
    }
    for (let x = 5; x <= 7; x += 1) for (let z = -19; z <= -17; z += 1) put(x, 76, z, "minecraft:oak_planks");
    // 门、窗与磨盘：都嵌在塔身上，有实际功能
    put(7, 65, windZ1, "minecraft:dark_oak_door");
    put(7, 66, windZ1, "minecraft:dark_oak_door");
    put(3, 68, -18, "minecraft:glass_pane");
    put(3, 69, -18, "minecraft:glass_pane");
    put(9, 68, -18, "minecraft:glass_pane");
    put(9, 69, -18, "minecraft:glass_pane");
    put(5, 65, windZ1, "minecraft:grindstone");
    // 正面（z=-16）白色帆面：竖臂 + 横臂 + 斜角点缀 + 木轴
    for (let y = 66; y <= 72; y += 1) put(6, y, windZ1, "minecraft:white_wool");
    for (let x = windX0; x <= windX1; x += 1) put(x, 69, windZ1, "minecraft:white_wool");
    put(6, 69, windZ1, "minecraft:copper_block");
    put(4, 67, windZ1, "minecraft:white_wool");
    put(8, 71, windZ1, "minecraft:white_wool");
    put(4, 71, windZ1, "minecraft:white_wool");
    put(8, 67, windZ1, "minecraft:white_wool");
    // 门边木桶 + 提灯（暖光）
    put(4, 65, windZ1, "minecraft:barrel");
    put(4, 66, windZ1, "minecraft:lantern");
    put(8, 65, windZ1, "minecraft:barrel");
    put(8, 66, windZ1, "minecraft:lantern");
    // 两翼伸出的白帆尖 + 落地木柱（不靠插件补柱）
    for (const tipX of [2, 10]) {
      for (let y = 65; y <= 68; y += 1) put(tipX, y, windZ1, "minecraft:oak_fence");
      put(tipX, 69, windZ1, "minecraft:white_wool");
    }

    // ── 货箱阵：货场北侧的木箱堆、东侧复核箱货堆、西侧货架、南侧货堆
    for (let x = -12; x <= 18; x += 3) {
      put(x, 65, -4, x % 2 === 0 ? "minecraft:barrel" : "minecraft:chest");
      if (x % 6 === 0) {
        put(x, 66, -4, "minecraft:barrel");
        put(x, 66, -5, "minecraft:chest");
      }
    }
    for (let z = 2; z <= 12; z += 2) {
      put(36, 65, z, "minecraft:barrel");
      put(38, 65, z, "minecraft:chest");
      if (z % 4 === 2) put(37, 66, z, "minecraft:barrel");
    }
    for (const [x, z] of [[-4, 20], [4, 20], [-2, 22], [2, 22], [-4, 24]] as Array<[number, number]>) {
      put(x, 65, z, z % 3 === 0 ? "minecraft:barrel" : "minecraft:chest");
    }
    // 每排箱子格两端各立一摞货箱，主视角能看到连续的货箱阵
    for (const z of [0, 6, 12]) {
      put(-2, 65, z, "minecraft:barrel");
      put(-2, 66, z, "minecraft:chest");
      put(16, 65, z, "minecraft:chest");
      put(16, 66, z, "minecraft:barrel");
    }
    // 近景两侧的货箱摞（在相机视野下缘，不进中央通道）
    for (const [x, z] of [[-6, 14], [8, 14]] as Array<[number, number]>) {
      put(x, 65, z, "minecraft:barrel");
      put(x, 66, z, "minecraft:chest");
    }
    put(-4, 66, 20, "minecraft:barrel");
    put(4, 66, 20, "minecraft:hay_block");

    // 西侧货架：木板背板 + 木桶层 + 架顶提灯
    for (let z = 2; z <= 10; z += 1) {
      for (let y = 65; y <= 67; y += 1) put(-16, y, z, "minecraft:oak_planks");
      put(-15, 65, z, z % 3 === 0 ? "minecraft:barrel" : "minecraft:chest");
    }
    put(-16, 68, 6, "minecraft:lantern");
    put(-16, 67, 8, "minecraft:oak_trapdoor");

    // ── 栅栏与树带：北侧木栅栏、西/东边栅栏、南侧半围，外围是杜鹃树带
    putAll(fenceLine(-20, -8, 22, -8, 65, 5));
    putAll(fenceLine(-22, -8, -22, 26, 65, 6));
    putAll(fenceLine(40, -8, 40, 20, 65, 6));
    putAll(fenceLine(-20, 30, 12, 30, 65, 5));
    const hedge = (x0: number, x1: number, z0: number, z1: number): void => {
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) {
        for (let y = 65; y <= 67; y += 1) put(x, y, z, "minecraft:azalea");
      }
    };
    const tallTree = (x: number, z: number): void => {
      for (let y = 68; y <= 69; y += 1) put(x, y, z, "minecraft:spruce_log");
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        put(x + dx, 70, z + dz, "minecraft:azalea");
      }
    };
    hedge(-18, 22, -27, -27);
    hedge(-26, -26, -6, 18);
    hedge(41, 41, -6, 18);
    hedge(-18, 10, 37, 37);
    for (const x of [-18, -12, -6, 6, 12, 18, 22]) tallTree(x, -27);
    for (const z of [-4, 4, 12]) {
      tallTree(-26, z);
      tallTree(41, z);
    }
    for (const x of [-18, -8, 0, 8]) tallTree(x, 37);

    // ── 暖光与生活痕迹：灯柱、营火、干草堆、小花（点缀色只在边缘）
    putAll(lampPost(-8, 10, 64));
    putAll(lampPost(18, 6, 64));
    putAll(lampPost(-16, 18, 64));
    put(10, 65, -2, "minecraft:campfire");
    put(16, 65, 12, "minecraft:campfire");
    put(-8, 65, 10, "minecraft:hay_block");
    put(-8, 66, 10, "minecraft:hay_block");
    put(-6, 65, 10, "minecraft:hay_block");
    put(12, 65, 16, "minecraft:hay_block");
    put(12, 66, 16, "minecraft:hay_block");
    put(14, 65, 16, "minecraft:hay_block");
    for (const [x, z] of [[-12, 18], [12, 18], [-14, 4], [20, 20]] as Array<[number, number]>) {
      put(x, 65, z, (x + z) % 2 === 0 ? "minecraft:poppy" : "minecraft:dandelion");
    }

    // ── 落地支撑：y>65 的方块全部自带骨架，插件不会补灰柱
    const supportFor = (block: string): string => {
      if (block.includes("white_wool")) return "minecraft:white_wool";
      if (block.includes("azalea")) return "minecraft:azalea";
      if (block.includes("hay_block")) return "minecraft:hay_block";
      if (block.includes("spruce") || block.includes("oak") || block.includes("barrel") || block.includes("chest") || block.includes("planks")) return "minecraft:oak_planks";
      if (block.includes("lantern") || block.includes("campfire")) return "minecraft:oak_fence";
      if (block.includes("copper")) return "minecraft:copper_block";
      return "minecraft:stone_bricks";
    };
    for (const [key, block] of [...layout.entries()]) {
      const [x, y, z] = key.split(",").map(Number);
      for (let py = 65; py < y; py += 1) {
        const below = keyOf(x, py, z);
        if (!layout.has(below)) layout.set(below, supportFor(block));
      }
    }
    // 分拣格必须空气：任何装饰都不许落在三排箱格/复核格上
    for (const slots of [...Object.values(boxes), ...Object.values(recheckBoxes)]) {
      for (const slot of slots) layout.set(keyOf(slot[0], slot[1], slot[2]), "minecraft:air");
    }

    const blocks: SceneBlock[] = [...layout.entries()].map(([key, block]) => {
      const [x, y, z] = key.split(",").map(Number);
      return { pos: [x, y, z] as Pos, block };
    });

    await port.clearRegion(L07_REAL_LAYOUT.clearFrom, L07_REAL_LAYOUT.clearTo);
    await port.setBlocks(blocks);
    await port.setTime(7000);
    await port.setWeather("clear");
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, 65, 24], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "allay", id: "allays", name: "悦灵", pos: [-10, 65, 6], role: "prop" });
    await port.spawnEntity({ type: "allay", id: "allay-2", name: "悦灵", pos: [-6, 65, 14], role: "prop" });
    await port.spawnEntity({ type: "allay", id: "allay-3", name: "悦灵", pos: [18, 65, 10], role: "prop" });
  },
  async playerBeat(port) {
    // 织者之印：三只笼门由你亲手打开，悦灵随即按规矩出发。
    for (const cage of posList(port.world.vars.cages)) {
      await port.playerPlace("oak_trapdoor", pos(cage));
    }
  },
};
