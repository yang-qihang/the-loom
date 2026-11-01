/**
 * L08 — 同一种心跳（MockWorld 版）
 *
 * 设计意图与数值以 content/levels/L08-one-heartbeat.md 为准（A11 接口 / 契约 / 组合）：
 * 三台机器统一启动、逐台汇报、过热的停机；把熔炉与警钟扣成一台联动机复核；收工按反序停机。
 *
 * T1 MockWorld 学生面只有 `golem.moveTo/place/say/pos` 与只读 `world.vars`
 * （docs/21 §2；docs/12 的 world.machines / world.lever / grader.injectMachine 尚未接线），
 * 因此本文件用「等价动作」实现：
 *   机器清单 = world.vars.machines（只读描述：编号、名字、合闸位、状态）
 *   启动一台 = 走到它的合闸位，place("redstone_block", 合闸位)
 *   停一台   = 走到合闸位，place("air", 合闸位)
 *   查状态   = 读描述里的 status（正常 / 过热）
 *   汇报     = say("启动 <名字>：<状态>")
 *   联动机   = 学生把两台机器的「动作单」拼成一台新机器（组合，不复制、不继承）
 *   总拉杆   = 玩家节拍：playerPlace("lever", 拉杆位)
 * 因为 Act II 是 auto-await，织偶调用只能写在顶层（由引擎自动补 await），
 * 所以「跑腿」与「排队」分开：函数只排动作单（纯数据），顶层循环再让灰崽照着做。
 * 真实 Paper 版接线后：world.machines() 直接给机器对象、machine.call 事件替代方块事件，
 * 学生代码换成机器对象上的 start/stop/status，关卡数据与判定口径不变。
 */
