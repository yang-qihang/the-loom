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
const optionalLamp = (L01_BASE.world.vars.optionalLamp as Pos[])[0];
const samePos = (a: number[] | undefined, b: Pos): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * L01 命名坐标点（docs/48 §1.1）：键名就是沙箱里的同名全局常量。
 * `golem.moveTo(lamp1)` / `golem.place("lantern", lamp1)` / `golem.moveTo(eira)` 都能直接用，
 * 学生不用从面板上抄数字；指令手册与 HUD 也读同一份。
 */
const L01_POINTS: Record<string, { pos: Pos; name: string }> = {
  eira: { pos: [0, 11, 6], name: "艾拉" },
  ...Object.fromEntries(lamps.map((pos, index) => [`lamp${index + 1}`, { pos, name: `${index + 1} 号灯` }])),
  lamp5: { pos: optionalLamp, name: "桥边小灯" },
};

/** 把一盏灯的坐标读成一句能照抄的 place 调用：第 2 个数是高度，第 3 个数是前后。 */
export function lampPlaceCall(i: number): string {
  const [x, y, z] = lamps[i];
  return `golem.place("lantern", ${x}, ${y}, ${z})`;
}

export const L01_COPY: ContentCopy = {
  coordinateRule:
    "灯柱都有名字：1 号到 4 号灯，代码里直接写名字（lamp1、lamp2……），不用背坐标。旧写法里 place 第二个数字管高低（上下），第三个数字管前后；moveTo 只要横着和前后两个数，写名字更省事。",
  golemNote: "golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。",
  entry: "写完点底部的「运行」，灰崽会照着走；卡住了就打开「指令手册」，灯和艾拉的名字、坐标都能查到。",
  errors: [
    {
      line: 5,
      reason: "第 5 行还没写完：moveTo 后面要跟灯的名字，比如灯的名字是 lamp1。",
      fix: "把括号里的名字补齐，再点「运行」。照抄：",
      sample: "golem.moveTo(lamp1)",
    },
    {
      line: 5,
      reason: "第 5 行只让灰崽走到了灯下，没让它点亮灯。",
      fix: "在 moveTo 后面补一句 place，把灯笼放到灯柱顶上。照抄：",
      sample: 'golem.place("lantern", lamp1)',
    },
    {
      line: 5,
      reason: "第 5 行少了一对引号：物品名要用英文双引号包起来。",
      fix: "把 lantern 加上英文双引号，再运行。照抄：",
      sample: 'golem.place("lantern", lamp1)',
    },
    {
      line: 5,
      reason: "第 5 行名字写错了：灯的名字是 1 号到 4 号，手册里能抄。",
      fix: "把名字换成灯的名字，1 号灯就叫 lamp1。照抄：",
      sample: "golem.moveTo(lamp1)",
    },
    {
      line: 7,
      reason: "第 7 行跳过了 2 号灯：小径有溪流，跳着点会掉进水里。",
      fix: "按 1 号、2 号、3 号的顺序各写一组 moveTo 加 place。照抄：",
      sample: "golem.moveTo(lamp2)",
    },
    {
      line: 11,
      reason: "第 11 行还没回艾拉身边：最后要让灰崽走回去。",
      fix: "在最后补一句 moveTo，写上艾拉的名字。照抄：",
      sample: "golem.moveTo(eira)",
    },
  ],
  timeout:
    "灰崽走了很久还没走完，八成是同一件事在绕圈。按「重置」再来一遍，看看有没有哪一步一直重复。",
  hints: [
    "先看小径：灰崽现在离哪一盏灯最近？灯柱上有编号，名字就是 1 号到 4 号灯。",
    "点亮一盏灯要两句：先 golem.moveTo(灯的名字) 走过去，再 golem.place(\"lantern\", 灯的名字) 放灯笼。",
    "照着第一盏的两行再写一遍，只把名字换成第二盏；三盏都亮了以后，再让灰崽走到 4 号灯下。",
  ],
  challenge: {
    title: "挑战：一步不多走",
    goal: "灰崽只走四段路：1 号灯、2 号灯、3 号灯、艾拉身边；4 号灯由你自己走过去点亮。",
  },
};

