/**
 * L05 — 一百座房子（MockWorld 版）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准：织偶（不会猜意思的无魂工匠）、符文（一句只做一件事的短句）、
 * 织典（学会一枚符文就亮一页的图鉴）、织者之印（只有活人的手能完成的最后一步）。
 * 教学意图与数值以 content/levels/L05-hundred-houses.md 为准（A5 函数/参数/返回 + A6 模块）。
 *
 * T1 MockWorld 学生面只有 `golem.moveTo/place/say/pos` 与只读 `world.vars`
 * （docs/21 §2；docs/12 的 world.plot / golem.fill / golem.placeSign 尚未接线），
 * 因此本文件用「等价动作」实现，动作语义固定如下（真实 Paper 版由 MC 线替换动词，判定不动）：
 *   读地块数据 = world.vars.plots（五块地各自的西北角 x/z 与屋顶风格 style）
 *   造房       = 走到地块中心 moveTo，再用 place 一格一格摆（地基/墙/屋顶/门窗床火把）
 *   门牌       = 亲手节拍：playerPlace("oak_sign", 门口位置)，织者之印由活人完成
 *   材料预算   = 织偶的 block.place 事件总数不得超过 vars.materialBudget（脚本里没有「无限材料」）
 * 真实 Paper 版接线后，学生代码换成 world.plot / golem.fill / golem.placeSign，
 * 地块数据、三阶段结构与全部判定不变。
 */
import { defineLevel, type Check, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import { SCENE_PALETTE, banner, groundPatch, lampPost, pathLine, tree } from "../scenes/scene-kit";
import type { LevelContent } from "../../packages/worldport/src/index";

type Pos = [number, number, number];
type Style = "oak" | "spruce" | "brick";
type Plot = { x: number; z: number; style: Style };

const C = "minecraft:";
const pos = (p: unknown): Pos => p as Pos;
const posList = (p: unknown): Pos[] => p as Pos[];
const plotList = (p: unknown): Plot[] => p as Plot[];
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const blockOf = (e: { data?: Record<string, unknown> }): string => String(e.data?.block ?? "");
const agentPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "agent");
const playerPlaces = (g: GraderApi) => g.events("block.place").filter(e => e.actorType === "player");

const wallBlock = (style: Style): string =>
  style === "spruce" ? "spruce_planks" : style === "brick" ? "bricks" : "oak_planks";
const roofBlock = (style: Style): string =>
  style === "spruce" ? "spruce_slab" : style === "brick" ? "stone_brick_slab" : "oak_slab";

/**
 * 一栋房子的等价布点：地基 3×3（y63）、墙一圈 8 格（y64）、屋顶 3×3（y65），
 * 门/床/窗/火把各一格，压在墙一圈上（位置见 spec §3；starter 注释里也写给学生看）。
 */
type Cell = { pos: Pos; block: string };
function hutCells(plot: Plot): Cell[] {
  const cells = new Map<string, Cell>();
  const put = (x: number, y: number, z: number, block: string): void => {
    cells.set(`${x},${y},${z}`, { pos: [x, y, z], block });
  };
  const wall = wallBlock(plot.style);
  const roof = roofBlock(plot.style);
  for (let dx = 0; dx < 3; dx++) {
    for (let dz = 0; dz < 3; dz++) {
      put(plot.x + dx, 63, plot.z + dz, "cobblestone");
      put(plot.x + dx, 65, plot.z + dz, roof);
    }
  }
  put(plot.x, 64, plot.z, wall);
  put(plot.x + 1, 64, plot.z, wall);
  put(plot.x + 2, 64, plot.z, wall);
  put(plot.x, 64, plot.z + 1, wall);
  put(plot.x + 2, 64, plot.z + 1, wall);
  put(plot.x, 64, plot.z + 2, wall);
  put(plot.x + 1, 64, plot.z + 2, wall);
  put(plot.x + 2, 64, plot.z + 2, wall);
  put(plot.x + 1, 64, plot.z + 2, "oak_door");
  put(plot.x + 1, 64, plot.z, "red_bed");
  put(plot.x, 64, plot.z + 1, "glass_pane");
  put(plot.x + 2, 64, plot.z + 1, "torch");
  return [...cells.values()];
}

/** 五块主线地块：前三栋橡木房、第四栋换屋顶、第五块是验收数据里的地块。 */
const MAIN_PLOTS: Plot[] = [
  { x: 0, z: 0, style: "oak" },
  { x: 12, z: 0, style: "oak" },
  { x: 24, z: 0, style: "oak" },
  { x: 0, z: 14, style: "spruce" },
  { x: 24, z: 14, style: "brick" },
];
const signsOf = (plots: Plot[]): Pos[] => plots.map(p => [p.x + 1, 64, p.z + 3]);
/** 井台与井水：谁都不许往这里摆方块（保护点）。 */
const WELL: Pos[] = [
  [12, 64, 9],
  [13, 64, 9],
  [12, 64, 10],
  [13, 64, 10],
  [12, 63, 9],
  [13, 63, 9],
];
const MATERIAL_BUDGET = 5 * 30; // 一栋 30 格 × 五栋：花超了就说明有重摆/乱摆

