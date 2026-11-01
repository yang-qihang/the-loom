/**
 * L03 — 岔路与钟声（MockWorld 版）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准：织偶（不会猜你意思的工匠）、符文（一句只做一件事的短句）、
 * 散线（让东西忘记自己是啥的灰白线头）、织者之印（只有活人手能完成的最后一步）。
 * 数值与教学意图以 content/levels/L03-bell-at-dusk.md 为准（A3 分支）。
 *
 * T1 MockWorld 学生面只有 golem.moveTo/place/say/pos 与只读 world.vars
 * （docs/21 §2；docs/12 的 world.scenario / countEntities / ringBell / placeTorch 尚未接线），
 * 因此本文件用「等价动作」实现：
 *   今晚剧本 = world.vars.scenario（字段同 registry 的 Scenario：threat/trapped/gateOpen）
 *   敲钟    = 走到钟边 place("bell", 钟坐标)（真实 MC 里是 golem.ringBell()）
 *   点火把  = 走到暗处 place("torch", 坐标)（真实 MC 里是 golem.placeTorch(x, z)）
 *   堵北门  = 走到门口 place("cobblestone", 门坐标)
 *   敲晨钟  = 玩家节拍：playerPlace("bell", 钟坐标)（actorType=player，不算守夜钟声）
 * 真实 Paper 版接线后，学生代码换成 world.scenario / golem.ringBell / golem.placeTorch，
 * 剧本数据与判定不变。
 */