/** 学生可见的 starter：全中文注释、没有 TODO，第一次出现 golem 就说明它是灰崽；名字优先于数字。 */
const starterCode = `// golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。
// 点亮一盏灯要两句：先让灰崽走过去（moveTo），再让它把灯笼放上去（place）。
// 灯柱都有名字：1 号灯到 4 号灯，名字直接写在指令手册里。
// 旧写法里 place 第二个数字是高度、第三个数字是前后；现在把灯的名字交给 place 就行。
// 4 号灯只走到灯下就停：最后一盏要由你亲手点亮。

// 第一盏：照下面两行把 1 号灯点亮
golem.moveTo(lamp1)
golem.place("lantern", lamp1)

// 第二盏、第三盏：照着上面两行再写两遍，只把名字换成 2 号灯、3 号灯。
// 三盏都亮以后，让灰崽走到 4 号灯下，再回艾拉身边；艾拉也有名字，手册里能查到。
`;

const referenceSolution = `// 第一盏：走到 1 号灯下，把灯笼放到灯柱顶上
golem.moveTo(lamp1)
golem.place("lantern", lamp1)
// 第二盏
golem.moveTo(lamp2)
golem.place("lantern", lamp2)
// 第三盏
golem.moveTo(lamp3)
golem.place("lantern", lamp3)
// 第四盏：只走到灯下，最后一盏由你亲手点亮
golem.moveTo(lamp4)
// 回艾拉身边
golem.moveTo(eira)
`;

/**
 * L01「名副其实」代码要求（docs/48 §1.9）：本关教「函数调用 + 顺序」。
 * - 调用次数：3 盏灯各要「走过去 + 点亮」两句，共 8 次调用；只写 1 盏灯的 starter 不满足。
 * - 顺序：每一次 place 点灯之前，都要先 moveTo 走到那盏灯下（顺序错了灯就点不到）。
 * custom 只做纯字符串/正则判定，不 import 分析器（content 会被 Studio 打包）。
 */
