import { L01 as L01_BASE } from "../../packages/level-spec/src/index";
import type { ChallengeDef, LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";

/**
 * L01 — 第一缕光（内容层）
 *
 * 本文件是内容层对 `packages/level-spec` 里 L01 定义的**文案与示例覆盖**：
 * 机器逻辑（successCriteria / hiddenTests）沿用基础定义，只替换学生可见的
 * starterCode / referenceSolution / task 文案，并按 Fresh Reader Round 1 修正：
 * FR-009（坐标数法：place 第 2 个数是高度、第 3 个数是前后）、FR-010（不再承诺不存在的坐标面板）、
 * FR-011/FR-031（错误固定「第 N 行 + 原因 + 可照抄写法」）、FR-032（注释全中文、去掉 TODO、说明 golem 就是灰崽）。
 */

export type Pos = [number, number, number];

/** 一条按「行号 + 原因 + 可照抄写法」写的错误文案（docs/20 §3b2）。 */
export type CopyError = {
  /** 出错的行号（从 1 开始；超时这类全局错误用 0）。 */
  line: number;
  /** 原因：一句话说清错在哪。 */
  reason: string;
  /** 怎么改：一句话，说清动作。 */
  fix: string;
  /** 可照抄的一行（学生可以整行替换）。 */
  sample: string;
};

/** 关卡内的玩家可见文案（内容层来源）。 */
export type ContentCopy = {
  coordinateRule: string;
  golemNote: string;
  errors: CopyError[];
  timeout: string;
  cards?: { title: string; headers: string[] };
  entry?: string;
  hints?: string[];
  challenge?: { title: string; goal: string };
};

const lamps = L01_BASE.world.vars.lamps as Pos[];
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** 把一盏灯的坐标读成一句能照抄的 place 调用：第 2 个数是高度，第 3 个数是前后。 */
export function lampPlaceCall(i: number): string {
  const [x, y, z] = lamps[i];
  return `golem.place("lantern", ${x}, ${y}, ${z})`;
}

export const L01_COPY: ContentCopy = {
  coordinateRule:
    "place 的四个参数依次是：放什么、横着第几格、高多少格、前后第几格。第二个数字管高低（上下），第三个数字管前后。",
  golemNote: "golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。",
  entry: "写完点底部的「运行」，灰崽就会照着走。",
  errors: [
    {
      line: 1,
      reason: "第 1 行还没写完：moveTo 后面要跟两个数字，比如 (-12, 10)。",
      fix: "照着第 2 行那样把括号和数字补齐，再点「运行」。",
      sample: "golem.moveTo(-12, 10)",
    },
    {
      line: 2,
      reason: "第 2 行数字顺序反了：place 第二个数字是高度（上下），第三个数字是前后。",
      fix: "把灯的高度 14 放回第二个位置。照抄这一行：",
      sample: lampPlaceCall(0),
    },
    {
      line: 1,
      reason: "第 1 行只让灰崽走到了灯下，没让它放灯。",
      fix: "在 moveTo 后面补一句 place，把灯笼放到灯柱顶上。照抄：",
      sample: lampPlaceCall(0),
    },
    {
      line: 2,
      reason: "第 2 行少了一对引号：物品名要用引号包起来。",
      fix: "把 lantern 加上英文双引号。照抄：",
      sample: lampPlaceCall(0),
    },
    {
      line: 5,
      reason: "第 5 行跳过了 2 号灯：小径有溪流，跳着点会掉进水里。",
      fix: "按 1 号、2 号、3 号的顺序各写一组 moveTo 加 place。",
      sample: "golem.moveTo(-12, -2)",
    },
  ],
  timeout:
    "灰崽走了很久还没走完，八成是同一件事在绕圈。按「重置」再来一遍，看看有没有哪一步一直重复。",
  hints: [
    "先看小径：灰崽现在离哪一盏灯最近？",
    "moveTo 只负责走，place 才负责放灯笼；每盏灯要两句。",
    "照着第一盏的写法再写一遍，只把括号里的坐标换成第二盏的。",
  ],
  challenge: {
    title: "挑战：一步不多走",
    goal: "灰崽只走四段路：1 号灯、2 号灯、3 号灯、艾拉身边；4 号灯由你自己走过去点亮。",
  },
};

/** 学生可见的 starter：全中文注释、没有 TODO，第一次出现 golem 就说明它是灰崽。 */
const starterCode = `// golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。
// 坐标怎么读：moveTo 后面两个数是横着第几格、前后第几格；
//   place 还要多一个高度——第二个数字是高度（上下），第三个数字是前后。
// 4 个灯位：1 号：(-12, 10)；2 号：(-12, -2)；3 号：(2, -2)；4 号：(2, 16)。

// 第一盏：让灰崽走到 1 号灯下，再把灯笼放到灯柱顶上（高 14）。
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)

// 第二盏：照着第一盏的写法再写一遍，只把括号里的坐标换成 2 号灯的。
// 第三盏：你来写。走完 1、2、3 号灯以后，再去 4 号灯下——最后那盏由你亲手点亮。
`;

const referenceSolution = `// 第一盏
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
// 第二盏
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
// 第三盏
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
// 第四盏：只走到灯下，最后一步由你亲手点亮
golem.moveTo(2, 16)
// 回艾拉身边
golem.moveTo(0, 6)
`;

/**
 * L01 挑战层（可跳过、不计星）：最短路线。
 * 比主线更紧：灰崽只走四段——1 号灯、2 号灯、3 号灯、艾拉身边；
 * 不回头、不重复、4 号灯不再由它带路（你自己走过去点亮）。
 * 机器判定用事件顺序与坐标：四段走位必须依次落在 1、2、3 号灯与艾拉身边，
 * 三盏灯恰好各由灰崽点亮一次，第 4 盏由你亲手点亮。
 */
export const L01_CHALLENGE: ChallengeDef = {
  id: "L01-shortest-route",
  title: "挑战：一步不多走",
  goal: "灰崽只走四段路：1 号灯、2 号灯、3 号灯、艾拉身边；4 号灯由你自己走过去点亮。",
  reference: `// 挑战：只走四段——1 号灯、2 号灯、3 号灯、艾拉身边
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(0, 6)
`,
  check: g => {
    const eira = g.npc("eira").pos;
    const moves = g.events("agent.move").filter(e => e.actorType === "agent");
    // 走位只比「横着第几格、前后第几格」——高度不影响灰崽走路
    const xz = (a: number[] | undefined, b: Pos): boolean => !!a && a[0] === b[0] && a[2] === b[2];
    const agentLights = g.events("block.place").filter(
      e => e.actorType === "agent" && String(e.data?.block ?? "") === "minecraft:lantern",
    );
    const playerLights = g.events("block.place").filter(
      e => e.actorType === "player" && String(e.data?.block ?? "") === "minecraft:lantern",
    );
    // 恰好四段走位，依次落在三盏灯与艾拉身边（多一段就是绕路，少一段就是没走完）
    if (moves.length !== 4) return false;
    const expected: Pos[] = [lamps[0], lamps[1], lamps[2]];
    for (let i = 0; i < 3; i++) {
      if (!xz(moves[i].pos, expected[i])) return false;
    }
    if (!moves[3].pos || Math.hypot(moves[3].pos[0] - eira[0], moves[3].pos[2] - eira[2]) > 2) return false;
    // 三盏灯恰好各被灰崽点亮一次，且没有多点别的灯
    if (agentLights.length !== 3) return false;
    for (const lamp of expected) {
      const hits = agentLights.filter(e => samePos(e.pos, lamp));
      if (hits.length !== 1) return false;
    }
    // 第 4 盏由你亲手点亮（织者之印）
    if (!playerLights.some(e => samePos(e.pos, lamps[3]))) return false;
    // 收工时就站在艾拉身边
    return g.withinRadius(g.agent("golem"), { pos: eira }, 4);
  },
};

/** 内容层的 L01：机器逻辑沿用基础定义，替换学生可见的代码、任务文案与引导。 */
export const L01: LevelDef & { challenge: ChallengeDef } = {
  ...L01_BASE,
  code: { ...L01_BASE.code, starterCode, referenceSolution, expectedLoc: 12 },
  task: {
    ...L01_BASE.task,
    mainTask: "让灰崽把 1 到 3 号灯点亮，再走到 4 号灯下；最后一盏由你亲手点亮，做完回到艾拉身边。",
    makeTask: "回程顺路把桥另一侧的第 5 盏小灯也点亮，这盏可以不做。",
    playerBeat: "4 号灯由你右键点亮：把鼠标移到灯笼上按右键。",
  },
  narrative: {
    opening: ["小径上四盏灯又灭了。", "先让灰崽点亮 1 到 3 号灯，再走到 4 号灯下。", "最后一盏要由你亲手点：织偶替不了活人的手。"],
    worldState: "天要黑了，晚归的村民还走在路上，路得亮起来。",
    whyYou: "活人才能写符文，最后一步也要由活人的手完成。",
  },
  phases: ["点亮 1 到 3 号灯", "你亲手点亮第 4 盏", "回艾拉身边"],
  challenge: L01_CHALLENGE,
};

/** MockWorld 场景：灯柱位置与 NPC 由场景数据声明；真实 MC 版由插件按 regions/vars 摆放。 */
export const L01Content: LevelContent & { copy: ContentCopy; challenge: ChallengeDef } = {
  def: L01,
  copy: L01_COPY,
  challenge: L01_CHALLENGE,
  async prepare(port) {
    // T3 美术 pass：L01 小径的「预置世界」。
    // 地面在 y=10，站立高度 y=11；灯柱从 y=11 砌到 y=13，灯笼在 y=14。
    const decor: Array<{ pos: Pos; block: string }> = [];
    const put = (x: number, y: number, z: number, block: string) => decor.push({ pos: [x, y, z], block });

    // 村口草地（先铺底，后面小径会覆盖）
    for (let x = -19; x <= 7; x += 1) for (let z = -8; z <= 24; z += 1) put(x, 10, z, "minecraft:moss_block");

    // 小径：先南北、再东西折一下，宽 3 格
    for (let z = -4; z <= 18; z += 1) {
      for (let x = -1; x <= 1; x += 1) put(x, 10, z, z % 3 === 0 ? "minecraft:cobblestone" : "minecraft:gravel");
    }
    for (let x = -13; x <= 3; x += 1) {
      for (let z = 9; z <= 11; z += 1) put(x, 10, z, (x + z) % 4 === 0 ? "minecraft:cobblestone" : "minecraft:gravel");
    }
    put(-4, 11, 12, "minecraft:flower_pot");
    put(4, 11, 8, "minecraft:flower_pot");
    put(-4, 11, 9, "minecraft:hay_block");
    put(4, 11, 12, "minecraft:hay_block");
    // 村口的小屋（只做外轮廓与屋顶，避免遮挡镜头）
    for (let x = -19; x <= -15; x += 1) {
      for (let z = -1; z <= 5; z += 1) {
        const edge = x === -19 || x === -15 || z === -1 || z === 5;
        if (edge) {
          put(x, 11, z, "minecraft:oak_planks");
          put(x, 12, z, z === 2 ? "minecraft:glass" : "minecraft:oak_planks");
          put(x, 13, z, "minecraft:oak_planks");
        }
      }
    }
    for (let x = -20; x <= -14; x += 1) for (let z = -2; z <= 6; z += 1) put(x, 14, z, "minecraft:spruce_planks");
    // 把四盏灯连成一条路：北段、横段、南段
    for (let z = -2; z <= 10; z += 1) put(-12, 10, z, z % 2 === 0 ? "minecraft:gravel" : "minecraft:cobblestone");
    for (let x = -12; x <= 2; x += 1) put(x, 10, -2, x % 2 === 0 ? "minecraft:gravel" : "minecraft:cobblestone");
    for (let z = -2; z <= 16; z += 1) put(2, 10, z, z % 2 === 0 ? "minecraft:gravel" : "minecraft:cobblestone");

    // 路边灯笼与树，让黄昏有暖光、有层次
    for (let z = -3; z <= 17; z += 4) {
      put(-3, 12, z, "minecraft:lantern");
      put(3, 12, z, "minecraft:lantern");
    }
    for (const [tx, tz] of [[-7, -5], [7, 14], [-8, 16]] as const) {
      for (let y = 11; y <= 14; y += 1) put(tx, y, tz, "minecraft:oak_log");
      for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) <= 3) put(tx + dx, 15, tz + dz, (dx + dz) % 2 === 0 ? "minecraft:azalea" : "minecraft:flowering_azalea");
      }
    }
    for (const [fx, fz, flower] of [[-5, 3, "minecraft:poppy"], [5, 5, "minecraft:cornflower"], [-2, 14, "minecraft:dandelion"], [4, -4, "minecraft:azure_bluet"]] as const) {
      put(fx, 11, fz, flower);
    }

    // 村门：石砖柱 + 木拱 + 羊毛幡
    for (const gx of [-4, 4]) {
      for (let y = 11; y <= 14; y += 1) put(gx, y, -6, "minecraft:stone_bricks");
      put(gx, 15, -6, "minecraft:lantern");
      put(gx, 13, -5, gx < 0 ? "minecraft:red_wool" : "minecraft:orange_wool");
    }
    for (let x = -3; x <= 3; x += 1) put(x, 15, -6, "minecraft:spruce_stairs");

    // 风车（村西）：石基、木塔、白帆
    for (let x = -21; x <= -17; x += 1) for (let z = 11; z <= 15; z += 1) put(x, 11, z, "minecraft:stone_bricks");
    for (let y = 11; y <= 16; y += 1) for (const [wx, wz] of [[-21, 11], [-17, 11], [-21, 15], [-17, 15]]) put(wx, y, wz, "minecraft:spruce_log");
    for (let y = 12; y <= 15; y += 1) for (const [wx, wz] of [[-19, 11], [-19, 15], [-21, 13], [-17, 13]]) put(wx, y, wz, "minecraft:oak_planks");
    for (let x = -22; x <= -16; x += 1) for (let z = 10; z <= 16; z += 1) put(x, 17, z, "minecraft:dark_oak_planks");
    for (const [sx, sz] of [[-19, 9], [-19, 17], [-23, 13], [-15, 13]]) put(sx, 17, sz, "minecraft:white_wool");

    // 池塘（村南）：石沿 + 水 + 睡莲
    for (let x = -19; x <= -15; x += 1) for (let z = 18; z <= 22; z += 1) put(x, 10, z, "minecraft:water");
    for (let x = -20; x <= -14; x += 1) { put(x, 10, 17, "minecraft:stone_bricks"); put(x, 10, 23, "minecraft:stone_bricks"); }
    for (let z = 18; z <= 22; z += 1) { put(-20, 10, z, "minecraft:stone_bricks"); put(-14, 10, z, "minecraft:stone_bricks"); }
    put(-17, 11, 20, "minecraft:lily_pad");
    put(-16, 11, 21, "minecraft:lily_pad");

    // 集市棚（村东）：羊毛顶 + 木桩 + 木桶
    for (let x = 5; x <= 8; x += 1) for (let z = 3; z <= 6; z += 1) put(x, 14, z, (x + z) % 2 === 0 ? "minecraft:red_wool" : "minecraft:orange_wool");
    for (const [px, pz] of [[5, 3], [8, 3], [5, 6], [8, 6]]) put(px, 11, pz, "minecraft:spruce_fence");
    for (let x = 5; x <= 8; x += 1) put(x, 11, 4, "minecraft:barrel");
    put(6, 11, 5, "minecraft:crafting_table");
    put(7, 11, 5, "minecraft:flower_pot");

    // 村口小物件：井、木桶、工作台、花坛
    put(-9, 11, 8, "minecraft:stone_bricks");
    put(-9, 11, 7, "minecraft:stone_bricks");
    put(-9, 11, 9, "minecraft:stone_bricks");
    put(-9, 10, 8, "minecraft:water");
    put(5, 11, 2, "minecraft:barrel");
    put(5, 11, 1, "minecraft:barrel");
    put(-5, 11, 2, "minecraft:crafting_table");
    put(-5, 11, 1, "minecraft:cartography_table");
    for (let x = 4; x <= 6; x += 1) for (let z = 8; z <= 10; z += 1) put(x, 11, z, "minecraft:poppy");

    // 第二栋村舍（东侧）
    for (let x = 3; x <= 7; x += 1) {
      for (let z = 18; z <= 22; z += 1) {
        const edge = x === 3 || x === 7 || z === 18 || z === 22;
        if (edge) {
          put(x, 11, z, "minecraft:spruce_planks");
          put(x, 12, z, z === 20 ? "minecraft:glass_pane" : "minecraft:spruce_planks");
          put(x, 13, z, "minecraft:spruce_planks");
        }
      }
    }
    for (let x = 2; x <= 8; x += 1) for (let z = 17; z <= 23; z += 1) put(x, 14, z, "minecraft:dark_oak_planks");

    // 村口篝火与长椅
    put(-4, 11, 4, "minecraft:campfire");
    put(-2, 11, 6, "minecraft:oak_stairs");
    put(2, 11, 6, "minecraft:oak_stairs");

    await port.setTime(12000);
    await port.setWeather("clear");
    // 中央小径走廊保持净空：装饰只在两侧/村口，不挡织偶寻路。
    const safeDecor = decor.filter(({ pos: [x, y, z], block }) => {
      if (y < 11) return true; // 地面层（草/小路）保留
      if (block === "minecraft:lantern") return y >= 12; // 路灯保留
      return !(x >= -13 && x <= 3 && z >= -3 && z <= 17);
    });
    await port.setBlocks([
      ...lamps.map(pos => ({ pos, block: "minecraft:air" })),
      ...safeDecor,
    ]);
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: [0, 11, 6], role: "npc" });
    await port.spawnEntity({ type: "golem", id: "golem", name: "灰崽", pos: [0, 11, 0], role: "agent" });
    for (const [i, z] of [-4, 2, 18].entries()) {
      await port.spawnEntity({ type: "villager", id: `villager-${i}`, name: "村民", pos: [i % 2 === 0 ? -2 : 2, 11, z], role: "npc" });
    }
  },
  async annotate(port) {
    const entries = lamps.map((p, index) => ({
      id: `lamp-${index + 1}`,
      text: index === 3 ? "4 号灯 · 由你亲手点亮" : `${index + 1} 号灯`,
      pos: [p[0], p[1] + 1, p[2]] as [number, number, number],
    }));
    entries.push({ id: "eira", text: "艾拉 · 老织者", pos: [0, 13, 6] });
    entries.push({ id: "golem", text: "灰崽 · 你的织偶", pos: [0, 13, 0] });
    await port.annotate(entries);
  },
  async playerBeat(port) {
    await port.playerPlace("lantern", lamps[3]);
  },
};