import { defineLevel, type ChallengeDef, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { groundPatch, pathLine, lampPost, fenceLine, banner, type SceneBlock } from "../scenes/scene-kit";

type Pos = [number, number, number];
const C = "minecraft:";

const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const pos = (p: unknown): Pos => p as Pos;
const blockOf = (e: { data?: Record<string, unknown> }): string => String(e.data?.block ?? "");
const agentPlaces = (g: GraderApi, block: string) =>
  g.events("block.place").filter(e => e.actorType === "agent" && blockOf(e) === C + block);

export type MachineSpec = {
  id: string;
  name: string;
  switchPos: Pos;
  status: "正常" | "过热";
};

export type ShotPosition = { id: string; label: string; pos: Pos; yaw: number; pitch: number; mustSee: string[] };

/**
 * 真实 Paper 的 region 布局（与 packages/worldport 的 deriveLayout 对齐）：
 * - clearRegion 决定 arena；playerSpawn = arena 中心；scene-shot 相机 = playerSpawn + (0, +4, +14)。
 * - 本关把 region 做成 -24..24 / -22..12：中心 [0,65,-5]，自动机位落在工坊南门内侧 [0,69,9]，
 *   朝北正好越过三台机器看向烟囱与铜管（不再是「对着南墙」）。
 * - region 内高于地面的方块全部自带落地支撑（见 prepare 的 support 填充）：
 *   插件会为每个 tracked 高点补石柱，自带支撑后就不会再出现「正对主视线的一整堵灰墙」。
 */
export const L08_REAL_LAYOUT = {
  clearFrom: [-24, 60, -22] as Pos,
  clearTo: [24, 82, 12] as Pos,
  groundY: 65,
  playerSpawn: [0, 65, -5] as Pos,
  autoCamera: [0, 69, 9] as Pos,
  yaw: 180,
  pitch: 10,
} as const;

/** 主截图机位：auto = scripts/scene-shot.mjs 的自动机位；manual = 人工补拍机位。 */
export const L08_SHOT_POSITIONS: ShotPosition[] = [
  { id: "auto", label: "自动机位：playerSpawn + (0,4,14)，朝北", pos: [0, 69, 9], yaw: 180, pitch: 10, mustSee: ["三台机器", "烟囱", "铜管", "工具架", "暖光"] },
  { id: "manual", label: "人工机位：工坊中轴朝北", pos: [0, 66, 5], yaw: 180, pitch: 0, mustSee: ["三台机器", "烟囱", "铜管"] },
  { id: "pipe", label: "人工机位：炉前朝北看管线", pos: [-5, 66, -2], yaw: 180, pitch: 0, mustSee: ["北墙铜管", "熔炉组", "烟囱"] },
];

/** 工坊的三台机器：合闸位就是学生要走去按的那一格（真实 MC 里是控制台拉杆）。 */
export const BASE_MACHINES: MachineSpec[] = [
  { id: "furnace", name: "熔炉组", switchPos: [-6, 65, -6], status: "正常" },
  { id: "gate", name: "红石门", switchPos: [6, 65, -6], status: "正常" },
  { id: "bell", name: "警钟", switchPos: [2, 65, -10], status: "正常" },
];

const BASE = {
  machines: BASE_MACHINES,
  lever: [0, 65, 8] as Pos,
  eira: [-4, 65, 6] as Pos,
};

const specsOf = (g: GraderApi): MachineSpec[] => g.var("machines") as MachineSpec[];
const switchPositions = (g: GraderApi): Pos[] => specsOf(g).map(s => s.switchPos);
const specIndexAt = (g: GraderApi, p: number[] | undefined): number =>
  specsOf(g).findIndex(s => samePos(p, s.switchPos));
const onEvents = (g: GraderApi): ReturnType<typeof agentPlaces> =>
  agentPlaces(g, "redstone_block").filter(e => switchPositions(g).some(p => samePos(e.pos, p)));
const offEvents = (g: GraderApi): ReturnType<typeof agentPlaces> =>
  agentPlaces(g, "air").filter(e => switchPositions(g).some(p => samePos(e.pos, p)));
const startSays = (g: GraderApi) =>
  g.events("say").filter(e => String(e.data?.text ?? "").startsWith("启动 "));

/** 依次启动；遇到「过热」就当场停机。返回动作单（纯数据，交给顶层执行）。 */
const L08_BASE: LevelDef = defineLevel({
  id: "L08",
  meta: {
    id: "L08",
    title: { zh: "同一种心跳", en: "One Heartbeat" },
    act: 2,
    order: 8,
    priority: "P1",
    prerequisites: ["L07"],
    estimatedMinutes: 20,
    difficulty: 5,
    abstractions: ["A11"],
    objectives: [
      { id: "o-contract", learnerView: "用一张写着三件事的清单描述机器，而不是用名字或出身", evidence: { kind: "machine", ref: "all-started" } },
      { id: "o-polymorphic", learnerView: "只按清单写的启动函数，换一台没见过的机器也照样能启动", evidence: { kind: "machine", ref: "h-unknown-machine" } },
      { id: "o-compose", learnerView: "把两台机器的动作扣成一台联动机，不复制、不继承", evidence: { kind: "machine", ref: "stop-reversed" } },
    ],
    misconceptions: ["interface-means-inheritance", "hardcode-machine-list", "composition-is-copy-paste", "stop-order-irrelevant"],
    apiIntroduced: [],
    apiAllowlist: ["golem.pos", "golem.moveTo", "golem.place", "golem.say", "world.vars"],
    syntaxIntroduced: ["interface 声明", "对象字面量满足形状", "多态数组", "数组与展开复用（L7）"],
    reward: { rune: "A11", advancement: "loomcraft/act2/one_heartbeat", codexPage: "A11" },
    languageLevel: "act2",
  },
  world: {
    vars: {
      machines: BASE_MACHINES,
      lever: BASE.lever,
      eira: BASE.eira,
      plaqueCells: 4,
    },
    entities: [
      { type: "golem", role: "agent", id: "golem", name: "灰崽" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
      { type: "villager", role: "npc", id: "worker", name: "织匠" },
    ],
  },
  code: {
    expectedLoc: 80,
    starterCode: `interface Machine {
  name: string
  status: string
  startSteps(): Step[]
  stopSteps(): Step[]
}
type Step = {
  kind: "on" | "off"
  pos: [number, number, number]
  name: string
  status: string
}
type MachineSpec = {
  id: string
  name: string
  switchPos: [number, number, number]
  status: "正常" | "过热"
}
const specs = world.vars.machines as MachineSpec[]
const lever = world.vars.lever as [number, number, number]

// 一台机器的动作单：启动往合闸位放红石块，停机放回空气。
function machineOf(spec: MachineSpec): Machine {
  return {
    name: spec.name,
    status: spec.status,
    startSteps() {
      return [{ kind: "on", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
    stopSteps() {
      return [{ kind: "off", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
  }
}

const fleet = specs.map(machineOf)
// TODO 1：用 combine 把熔炉和警钟扣成一台联动机（启动先熔炉后警钟，停机反过来）。
const combined = fleet[0]
const all = [...fleet, combined]

// TODO 2：runAll 排「逐台启动 + 过热当场停机」的动作单；stopAll 排「按反序停机」的动作单。
const plan: Step[] = []
for (const step of plan) {
  // 站在合闸位旁边，不站到机关格本身
  // 站回中央通道/开关旁，不站到机器阵列或机关格上
  const standX = step.pos[2] <= -10 ? step.pos[0] : (step.pos[0] > 0 ? step.pos[0] - 4 : step.pos[0] + 4)
  const standZ = step.pos[2] <= -10 ? step.pos[2] + 4 : step.pos[2]
  golem.moveTo(standX, standZ)
  if (step.kind === "on") {
    golem.place("redstone_block", step.pos[0], step.pos[1], step.pos[2])
    golem.say("启动 " + step.name + "：" + step.status)
  } else {
    golem.place("air", step.pos[0], step.pos[1], step.pos[2])
    golem.say("停机 " + step.name)
  }
}
golem.moveTo(lever[0], lever[2] + 2)
golem.say("全部待机，请织者把拉杆推到底")
`,
    referenceSolution: `interface Machine {
  name: string
  status: string
  startSteps(): Step[]
  stopSteps(): Step[]
}
type Step = {
  kind: "on" | "off"
  pos: [number, number, number]
  name: string
  status: string
}
type MachineSpec = {
  id: string
  name: string
  switchPos: [number, number, number]
  status: "正常" | "过热"
}
const specs = world.vars.machines as MachineSpec[]
const lever = world.vars.lever as [number, number, number]

function machineOf(spec: MachineSpec): Machine {
  return {
    name: spec.name,
    status: spec.status,
    startSteps() {
      return [{ kind: "on", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
    stopSteps() {
      return [{ kind: "off", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
  }
}

function combine(a: Machine, b: Machine): Machine {
  return {
    name: a.name + "与" + b.name + "联动机",
    status: a.status === "过热" || b.status === "过热" ? "过热" : "正常",
    startSteps() {
      return [...a.startSteps(), ...b.startSteps()]
    },
    stopSteps() {
      return [...b.stopSteps(), ...a.stopSteps()]
    },
  }
}

const fleet = specs.map(machineOf)
const combined = combine(fleet[0], fleet[2])
const all = [...fleet, combined]

function runAll(ms: Machine[]): Step[] {
  const steps: Step[] = []
  for (const m of ms) {
    steps.push(...m.startSteps())
    if (m.status === "过热") {
      steps.push(...m.stopSteps())
    }
  }
  return steps
}

function stopAll(ms: Machine[]): Step[] {
  const steps: Step[] = []
  const reversed = ms.slice().reverse()
  for (const m of reversed) {
    steps.push(...m.stopSteps())
  }
  return steps
}

const plan = [...runAll(all), ...stopAll(all)]
for (const step of plan) {
  // 站在合闸位旁边，不站到机关格本身
  // 站回中央通道/开关旁，不站到机器阵列或机关格上
  const standX = step.pos[2] <= -10 ? step.pos[0] : (step.pos[0] > 0 ? step.pos[0] - 4 : step.pos[0] + 4)
  const standZ = step.pos[2] <= -10 ? step.pos[2] + 4 : step.pos[2]
  golem.moveTo(standX, standZ)
  if (step.kind === "on") {
    golem.place("redstone_block", step.pos[0], step.pos[1], step.pos[2])
    golem.say("启动 " + step.name + "：" + step.status)
  } else {
    golem.place("air", step.pos[0], step.pos[1], step.pos[2])
    golem.say("停机 " + step.name)
  }
}
golem.moveTo(lever[0], lever[2] + 2)
golem.say("全部待机，请织者把拉杆推到底")
`,
  },
  task: {
    mainTask: "让灰崽把四台机器按同一节拍叫醒：逐台启动、逐台汇报、过热就停；再按反序让它们全部待机。",
    makeTask: "换一批机器（含你没见过的）也照样能叫醒：不许背名单、不许写死坐标。",
    playerBeat: "灰崽把总拉杆推到一半，由你把拉杆推到底。",
    playerBeatHint: "对准总拉杆，按右键推到底",
    successCriteria: [
      {
        id: "all-started",
        text: "清单里的机器都启动了，联动机也接上了",
        check: g => {
          const specs = specsOf(g);
          return switchPositions(g).every(p => onEvents(g).some(e => samePos(e.pos, p))) && startSays(g).length >= specs.length + 1;
        },
      },
      {
        id: "status-reported",
        text: "织偶逐台念出了状态（正常或过热）",
        check: g => {
          const says = g.events("say").filter(e => {
            const text = String(e.data?.text ?? "");
            return text.includes("正常") || text.includes("过热");
          });
          return says.length >= specsOf(g).length + 1;
        },
      },
      {
        id: "stop-reversed",
        text: "停机按反序，最后停的是清单里的第一台",
        check: g => {
          const specs = specsOf(g);
          const tail = offEvents(g).map(e => specIndexAt(g, e.pos)).slice(-specs.length);
          return (
            tail.length === specs.length &&
            tail.every((v, i) => v === specs.length - 1 - i) &&
            switchPositions(g).every(p => g.block(p).id === C + "air")
          );
        },
      },
      {
        id: "lever-pulled",
        text: "你亲手把总拉杆推到底",
        check: g => g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, pos(g.var("lever")))),
      },
    ],
    hiddenTests: [
      {
        id: "h-all-machines",
        name: "清单里每一台都真的启动过、停机过",
        setup: { note: "背名单、只启动前两台的程序会在这里失败" },
        assertions: [
          {
            id: "every-machine-touched",
            text: "每一台机器都有启动与停机动作，最后都在待机",
            check: g => {
              const specs = specsOf(g);
              return specs.every(s => {
                const on = onEvents(g).some(e => samePos(e.pos, s.switchPos));
                const off = offEvents(g).some(e => samePos(e.pos, s.switchPos));
                return on && off && g.block(s.switchPos).id === C + "air";
              });
            },
          },
        ],
      },
      {
        id: "h-reverse-order",
        name: "停机严格反序（与机器清单顺序相反）",
        setup: { note: "按启动顺序停机、或先停熔炉的程序会在这里失败" },
        assertions: [
          {
            id: "reversed-tail",
            text: "最后几台停机动作与清单顺序完全相反",
            check: g => {
              const specs = specsOf(g);
              const tail = offEvents(g).map(e => specIndexAt(g, e.pos)).slice(-specs.length);
              return tail.length === specs.length && tail.every((v, i) => v === specs.length - 1 - i);
            },
          },
        ],
      },
      {
        id: "h-overheat-guard",
        name: "过热的机器当场停机",
        setup: { note: "只会在「过热」隐藏变体里显形：正常工坊没有过热机器" },
        assertions: [
          {
            id: "hot-stopped-early",
            text: "过热的机器被停机不止一次（当场停一次、收工再停一次）",
            check: g => {
              const hot = specsOf(g).filter(s => s.status === "过热");
              if (hot.length === 0) return true;
              return hot.every(s => {
                const offs = offEvents(g).filter(e => samePos(e.pos, s.switchPos));
                return offs.length >= 2;
              });
            },
          },
        ],
      },
      {
        id: "h-only-switch",
        name: "只动合闸位，不往别处乱放",
        setup: { note: "写死坐标、把红石块按到别处的程序会在这里失败" },
        assertions: [
          {
            id: "only-switch-positions",
            text: "织偶的每一次放置都落在机器合闸位上",
            check: g => {
              const allowed = switchPositions(g);
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
  challenge: {
    id: "L08-three-machines",
    title: "挑战：三设备联动机",
    goal: "把熔炉、红石门、警钟扣成一组：按清单顺序启动、按反序停机；任一台过热整组停机。",
    reference: `type Spec = { id: string; name: string; switchPos: Pos; status: "正常" | "过热" }
type Step = { kind: "on" | "off"; pos: Pos; name: string; status: string }
interface Machine { name: string; status: string; startSteps(): Step[]; stopSteps(): Step[] }
const specs = world.vars.machines as Spec[]
const lever = world.vars.lever as [number, number, number]
function machineOf(spec: Spec): Machine {
  return {
    name: spec.name,
    status: spec.status,
    startSteps() {
      return [{ kind: "on", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
    stopSteps() {
      return [{ kind: "off", pos: spec.switchPos, name: spec.name, status: spec.status }]
    },
  }
}
function combineAll(ms: Machine[]): Machine {
  let status = "正常"
  const starts: Step[] = []
  const stops: Step[] = []
  const reversed = ms.slice().reverse()
  for (const m of ms) {
    starts.push(...m.startSteps())
    if (m.status === "过热") status = "过热"
  }
  for (const m of reversed) {
    stops.push(...m.stopSteps())
  }
  return { name: "三设备联动机", status, startSteps: () => starts, stopSteps: () => stops }
}
const trio = combineAll(specs.map(machineOf))
const plan = [...trio.startSteps(), ...trio.stopSteps()]
for (const step of plan) {
  // 站在合闸位旁边，不站到机关格本身
  // 站回中央通道/开关旁，不站到机器阵列或机关格上
  const standX = step.pos[2] <= -10 ? step.pos[0] : (step.pos[0] > 0 ? step.pos[0] - 4 : step.pos[0] + 4)
  const standZ = step.pos[2] <= -10 ? step.pos[2] + 4 : step.pos[2]
  golem.moveTo(standX, standZ)
  if (step.kind === "on") {
    golem.place("redstone_block", step.pos[0], step.pos[1], step.pos[2])
    golem.say("启动 " + step.name + "：" + step.status)
  } else {
    golem.place("air", step.pos[0], step.pos[1], step.pos[2])
    golem.say("停机 " + step.name)
  }
}
golem.moveTo(lever[0], lever[2] + 2)
golem.say("三台机器扣成一组，全部待机")
`,
    check: g => {
      const specs = specsOf(g);
      if (specs.length !== 3) return false;
      const onOrder = onEvents(g).map(e => specIndexAt(g, e.pos));
      const offOrder = offEvents(g).map(e => specIndexAt(g, e.pos));
      const startOk = onOrder.length === 3 && onOrder.every((v, i) => v === i);
      const stopOk = offOrder.length === 3 && offOrder.every((v, i) => v === 2 - i);
      const saidOk = startSays(g).length === 3;
      const standby = specs.every(s => g.block(s.switchPos).id === C + "air");
      return startOk && stopOk && standby && saidOk;
    },
  },
  narrative: {
    worldState: "工坊的机器停了三个早上，熔炉冷着，警钟哑着，结构之核的裂纹又长了一寸。",
    opening: [
      "工坊的机器停了三个早上，熔炉冷着，警钟哑着，结构之核的裂纹又长了一寸。",
      "先把四台机器按同一节拍叫醒：逐台启动、报状态、过热就停；再把熔炉和警钟扣成一台联动机复核一遍。",
      "总拉杆只认活人的手，灰崽只能替你把机器叫醒，最后那一下得你来。",
    ],
    whyYou: "总拉杆只认活人的手，你是工坊里最后一个织者；灰崽只能替你把机器叫醒，最后那一下得你来。",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值；总拉杆是玩家节拍。
  progress: [
    {
      id: "l08-machines-started",
      text: "清单里的机器逐台启动、各报状态",
      check: g => {
        const specs = specsOf(g);
        const allStarted =
          switchPositions(g).every(p => onEvents(g).some(e => samePos(e.pos, p))) && startSays(g).length >= specs.length + 1;
        const says = g.events("say").filter(e => {
          const text = String(e.data?.text ?? "");
          return text.includes("正常") || text.includes("过热");
        });
        return allStarted && says.length >= specs.length + 1;
      },
    },
    {
      id: "l08-stop-reversed",
      text: "停机按反序，最后停第一台",
      check: g => {
        const specs = specsOf(g);
        const tail = offEvents(g).map(e => specIndexAt(g, e.pos)).slice(-specs.length);
        return (
          tail.length === specs.length &&
          tail.every((v, i) => v === specs.length - 1 - i) &&
          switchPositions(g).every(p => g.block(p).id === C + "air")
        );
      },
    },
    {
      id: "l08-lever-pulled",
      text: "你亲手把总拉杆推到底",
      player: true,
      check: g => g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, pos(g.var("lever")))),
    },
  ],
  phases: ["统一启动与汇报", "联动机与停机反序"],
});

const posOf = (p: unknown): Pos => p as Pos;

/** 挑战层单独导出，供测试与实现期直接引用。 */
export const L08_CHALLENGE: ChallengeDef = L08_BASE.challenge as ChallengeDef;

/** 正式关卡（含挑战层）。 */
export const L08: LevelDef & { challenge: ChallengeDef } = L08_BASE as LevelDef & { challenge: ChallengeDef };

/** MockWorld 场景：控制室地面 + 三台机器 + 四格状态铭牌 + 总拉杆 + 装饰。 */
export const L08Content: LevelContent & { challenge: ChallengeDef } = {
  def: L08,
  challenge: L08_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const specs = vars.machines as MachineSpec[];
    const lever = posOf(vars.lever);
    const layout = new Map<string, string>();
    const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;
    const put = (x: number, y: number, z: number, block: string): void => {
      layout.set(keyOf(x, y, z), block);
    };
    const putAll = (list: SceneBlock[]): void => {
      for (const b of list) put(b.pos[0], b.pos[1], b.pos[2], b.block);
    };

    // ── 地面：石砖大厅 + 中央抛光安山岩主路 + 四块材质不同的工区（不是一条灰走廊）
    putAll(groundPatch(-12, 12, -13, 10, 64, "minecraft:stone_bricks"));
    for (let x = -1; x <= 1; x++) {
      for (let z = -12; z <= 10; z++) put(x, 64, z, "minecraft:polished_andesite");
    }
    for (let z = -12; z <= 10; z++) {
      put(-2, 64, z, "minecraft:gravel");
      put(2, 64, z, "minecraft:gravel");
    }
    putAll(groundPatch(-10, -4, -11, -4, 64, "minecraft:cobblestone"));
    putAll(groundPatch(3, 9, -11, -4, 64, "minecraft:polished_deepslate"));
    putAll(groundPatch(7, 11, -9, -3, 64, "minecraft:dark_oak_planks"));
    putAll(groundPatch(-11, 11, 6, 10, 64, "minecraft:spruce_planks"));

    // ── 北侧：1 格矮墙 + 墙顶铜管/木檐 + 红石灯带；上面完全敞开（半开放，不再是整墙）
    for (let x = -12; x <= 12; x++) {
      const block = x % 5 === 0 ? "minecraft:deepslate_bricks" : "minecraft:stone_bricks";
      put(x, 65, -13, block);
      if (x % 3 !== 0) put(x, 66, -13, "minecraft:spruce_planks"); // 墙顶木檐
    }
    for (const x of [-10, -2, 6]) {
      put(x, 65, -13, "minecraft:redstone_lamp");
      put(x, 65, -14, "minecraft:redstone_block"); // 贴墙供电，灯带真的会亮
    }
    // 铜管：架在矮墙顶上（每段都有墙托着，插件不会补灰柱）
    const pipeBlocks = ["minecraft:waxed_copper_block", "minecraft:waxed_cut_copper", "minecraft:exposed_copper"];
    for (let x = -11; x <= 11; x++) {
      if (x >= -9 && x <= -7) continue; // 烟囱位置
      const joint = x === -6 || x === 0 || x === 6;
      put(x, 66, -13, joint ? "minecraft:hopper" : pipeBlocks[(x + 20) % pipeBlocks.length]);
    }
    for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
      for (let y = 65; y <= 69; y++) put(x, y, -13, "minecraft:spruce_log");
      put(x, 70, -13, "minecraft:waxed_cut_copper");
    }

    // ── 两侧：1 格矮墙 + 玻璃窗带 + 云杉立柱（实心落地）；顶部敞开
    for (const wx of [-12, 12]) {
      for (let z = -13; z <= 10; z++) {
        put(wx, 65, z, z % 4 === 0 ? "minecraft:deepslate_bricks" : "minecraft:stone_bricks");
        put(wx, 66, z, z % 4 === 0 ? "minecraft:spruce_planks" : "minecraft:glass_pane");
      }
      for (const z of [-12, -8, -4, 0, 4, 8]) {
        for (let y = 65; y <= 69; y++) put(wx, y, z, "minecraft:spruce_log");
        put(wx, 70, z, "minecraft:waxed_cut_copper");
        put(wx, 71, z, "minecraft:lantern"); // 柱顶暖光，四角可见
      }
    }
    // 南侧：只有两根实心立柱 + 幡，完全敞开（门洞）
    for (const x of [-5, 5]) {
      for (let y = 65; y <= 69; y++) put(x, y, 10, "minecraft:spruce_log");
      put(x, 70, 10, "minecraft:waxed_cut_copper");
      put(x, 66, 10, x < 0 ? "minecraft:red_wool" : "minecraft:yellow_wool");
    }

    // ── 地标烟囱：实心砖柱 + 铜箍 + 顶端双层营火（在自动机位正前方偏左）
    for (let x = -9; x <= -8; x++) {
      for (let z = -13; z <= -12; z++) {
        for (let y = 65; y <= 73; y++) {
          const ring = y === 71;
          const crack = y === 67 || y === 69;
          put(x, y, z, ring ? "minecraft:waxed_cut_copper" : crack ? "minecraft:cracked_stone_bricks" : "minecraft:bricks");
        }
        put(x, 74, z, "minecraft:campfire");
      }
    }
    put(-10, 65, -12, "minecraft:barrel");
    put(-10, 65, -13, "minecraft:coal_block");
    put(-7, 65, -12, "minecraft:coal_block");

    // ── 熔炉组：实心三格高炉塔 + 铜灯 + 地面工具（启停点上方保持无遮挡）
    put(-6, 64, -6, "minecraft:chiseled_stone_bricks");
    put(-7, 65, -6, "minecraft:blast_furnace");
    put(-7, 66, -6, "minecraft:blast_furnace");
    put(-7, 67, -6, "minecraft:blast_furnace");
    put(-5, 65, -6, "minecraft:copper_bulb");
    put(-5, 66, -6, "minecraft:redstone_lamp");
    put(-8, 65, -5, "minecraft:crafting_table");
    put(-4, 65, -5, "minecraft:chest");
    put(-8, 65, -8, "minecraft:furnace");
    put(-4, 65, -8, "minecraft:barrel");
    put(-9, 65, -9, "minecraft:campfire");
    put(-7, 68, -6, "minecraft:lantern"); // 塔顶暖灯，立在炉顶

    // ── 红石门：云杉木/黄铜门框 + 两盏红石灯点到为止（大面积仍是石头与木）
    put(6, 64, -6, "minecraft:chiseled_stone_bricks");
    for (const x of [5, 7]) {
      put(x, 65, -6, "minecraft:spruce_log");
      put(x, 66, -6, "minecraft:waxed_cut_copper");
      put(x, 68, -6, "minecraft:redstone_lamp");
    }
    put(5, 67, -6, "minecraft:dark_oak_planks");
    put(7, 67, -6, "minecraft:dark_oak_planks");
    put(7, 65, -5, "minecraft:sticky_piston");
    put(5, 65, -7, "minecraft:piston");
    put(4, 65, -4, "minecraft:crafting_table");
    put(8, 65, -4, "minecraft:chest");
    put(4, 65, -8, "minecraft:furnace");
    put(8, 65, -9, "minecraft:barrel");

    // ── 警钟：两根实心铜柱 + 横梁；钟挂在柱侧（启停点上方保持空）
    for (const x of [1, 3]) {
      for (let y = 65; y <= 67; y++) put(x, y, -10, "minecraft:waxed_cut_copper");
      put(x, 68, -10, "minecraft:waxed_cut_copper");
    }
    put(3, 66, -10, "minecraft:waxed_copper_block");
    put(3, 67, -10, "minecraft:bell");
    put(0, 65, -9, "minecraft:crafting_table");
    put(4, 65, -9, "minecraft:chest");
    put(0, 65, -12, "minecraft:furnace");

    // ── 工具架：实心背板到地面，铁栏/铁链嵌在板上；工具在地面排开
    for (let z = -9; z <= -4; z++) {
      for (let y = 65; y <= 68; y++) put(10, y, z, y === 68 ? "minecraft:dark_oak_planks" : "minecraft:spruce_planks");
    }
    for (const z of [-8, -6]) put(10, 66, z, "minecraft:iron_bars");
    for (const z of [-7, -5]) put(10, 67, z, "minecraft:iron_bars");
    put(9, 65, -8, "minecraft:stonecutter");
    put(9, 65, -7, "minecraft:anvil");
    put(9, 65, -6, "minecraft:grindstone");
    put(9, 65, -5, "minecraft:smithing_table");
    put(9, 65, -4, "minecraft:chest");
    put(10, 69, -6, "minecraft:lantern"); // 架顶暖灯
    put(10, 69, -8, "minecraft:shroomlight");

    // ── 暖光：主视线两侧的落地灯柱 + 地面营火（灯柱实心落地，不靠插件补柱）
    putAll(lampPost(-4, 4, 64));
    putAll(lampPost(4, 4, 64));
    put(-9, 65, 8, "minecraft:campfire");
    put(9, 65, 7, "minecraft:campfire");

    // ── 总拉杆：铜台面 + 红石压边 + 金块；四格状态灯带落地
    put(lever[0], 64, lever[2], "minecraft:chiseled_stone_bricks");
    put(lever[0] - 1, 64, lever[2], "minecraft:waxed_cut_copper");
    put(lever[0] + 1, 64, lever[2], "minecraft:waxed_cut_copper");
    put(lever[0], 64, lever[2] - 1, "minecraft:mossy_stone_bricks");
    put(lever[0], 64, lever[2] + 1, "minecraft:gold_block");
    for (let i = 0; i < 4; i++) {
      put(6 + i, 65, 8, "minecraft:dark_oak_planks");
      put(6 + i, 66, 8, "minecraft:dark_oak_sign");
      put(6 + i, 67, 8, "minecraft:dark_oak_planks");
    }
    putAll(fenceLine(-2, 2, -2, 8, 65, 3));
    putAll(fenceLine(2, 2, 2, 8, 65, 3));

    // ── 苔绿点缀（自然色，小面积）：墙脚苔石带 + 两丛杜鹃
    putAll(groundPatch(-12, -11, -6, 2, 64, "minecraft:mossy_stone_bricks"));
    putAll(groundPatch(11, 12, -6, 2, 64, "minecraft:mossy_stone_bricks"));
    put(-11, 65, 4, "minecraft:azalea");
    put(11, 65, 4, "minecraft:flowering_azalea");

    // ── 故事道具：料堆、工具、半成品线轴（都在地面层）
    put(-11, 65, 6, "minecraft:barrel");
    put(-11, 65, 7, "minecraft:chest");
    put(11, 65, 6, "minecraft:cartography_table");
    put(11, 65, 7, "minecraft:barrel");
    put(-4, 65, -12, "minecraft:barrel");

    // ── 落地支撑：所有高于地面（y>65）的方块都补上落地骨架，
    //    插件不会再给这些 tracked 高点自动补灰石柱（这是上次「正对一整堵灰墙」的根因）。
    const supportFor = (block: string): string => {
      if (block.includes("lantern") || block.includes("campfire") || block.includes("shroomlight")) return "minecraft:spruce_log";
      if (block.includes("glass")) return "minecraft:stone_bricks";
      if (block.includes("copper") || block === "minecraft:gold_block" || block.includes("hopper")) return "minecraft:waxed_copper_block";
      if (block.includes("spruce") || block.includes("dark_oak") || block.includes("oak_")) return "minecraft:spruce_log";
      if (block.includes("redstone") || block.includes("wool")) return "minecraft:deepslate_bricks";
      return "minecraft:stone_bricks";
    };
    for (const [key, block] of [...layout.entries()]) {
      const [x, y, z] = key.split(",").map(Number);
      for (let py = 65; py < y; py++) {
        const below = keyOf(x, py, z);
        if (!layout.has(below)) layout.set(below, supportFor(block));
      }
    }
    // 启停点必须是空气：只允许地面层有东西（上方不加装饰）
    for (const spec of specs) {
      const [sx, sy, sz] = spec.switchPos;
      layout.set(keyOf(sx, sy, sz), "minecraft:air");
    }

    const blocks: SceneBlock[] = [...layout.entries()].map(([key, block]) => {
      const [x, y, z] = key.split(",").map(Number);
      return { pos: [x, y, z] as Pos, block };
    });

    await port.clearRegion(L08_REAL_LAYOUT.clearFrom, L08_REAL_LAYOUT.clearTo);
    await port.setBlocks(blocks);
    await port.setTime(4500); // 工坊正午：阳光照到中轴
    await port.setWeather("rain"); // 工坊雨天：云层更厚，铜管与炉火对比更强
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, 65, 0], role: "agent" });
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: posOf(vars.eira), role: "npc" });
    await port.spawnEntity({ type: "villager", id: "worker", name: "织匠", pos: [7, 65, 3], role: "npc" });
  },
  async afterPrepare(port) {
    // 真实玩家需要先拿到亲手节拍道具；没人在线时插件会排队到进服。
    await port.playerGive("minecraft:lever", 8);
  },
  async playerBeat(port) {
    // 织者之印：总拉杆的最后一下只有活人的手能推到底
    await port.playerPlace("lever", posOf(L08.world.vars.lever));
  },
};