/**
 * 真实坐标与真实机位核对（Lead 返工两次的根因）：
 * `scripts/scene-shot.mjs` 的取景公式是固定的：
 *   base = session.status.playerSpawn（缺省 center）→ cam = [base.x, groundY + 4, base.z + 14]，yaw=180（朝北）、pitch=10（俯 10°）。
 * 而 playerSpawn = arena 中心、arena = prepare 里 clearRegion 的 from/to（paper-port deriveArena 优先用 recorded clearFrom/To）。
 * 本关把 clearRegion 设成 L05_CLEAR（中心恰为 (12,0)），于是：
 *   playerSpawn = (12, groundY=64, 0)，机位 = (12, 68, 14)，朝北俯 10°、fov 70、aspect 1.6。
 * 五块地西北角仍是 (0,0)(12,0)(24,0)(0,14)(24,14)；工棚改在 (-14..-8, -14..-8)，
 * 半成品房改在 (-8..-2, -22..-16)——两者都在上述机位的画面锥内（见 L05_CAM）。
 * 地面层 floorY=63（deriveGroundY=64 → 插件 floorY=63），所有立体道具从 y63 地板往上摆。
 */
export const L05_SCENE = {
  time: 6000,
  floorY: 63,
  groundY: 64,
  shed: { min: [-12, 63, -13] as Pos, max: [-6, 67, -7] as Pos, center: [-9, 65, -10] as Pos },
  halfBuilt: { min: [2, 63, -22] as Pos, max: [8, 67, -16] as Pos, center: [5, 65, -19] as Pos },
  landmarkRoof: [5, 67, -19] as Pos,
  banner: [-12, 67, -13] as Pos,
  warmLights: [
    [6, 66, 2],
    [18, 66, 2],
    [-4, 66, -4],
    [30, 66, -4],
    [-11, 66, -13],
    [-7, 66, -13],
    [5, 65, -22],
    [-9, 63, -10],
    [-5, 66, 10],
    [21, 66, 10],
  ] as Pos[],
  craftsmen: ["木匠阿岩", "石匠阿灰", "学徒小穗"],
};

/** arena 从/到：中心 (12,0) → playerSpawn=(12,64,0) → scene-shot 机位 (12,68,14)。 */
export const L05_CLEAR = { from: [-18, 55, -26] as Pos, to: [44, 85, 22] as Pos };

/** scene-shot.mjs 当前固定取景公式（机位 = playerSpawn + (0, groundY+4 的 +4, +14)，yaw 180 / pitch 10）。 */
export const L05_CAM = {
  spawnCenter: [13, -2] as [number, number],
  pos: [13, 68, 12] as Pos,
  yaw: 180,
  pitch: 10,
  fovDeg: 70,
  aspect: 1.6,
};

/** 主路走廊（3 格宽，真实地面以上 y64–67 净空）：主路、前门支路、南环道。 */
export const L05_CORRIDOR = [
  { x0: -18, z0: 6, x1: 42, z1: 6 },
  { x0: 1, z0: 6, x1: 1, z1: 3 },
  { x0: 13, z0: 6, x1: 13, z1: 3 },
  { x0: 25, z0: 6, x1: 25, z1: 3 },
  { x0: -18, z0: 20, x1: 42, z1: 20 },
  { x0: 1, z0: 20, x1: 1, z1: 18 },
  { x0: 13, z0: 20, x1: 13, z1: 18 },
  { x0: 25, z0: 20, x1: 25, z1: 18 },
];

const corridorCells = (): Set<string> => {
  const cells = new Set<string>();
  for (const seg of L05_CORRIDOR) {
    const dx = Math.sign(seg.x1 - seg.x0);
    const dz = Math.sign(seg.z1 - seg.z0);
    const steps = Math.max(Math.abs(seg.x1 - seg.x0), Math.abs(seg.z1 - seg.z0));
    for (let i = 0; i <= steps; i++) {
      const x = seg.x0 + dx * i;
      const z = seg.z0 + dz * i;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        if (ox !== 0 && oz !== 0) continue;
        for (let y = 63; y <= 68; y++) cells.add(`${x + ox},${y},${z + oz}`);
      }
    }
  }
  return cells;
};

/** 一摞原木/木板：底层 y63 起往上叠。 */
const stack = (x: number, z: number, block: string, layers: number): Array<{ pos: Pos; block: string }> => {
  const out: Array<{ pos: Pos; block: string }> = [];
  for (let y = 63; y < 63 + layers; y++) out.push({ pos: [x, y, z], block });
  return out;
};