import { defineLevel, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import type { ContentCopy } from "./L01.content";
import { banner, fenceLine, groundPatch, lampPost, pathLine, SCENE_PALETTE } from "../scenes/scene-kit";

type Pos = [number, number, number];
const C = "minecraft:";

const pos = (p: unknown): Pos => p as Pos;
const posList = (p: unknown): Pos[] => p as Pos[];
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const blockOf = (e: { data?: Record<string, unknown> }): string => String(e.data?.block ?? "");
const agentPlaces = (g: GraderApi, block: string) =>
  g.events("block.place").filter(e => e.actorType === "agent" && blockOf(e) === C + block);
const nearAny = (g: GraderApi, targets: Pos[], radius = 2): boolean =>
  g.events("agent.move").some(e => !!e.pos && targets.some(t => Math.hypot(e.pos![0] - t[0], e.pos![2] - t[2]) <= radius));

export type Scenario = { night: number; threat: number; trapped: boolean; gateOpen: boolean };

/** 五夜：前三夜是主线试炼，第四夜是验收组合，第五夜是挑战层。 */
export const SCENARIOS: Scenario[] = [
  { night: 1, threat: 0, trapped: false, gateOpen: false }, // 第一夜 · 安静
  { night: 2, threat: 3, trapped: false, gateOpen: false }, // 第二夜 · 北门
  { night: 3, threat: 2, trapped: true, gateOpen: false }, // 第三夜 · 井边
  { night: 4, threat: 2, trapped: true, gateOpen: true }, // 第四夜 · 组合（hiddenOnly）
  { night: 5, threat: 5, trapped: true, gateOpen: true }, // 第五夜 · 挑战（两处威胁）
];

const scenarioOf = (g: GraderApi): Scenario => g.var("scenario") as Scenario;

/** 内容层文案：剧本卡统一叫「上面三张卡」，入口统一写「运行」，铁傀儡不是灰崽（FR-020/021/022）。 */
export const L03_COPY: ContentCopy = {
  coordinateRule: "括号里的两个数是横着第几格、前后第几格；先写 moveTo 让灰崽走过去，再用 place 放灯或敲钟。",
  golemNote: "golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶；铁傀儡不是灰崽，它是村里的守卫。",
  cards: { title: "接下来三夜的剧本", headers: ["第 1 夜（今晚）", "第 2 夜", "第 3 夜"] },
  entry: "写完点底部的「运行」，开始这三夜的试炼。",
  hints: [
    "先看上面三张卡：哪一夜有威胁？哪一夜有人被困？北门开着吗？",
    "三种夜对应三个分支：有人被困、有僵尸、什么都没有。",
    "救人的分支里，先问有没有僵尸，再去井边，最后把人带回门口。",
  ],
  errors: [
    {
      line: 8,
      reason: "第 8 行没有先看剧本：安静的夜里敲钟会把全村吵醒。",
      fix: "先在 if 里判断今晚有没有威胁，再决定敲不敲钟。照抄：",
      sample: "if (s.threat > 0) {",
    },
    {
      line: 9,
      reason: "第 9 行条件写反了：有僵尸才敲钟，没有僵尸不该敲。",
      fix: "把 0 改成 1 以上的数，或者把比较反过来。照抄：",
      sample: 'if (s.threat > 0) { golem.place("bell", 0, 65, 0) }',
    },
    {
      line: 11,
      reason: "第 11 行少了引号：剧本里写的是字符串，要带引号。",
      fix: "把 zombie 用英文双引号包起来。照抄：",
      sample: 'if (s.threat > 0) {',
    },
    {
      line: 14,
      reason: "第 14 行少了一段「不是这样就……」——代码里就是 else；安静的夜也要点亮暗处的灯。",
      fix: "在 if 后面补一段 else，写安静夜要做的事。照抄：",
      sample: '} else { golem.place("torch", -8, 65, 2) }',
    },
    {
      line: 18,
      reason: "第 18 行只走到门口：有人被困时，灰崽要先去井边，再把人带回门口。",
      fix: "先去井边（-4, 18），再去门口（6, 22）。照抄：",
      sample: "golem.moveTo(-4, 18)",
    },
    {
      line: 22,
      reason: "第 22 行顺序反了：先救人，再敲钟，最后堵门。",
      fix: "把救人的那一段挪到最前面。照抄：",
      sample: "golem.moveTo(6, 22)",
    },
  ],
  timeout: "灰崽走了很久还没走完，八成是同一步在绕圈。按「重置」再来一遍，看看哪一段被重复写了。",
};

/**
 * L03 场景美术（docs/35 夜晚村口/钟楼 pass）。
 * 时间锁 18000（深夜）；冷蓝夜色（soul_lantern / blue_wool / blue_ice / 水面）+ 火把橙暖光
 * （lantern / campfire / 灯柱火把）+ 石砖与深色木；地标：钟楼、北门、井、四户人家、八灯柱、东墙散线。
 * 只读 SceneKit 构件（groundPatch / pathLine / lampPost / villageHouse / fenceLine / banner），
 * 全部方块均为稳定方块（不用 grass_block / oak_leaves）。
 */
export const L03_SCENE = {
  time: 13100, // 黄昏/初夜（Lead 反馈：不要全黑 18000；范围 13000–15000）
  weather: "clear" as const,
  groundY: 64,
  materials: ["moss_block", "coarse_dirt", "stone_bricks", "mossy_stone_bricks", "spruce_planks", "dark_oak_planks", "glass_pane", "blue_wool"],
  lights: { warm: ["lantern", "campfire", "shroomlight"], cold: ["soul_lantern"] },
  landmarks: ["钟楼", "八根灯柱", "四户人家", "井", "北门", "东墙散线"],
  /** 主机位：站在南侧集市路口，一屏看全广场（钟楼居中、灯柱环、四户人家两侧、井在左前）。 */
  mainCamera: { pos: [0, 72, 24], lookAt: [0, 68, 0], time: 13100, fov: 75 },
  /** 主机位一屏内应看到的东西（Lead 重拍时按这个清单对）。 */
  expectedVisible: [
    "钟楼：居中的石砖四柱 + 深色木梁/屋顶 + 檐下暖灯（冷蓝顶灯在最高处）",
    "八根灯柱：环广场一圈的石砖柱，柱顶留空给灰崽点火把，灯柱旁各有一盏暖灯",
    "四户人家：广场两侧的深色木屋，玻璃窗透暖光，屋檐挂着灯笼",
    "井：左前方的石砖井台 + 木棚 + 暖灯",
    "暖光：南侧集市两排灯笼 + 广场两处营火 + 屋檐灯（整体偏暖，不是纯黑夜景）",
    "背景：右后方北门（石砖门柱 + 橙幡），最右侧东墙散线（蛛网 + 灰白羊毛）",
  ],
  screenshotSpots: [
    { name: "主视角：广场钟楼、八灯柱与四户人家", pos: [0, 72, 24], lookAt: [0, 68, 0], time: 13100 },
    { name: "钟楼近景", pos: [-8, 67, 12], lookAt: [0, 67, 0], time: 13100 },
    { name: "南侧集市与灯列", pos: [-4, 67, 26], lookAt: [0, 65, 12], time: 13100 },
    { name: "北门与东墙散线", pos: [4, 67, -14], lookAt: [14, 65, -4], time: 13100 },
  ],
} as const;

const L03_BASE: LevelDef = defineLevel({
  id: "L03",
  meta: {
    id: "L03",
    title: { zh: "岔路与钟声", en: "The Bell at Dusk" },
    act: 1,
    order: 3,
    priority: "P0",
    prerequisites: ["L02"],
    estimatedMinutes: 12,
    difficulty: 2,
    abstractions: ["A3"],
    objectives: [
      { id: "o-scenario", learnerView: "先读今晚的情况，再决定做什么", evidence: { kind: "machine", ref: "read-scenario" } },
      { id: "o-if", learnerView: "用 if / else if / else 让同一个程序在不同夜晚做不同的事", evidence: { kind: "machine", ref: "night-handled" } },
      { id: "o-priority", learnerView: "麻烦一起来时按优先级：先救人、再敲钟、最后堵门", evidence: { kind: "machine", ref: "player-dawn-bell" } },
    ],
    misconceptions: ["fixed-action-every-night", "bell-is-ritual", "condition-inverted", "skip-lamps"],
    apiIntroduced: ["world.scenario", "world.countEntities", "golem.ringBell", "golem.placeTorch"],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.scenario", "world.countEntities", "golem.ringBell", "golem.placeTorch"],
    syntaxIntroduced: ["if / else if / else", "比较运算（> 与 ===）", "逻辑与（&&）"],
    reward: { rune: "A3", advancement: "loomcraft/act1/bell_at_dusk", codexPage: "A3" },
    languageLevel: "act1",
  },
  world: {
    vars: {
      scenarioIndex: 1,
      // RT-03：world.vars 是冻结只读副本，运行时数据必须在 def 里静态声明（测试克隆 def 换 scenario）
      scenario: { night: 2, threat: 3, trapped: false, gateOpen: false },
      bell: [0, 65, 0],
      gate: [14, 65, -6],
      well: [-4, 65, 18],
      door: [6, 65, 22],
      eastWall: [22, 65, 2], // 第五夜（挑战）的第二处威胁
      // 村口八根灯柱：夜里得有光，散线才退得慢
      lamps: [[-8, 65, 2], [8, 65, 2], [-14, 65, -2], [14, 65, 2], [-6, 65, 10], [6, 65, 10], [-12, 65, -8], [12, 65, -8]],
      // 四户人家的门（夜里逐户送火把）
      houses: [[-1, 65, 4], [5, 65, 12], [-6, 65, 8], [10, 65, 14]],
      eira: [0, 65, 6],
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
    ],
  },
  code: {
    expectedLoc: 58,
    starterCode: `// 上面三张卡就是今晚的剧本：安静夜、北门有僵尸、井边有人被困。
// 程序读到的，就是这三张卡写的事。
// 铁傀儡不是灰崽：它是村里的守卫；灰崽是你写符文驱动的织偶。
// 这张卡说的三件事，就是下面三个分支。
const s = world.vars.scenario

// 今晚有威胁：先敲钟，再去北门守着
if (s.threat > 0) {
  golem.place("bell", 0, 65, 0)
  golem.moveTo(14, -6)
}

// 剩下两段你来补。
// 有人被困的夜里，灰崽要先到井边，再把人带回门口。
// 一个威胁都没有的夜里，把暗处的灯点亮，八根灯柱补齐。
// 最后从北门绕到井边、钟楼看一圈，回艾拉身边报平安。
`,
    referenceSolution: `const s = world.vars.scenario

// 阶段一：守夜——先看今晚是什么夜
if (s.trapped) {
  golem.moveTo(-4, 18)
  golem.moveTo(6, 22)
  if (s.threat > 0) {
    golem.moveTo(0, 0)
    golem.place("bell", 0, 65, 0)
  }
} else if (s.threat > 0) {
  golem.moveTo(0, 0)
  golem.place("bell", 0, 65, 0)
  golem.moveTo(14, -6)
}

// 阶段二：把村口八根灯柱全部点亮
golem.moveTo(-8, 2)
golem.place("torch", -8, 65, 2)
golem.moveTo(8, 2)
golem.place("torch", 8, 65, 2)
golem.moveTo(-14, -2)
golem.place("torch", -14, 65, -2)
golem.moveTo(14, 2)
golem.place("torch", 14, 65, 2)
golem.moveTo(-6, 10)
golem.place("torch", -6, 65, 10)
golem.moveTo(6, 10)
golem.place("torch", 6, 65, 10)
golem.moveTo(-12, -8)
golem.place("torch", -12, 65, -8)
golem.moveTo(12, -8)
golem.place("torch", 12, 65, -8)

// 阶段三：逐户送火把（散线重的地方，人家门口不敢熄灯）
golem.moveTo(-1, 4)
golem.place("torch", -1, 65, 4)
golem.say("第一家：门口有光了")
golem.moveTo(5, 12)
golem.place("torch", 5, 65, 12)
golem.say("第二家：门口有光了")
golem.moveTo(-6, 8)
golem.place("torch", -6, 65, 8)
golem.say("第三家：门口有光了")
golem.moveTo(10, 14)
golem.place("torch", 10, 65, 14)
golem.say("第四家：门口有光了")

// 阶段四：北门被撞开就堵上，然后巡查三处
if (s.gateOpen) {
  golem.moveTo(14, -6)
  golem.place("cobblestone", 14, 65, -6)
}
golem.moveTo(-4, 18)
golem.say("井边：平安")
golem.moveTo(14, -6)
golem.say("北门：平安")
golem.moveTo(0, 0)
golem.say("钟楼：平安")

// 收岗：回艾拉身边
golem.moveTo(0, 6)
golem.say("三夜平安，天亮收岗")
`,
  },
  task: {
    mainTask: "先看上面三张剧本卡，按剧本守一夜：有威胁就敲钟，有人被困先救人，再把八根灯柱和四户人家的门口点亮，最后回艾拉身边报平安。",
    makeTask: "第四夜三件事一起来：先敲钟，再救人，最后把北门堵上。",
    playerBeat: "天亮后你亲手敲钟；灰崽敲的不算守夜钟声。",
    playerBeatHint: "对着钟楼按右键敲钟，不用找钟本体",
    successCriteria: [
      {
        id: "read-scenario",
        text: "先看上面三张剧本卡",
        check: g => {
          const s = scenarioOf(g);
          const rang = agentPlaces(g, "bell").length > 0;
          return s.threat > 0 ? rang : !rang;
        },
      },
      {
        id: "night-handled",
        text: "守好夜、补齐灯柱和人家门口",
        check: g => {
          const s = scenarioOf(g);
          const litLamps = posList(g.var("lamps")).every(p => g.block(p).id === C + "torch");
          const litHouses = posList(g.var("houses")).every(p => g.block(p).id === C + "torch");
          const rescueOk = !s.trapped || (nearAny(g, [pos(g.var("well"))]) && nearAny(g, [pos(g.var("door"))]));
          const gateSealed = g.block(pos(g.var("gate"))).id === C + "cobblestone";
          const gateOk = !s.gateOpen || gateSealed;
          return litLamps && litHouses && rescueOk && gateOk;
        },
      },
      {
        id: "player-dawn-bell",
        text: "天亮后你亲手敲钟",
        check: g =>
          g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, pos(g.var("bell")))),
      },
    ],
    hiddenTests: [
      {
        id: "h-combo",
        name: "第四夜：三件事一起处理",
        setup: { scenarioIndex: 3, note: "僵尸 + 村民被困 + 北门被撞开（只在验收时出现）" },
        assertions: [
          {
            id: "combo-handled",
            text: "钟响、村民被救回、北门被堵上",
            check: g => {
              const s = scenarioOf(g);
              if (!s.trapped || !s.gateOpen) return true;
              return (
                agentPlaces(g, "bell").length > 0 &&
                nearAny(g, [pos(g.var("well"))]) &&
                nearAny(g, [pos(g.var("door"))]) &&
                g.block(pos(g.var("gate"))).id === C + "cobblestone"
              );
            },
          },
        ],
      },
      {
        id: "h-no-stray",
        name: "只动该动的方块，不乱放",
        setup: { note: "把火把插到屋顶、把圆石乱丢会在这里失败" },
        assertions: [
          {
            id: "only-allowed-placements",
            text: "织偶的放置只发生在钟、灯柱、人家门口和北门",
            check: g => {
              const allowed = [
                pos(g.var("bell")),
                pos(g.var("gate")),
                ...posList(g.var("lamps")),
                ...posList(g.var("houses")),
              ];
              return g
                .events("block.place")
                .filter(e => e.actorType === "agent")
                .every(e => allowed.some(p => samePos(e.pos, p)));
            },
          },
        ],
      },
    ],
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值。
  progress: [
    {
      id: "l03-read-scenario",
      text: "看剧本：有威胁才敲守夜钟",
      check: g => {
        const s = scenarioOf(g);
        const rang = agentPlaces(g, "bell").length > 0;
        return s.threat > 0 ? rang : !rang;
      },
    },
    {
      id: "l03-night-handled",
      text: "按剧本救人、点灯、堵好北门",
      check: g => {
        const s = scenarioOf(g);
        const litLamps = posList(g.var("lamps")).every(p => g.block(p).id === C + "torch");
        const litHouses = posList(g.var("houses")).every(p => g.block(p).id === C + "torch");
        const rescueOk = !s.trapped || (nearAny(g, [pos(g.var("well"))]) && nearAny(g, [pos(g.var("door"))]));
        const gateSealed = g.block(pos(g.var("gate"))).id === C + "cobblestone";
        const gateOk = !s.gateOpen || gateSealed;
        return litLamps && litHouses && rescueOk && gateOk;
      },
    },
    {
      id: "l03-dawn-bell",
      text: "天亮后，你亲手敲响钟",
      player: true,
      check: g =>
        g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, pos(g.var("bell")))),
    },
  ],
  phases: ["守夜判断", "补灯与救人", "堵门回村"],
});

