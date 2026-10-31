import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { effectiveLines, validateLevel } from "../../packages/level-spec/src/index";
import { digestSnapshot } from "../../packages/session/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { BASE_MACHINES, L08, L08_CHALLENGE, L08Content, L08_REAL_LAYOUT, L08_SHOT_POSITIONS, type MachineSpec } from "./L08.content";

/** L08 验收：prepare → 跑学生程序 → 玩家节拍 → grade（MockWorld，全自动）。 */
async function play(source: string, content: LevelContent = L08Content, withPlayerBeat = true) {
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snapshot = await port.snapshot("L08");
  return { report: grade(content.def, snapshot), snapshot };
}

/** 克隆一份内容，替换机器清单（隐藏变体：多一台 / 平移 / 过热）。 */
function withMachines(machines: MachineSpec[]): LevelContent {
  return {
    ...L08Content,
    def: { ...L08, world: { ...L08.world, vars: { ...L08.world.vars, machines } } },
  };
}

const shiftedMachines = (dx: number, dz: number): MachineSpec[] =>
  BASE_MACHINES.map(m => ({
    ...m,
    switchPos: [m.switchPos[0] + dx, m.switchPos[1], m.switchPos[2] + dz] as MachineSpec["switchPos"],
  }));

const EXTRA_MACHINE: MachineSpec = {
  id: "loom",
  name: "悦灵纺车",
  switchPos: [-4, 65, -2],
  status: "正常",
};

/** 把基础工坊的三台机器坐标写死的程序：换一套工坊布局就会失败。 */
const HARDCODED = `golem.moveTo(-6, -6)
golem.place("redstone_block", -6, 65, -6)
golem.say("启动 熔炉组：正常")
golem.moveTo(6, -6)
golem.place("redstone_block", 6, 65, -6)
golem.say("启动 红石门：正常")
golem.moveTo(2, -10)
golem.place("redstone_block", 2, 65, -10)
golem.say("启动 警钟：正常")
golem.moveTo(2, -10)
golem.place("air", 2, 65, -10)
golem.moveTo(6, -6)
golem.place("air", 6, 65, -6)
golem.moveTo(-6, -6)
golem.place("air", -6, 65, -6)
golem.moveTo(0, 8)
golem.say("全部待机")`;

/** 挑战层偷懒版：确实联合启动了三台，但停机按正序（不是反序）。 */
const LAZY_THREE = `type Spec = { id: string; name: string; switchPos: [number, number, number]; status: "正常" | "过热" }
const specs = world.vars.machines as Spec[]
for (const spec of specs) {
  golem.moveTo(spec.switchPos[0], spec.switchPos[2])
  golem.place("redstone_block", spec.switchPos[0], spec.switchPos[1], spec.switchPos[2])
  golem.say("启动 " + spec.name + "：" + spec.status)
}
for (const spec of specs) {
  golem.moveTo(spec.switchPos[0], spec.switchPos[2])
  golem.place("air", spec.switchPos[0], spec.switchPos[1], spec.switchPos[2])
}
golem.say("三台一起停了")`;

const challengeWith = async (source: string, content: LevelContent = L08Content): Promise<boolean> => {
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snapshot = await port.snapshot("L08");
  return L08_CHALLENGE.check(makeGraderApi(snapshot));
};