const L05_BASE: LevelDef = defineLevel({
  id: "L05",
  meta: {
    id: "L05",
    title: { zh: "一百座房子", en: "A Hundred Houses" },
    act: 2,
    order: 5,
    priority: "P0",
    prerequisites: ["L04"],
    estimatedMinutes: 15,
    difficulty: 4,
    abstractions: ["A5", "A6"],
    objectives: [
      { id: "o-reuse", learnerView: "同一栋房子的动作只写一次，用参数换位置、换风格", evidence: { kind: "machine", ref: "houses-built" } },
      { id: "o-param", learnerView: "参数是每次不一样的地方，函数体是每次都一样的过程", evidence: { kind: "machine", ref: "styles-follow" } },
      { id: "o-return", learnerView: "函数可以带回一个结果，调用的人不用知道里面怎么算", evidence: { kind: "machine", ref: "signs-ready" } },
    ],
    misconceptions: ["copy-paste-is-reuse", "params-are-global", "style-is-a-position", "budget-is-infinite"],
    apiIntroduced: ["world.plot", "golem.fill", "golem.placeSign"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.plot", "golem.fill", "golem.placeSign"],
    syntaxIntroduced: ["function 声明与返回", "参数", "类型注解（number/string）", "export/import（D15）"],
    reward: { rune: "A5", advancement: "loomcraft/act2/hundred_houses", codexPage: "A5" },
    languageLevel: "act2",
  },
  world: {
    vars: {
      plots: MAIN_PLOTS.map(p => ({ ...p })),
      signs: signsOf(MAIN_PLOTS),
      protected: WELL.map(p => [...p]),
      materialBudget: MATERIAL_BUDGET,
      eira: [22, 65, 8],
      challengePlots: [
        { x: -40, z: -30, style: "brick" },
        { x: -28, z: -30, style: "spruce" },
        { x: -16, z: -30, style: "oak" },
        { x: -40, z: -18, style: "spruce" },
        { x: -16, z: -18, style: "brick" },
      ],
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "villager", role: "npc", id: "newcomers", name: "搬来的村民" },
      { type: "villager", role: "npc", id: "carpenter", name: "木匠阿岩" },
      { type: "villager", role: "npc", id: "mason", name: "石匠阿灰" },
      { type: "villager", role: "npc", id: "apprentice", name: "学徒小穗" },
    ],
  },
  code: {
    expectedLoc: 60,
    starterCode: `// 五块地的数据在 world.vars.plots 里：每块地有 x、z（西北角）和 style（屋顶风格）。
// 每栋房的摆法（照这个位置一格一格摆）：
//   地基：从 (x, 63, z) 起的 3×3 圆石；
//   墙：一圈 8 格（y64），材料按风格：橡木→oak_planks、云杉→spruce_planks、砖→bricks；
//   屋顶：3×3（y65），材料按风格：橡木→oak_slab、云杉→spruce_slab、砖→stone_brick_slab；
//   门 (x+1, 64, z+2) 放 oak_door；床 (x+1, 64, z) 放 red_bed；
//   窗 (x, 64, z+1) 放 glass_pane；火把 (x+2, 64, z+1) 放 torch。
// 现在只铺了一号地的地基，后面四块地还没动。
const p = world.vars.plots[0]
golem.moveTo(p.x + 1, p.z + 1)
golem.place("cobblestone", p.x, 63, p.z)
golem.place("cobblestone", p.x + 1, 63, p.z)
golem.place("cobblestone", p.x + 2, 63, p.z)
golem.place("cobblestone", p.x, 63, p.z + 1)
golem.place("cobblestone", p.x + 1, 63, p.z + 1)
golem.place("cobblestone", p.x + 2, 63, p.z + 1)
golem.place("cobblestone", p.x, 63, p.z + 2)
golem.place("cobblestone", p.x + 1, 63, p.z + 2)
golem.place("cobblestone", p.x + 2, 63, p.z + 2)

// TODO 第一阶段：把墙、屋顶、门窗床火把也摆上，再照做二、三号地。
// TODO 第二阶段：第四块地是变体，屋顶材料要跟着 style 走。
// TODO 第三阶段：第五块地的位置和风格验收时才定，也只能用同一段写法。
`,
    referenceSolution: `// 第一阶段：把一栋房的摆法写成一个有名字的函数，前三块地各调用一次
const plots = world.vars.plots

function wallOf(style) {
  if (style === "spruce") { return "spruce_planks" }
  if (style === "brick") { return "bricks" }
  return "oak_planks"
}

function roofOf(style) {
  if (style === "spruce") { return "spruce_slab" }
  if (style === "brick") { return "stone_brick_slab" }
  return "oak_slab"
}

// 一栋房的布点计划：函数只算「摆在哪、摆什么」，具体动手留给下面的循环
function hutPlan(x, z, style) {
  const cells = []
  const wall = wallOf(style)
  const slab = roofOf(style)
  for (let dx = 0; dx < 3; dx = dx + 1) {
    for (let dz = 0; dz < 3; dz = dz + 1) {
      cells.push(["cobblestone", x + dx, 63, z + dz])
      cells.push([slab, x + dx, 65, z + dz])
    }
  }
  cells.push([wall, x, 64, z])
  cells.push([wall, x + 1, 64, z])
  cells.push([wall, x + 2, 64, z])
  cells.push([wall, x, 64, z + 1])
  cells.push([wall, x + 2, 64, z + 1])
  cells.push([wall, x, 64, z + 2])
  cells.push([wall, x + 1, 64, z + 2])
  cells.push([wall, x + 2, 64, z + 2])
  cells.push(["oak_door", x + 1, 64, z + 2])
  cells.push(["red_bed", x + 1, 64, z])
  cells.push(["glass_pane", x, 64, z + 1])
  cells.push(["torch", x + 2, 64, z + 1])
  return cells
}

for (let i = 0; i < 3; i = i + 1) {
  const plot = plots[i]
  const plan = hutPlan(plot.x, plot.z, plot.style)
  // 走到地块门口再动手：先到南边的路，再到门口（z+3），站在屋外就不会被自己盖的墙关住
  golem.moveTo(plot.x + 1, plot.z + 6)
  golem.moveTo(plot.x + 1, plot.z + 3)
  for (let c = 0; c < plan.length; c = c + 1) {
    const cell = plan[c]
    golem.place(cell[0], cell[1], cell[2], cell[3])
  }
}
golem.say("前三栋立起来了。")

// 第二阶段：第四栋换屋顶的变体，同一段写法再调用一次
const fourth = plots[3]
const plan4 = hutPlan(fourth.x, fourth.z, fourth.style)
golem.moveTo(13, 6)
golem.moveTo(13, 18)
golem.moveTo(13, 20)
golem.moveTo(fourth.x + 1, fourth.z + 6)
golem.moveTo(fourth.x + 1, fourth.z + 3)
for (let c = 0; c < plan4.length; c = c + 1) {
  const cell = plan4[c]
  golem.place(cell[0], cell[1], cell[2], cell[3])
}
golem.say("第四栋换了屋顶。")

// 第三阶段：第五块地验收时才定位置和风格，照样用同一页写法
const fifth = plots[4]
const plan5 = hutPlan(fifth.x, fifth.z, fifth.style)
golem.moveTo(fifth.x + 1, fifth.z + 6)
golem.moveTo(fifth.x + 1, fifth.z + 3)
for (let c = 0; c < plan5.length; c = c + 1) {
  const cell = plan5[c]
  golem.place(cell[0], cell[1], cell[2], cell[3])
}
golem.say("五栋房子都立起来了。")
`,
  },
  task: {
    mainTask: "用同一份造房写法造出五栋房子，每栋门口挂一块门牌。",
    makeTask: "把造房拆成六个有名字的小步骤，主程序只负责读地块和调用。",
    playerBeat: "五块门牌由你亲手挂到门口（织者之印）。",
    playerBeatHint: "手持门牌，对五块门口各按右键",
    successCriteria: [
      {
        id: "houses-built",
        text: "五块地各有一栋能住人的房子",
        check: g => plotList(g.var("plots")).every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block)),
      },
      {
        id: "styles-follow",
        text: "每栋房子的墙和屋顶材料跟着地块风格走",
        check: g => plotList(g.var("plots")).every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block)),
      },
      {
        id: "budget-kept",
        text: "用掉的方块不超总预算，也不算错重摆",
        check: g => {
          // 同一个格子只算一次：不重置连续跑两遍时，重复摆同一格不能把预算判超。
          const distinct = new Set(agentPlaces(g).filter(e => !!e.pos).map(e => e.pos!.join(",")));
          return distinct.size <= Number(g.var("materialBudget"));
        },
      },
      {
        id: "signs-ready",
        text: "五块门牌都由你亲手挂到门口",
        check: g => {
          const signs = posList(g.var("signs"));
          const placed = playerPlaces(g);
          return signs.every(s => g.block(s).id === C + "oak_sign" && placed.some(e => samePos(e.pos, s)));
        },
      },
      {
        id: "well-untouched",
        text: "没有往井台边上摆方块",
        check: g => {
          const well = posList(g.var("protected"));
          return agentPlaces(g).every(e => !well.some(w => samePos(e.pos, w)));
        },
      },
    ],
    hiddenTests: [
      {
        id: "h-layout-generic",
        name: "换个地块位置、换一组风格，五栋房仍然全对",
        setup: { note: "验收会把地块整体挪走并打乱风格；写死坐标的程序必挂" },
        assertions: [
          {
            id: "h1a",
            text: "五块地按各自风格全部建好（含第五块）",
            check: g => {
              const plots = plotList(g.var("plots"));
              if (plots.length !== 5) return false;
              return plots.every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block));
            },
          },
          {
            id: "h1b",
            text: "每个地块的墙、屋顶材料与它自己的风格一致",
            check: g =>
              plotList(g.var("plots")).every(p => {
                const wall = C + wallBlock(p.style);
                const slab = C + roofBlock(p.style);
                return [p.x, p.x + 2].every(x => g.block([x, 64, p.z]).id === wall) && g.block([p.x, 65, p.z]).id === slab;
              }),
          },
        ],
      },
      {
        id: "h-no-extra-blocks",
        name: "只往地块里摆，不在别处乱放",
        setup: { note: "动手写死的程序在场景挪动后会把方块摆到地块外" },
        assertions: [
          {
            id: "h2a",
            text: "所有摆方块的动作都落在五块地的房子格内",
            check: g => {
              const allowed = new Set<string>();
              for (const p of plotList(g.var("plots"))) for (const c of hutCells(p)) allowed.add(c.pos.join(","));
              return agentPlaces(g).every(e => !!e.pos && allowed.has(e.pos.join(",")));
            },
          },
        ],
      },
    ],
  },
  narrative: {
    worldState: "村东的地空了一整天，三户人家和一对新婚夫妇的行李还堆在土路边；入夜前房子不立起来，今晚又有人要睡在井边。",
    opening: [
      "村东的地空了一整天，三户人家和一对新婚夫妇的行李还堆在土路边。",
      "用同一份造房写法，先立三栋橡木房，再立第四栋换过屋顶的变体，最后立验收时才定位置与风格的那一栋。",
      "屋梁的最后一块、门牌上的名字，得你亲手来；活人的手，织偶替不了。",
    ],
    whyYou: "屋梁的最后一块、门牌上的名字，得你亲手来；活人的手，织偶替不了。",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值；门牌是玩家节拍。
  progress: [
    {
      id: "l05-houses-built",
      text: "五块地各立起一栋能住的房子",
      check: g => plotList(g.var("plots")).every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block)),
    },
    {
      id: "l05-styles-follow",
      text: "每栋的墙和屋顶按地块样式走",
      check: g => plotList(g.var("plots")).every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block)),
    },
    {
      id: "l05-signs-ready",
      text: "五块门牌由你亲手挂到门口",
      player: true,
      check: g => {
        const signs = posList(g.var("signs"));
        const placed = playerPlaces(g);
        return signs.every(s => g.block(s).id === C + "oak_sign" && placed.some(e => samePos(e.pos, s)));
      },
    },
  ],
  phases: ["三栋橡木房", "第四栋换屋顶", "第五块地与门牌"],
});

