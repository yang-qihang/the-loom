import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import type { WorldSnapshot } from "../../packages/protocol/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L07, L07Content, L07_CHALLENGE, L07_REAL_LAYOUT, L07_SHOT_POSITIONS } from "./L07.content";

type CargoItem = { id: string; kind: "ore" | "wood" | "food" };
const cargoList = (v: unknown): CargoItem[] => v as CargoItem[];
const digest = (snap: WorldSnapshot): string => JSON.stringify(snap);

function withVars(patch: Record<string, unknown>): LevelContent {
  return {
    ...L07Content,
    def: { ...L07, world: { ...L07.world, vars: { ...L07.world.vars, ...patch } } },
  };
}

async function play(patch: Record<string, unknown>, source = L07.code.referenceSolution, withPlayerBeat = true) {
  const content = withVars(patch);
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snap = await port.snapshot("L07");
  return { report: grade(content.def, snap), snap };
}

async function playChallenge(source: string) {
  const content = withVars({});
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snap = await port.snapshot("L07");
  return L07_CHALLENGE.check(makeGraderApi(snap));
}

const MAIN_CARGO = cargoList(L07.world.vars.cargo);

/** 隐藏变体一：货物数量与组合变了（多一块煤、少一根胡萝卜）。 */
const MIXED: CargoItem[] = [
  { id: "coal", kind: "ore" },
  { id: "bread", kind: "food" },
  { id: "raw_iron", kind: "ore" },
  { id: "spruce_log", kind: "wood" },
  { id: "coal", kind: "ore" },
  { id: "oak_log", kind: "wood" },
];
/** 隐藏变体二：只来两类货（没有食物）。 */
const SPARSE: CargoItem[] = [
  { id: "raw_iron", kind: "ore" },
  { id: "oak_log", kind: "wood" },
  { id: "coal", kind: "ore" },
];
const SPARSE_RECHECK: CargoItem[] = [
  { id: "raw_iron", kind: "ore" },
  { id: "spruce_log", kind: "wood" },
];

/** 写死清单的偷懒解：只摆主线那六件货，换一批货就漏。 */
const HARDCODED = `const boxes = world.vars.boxes
golem.moveTo(boxes.ore[0][0], boxes.ore[0][2])
golem.place("raw_iron", boxes.ore[0][0], boxes.ore[0][1], boxes.ore[0][2])
golem.moveTo(boxes.ore[1][0], boxes.ore[1][2])
golem.place("coal", boxes.ore[1][0], boxes.ore[1][1], boxes.ore[1][2])
golem.moveTo(boxes.wood[0][0], boxes.wood[0][2])
golem.place("oak_log", boxes.wood[0][0], boxes.wood[0][1], boxes.wood[0][2])
golem.moveTo(boxes.wood[1][0], boxes.wood[1][2])
golem.place("spruce_log", boxes.wood[1][0], boxes.wood[1][1], boxes.wood[1][2])
golem.moveTo(boxes.food[0][0], boxes.food[0][2])
golem.place("bread", boxes.food[0][0], boxes.food[0][1], boxes.food[0][2])
golem.moveTo(boxes.food[1][0], boxes.food[1][2])
golem.place("carrot", boxes.food[1][0], boxes.food[1][1], boxes.food[1][2])
golem.say("六件货摆好了。")`;