/**
 * 挑战层（可跳过、不计星）：第五夜——两处同时有威胁，还得先救人。
 * 比主线更紧：先到井边把人带回家，钟才能响，然后堵北门、守东墙。
 */
export type LevelChallenge = {
  id: string;
  title: string;
  goal: string;
  reference: string;
  check: (g: GraderApi) => boolean;
};

export const L03_CHALLENGE: LevelChallenge = {
  id: "L03-night-five",
  title: "挑战：第五夜",
  goal: "两处威胁同时来，先把人救回来",
  reference: `// 第五夜：先救人（织偶只管跑腿，最后一步才轮到你）
golem.moveTo(-4, 18)
golem.moveTo(6, 22)

// 人安全了，钟才响
golem.moveTo(0, 0)
golem.place("bell", 0, 65, 0)

// 北门堵上，东墙挂灯（散线怕光）
golem.moveTo(14, -6)
golem.place("cobblestone", 14, 65, -6)
golem.moveTo(22, 2)
golem.place("torch", 22, 65, 2)

// 回村口报平安
golem.moveTo(0, 6)
golem.say("第五夜：人先救，钟后响")
`,
  check: g => {
    const s = scenarioOf(g);
    if (s.night !== 5 || !s.trapped || !s.gateOpen) return false;
    const bell = agentPlaces(g, "bell")[0];
    const wellVisit = g.events("agent.move").find(e => !!e.pos && samePos(e.pos, pos(g.var("well"))));
    const doorVisit = g.events("agent.move").find(e => !!e.pos && samePos(e.pos, pos(g.var("door"))));
    const rescueFirst = !!bell && !!wellVisit && !!doorVisit && (wellVisit.seq ?? 0) < (bell.seq ?? 0);
    const northVisit = nearAny(g, [pos(g.var("gate"))]);
    const eastVisit = nearAny(g, [pos(g.var("eastWall"))]);
    const gateSealed = g.block(pos(g.var("gate"))).id === C + "cobblestone";
    const home = g.withinRadius(g.agent("golem"), { pos: pos(g.var("eira")) }, 4);
    return rescueFirst && northVisit && eastVisit && gateSealed && home;
  },
};