describe("L08 同一种心跳（MockWorld）", () => {
  it("关卡定义通过基础校验（体量 / 阶段 / 挑战 / 引导）", () => {
    expect(validateLevel(L08)).toEqual([]);
    const ref = effectiveLines(L08.code.referenceSolution);
    const starter = effectiveLines(L08.code.starterCode);
    expect(ref).toBeGreaterThanOrEqual(50);
    expect(ref - starter).toBeGreaterThanOrEqual(25);
    expect(L08.code.expectedLoc).toBe(ref);
    expect(L08.phases?.length).toBe(2);
    expect(L08.task.hiddenTests.length).toBeGreaterThanOrEqual(2);
    expect(L08_CHALLENGE.check).toBeTypeOf("function");
    expect(L08.narrative?.opening).toHaveLength(3);
    for (const line of L08.narrative!.opening) expect(line.length).toBeGreaterThan(0);
    expect(L08.narrative!.worldState).not.toMatch(/[A-Za-z]/);
    expect(L08.narrative!.whyYou).not.toMatch(/[A-Za-z]/);
  });

  it("参考解 + 玩家节拍 = 通关 3 星", async () => {
    const { report } = await play(L08.code.referenceSolution);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.criteria.every(c => c.passed)).toBe(true);
    expect(report.hidden.every(h => h.passed)).toBe(true);
  });

  it("starter 未修改必然失败（没有排任何动作单）", async () => {
    const { report } = await play(L08.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "all-started")?.passed).toBe(false);
  });

  it("只差最后一下：没有玩家推杆拿不到 3 星", async () => {
    const { report } = await play(L08.code.referenceSolution, L08Content, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBeLessThan(3);
    expect(report.criteria.find(c => c.id === "lever-pulled")?.passed).toBe(false);
  });

  it("隐藏变体一：工坊多一台没见过的机器，参考解仍 3 星", async () => {
    const content = withMachines([...BASE_MACHINES, EXTRA_MACHINE]);
    const { report } = await play(L08.code.referenceSolution, content);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("隐藏变体二：工坊整体平移，参考解仍 3 星；写死坐标的程序失败", async () => {
    const content = withMachines(shiftedMachines(20, 12));
    const good = await play(L08.code.referenceSolution, content);
    expect(good.report.passed).toBe(true);
    expect(good.report.stars).toBe(3);

    const hardcoded = await play(HARDCODED, content);
    expect(hardcoded.report.passed).toBe(false);
    expect(hardcoded.report.hidden.find(h => h.id === "every-machine-touched")?.passed).toBe(false);
  });

  it("隐藏变体三：熔炉过热，参考解当场停机、仍 3 星", async () => {
    const machines = BASE_MACHINES.map(m => ({ ...m, status: m.id === "furnace" ? ("过热" as const) : m.status }));
    const content = withMachines(machines);
    const { report, snapshot } = await play(L08.code.referenceSolution, content);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    const hotSays = snapshot.events.filter(e => String(e.data?.text ?? "").includes("过热"));
    expect(hotSays.length).toBeGreaterThanOrEqual(1);
  });

  it("反作弊：在合闸位之外乱放方块，隐藏测试会拦住", async () => {
    const stray = `${L08.code.referenceSolution}\ngolem.place("cobblestone", 0, 65, 7)\n`;
    const { report } = await play(stray);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "only-switch-positions")?.passed).toBe(false);
  });

  it("挑战层三态：联合启动通过；偷懒正序停机失败；写死坐标换布局失败", async () => {
    // ① 联合启动（挑战参考解）：通过
    expect(await challengeWith(L08_CHALLENGE.reference!)).toBe(true);
    // ② 偷懒：只把三台启动、停机按正序：不通过
    expect(await challengeWith(LAZY_THREE)).toBe(false);
    // ③ 写死：把基础工坊坐标写死，换到平移工坊：不通过
    expect(await challengeWith(HARDCODED, withMachines(shiftedMachines(20, 12)))).toBe(false);
  });

  it("挑战层与主线判定互不替代：主线参考解不算过挑战", async () => {
    expect(await challengeWith(L08.code.referenceSolution)).toBe(false);
  });

  it("确定性：同一程序 + 玩家节拍两次运行，快照 digest 与评分一致", async () => {
    const first = await play(L08.code.referenceSolution);
    const second = await play(L08.code.referenceSolution);
    expect(digestSnapshot(first.snapshot)).toBe(digestSnapshot(second.snapshot));
    expect(second.report).toEqual(first.report);
  });

  it("工坊美术：≥3 类材质、2 处暖光、1 个地标、管线/工具架/机器周边道具", async () => {
    const port = new MockWorldPort();
    await port.prepare(L08Content);
    const blocks = Object.values((await port.snapshot("L08")).blocks);
    const has = (pred: (block: string) => boolean): boolean => blocks.some(pred);
    const materialClasses = [
      has(b => b.startsWith("minecraft:stone_bricks") || b.startsWith("minecraft:deepslate") || b === "minecraft:cobblestone" || b === "minecraft:mossy_stone_bricks" || b === "minecraft:polished_andesite"),
      has(b => b === "minecraft:copper_block" || b === "minecraft:waxed_copper_block" || b === "minecraft:cut_copper" || b === "minecraft:waxed_cut_copper" || b === "minecraft:exposed_copper" || b === "minecraft:gold_block" || b === "minecraft:iron_bars" || b === "minecraft:chain"),
      has(b => b.startsWith("minecraft:spruce_") || b.startsWith("minecraft:dark_oak_") || b.startsWith("minecraft:oak_") || b === "minecraft:crafting_table" || b === "minecraft:barrel" || b === "minecraft:chest"),
      has(b => b === "minecraft:red_concrete" || b === "minecraft:red_wool" || b === "minecraft:redstone_lamp" || b === "minecraft:bricks"),
    ];
    expect(materialClasses.filter(Boolean).length).toBeGreaterThanOrEqual(3);

    const warmLights = blocks.filter(b => b === "minecraft:lantern" || b === "minecraft:campfire" || b === "minecraft:shroomlight").length;
    expect(warmLights).toBeGreaterThanOrEqual(2);

    // 地标：烟囱砖柱（65..73，71 格黄铜箍）与顶端双层营火
    const snapshot = (await port.snapshot("L08")).blocks;
    for (let y = 65; y <= 73; y += 1) expect(snapshot[`-8,${y},-12`]).toBeDefined();
    expect(snapshot["-8,71,-12"]).toBe("minecraft:waxed_cut_copper");
    expect(snapshot["-9,74,-12"]).toBe("minecraft:campfire");
    expect(snapshot["-8,74,-12"]).toBe("minecraft:campfire");

    // 管线（铜 ≥8 段）、工具架五件、机器周边三件套（工作台/箱子/熔炉各 ≥3）
    const copper = blocks.filter(b => b === "minecraft:copper_block" || b === "minecraft:waxed_copper_block" || b === "minecraft:cut_copper" || b === "minecraft:waxed_cut_copper" || b === "minecraft:exposed_copper").length;
    expect(copper).toBeGreaterThanOrEqual(8);
    for (const tool of ["minecraft:anvil", "minecraft:grindstone", "minecraft:smithing_table", "minecraft:stonecutter"]) {
      expect(blocks).toContain(tool);
    }
    expect(blocks.filter(b => b === "minecraft:crafting_table").length).toBeGreaterThanOrEqual(3);
    expect(blocks.filter(b => b === "minecraft:chest").length).toBeGreaterThanOrEqual(3);
    expect(blocks.filter(b => b === "minecraft:furnace").length).toBeGreaterThanOrEqual(3);

    // 稳定方块：不用草方块 / 落叶；装饰密度下限
    expect(blocks.some(b => b === "minecraft:grass_block" || b.endsWith("_leaves"))).toBe(false);
    expect(blocks.length).toBeGreaterThanOrEqual(600);
    expect(new Set(blocks).size).toBeGreaterThanOrEqual(18);
  });

  it("美术不挡路：中央走廊与机器接近通道净空，启停点保持空气", async () => {
    const port = new MockWorldPort();
    await port.prepare(L08Content);
    const snapshot = (await port.snapshot("L08")).blocks;
    const air = (x: number, y: number, z: number): string => snapshot[`${x},${y},${z}`] ?? "minecraft:air";
    // 出生点 → 总拉杆：3 格宽主走廊（y=65..67）保持净空
    for (const x of [-1, 0, 1]) {
      for (let z = 0; z <= 8; z += 1) {
        for (const y of [65, 66, 67]) expect(air(x, y, z)).toBe("minecraft:air");
      }
    }
    // 走廊 → 每台机器启停点的接近通道：人走的 y=65 层必须净空，启停点本身是空气
    for (const spec of BASE_MACHINES) {
      const [x, , z] = spec.switchPos;
      const step = z < 0 ? -1 : 1;
      for (let cz = 0; cz !== z + step; cz += step) expect(air(x, 65, cz)).toBe("minecraft:air");
      expect(air(x, 65, z)).toBe("minecraft:air");
    }
  });

  it("真实 region 布局：自动机位 = playerSpawn + (0,4,14)，且站位可站", async () => {
    const spawn = L08_REAL_LAYOUT.playerSpawn;
    const auto = L08_REAL_LAYOUT.autoCamera;
    expect(auto).toEqual([spawn[0], L08_REAL_LAYOUT.groundY + 4, spawn[2] + 14]);
    expect(auto).toEqual([0, 69, 9]);
    const port = new MockWorldPort();
    await port.prepare(L08Content);
    const blocks = (await port.snapshot("L08")).blocks;
    const at = (p: number[]): string => blocks[p.join(",")] ?? "minecraft:air";
    for (const shot of L08_SHOT_POSITIONS) {
      for (let y = 65; y <= 69; y += 1) expect(at([shot.pos[0], y, shot.pos[2]])).toBe("minecraft:air");
    }
    expect(at(auto)).toBe("minecraft:air");
  });

  it("真实布局安全：所有高点自带落地支撑、启停点上方无装饰、区域与机位常量一致", async () => {
    const calls: Array<[number[], number[]]> = [];
    const port = new MockWorldPort();
    const original = port.clearRegion.bind(port);
    (port as unknown as { clearRegion: typeof port.clearRegion }).clearRegion = async (from, to) => {
      calls.push([from, to]);
      return original(from, to);
    };
    await port.prepare(L08Content);
    const blocks = (await port.snapshot("L08")).blocks;
    const keys = new Set(Object.keys(blocks));
    // 插件会为每个 tracked 高点补灰石柱：我们自己从地面起撑好，插件就无事可做。
    for (const [key] of Object.entries(blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      if (y > 65) expect(keys.has(`${x},${y - 1},${z}`)).toBe(true);
    }
    // 启停点正上方保持空：机器可以立在旁边，不能压在开关上。
    for (const spec of BASE_MACHINES) {
      const [x, , z] = spec.switchPos;
      for (let y = 65; y <= 70; y += 1) expect(blocks[`${x},${y},${z}`] ?? "minecraft:air").toBe("minecraft:air");
    }
    expect(calls[0]).toEqual([L08_REAL_LAYOUT.clearFrom, L08_REAL_LAYOUT.clearTo]);
    const spawn = L08_REAL_LAYOUT.playerSpawn;
    expect(spawn).toEqual([0, 65, -5]);
  });

  it("主视角视线：从自动机位朝北至少看到 3 样工坊主体 + 2 处暖光", async () => {
    const port = new MockWorldPort();
    await port.prepare(L08Content);
    const blocks = (await port.snapshot("L08")).blocks;
    const at = (p: number[]): string => blocks[p.join(",")] ?? "minecraft:air";
    // 人落地后的眼睛高度约 66.6，取整到 67 抽样；薄片/透光装饰不算挡墙。
    const thin = new Set([
      "minecraft:air",
      "minecraft:glass_pane",
      "minecraft:iron_bars",
      "minecraft:chain",
      "minecraft:lantern",
      "minecraft:campfire",
      "minecraft:shroomlight",
      "minecraft:dark_oak_sign",
    ]);
    const lineOfSight = (from: number[], to: number[]): boolean => {
      const steps = 64;
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const p = [0, 1, 2].map(axis => Math.round(from[axis] + (to[axis] - from[axis]) * t));
        if (Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2]) < 2.2) continue;
        if (!thin.has(at(p))) return false;
      }
      return true;
    };
    const eye = [0, 67, 9];
    const subjects = [
      ["熔炉组高楼", [-7, 67, -6]],
      ["红石门柱", [5, 67, -6]],
      ["吊警钟", [3, 67, -10]],
      ["烟囱顶营火", [-8, 74, -12]],
      ["北墙铜管", [0, 66, -13]],
      ["工具架顶层", [10, 68, -6]],
    ] as const;
    const visibleSubjects = subjects.filter(([, target]) => lineOfSight(eye, [...target])).map(([label]) => label);
    expect(visibleSubjects.length).toBeGreaterThanOrEqual(3);

    const warmTargets = [
      [-4, 67, 4],
      [4, 67, 4],
      [12, 71, 0],
      [-12, 71, 0],
    ] as const;
    const visibleLights = warmTargets.filter(target => lineOfSight(eye, [...target]));
    expect(visibleLights.length).toBeGreaterThanOrEqual(2);

    // 半开放：北墙在 y≥67 只剩柱子/铜饰，没有连续整墙
    let northHigh = 0;
    for (let x = -12; x <= 12; x += 1) {
      for (let y = 67; y <= 69; y += 1) {
        if (at([x, y, -13]) !== "minecraft:air") northHigh += 1;
      }
    }
    expect(northHigh).toBeLessThanOrEqual(28); // 7 根立柱 + 烟囱；不是整墙
  });

  it("点缀色面积约束：不用混凝土，羊毛≤4，红石灯≤10，自然材质占多数", async () => {
    const port = new MockWorldPort();
    await port.prepare(L08Content);
    const blocks = Object.values((await port.snapshot("L08")).blocks);
    expect(blocks.some(b => b.endsWith("_concrete"))).toBe(false);
    const wool = blocks.filter(b => b === "minecraft:red_wool" || b === "minecraft:yellow_wool" || b === "minecraft:orange_wool");
    expect(wool.length).toBeLessThanOrEqual(4);
    const lamps = blocks.filter(b => b === "minecraft:redstone_lamp" || b === "minecraft:redstone_block");
    expect(lamps.length).toBeLessThanOrEqual(10);
    const natural = blocks.filter(b =>
      b.includes("stone") || b.includes("deepslate") || b === "minecraft:cobblestone" || b === "minecraft:gravel" ||
      b.includes("spruce") || b.includes("dark_oak") || b.includes("oak_") || b.includes("azalea") ||
      b.includes("copper") || b === "minecraft:gold_block" || b.includes("bricks"),
    );
    expect(natural.length / blocks.length).toBeGreaterThanOrEqual(0.6);
    // 小面积自然色点缀确实存在（苔绿/花），但不是彩墙
    expect(blocks.some(b => b === "minecraft:mossy_stone_bricks")).toBe(true);
    expect(blocks.some(b => b === "minecraft:azalea" || b === "minecraft:flowering_azalea")).toBe(true);
  });

  it("场景钩子齐全，真实 Minecraft 版可复用同一套内容契约", () => {
    expect(L08Content.def.id).toBe("L08");
    expect(L08Content.prepare).toBeTypeOf("function");
    expect(L08Content.playerBeat).toBeTypeOf("function");
    expect(L08Content.challenge.id).toBe("L08-three-machines");
    // 替代动作的口径：机器清单与总拉杆位置都在只读 world.vars 里，真实 MC 版按同一份数据摆放
    const vars = L08.world.vars as { machines: MachineSpec[]; lever: [number, number, number] };
    expect(vars.machines.map(m => m.id)).toEqual(["furnace", "gate", "bell"]);
    expect(vars.lever).toHaveLength(3);
  });
});