describe("L07 信风与织线（MockWorld）", () => {
  it("关卡定义通过基础校验（参考解 ≥50 行、starter 差 ≥25、阶段与挑战齐全）", () => {
    expect(validateLevel(L07)).toEqual([]);
    expect(L07.phases?.length).toBe(3);
    expect(L07.challenge?.title).toContain("挑战");
    expect(L07.narrative?.opening.length).toBe(3);
  });

  it("场景数据：货堆六件、复核箱四件、三只笼子", () => {
    expect(MAIN_CARGO.length).toBe(6);
    expect(cargoList(L07.world.vars.recheck).length).toBe(4);
    expect((L07.world.vars.cages as unknown[]).length).toBe(3);
  });

  it("参考解 + 开笼 = 通关 3 星", async () => {
    const { report } = await play({});
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（只放了一件货）", async () => {
    const { report } = await play({}, L07.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "cargo-boxes")?.passed).toBe(false);
  });

  it("少开笼门（没有织者之印）只能拿 2 星", async () => {
    const { report } = await play({}, L07.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(2);
  });

  it("隐藏变体一：换一批货，参考解仍 3 星", async () => {
    const { report } = await play({ cargo: MIXED });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("隐藏变体二：只来两类货（没有食物），参考解仍 3 星", async () => {
    const { report } = await play({ cargo: SPARSE, recheck: SPARSE_RECHECK });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("作弊：写死清单的偷懒解在换货后被隐藏测试拦住", async () => {
    const { report } = await play({ cargo: MIXED }, HARDCODED);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "h1a")?.passed).toBe(false);
  });

  it("挑战层「无限巡逻」：挑战参考解通过", async () => {
    expect(await playChallenge(L07_CHALLENGE.reference)).toBe(true);
  });

  it("挑战层：主线参考解忙着分拣，不算过", async () => {
    expect(await playChallenge(L07.code.referenceSolution)).toBe(false);
  });

  it("挑战层：只走三站的偷懒解不算过", async () => {
    const lazy = `golem.moveTo(22, 22)
golem.moveTo(38, 22)
golem.moveTo(38, 38)`;
    expect(await playChallenge(lazy)).toBe(false);
  });

  it("信风谷美术：货箱阵/风车/货架/栅栏/树带/暖光俱全，材质≥3 类", async () => {
    const port = new MockWorldPort();
    await port.prepare(L07Content);
    const blocks = (await port.snapshot("L07")).blocks;
    const values = Object.values(blocks);
    const has = (pred: (b: string) => boolean): boolean => values.some(pred);
    const classes = [
      has(b => b.includes("stone_bricks") || b.includes("cobblestone") || b.includes("mossy_stone")),
      has(b => b.includes("oak_planks") || b.includes("spruce_log") || b === "minecraft:barrel" || b === "minecraft:chest"),
      has(b => b === "minecraft:hay_block" || b === "minecraft:azalea" || b === "minecraft:moss_block"),
      has(b => b === "minecraft:white_wool" || b === "minecraft:oak_fence"),
    ];
    expect(classes.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    const warm = values.filter(b => b === "minecraft:lantern" || b === "minecraft:campfire").length;
    expect(warm).toBeGreaterThanOrEqual(2);

    // 地标：风车塔身实心、正面白帆十字、两翼伸出
    expect(blocks["6,69,-16"]).toBe("minecraft:copper_block"); // 铜轴
    for (let y = 66; y <= 72; y += 1) expect(blocks[`6,${y},-16`]).toBe(y === 69 ? "minecraft:copper_block" : "minecraft:white_wool");
    for (let x = 3; x <= 9; x += 1) expect(blocks[`${x},69,-16`]).toBe(x === 6 ? "minecraft:copper_block" : "minecraft:white_wool");
    expect(blocks["2,69,-16"]).toBe("minecraft:white_wool");
    expect(blocks["10,69,-16"]).toBe("minecraft:white_wool");

    // 货箱阵：木桶/箱子 ≥ 25，栅栏 ≥ 8，树带杜鹃 ≥ 60，货架背板存在
    const crates = values.filter(b => b === "minecraft:barrel" || b === "minecraft:chest").length;
    expect(crates).toBeGreaterThanOrEqual(25);
    expect(values.filter(b => b === "minecraft:oak_fence").length).toBeGreaterThanOrEqual(8);
    expect(values.filter(b => b === "minecraft:azalea").length).toBeGreaterThanOrEqual(60);
    expect(blocks["-16,66,6"]).toBe("minecraft:oak_planks");
  });

  it("自然色约束：无混凝土，彩色羊毛≤4，主色为苔绿/木褐/石灰/米白/暖橙", async () => {
    const port = new MockWorldPort();
    await port.prepare(L07Content);
    const blocks = Object.values((await port.snapshot("L07")).blocks);
    expect(blocks.some(b => b.endsWith("_concrete"))).toBe(false);
    const coloredWool = blocks.filter(b => b.endsWith("_wool") && b !== "minecraft:white_wool");
    expect(coloredWool.length).toBeLessThanOrEqual(4);
    const natural = blocks.filter(b =>
      b.includes("stone") || b.includes("cobblestone") || b.includes("moss") || b.includes("azalea") ||
      b.includes("oak") || b.includes("spruce") || b.includes("barrel") || b.includes("chest") ||
      b.includes("hay_block") || b.includes("white_wool") || b.includes("lantern") || b.includes("campfire"),
    );
    expect(natural.length / blocks.length).toBeGreaterThanOrEqual(0.6);
    expect(blocks.some(b => b === "minecraft:grass_block" || b.endsWith("_leaves"))).toBe(false);
  });

  it("真实 region 布局与自动机位：站位/货格/评分点都不被装饰占住", async () => {
    const spawn = L07_REAL_LAYOUT.playerSpawn;
    expect(L07_REAL_LAYOUT.autoCamera).toEqual([spawn[0], L07_REAL_LAYOUT.groundY + 4, spawn[2] + 14]);
    const center = [
      Math.round((L07_REAL_LAYOUT.clearFrom[0] + L07_REAL_LAYOUT.clearTo[0]) / 2),
      L07_REAL_LAYOUT.groundY,
      Math.round((L07_REAL_LAYOUT.clearFrom[2] + L07_REAL_LAYOUT.clearTo[2]) / 2),
    ];
    expect(center).toEqual([...spawn]);

    const port = new MockWorldPort();
    await port.prepare(L07Content);
    const blocks = (await port.snapshot("L07")).blocks;
    const air = (p: number[]): string => blocks[p.join(",")] ?? "minecraft:air";
    // 分拣格与复核格必须是空气（判定要往上放货）
    const mainBoxes = L07.world.vars.boxes as Record<string, number[][]>;
    const checkBoxes = L07.world.vars.recheckBoxes as Record<string, number[][]>;
    for (const key of ["ore", "wood", "food"]) {
      for (const slot of mainBoxes[key]) expect(air(slot)).toBe("minecraft:air");
    }
    for (const key of ["ore", "wood", "food"]) {
      for (const slot of checkBoxes[key]) expect(air(slot)).toBe("minecraft:air");
    }
    for (const shot of L07_SHOT_POSITIONS) {
      for (let y = 65; y <= 69; y += 1) expect(air([shot.pos[0], y, shot.pos[2]])).toBe("minecraft:air");
    }
    // 所有高点自带落地骨架：插件不会再补灰柱
    const keys = new Set(Object.keys(blocks));
    for (const [key] of Object.entries(blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      if (y > 65) expect(keys.has(`${x},${y - 1},${z}`)).toBe(true);
    }
  });

  it("主视角视线：自动机位朝北看到货箱阵 + 风车 + 货架等 ≥3 样，暖光 ≥2", async () => {
    const port = new MockWorldPort();
    await port.prepare(L07Content);
    const blocks = (await port.snapshot("L07")).blocks;
    const at = (p: number[]): string => blocks[p.join(",")] ?? "minecraft:air";
    const thin = new Set([
      "minecraft:air", "minecraft:glass_pane", "minecraft:iron_bars", "minecraft:chain",
      "minecraft:lantern", "minecraft:campfire", "minecraft:oak_fence", "minecraft:azalea",
    ]);
    const lineOfSight = (from: number[], to: number[]): boolean => {
      const steps = 72;
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const p = [0, 1, 2].map(axis => Math.round(from[axis] + (to[axis] - from[axis]) * t));
        if (Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2]) < 2.2) continue;
        if (!thin.has(at(p))) return false;
      }
      return true;
    };
    const eye = [0, 67, 16];
    const subjects = [
      ["北侧货箱堆", [0, 65, -4]],
      ["风车白帆十字", [6, 69, -16]],
      ["西侧货架", [-15, 65, 6]],
      ["东侧复核货堆", [38, 65, 6]],
      ["正面木箱阵", [0, 64, 12]],
    ] as const;
    const visible = subjects.filter(([, target]) => lineOfSight(eye, [...target]));
    expect(visible.length).toBeGreaterThanOrEqual(3);

    const warmTargets = [[-8, 67, 10], [18, 67, 6], [10, 65, -2], [16, 65, 12]] as const;
    const warmVisible = warmTargets.filter(target => lineOfSight(eye, [...target]));
    expect(warmVisible.length).toBeGreaterThanOrEqual(2);
  });

  it("确定性：同一程序跑两次，世界快照完全一致", async () => {
    const a = await play({});
    const b = await play({});
    expect(digest(a.snap)).toBe(digest(b.snap));
  });
});