/** 正式关卡：主线定义 + 可跳过的挑战层（不计星）。 */
export const L03: LevelDef & { challenge: LevelChallenge } = Object.assign(L03_BASE, {
  challenge: L03_CHALLENGE,
});

const BASE = L03.world.vars as { bell: Pos };

/** MockWorld 场景：钟楼 + 八根灯柱 + 四户人家 + 北门 + 井 + 装饰；今晚剧本写进 vars.scenario。 */
export const L03Content: LevelContent & { challenge: LevelChallenge; copy: ContentCopy } = {
  def: L03,
  challenge: L03_CHALLENGE,
  copy: L03_COPY,
  async prepare(port) {
    const vars = port.world.vars; // deep-frozen 只读副本（RT-03）
    const scenario = vars.scenario as Scenario;
    const bell = pos(vars.bell);
    const gate = pos(vars.gate);
    const well = pos(vars.well);
    const door = pos(vars.door);
    const east = pos(vars.eastWall);
    const houses = posList(vars.houses);
    const lamps = posList(vars.lamps);
    const G = L03_SCENE.groundY; // 地面 y=64，站人/火把高度 y=65
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const inCorridor = (x: number, z: number) =>
      (x >= -1 && x <= 1 && z >= -10 && z <= 24) || (z >= -1 && z <= 1 && x >= -14 && x <= 22);

    // ---- 功能方块（评分点/目标位）：位置与旧版完全一致，一个不改 ----
    const functional: Array<{ pos: Pos; block: string }> = [];
    const pushF = (x: number, y: number, z: number, block: string) => functional.push({ pos: [x, y, z], block });
    pushF(bell[0], G, bell[2], "stone_bricks");
    pushF(bell[0], bell[1], bell[2], "bell");
    for (const lamp of lamps) {
      pushF(lamp[0], G, lamp[2], "stone_bricks");
      pushF(lamp[0], lamp[1], lamp[2], "air"); // 火把要由灰崽来点
    }
    for (const house of houses) {
      pushF(house[0], G, house[2], "oak_planks");
      pushF(house[0], house[1], house[2] + 1, "oak_door");
    }
    pushF(gate[0], gate[1], gate[2], scenario.gateOpen ? "air" : "oak_fence_gate");
    pushF(well[0], well[1], well[2], "cobblestone_wall");
    pushF(door[0], door[1], door[2], "oak_door");
    pushF(east[0], G, east[2], "cobblestone");
    pushF(east[0], east[1], east[2], "cobweb");

    // ---- 结构件（地标主体）：不压评分点、不进主路走廊 ----
    const structural: Array<{ pos: Pos; block: string }> = [];
    const fKeys = new Set(functional.map(({ pos: [x, y, z] }) => key(x, y, z)));
    const sKeys = new Set<string>();
    const pushS = (x: number, y: number, z: number, block: string): boolean => {
      const k = key(x, y, z);
      if (fKeys.has(k) || sKeys.has(k)) return false;
      if (y >= G + 1 && y <= G + 3 && inCorridor(x, z)) return false;
      structural.push({ pos: [x, y, z], block });
      sKeys.add(k);
      return true;
    };

    // ===== 地标 1：钟楼（高塔：四柱 + 两层木梁 + 坡屋顶 + 檐下暖灯 + 冷蓝顶灯） =====
    for (const [dx, dz] of [[-3, -3], [-3, 3], [3, -3], [3, 3]] as const) {
      for (let y = G; y <= G + 10; y += 1) pushS(bell[0] + dx, y, bell[2] + dz, y % 2 === 0 ? SCENE_PALETTE.stone : SCENE_PALETTE.stoneAccent);
    }
    // 两层木梁：y70 与 y73，把塔身围成一圈
    for (const by of [G + 6, G + 9]) {
      for (let t = -3; t <= 3; t += 1) {
        pushS(bell[0] + t, by, bell[2] - 3, SCENE_PALETTE.log);
        pushS(bell[0] + t, by, bell[2] + 3, SCENE_PALETTE.log);
        pushS(bell[0] - 3, by, bell[2] + t, SCENE_PALETTE.log);
        pushS(bell[0] + 3, by, bell[2] + t, SCENE_PALETTE.log);
      }
    }
    // 檐下暖灯：上下两层各四盏（吊在横梁下面）
    for (const ly of [G + 5, G + 8]) {
      pushS(bell[0] - 3, ly, bell[2], SCENE_PALETTE.light);
      pushS(bell[0] + 3, ly, bell[2], SCENE_PALETTE.light);
      pushS(bell[0], ly, bell[2] - 3, SCENE_PALETTE.light);
      pushS(bell[0], ly, bell[2] + 3, SCENE_PALETTE.light);
    }
    // 塔身橙/红幡（给地标一点颜色，远处能认出来）
    for (const [bx, bz] of [[-2, -2], [-2, 2], [2, -2], [2, 2]] as const) {
      pushS(bell[0] + bx, G + 7, bell[2] + bz, bx * bz > 0 ? "minecraft:orange_wool" : "minecraft:red_wool");
    }
    // 坡屋顶：y75 出檐、y76 收一层、y77 脊
    for (let x = -4; x <= 4; x += 1) {
      for (let z = -4; z <= 4; z += 1) {
        const edge = Math.abs(x) === 4 || Math.abs(z) === 4;
        pushS(bell[0] + x, G + 11, bell[2] + z, edge ? "minecraft:dark_oak_stairs" : SCENE_PALETTE.woodDeep);
      }
    }
    for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      pushS(bell[0] + x, G + 12, bell[2] + z, edge ? "minecraft:dark_oak_stairs" : SCENE_PALETTE.woodDeep);
    }
    for (let x = -1; x <= 1; x += 1) pushS(bell[0] + x, G + 13, bell[2], "minecraft:dark_oak_planks");
    pushS(bell[0], G + 14, bell[2], "minecraft:soul_lantern"); // 冷蓝顶灯（脊上）
    // 钟楼里藏一颗菌光体：夜里从柱子缝里透暖光
    pushS(bell[0], G + 5, bell[2], "minecraft:shroomlight");

    // ===== 地标 2：北门（石砖门柱 + 木拱 + 橙幡 + 暖灯） =====
    for (const dx of [-2, 2]) {
      for (let y = G; y <= G + 5; y += 1) pushS(gate[0] + dx, y, gate[2], y % 2 === 0 ? SCENE_PALETTE.stone : SCENE_PALETTE.stoneAccent);
      pushS(gate[0] + dx, G + 5, gate[2], SCENE_PALETTE.light);
      pushS(gate[0] + dx, G + 3, gate[2] - 1, "minecraft:orange_wool");
    }
    for (let x = gate[0] - 2; x <= gate[0] + 2; x += 1) pushS(x, G + 6, gate[2], SCENE_PALETTE.log);
    for (let x = gate[0] - 1; x <= gate[0] + 1; x += 1) pushS(x, G + 6, gate[2], "minecraft:dark_oak_stairs");
    pushS(gate[0], G + 5, gate[2] - 1, "minecraft:shroomlight"); // 门洞上方的暖光

    // ===== 地标 3：井（石砖台 + 木棚 + 暖灯） =====
    for (const dx of [-3, 3]) {
      for (let y = G + 1; y <= G + 3; y += 1) pushS(well[0] + dx, y, well[2], SCENE_PALETTE.woodDark);
    }
    for (let x = well[0] - 3; x <= well[0] + 3; x += 1) {
      for (let z = well[2] - 1; z <= well[2] + 1; z += 1) pushS(x, G + 4, z, SCENE_PALETTE.woodDeep);
    }
    pushS(well[0], G + 3, well[2], SCENE_PALETTE.light); // 棚下暖灯

    // ===== 地标 4：四户人家（深色木墙 + 玻璃窗 + 坡屋顶 + 屋檐暖灯） =====
    const canFit = (x0: number, z0: number, w: number, d: number): boolean => {
      for (let i = -1; i <= w; i += 1) {
        for (let j = -1; j <= d; j += 1) {
          for (let y = G; y <= G + 4; y += 1) {
            const k = key(x0 + i, y, z0 + j);
            if (fKeys.has(k) || sKeys.has(k)) return false;
            if (y >= G + 1 && y <= G + 3 && inCorridor(x0 + i, z0 + j)) return false;
          }
        }
      }
      return true;
    };
    for (const house of houses) {
      const [tx, tz] = [house[0], house[2]];
      const w = 6, d = 5;
      // 在目标周围 15 格内挑一块不压功能点/走廊的房基，优先离门口 6–9 格
      let spot: [number, number] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let dx = -18; dx <= 12; dx += 1) {
        for (let dz = -14; dz <= 12; dz += 1) {
          const x0 = tx + dx;
          const z0 = tz + dz;
          if (!canFit(x0, z0, w, d)) continue;
          const cx = x0 + (w - 1) / 2;
          const cz = z0 + (d - 1) / 2;
          const dist = Math.hypot(cx - tx, cz - tz);
          if (dist < 4.5 || dist > 10) continue;
          const lateral = Math.abs(cx - tx) >= Math.abs(cz - tz);
          const score = Math.abs(dist - 8) + (lateral ? 0 : 4);
          if (score < bestScore) {
            bestScore = score;
            spot = [x0, z0];
          }
        }
      }
      if (!spot) continue;
      const [x0, z0] = spot;
      // 地板
      for (let i = -1; i <= w; i += 1) for (let j = -1; j <= d; j += 1) pushS(x0 + i, G, z0 + j, "minecraft:spruce_planks");
      // 墙：云杉 + 深色木角柱 + 玻璃窗；正面（朝广场）留 2 格宽门洞
      const frontEast = tx > x0 + w / 2;
      for (let i = 0; i <= w - 1; i += 1) {
        for (let j = 0; j <= d - 1; j += 1) {
          const edge = i === 0 || i === w - 1 || j === 0 || j === d - 1;
          if (!edge) continue;
          const corner = (i === 0 || i === w - 1) && (j === 0 || j === d - 1);
          for (const y of [G + 1, G + 2]) {
            const win = !corner && (i + j) % 3 !== 0;
            pushS(x0 + i, y, z0 + j, corner ? SCENE_PALETTE.log : win ? "minecraft:glass_pane" : SCENE_PALETTE.woodDark);
          }
        }
      }
      // 门洞（朝广场的正面中间两格）
      const doorI = frontEast ? w - 1 : 0;
      const dj = Math.floor(d / 2);
      for (const y of [G + 1, G + 2]) {
        for (const j of [dj - 1, dj]) {
          const k = key(x0 + doorI, y, z0 + j);
          if (!fKeys.has(k)) { sKeys.delete(k); const idx = structural.findIndex(b => key(b.pos[0], b.pos[1], b.pos[2]) === k); if (idx >= 0) structural.splice(idx, 1); }
        }
      }
      // 屋内暖光
      pushS(x0 + Math.floor(w / 2), G + 1, z0 + Math.floor(d / 2), "minecraft:shroomlight");
      // 屋檐：y=G+3 出檐一圈
      for (let i = -1; i <= w; i += 1) for (let j = -1; j <= d; j += 1) pushS(x0 + i, G + 3, z0 + j, "minecraft:dark_oak_planks");
      // 坡屋顶两层
      for (let i = 0; i <= w - 1; i += 1) {
        for (let j = 0; j <= d - 1; j += 1) {
          const edge = i === 0 || i === w - 1 || j === 0 || j === d - 1;
          pushS(x0 + i, G + 4, z0 + j, edge ? "minecraft:dark_oak_stairs" : SCENE_PALETTE.woodDeep);
        }
      }
      for (let i = 1; i <= w - 2; i += 1) pushS(x0 + i, G + 5, z0 + Math.floor(d / 2), "minecraft:dark_oak_planks");
      // 屋檐暖灯两盏（高于主路净空）
      const ex = frontEast ? x0 + w : x0 - 1;
      pushS(ex, G + 3, z0 - 1, SCENE_PALETTE.light);
      pushS(ex, G + 3, z0 + d, SCENE_PALETTE.light);
      // 烟囱 + 顶上营火（远看有火光）
      pushS(x0 + 1, G + 3, z0 + 1, "minecraft:cobblestone");
      pushS(x0 + 1, G + 4, z0 + 1, "minecraft:cobblestone");
      pushS(x0 + 1, G + 5, z0 + 1, "minecraft:campfire");
    }

    // ===== 八根灯柱：石砖底座 + 木柱 + 柱顶暖灯（火把位仍留给灰崽） =====
    for (const lamp of lamps) {
      const dir = lamp[0] >= 0 ? 1 : -1;
      const px = lamp[0] + dir;
      pushS(px, G, lamp[2], SCENE_PALETTE.stoneAccent);
      pushS(px, G + 1, lamp[2], SCENE_PALETTE.log);
      pushS(px, G + 2, lamp[2], SCENE_PALETTE.log);
      pushS(px, G + 3, lamp[2], SCENE_PALETTE.light);
      // 灯柱底座苔石圈
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) pushS(lamp[0] + dx, G, lamp[2] + dz, SCENE_PALETTE.stoneAccent);
    }

    // ===== 地标 5：东墙与散线（蛛网 + 灰白羊毛 + 冷蓝灯；留窗洞，不是一堵实心高墙） =====
    for (let z = -8; z <= 10; z += 1) {
      for (let y = G; y <= G + 3; y += 1) {
        const windowGap = z % 3 === 0 && y >= G + 1 && y <= G + 2;
        if (!windowGap) pushS(24, y, z, (y + z) % 3 === 0 ? SCENE_PALETTE.stoneAccent : "minecraft:cobblestone");
      }
      if (z % 2 === 0) pushS(24, G + 4, z, "minecraft:cobblestone");
    }
    pushS(24, G + 5, -6, "minecraft:soul_lantern");
    pushS(24, G + 5, 8, "minecraft:soul_lantern");

    // ---- 美术层（会被安全检查过滤）：地面、道路、集市、灯列、树、花 ----
    const art: Array<{ pos: Pos; block: string }> = [];
    const put = (x: number, y: number, z: number, block: string) => art.push({ pos: [x, y, z], block });
    // 地面：苔藓底 + 泥土/砂砾补丁（避免整屏同色）
    art.push(...groundPatch(-30, 34, -20, 40, G, SCENE_PALETTE.ground));
    for (const [x0, x1, z0, z1] of [[-26, -16, 4, 14], [12, 24, 18, 30], [-24, -14, -14, -6], [16, 28, -16, -8]] as const) {
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) put(x, G, z, "minecraft:coarse_dirt");
    }
    // 南侧主视角大道：宽 5 格石砾/圆石，直通广场
    for (let z = 4; z <= 38; z += 1) {
      for (let x = -2; x <= 2; x += 1) put(x, G, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[0] : SCENE_PALETTE.path[1]);
    }
    // 东西主路 + 南北延长线
    for (let x = -14; x <= 22; x += 1) for (let z = -1; z <= 1; z += 1) put(x, G, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[1] : SCENE_PALETTE.path[0]);
    for (let z = -10; z <= 4; z += 1) for (let x = -2; x <= 2; x += 1) put(x, G, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[0] : SCENE_PALETTE.path[1]);
    // 广场：石砖 + 苔石砖棋盘（亮色地面，提升整屏亮度）
    for (let x = -7; x <= 7; x += 1) for (let z = -7; z <= 7; z += 1) put(x, G, z, (x + z) % 2 === 0 ? SCENE_PALETTE.stone : SCENE_PALETTE.stoneAccent);
    // 井台（水面 + 石砖圈）
    for (let x = well[0] - 2; x <= well[0] + 2; x += 1) {
      for (let z = well[2] - 2; z <= well[2] + 2; z += 1) {
        const edge = x === well[0] - 2 || x === well[0] + 2 || z === well[2] - 2 || z === well[2] + 2;
        put(x, G, z, edge ? SCENE_PALETTE.stoneAccent : "minecraft:water");
      }
    }
    // 北门前碎石地
    for (let x = gate[0] - 5; x <= gate[0] + 5; x += 1) for (let z = gate[2] - 3; z <= gate[2] + 2; z += 1) put(x, G, z, SCENE_PALETTE.path[0]);
    // 四户人家门前小路
    for (const house of houses) {
      art.push(...pathLine(house[0], house[2], house[0], house[2] + 4, G));
      art.push(...pathLine(house[0], house[2], house[0] - 4, house[2], G));
    }
    // 南侧集市两排：栅栏 + 灯笼（主视角前景暖光），灯柱 + 羊毛棚
    art.push(...fenceLine(-4, 34, -4, 8, G + 1, 3));
    art.push(...fenceLine(4, 34, 4, 8, G + 1, 3));
    for (let z = 10; z <= 32; z += 4) {
      put(-4, G + 2, z, SCENE_PALETTE.light);
      put(4, G + 2, z, SCENE_PALETTE.light);
    }
    for (const [sx, sz] of [[-10, 22], [10, 24]] as const) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) put(sx + dx, G + 1, sz + dz, SCENE_PALETTE.log);
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
        const border = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        put(sx + dx, G + 3, sz + dz, border ? "minecraft:orange_wool" : "minecraft:red_wool");
      }
      put(sx, G + 2, sz, "minecraft:shroomlight"); // 棚下暖光
      put(sx + 2, G + 1, sz + 2, "minecraft:barrel");
      put(sx - 2, G + 1, sz + 1, "minecraft:hay_block");
      put(sx + 1, G + 1, sz - 2, "minecraft:crafting_table");
    }
    // 广场营火两处（暖光 + 故事道具）
    for (const [fx, fz] of [[-6, -5], [6, -5]] as const) {
      put(fx, G + 1, fz, "minecraft:campfire");
      put(fx - 1, G + 1, fz, "minecraft:oak_stairs");
      put(fx + 1, G + 1, fz, "minecraft:oak_stairs");
    }
    // 广场灯柱：灯笼排成一圈（远看是「八灯柱 + 围栏」）
    for (const [px, pz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) put(px, G + 2, pz, SCENE_PALETTE.light);
    // 蓝冰/冷色点缀 + 花圃（明暗对比）
    for (const [bx, bz] of [[-3, -6], [3, 5], [-5, 3], [5, -3]] as const) put(bx, G, bz, "minecraft:blue_ice");
    for (const [fx, fz, flower] of [[-9, 6, "minecraft:poppy"], [8, 7, "minecraft:cornflower"], [-12, 16, "minecraft:dandelion"], [12, 6, "minecraft:azure_bluet"], [-8, 26, "minecraft:poppy"], [10, 14, "minecraft:dandelion"]] as const) {
      put(fx, G + 1, fz, flower);
    }
    // 树（稳定方块：云杉木 + 杜鹃叶）：给远景层次，不用 oak_leaves
    for (const [tx, tz] of [[-18, 28], [18, 30], [-20, -8], [20, -14], [-16, 12], [17, 8]] as const) {
      for (let y = G + 1; y <= G + 4; y += 1) put(tx, y, tz, SCENE_PALETTE.log);
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) <= 3) put(tx + dx, G + 5, tz + dz, (dx + dz) % 2 === 0 ? SCENE_PALETTE.foliage[0] : SCENE_PALETTE.foliage[1]);
      }
    }
    // 远处灯串（路肩两列暖灯，强化主视角纵深）
    for (let x = -14; x <= 20; x += 4) {
      put(x, G + 2, -3, SCENE_PALETTE.light);
      put(x, G + 2, 3, SCENE_PALETTE.light);
    }
    // 北侧道路：广场 → 北门 / 北面纵深（两条）
    art.push(...pathLine(bell[0], bell[2], gate[0], gate[2], G));
    for (let z = -16; z <= -8; z += 1) for (let x = -2; x <= 2; x += 1) put(x, G, z, (x + z) % 2 === 0 ? SCENE_PALETTE.path[0] : SCENE_PALETTE.path[1]);
    // 北面背景树带（挡住空地平线，给主视角纵深）
    for (const [tx, tz] of [[-20, -18], [-16, -16], [-12, -20], [-8, -15], [-4, -19], [0, -21], [4, -16], [8, -20], [12, -15], [16, -19], [20, -16]] as const) {
      for (let y = G + 1; y <= G + 4; y += 1) put(tx, y, tz, SCENE_PALETTE.log);
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) <= 3) put(tx + dx, G + 5, tz + dz, (dx + dz) % 2 === 0 ? SCENE_PALETTE.foliage[0] : SCENE_PALETTE.foliage[1]);
      }
    }
    // 北侧一串灯（背景也见暖光，不只是黑天）
    for (let x = -12; x <= 16; x += 4) put(x, G + 2, -10, SCENE_PALETTE.light);
    art.push(...lampPost(-9, 36, G));
    art.push(...lampPost(9, 36, G));
    art.push(...banner(-6, G + 4, -6, 0), ...banner(6, G + 4, -6, 1));

    // ---- 安全过滤：装饰不压评分点、不进主路走廊、齐头高以下避开评分点 ----
    const targets: Pos[] = [bell, gate, well, door, east, ...lamps, ...houses, pos(vars.eira)];
    const nearTarget = (x: number, z: number) =>
      targets.some(([tx, , tz]) => Math.abs(x - tx) <= 2 && Math.abs(z - tz) <= 2);
    const safeArt = art.filter(({ pos: [x, y, z] }) => {
      const k = key(x, y, z);
      if (fKeys.has(k) || sKeys.has(k)) return false; // 功能位/结构件一格不盖
      if (y <= G) return true; // 地面层（草/路/广场/井台）保留
      if (y <= G + 3 && inCorridor(x, z)) return false; // 主路 3 格宽净空（y65..67）
      if (y <= G + 2 && nearTarget(x, z)) return false; // 齐头高以下不挡评分点
      return true; // 高处可以挂灯/幡
    });

    await port.clearRegion([-40, 55, -40], [40, 85, 40]);
    await port.setBlocks([...functional, ...structural, ...safeArt]);
    await port.setTime(L03_SCENE.time); // 13100 初夜：冷蓝天光 + 暖灯，不是全黑
    await port.setWeather(L03_SCENE.weather);
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, G + 1, 3], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: pos(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "iron_golem", id: "guard", name: "铁傀儡", pos: [3, G + 1, 3], role: "npc" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:bell", 8);
  },
  async playerBeat(port) {
    // 天亮，你用织者之印敲钟：有些最后一步，只有活人的手能完成
    await port.playerPlace("bell", pos(BASE.bell));
  },
};