/**
 * 挑战层（可跳过、不计星）：不复制粘贴。
 * 五块挑战地的位置与风格全换过一遍；主线那页房子写法要能原样复用，
 * 并且在预算内一格不多地立起来——写死坐标或复制整段的程序过不了。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L05_CHALLENGE: LevelChallenge = {
  id: "L05-no-copy-paste",
  title: "挑战：不复制粘贴",
  goal: "五块地都换了位置和风格，同一页造房写法要原样立起五栋",
  reference: `const plots = world.vars.challengePlots

function wallOf(style) {
  if (style === "spruce") { return "spruce_planks" }
  if (style === "brick") { return "bricks" }
  return "oak_planks"
}

function roofOf(style) {
  if (style === "spruce") { return "spruce_slab" }
  if (style === "brick") { return "stone_brick_slab" }
  return "oak_slab"
}

function hutPlan(x, z, style) {
  const cells = []
  const wall = wallOf(style)
  const slab = roofOf(style)
  for (let dx = 0; dx < 3; dx = dx + 1) {
    for (let dz = 0; dz < 3; dz = dz + 1) {
      cells.push(["cobblestone", x + dx, 63, z + dz])
      cells.push([slab, x + dx, 65, z + dz])
    }
  }
  cells.push([wall, x, 64, z])
  cells.push([wall, x + 1, 64, z])
  cells.push([wall, x + 2, 64, z])
  cells.push([wall, x, 64, z + 1])
  cells.push([wall, x + 2, 64, z + 1])
  cells.push([wall, x, 64, z + 2])
  cells.push([wall, x + 1, 64, z + 2])
  cells.push([wall, x + 2, 64, z + 2])
  cells.push(["oak_door", x + 1, 64, z + 2])
  cells.push(["red_bed", x + 1, 64, z])
  cells.push(["glass_pane", x, 64, z + 1])
  cells.push(["torch", x + 2, 64, z + 1])
  return cells
}

for (let i = 0; i < plots.length; i = i + 1) {
  const plot = plots[i]
  const plan = hutPlan(plot.x, plot.z, plot.style)
  golem.moveTo(plot.x + 1, plot.z + 1)
  for (let c = 0; c < plan.length; c = c + 1) {
    const cell = plan[c]
    golem.place(cell[0], cell[1], cell[2], cell[3])
  }
}
golem.say("挑战：五块新地也立起来了。")
`,
  check: g => {
    const plots = plotList(g.var("challengePlots"));
    const allowed = new Set<string>();
    for (const p of plots) for (const c of hutCells(p)) allowed.add(c.pos.join(","));
    const placements = agentPlaces(g);
    const complete = plots.every(p => hutCells(p).every(c => g.block(c.pos).id === C + c.block));
    return complete && placements.every(e => !!e.pos && allowed.has(e.pos.join(","))) && placements.length === MATERIAL_BUDGET;
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L05: LevelDef & { challenge: LevelChallenge } = Object.assign(L05_BASE, {
  challenge: L05_CHALLENGE,
});

/** MockWorld 场景：五块标过风格的地、井台、土路与营火装饰（数值见 spec §3）。 */
export const L05Content: LevelContent & { challenge: LevelChallenge } = {
  def: L05,
  challenge: L05_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const plots = plotList(vars.plots);
    const floorY = L05_SCENE.floorY;
    const art: Array<{ pos: Pos; block: string }> = [];
    const functional: Array<{ pos: Pos; block: string }> = [];

    // 真实底板 y63；净空保护：评分房格 y63–65、门牌位、井台、主路走廊 y63–68
    const plotCells = new Set<string>();
    for (const p of plots) {
      for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) for (let y = floorY; y <= floorY + 2; y++) plotCells.add(`${p.x + dx},${y},${p.z + dz}`);
      plotCells.add(`${p.x + 1},64,${p.z + 3}`);
    }
    const wellCells = new Set<string>(WELL.map(p => p.join(",")));
    const road = corridorCells();
    const blocked = (x: number, y: number, z: number): boolean => {
      const key = `${x},${y},${z}`;
      return plotCells.has(key) || wellCells.has(key) || road.has(key);
    };
    const putArt = (x: number, y: number, z: number, block: string): void => {
      if (!blocked(x, y, z)) art.push({ pos: [x, y, z], block });
    };
    const putMany = (cells: Array<{ pos: Pos; block: string }>): void => {
      for (const cell of cells) putArt(cell.pos[0], cell.pos[1], cell.pos[2], cell.block);
    };
    const putFloor = (x: number, z: number, block: string): void => {
      const key = `${x},${floorY},${z}`;
      if (plotCells.has(key) || wellCells.has(key)) return;
      art.push({ pos: [x, floorY, z], block });
    };
    const patch = (x0: number, x1: number, z0: number, z1: number, block: string): void => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) putFloor(x, z, block);
    };
    const path = (x0: number, z0: number, x1: number, z1: number): void => {
      for (const b of pathLine(x0, z0, x1, z1, floorY)) putFloor(b.pos[0], b.pos[2], b.block);
    };

    // 1) 地面：苔藓底 + 工地黄土 + 砂砾/圆石路；近景再铺一条木工台面
    patch(-16, 42, -24, 20, SCENE_PALETTE.ground);
    for (const p of plots) patch(p.x - 3, p.x + 6, p.z - 3, p.z + 6, "minecraft:coarse_dirt");
    patch(-16, 42, 5, 11, "minecraft:coarse_dirt");
    patch(8, 18, 8, 11, "minecraft:oak_planks");
    patch(-16, -4, -14, -6, "minecraft:coarse_dirt");
    patch(-10, 2, -22, -12, "minecraft:coarse_dirt");
    path(-16, 6, 42, 6);
    path(1, 6, 1, 3);
    path(13, 6, 13, 3);
    path(25, 6, 25, 3);
    path(-16, 20, 42, 20);
    path(1, 20, 1, 18);
    path(13, 20, 13, 18);
    path(25, 20, 25, 18);
    path(13, 12, 13, 6);
    path(13, 12, 13, 18);

    // 2) 五块地：脚手架 + 横梁 + 双黄幡 + 木料堆/干草/木桶/工作台（全部在地块外一格）
    for (const plot of plots) {
      const px = plot.x;
      const pz = plot.z;
      for (const [cx, cz] of [[px - 1, pz - 1], [px + 3, pz - 1], [px - 1, pz + 3], [px + 3, pz + 3]] as const) {
        for (let y = floorY; y <= floorY + 3; y++) putArt(cx, y, cz, "minecraft:spruce_log");
      }
      for (let x = px - 1; x <= px + 3; x++) putArt(x, 67, pz - 1, "minecraft:oak_planks");
      for (let z = pz - 1; z <= pz + 3; z++) {
        putArt(px - 1, 67, z, "minecraft:oak_planks");
        putArt(px + 3, 67, z, "minecraft:oak_planks");
      }
      putArt(px - 1, 67, pz - 1, "minecraft:yellow_wool");
      putArt(px + 3, 67, pz - 1, "minecraft:yellow_wool");
      putArt(px - 1, 66, pz - 1, "minecraft:yellow_wool");
      putMany(stack(px + 4, pz + 1, "minecraft:spruce_log", 3));
      putMany(stack(px + 4, pz + 2, "minecraft:oak_log", 2));
      putMany(stack(px + 5, pz + 2, "minecraft:oak_planks", 2));
      putArt(px + 4, floorY, pz + 3, "minecraft:hay_block");
      putArt(px + 5, floorY, pz + 1, "minecraft:hay_block");
      putArt(px + 5, floorY, pz + 3, "minecraft:barrel");
      putArt(px + 4, floorY + 1, pz + 3, "minecraft:barrel");
    }

    // 3) 机位正前方（z4–11）：左右两侧物料堆 + 木架黄幡，中间留出三条看地块的视线缝
    for (const [sx, sz] of [[-16, 6], [-12, 8], [-8, 5], [0, 8], [4, 5], [22, 5], [26, 8], [30, 5], [34, 8], [38, 5], [40, 8]] as const) {
      putMany(stack(sx, sz, "minecraft:spruce_log", 3));
      putMany(stack(sx + 1, sz, "minecraft:oak_log", 2));
      putMany(stack(sx, sz + 1, "minecraft:oak_planks", 2));
      putArt(sx + 1, floorY, sz + 1, "minecraft:barrel");
      putArt(sx + 2, floorY, sz, "minecraft:hay_block");
    }
    // 中景只放 1–2 格高的矮件，不挡左右两块地的脚手架
    for (const [lx, lz] of [[8, 9], [10, 7], [16, 9], [18, 7], [12, 10], [14, 10]] as const) {
      putArt(lx, floorY, lz, "minecraft:barrel");
      putArt(lx, floorY + 1, lz, "minecraft:hay_block");
    }
    for (const bx of [-14, -6, 2, 20, 28, 36] as const) {
      for (let y = floorY; y <= 66; y++) {
        putArt(bx, y, 10, "minecraft:spruce_log");
        putArt(bx + 3, y, 10, "minecraft:spruce_log");
      }
      putArt(bx, 67, 10, "minecraft:yellow_wool");
      putArt(bx + 3, 67, 10, "minecraft:yellow_wool");
      putArt(bx + 1, 67, 10, "minecraft:oak_planks");
      putArt(bx + 2, 67, 10, "minecraft:oak_planks");
      putArt(bx + 1, 66, 10, "minecraft:lantern");
    }
    // 近景中心只留 2 张工作台 + 矮桶，保证镜头下缘不出现一整块棋盘格台面
    for (const [tx, tz] of [[9, 10], [17, 10]] as const) putArt(tx, floorY + 1, tz, "minecraft:crafting_table");
    for (const [tx, tz] of [[11, 11], [13, 11], [15, 11]] as const) {
      putArt(tx, floorY, tz, "minecraft:barrel");
    }

    // 4) 工棚（地标一，左前方）：云杉木架 + 深色屋顶 + 黄幡 + 营火与吊灯
    for (let x = -12; x <= -6; x++) for (let z = -13; z <= -7; z++) putArt(x, floorY, z, "minecraft:spruce_planks");
    for (let x = -12; x <= -6; x++) {
      for (const z of [-13, -7]) {
        if (x === -9) continue;
        for (let y = 64; y <= 66; y++) putArt(x, y, z, "minecraft:spruce_planks");
        putArt(x, 67, z, "minecraft:spruce_planks");
      }
    }
    for (const z of [-12, -11, -10, -9, -8]) {
      if (z === -10) continue;
      for (let y = 64; y <= 66; y++) {
        putArt(-12, y, z, "minecraft:spruce_planks");
        putArt(-6, y, z, "minecraft:spruce_planks");
      }
    }
    for (let x = -13; x <= -5; x++) for (let z = -14; z <= -6; z++) putArt(x, 67, z, "minecraft:dark_oak_planks");
    putArt(-12, 67, -13, "minecraft:yellow_wool");
    putArt(-6, 67, -13, "minecraft:yellow_wool");
    putArt(-11, 66, -13, "minecraft:lantern");
    putArt(-7, 66, -13, "minecraft:lantern");
    putArt(-9, floorY, -10, "minecraft:campfire");
    putArt(-10, floorY, -9, "minecraft:barrel");
    putArt(-8, floorY, -9, "minecraft:hay_block");
    putArt(-9, 64, -7, "minecraft:oak_sign");

    // 5) 半成品房（地标二，正前方远处；正对一号地与二号地之间的视线缝）
    for (let x = 2; x <= 8; x++) for (let z = -22; z <= -16; z++) {
      const edge = x === 2 || x === 8 || z === -22 || z === -16;
      if (!edge) continue;
      putArt(x, floorY, z, x % 2 === 0 ? "minecraft:stone_bricks" : "minecraft:mossy_stone_bricks");
    }
    for (let x = 2; x <= 7; x++) for (let y = 64; y <= 66; y++) putArt(x, y, -22, "minecraft:oak_planks");
    for (let z = -22; z <= -19; z++) for (let y = 64; y <= 66; y++) putArt(2, y, z, "minecraft:oak_planks");
    for (const [cx, cz] of [[2, -22], [8, -22], [2, -16], [8, -16]] as const) {
      for (let y = floorY; y <= 66; y++) putArt(cx, y, cz, "minecraft:spruce_log");
    }
    for (let x = 2; x <= 8; x++) putArt(x, 67, -19, "minecraft:dark_oak_planks");
    putArt(5, 67, -19, "minecraft:dark_oak_planks");
    putArt(2, 66, -22, "minecraft:yellow_wool");
    putArt(5, 65, -22, "minecraft:lantern");
    putArt(5, floorY, -20, "minecraft:hay_block");

    // 6) 暖光：地块旁灯柱 + 画面左右两根高灯柱 + 地标吊灯/营火
    putMany(lampPost(6, 2, floorY));
    putMany(lampPost(18, 2, floorY));
    for (let y = floorY; y <= 66; y++) {
      putArt(-4, y, -4, "minecraft:spruce_log");
      putArt(30, y, -4, "minecraft:spruce_log");
    }
    putArt(-4, 67, -4, "minecraft:yellow_wool");
    putArt(30, 67, -4, "minecraft:yellow_wool");
    putArt(-4, 66, -4, "minecraft:lantern");
    putArt(30, 66, -4, "minecraft:lantern");
    for (const [tx, tz] of [[2, -24], [26, -24], [38, -6], [-16, 14]] as const) putMany(tree(tx, tz, floorY));

    // 7) 花与灌木点缀（稳定方块，不种树叶方块）；只铺地面层，不挡人
    for (const [fx, fz] of [[-6, 3], [8, 3], [16, 3], [28, 3], [38, 3], [-16, 3], [4, 8], [22, 9], [34, 10], [-4, -6], [2, -14], [20, -14], [6, 12], [20, 12]] as const) {
      putFloor(fx, fz, SCENE_PALETTE.flowers[(fx + fz + 100) % SCENE_PALETTE.flowers.length]);
    }
    putArt(-6, 64, -7, "minecraft:flower_pot");
    putArt(30, floorY, 16, "minecraft:barrel");
    putArt(0, floorY, -4, "minecraft:barrel");

    // 功能块（评分相关，最后写入，确保覆盖任何误放的美术块）
    for (const p of plots) {
      const wool = p.style === "spruce" ? "brown_wool" : p.style === "brick" ? "orange_wool" : "white_wool";
      functional.push({ pos: [p.x - 1, floorY, p.z + 1], block: wool });
    }
    functional.push({ pos: [12, floorY, 9], block: "cobblestone" });
    functional.push({ pos: [13, floorY, 9], block: "cobblestone" });
    functional.push({ pos: [12, floorY, 10], block: "water" });
    functional.push({ pos: [13, floorY, 10], block: "water" });

    await port.clearRegion(L05_CLEAR.from, L05_CLEAR.to);
    await port.setBlocks([...art, ...functional]);
    await port.setTime(L05_SCENE.time);
    await port.setWeather("clear");
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [20, 64, 6], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "villager", id: "newcomers", name: "搬来的村民", pos: [-4, 64, 10], role: "prop" });
    await port.spawnEntity({ type: "villager", id: "carpenter", name: "木匠阿岩", pos: [2, 64, 4], role: "npc" });
    await port.spawnEntity({ type: "villager", id: "mason", name: "石匠阿灰", pos: [16, 64, 4], role: "npc" });
    await port.spawnEntity({ type: "villager", id: "apprentice", name: "学徒小穗", pos: [26, 64, -4], role: "npc" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:oak_sign", 8);
  },
  async playerBeat(port) {
    // 织者之印：五块门牌由你亲手挂到门口（真实 MC 里还要在门牌上写户名）。
    for (const sign of posList(port.world.vars.signs)) {
      await port.playerPlace("oak_sign", pos(sign));
    }
  },
};