const CODE_REQUIREMENTS = [
  {
    id: "l01-calls",
    text: "至少写 8 次 golem 调用：每一盏灯都要「走过去 + 点亮」两句",
    kind: "calls" as const,
    min: 8,
  },
  {
    id: "l01-order",
    text: "先走再点：每次 place 点灯之前，先让灰崽 moveTo 走到那盏灯下",
    kind: "custom" as const,
    test: (source: string): boolean => {
      const lines = source
        .split("\n")
        .map(line => line.replace(/\/\/.*$/, "").trim())
        .filter(line => line.length > 0);
      let pairs = 0;
      for (let i = 1; i < lines.length; i += 1) {
        // 兼容 Act III 的显式 await 写法：await golem.place(...) 前面也要有 await golem.moveTo(...)。
        if (!/^(?:await\s+)?golem\.place\s*\(\s*["'`]lantern["'`]/.test(lines[i])) continue;
        if (/^(?:await\s+)?golem\.moveTo\s*\(/.test(lines[i - 1])) pairs += 1;
      }
      return pairs >= 3;
    },
  },
];

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
golem.moveTo(lamp1)
golem.place("lantern", lamp1)
golem.moveTo(lamp2)
golem.place("lantern", lamp2)
golem.moveTo(lamp3)
golem.place("lantern", lamp3)
golem.moveTo(eira)
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
  // 命名点 + 玩家出生点（docs/48 §1.1/§1.8）：进关第一人称站在村道 (2,11,4) 朝北，
  // 正面能看到灰崽和灯柱，艾拉在右手后方余角；不与灰崽出生点 (0,11,0) 重合。
  world: { ...L01_BASE.world, points: L01_POINTS, playerSpawn: [2, 11, 4] },
  code: { ...L01_BASE.code, starterCode, referenceSolution, expectedLoc: 12 },
  codeRequirements: CODE_REQUIREMENTS,
  task: {
    ...L01_BASE.task,
    mainTask: "让灰崽把 1 到 3 号灯点亮，再走到 4 号灯下；最后一盏由你亲手点亮，做完回到艾拉身边。",
    makeTask: "回程顺路点亮桥另一侧的第 5 盏小灯，这盏可以不做。",
    playerBeat: "4 号灯由你亲手点亮：走到村道尽头 4 号灯柱前，手持灯笼，对着灯柱按右键放置（站地面即可，不用看见柱顶）。",
    playerBeatHint: "手持灯笼，对着灯柱按右键，不用看顶面",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值，Studio 按 id 逐条打勾。
  progress: [
    {
      id: "l01-three-lamps",
      text: "灰崽按顺序点亮 1、2、3 号灯",
      hint:
        "先点亮 1 到 3 号灯：写一句 `golem.moveTo(lamp1)` 走到 1 号灯下，再写 `golem.place(\"lantern\", lamp1)` 把灯笼放上灯柱顶。lamp1 到 lamp4 都是关卡给好的名字（指令手册里能查到），照着这三组把 1、2、3 号灯按顺序点完；顺序错了要按「重置」重来。",
      check: g => {
        const lampList = g.var("lamps") as Pos[];
        // 只看每盏灯的「第一次」放置：不重置直接再跑一遍时，重复事件不能把顺序判错。
        const firstOrder: number[] = [];
        const seen = new Set<number>();
        for (const event of g.events("block.place")) {
          if (event.actorType !== "agent") continue;
          const index = lampList.slice(0, 3).findIndex(p => samePos(event.pos, p));
          if (index < 0 || seen.has(index)) continue;
          seen.add(index);
          firstOrder.push(index);
        }
        return (
          lampList.slice(0, 3).every(p => g.block(p).id === "minecraft:lantern") &&
          firstOrder.length === 3 &&
          firstOrder.every((value, i) => (i === 0 ? value === 0 : value > firstOrder[i - 1]))
        );
      },
    },
    {
      id: "l01-fourth-by-player",
      text: "你亲手点亮 4 号灯",
      player: true,
      hint:
        "最后一步轮到你了：让灰崽走到 4 号灯下，然后由你亲手点。站在灯柱前的地面上，手持灯笼对着灯柱按右键就行，灯笼会自动挂到柱顶，不用抬头找顶面。点亮后回工作台点「运行」，这一条会打勾。",
      check: g => {
        const fourth = (g.var("lamps") as Pos[])[3];
        if (!fourth) return false;
        return g.events("block.place").some(e => e.actorType === "player" && samePos(e.pos, fourth));
      },
    },
    {
      id: "l01-golem-home",
      text: "灰崽回到艾拉身边",
      hint:
        "回艾拉身边只要补一句 `golem.moveTo(eira)`：eira 就是艾拉的名字，不用背坐标。把这一句写在最后，再点「运行」；目标面板三条都打勾，这一关就过了。",
      check: g => g.withinRadius(g.agent("golem"), g.npc("eira"), 4),
    },
  ],
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
    // 本关沙盒体积：清掉上一会话残留的方块（y=65 的其它关卡不在此区域内），再铺本关场景。
    // 第 4 盏灯的柱子由插件按 tracked 灯位从地面砌到 y=13，灯位 y=14 保持空气。
    await port.clearRegion([-26, 9, -12], [12, 20, 32]);
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
  async afterPrepare(port) {
    // 玩家是生存模式：必须先给灯笼，否则「右键点亮」无从谈起。
    await port.playerGive("minecraft:lantern", 8);
  },
  async annotate(port) {
    const entries = lamps.map((p, index) => ({
      id: `lamp-${index + 1}`,
      text: index === 3 ? "4 号灯 · 由你亲手点亮（走到灯柱前，手持灯笼右键柱子）" : `${index + 1} 号灯`,
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
