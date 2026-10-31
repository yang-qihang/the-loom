import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L04, L04Content, L04_SCENE, layoutFor } from "./L04.content";

type Field = { rows: number; cols: number; x: number; z: number; waterRow: number; seeds: number; plantable: number };

/** 克隆一份内容（可换三块田 / 挑战田；RT-03 的 vars 是冻结副本，所以只能改 def）。 */
function withVars(patch: Record<string, unknown>): LevelContent {
  return {
    ...L04Content,
    def: { ...L04, world: { ...L04.world, vars: { ...L04.world.vars, ...patch } } },
  };
}

/** L04 验收：prepare → 跑学生程序 → 玩家节拍（放稻草人）→ grade。 */
async function play(patch: Record<string, unknown>, source = L04.code.referenceSolution, withPlayerBeat = true) {
  const content = withVars(patch);
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  return grade(content.def, await port.snapshot("L04"));
}

/** 挑战层验收：把西田换成「不规则田」（两行水渠 + 种子六成），只判挑战 check。 */
async function playChallenge(source: string, withPlayerBeat = true) {
  const content = withVars({
    fieldC: { ...(L04.world.vars.challengeField as Field) },
    matureCellsC: (L04.world.vars.challengeMature as number[][]).map(m => [...m]),
  });
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snap = await port.snapshot("L04");
  return L04Content.challenge.check(makeGraderApi(snap));
}

const fieldsOf = (): Field[] => [L04.world.vars.fieldA, L04.world.vars.fieldB, L04.world.vars.fieldC] as Field[];

describe("L04 麦田的咒语（MockWorld）", () => {
  it("关卡定义通过基础校验", () => {
    expect(validateLevel(L04)).toEqual([]);
  });

  it("三块田尺寸各不相同（专门用来抓写死 5×5 的程序）", () => {
    const sizes = fieldsOf().map(f => `${f.rows}×${f.cols}`);
    expect(new Set(sizes).size).toBe(3);
    for (const f of fieldsOf()) {
      expect(f.plantable).toBe(f.rows * f.cols - f.cols);
    }
    const challenge = L04.world.vars.challengeField as Field & { waterRow2: number };
    expect(challenge.waterRow2).toBeGreaterThanOrEqual(0);
    expect(challenge.seeds).toBeLessThan(challenge.plantable); // 种子只够六成
  });

  it("参考解 + 玩家放稻草人 = 通关 3 星（三块田都收好种好、回谷仓）", async () => {
    const report = await play({});
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（写死 5×5、没先收残株）", async () => {
    const report = await play({}, L04.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "harvest-first")?.passed).toBe(false);
  });

  it("少玩家节拍只能拿 2 星", async () => {
    const report = await play({}, L04.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(2);
  });

  it("种子只够六成：种到没种子就停，仍然是 3 星、不浪费", async () => {
    const a = L04.world.vars.fieldA as Field;
    const b = L04.world.vars.fieldB as Field;
    const c = L04.world.vars.fieldC as Field;
    const short = (f: Field): Field => ({ ...f, seeds: Math.max(1, Math.round(f.plantable * 0.6)) });
    const report = await play({ fieldA: short(a), fieldB: short(b), fieldC: short(c) });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("作弊：只种不收（跳过残株）被「先收后种」判定拦住", async () => {
    const noHarvest = `const a = world.vars.fieldA
let r = 0
while (r < a.rows) {
  for (let c = 0; c < a.cols; c++) {
    if (r !== a.waterRow) {
      golem.moveTo(a.x + c, a.z + r)
      golem.place("wheat_sprout", a.x + c, 65, a.z + r)
    }
  }
  r = r + 1
}
golem.moveTo(-4, 14)`;
    const report = await play({}, noHarvest);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "harvest-first")?.passed).toBe(false);
  });

  it("作弊：把种子丢进水渠被隐藏测试拦住", async () => {
    const intoWater = `const a = world.vars.fieldA
let r = 0
while (r < a.rows) {
  for (let c = 0; c < a.cols; c++) {
    golem.moveTo(a.x + c, a.z + r)
    golem.place("air", a.x + c, 65, a.z + r)
    golem.place("wheat_sprout", a.x + c, 65, a.z + r)
  }
  r = r + 1
}
golem.moveTo(-4, 14)`;
    const report = await play({}, intoWater);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "water-clean")?.passed).toBe(false);
  });

  it("挑战层「不规则田」：挑战参考解通过", async () => {
    expect(await playChallenge(L04Content.challenge.reference)).toBe(true);
  });

  it("挑战层：主线参考解只会跳一行水渠，不算过", async () => {
    expect(await playChallenge(L04.code.referenceSolution)).toBe(false);
  });

  it("挑战层：写死 5×5 的偷懒解不算过", async () => {
    const hardcoded = `for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    golem.moveTo(10 + c, -8 + r)
    golem.place("wheat_sprout", 10 + c, 65, -8 + r)
  }
}
golem.moveTo(-4, 14)`;
    expect(await playChallenge(hardcoded)).toBe(false);
  });

  it("FR-023/024：错误点名第 8 行与 <= 改 <，不用「循环边界」这类黑话", () => {
    const copy = L04Content.copy;
    const bound = copy.errors.find(e => e.reason.startsWith("第 8 行"));
    expect(bound).toBeTruthy();
    expect(bound!.reason).toContain("走多了一格");
    expect(bound!.fix).toContain("<=");
    expect(bound!.fix).toContain("<");
    const all = [
      L04.task.mainTask,
      L04.task.makeTask,
      L04.task.playerBeat,
      ...L04.task.successCriteria.map(c => c.text),
      copy.coordinateRule,
      copy.golemNote,
      copy.timeout,
      ...(copy.hints ?? []),
      ...copy.errors.flatMap(e => [e.reason, e.fix, e.sample]),
    ].join("\n");
    expect(all).not.toMatch(/玩家|用户|您|循环边界|小于等于|写死/);
    // 不重复「让世界告诉你」这类漂亮话
    expect((copy.hints ?? []).join("\n")).not.toContain("让世界告诉你");
    expect(L04.code.starterCode).not.toContain("TODO");
    for (const e of copy.errors) expect(e.reason).toMatch(/^第 \d+ 行/);
  });

  // ---------- 午后麦田场景美术（docs/35） ----------
  /** 取一份 prepare 之后的世界快照（blocks 是 MockWorld 的方块表）。 */
  async function snapshotOf() {
    const port = new MockWorldPort();
    await port.prepare(withVars({}));
    return port.snapshot("L04");
  }
  const blockAt = (snap: { blocks: Record<string, string> }, p: [number, number, number]) =>
    snap.blocks[p.join(",")] ?? "minecraft:air";
  const vars = L04.world.vars as {
    fieldA: Field; fieldB: Field; fieldC: Field; matureCellsA: number[][]; matureCellsB: number[][]; matureCellsC: number[][];
    barn: [number, number, number]; scarecrow: [number, number, number];
  };
  const allFields: Array<{ field: Field; mature: number[][] }> = [
    { field: vars.fieldA, mature: vars.matureCellsA },
    { field: vars.fieldB, mature: vars.matureCellsB },
    { field: vars.fieldC, mature: vars.matureCellsC },
  ];

  it("美术元数据：午后 8000、floorY=64/groundY=65、主视角与可见清单", () => {
    expect(L04_SCENE.time).toBe(8000); // 午后，docs/35
    expect(L04_SCENE.weather).toBe("clear");
    expect(L04_SCENE.floorY).toBe(64); // 真机可见的地板层
    expect(L04_SCENE.groundY).toBe(65); // 站立层 = 田块逻辑层
    expect(L04_SCENE.materials.length).toBeGreaterThanOrEqual(3);
    expect(L04_SCENE.lights.warm.length).toBeGreaterThanOrEqual(2); // lantern + campfire
    expect(L04_SCENE.landmarks).toEqual(expect.arrayContaining(["三块麦田", "谷仓", "风车", "石仓", "稻草人"]));
    expect(L04_SCENE.mainCamera.time).toBe(L04_SCENE.time);
    expect(L04_SCENE.expectedVisible.length).toBeGreaterThanOrEqual(3);
    expect(L04_SCENE.cameraHint.offset).toEqual([0, 5, 26]); // scene-shot: --y 5 --z 26
    expect(L04_SCENE.screenshotSpots.length).toBeGreaterThanOrEqual(3);
    for (const spot of L04_SCENE.screenshotSpots) {
      expect(spot.time).toBe(L04_SCENE.time);
      expect(spot.pos).toHaveLength(3);
      expect(spot.lookAt).toHaveLength(3);
    }
  });

  it("田的视觉画在 y=64 地板层：farmland 土 + hay_block 金麦 + prismarine 水渠 + coarse_dirt", async () => {
    const snap = await snapshotOf();
    const floorBlocks = Object.entries(snap.blocks)
      .filter(([k]) => Number(k.split(",")[1]) === 64)
      .map(([, v]) => v);
    const count = (id: string) => floorBlocks.filter(v => v === `minecraft:${id}`).length;
    expect(count("farmland")).toBeGreaterThan(20); // 非成熟田格
    expect(count("hay_block")).toBeGreaterThan(10); // 成熟金麦 + 田埂
    expect(count("prismarine")).toBeGreaterThan(5); // 水渠蓝
    expect(count("coarse_dirt")).toBeGreaterThan(20); // 土褐补丁
    expect(count("stone_bricks")).toBeGreaterThan(3);
  });

  it("逻辑层保真：y=65 的田格只有 farmland/wheat/water，没被美术实体盖住", async () => {
    const snap = await snapshotOf();
    for (const { field } of allFields) {
      for (let r = 0; r < field.rows; r += 1) {
        for (let c = 0; c < field.cols; c += 1) {
          const id = blockAt(snap, [field.x + c, 65, field.z + r]);
          expect(["minecraft:farmland", "minecraft:wheat", "minecraft:water"], `${field.x + c},65,${field.z + r}`).toContain(id);
        }
      }
    }
    // 谷仓/稻草人的功能位也在原位
    expect(blockAt(snap, vars.barn)).toBe("minecraft:barrel");
    expect(blockAt(snap, [vars.barn[0], 65, vars.barn[2] + 1])).toBe("minecraft:oak_planks");
    expect(blockAt(snap, [vars.scarecrow[0], 65, vars.scarecrow[2]])).toBe("minecraft:hay_block");
  });

  it("主视角一屏内至少 2 块田 + 1 个地标（谷仓/风车/石仓/稻草人）", () => {
    const cam = L04_SCENE.mainCamera;
    // 75 垂直 FOV + 16:9 → 水平半角约 51°
    const half = Math.atan(Math.tan((75 / 2) * (Math.PI / 180)) * (16 / 9));
    const visible = (p: [number, number, number]): boolean => {
      const dx = p[0] - cam.pos[0];
      const dz = p[2] - cam.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 70) return false;
      const fw = [cam.lookAt[0] - cam.pos[0], cam.lookAt[2] - cam.pos[2]];
      const fwLen = Math.hypot(fw[0], fw[1]);
      const dot = (dx * fw[0] + dz * fw[1]) / Math.max(0.001, dist * fwLen);
      return dot >= Math.cos(half);
    };
    const fieldsVisible = allFields.filter(({ field }) => {
      for (let r = 0; r < field.rows; r += 1) for (let c = 0; c < field.cols; c += 1) {
        if (visible([field.x + c, 65, field.z + r])) return true;
      }
      return false;
    }).length;
    expect(fieldsVisible).toBeGreaterThanOrEqual(2);
    const landmarks = [
      [-7, 65, 18], // 谷仓
      [-12, 65, -12], // 风车
      [2, 65, -5], // 石仓
      [vars.scarecrow[0], 65, vars.scarecrow[2]], // 稻草人
    ] as Array<[number, number, number]>;
    expect(landmarks.filter(visible).length).toBeGreaterThanOrEqual(1);
  });

  it("足量暖光与稳定方块：lantern/campfire，无 grass_block / oak_leaves", async () => {
    const snap = await snapshotOf();
    const values = Object.values(snap.blocks);
    const count = (id: string) => values.filter(v => v === `minecraft:${id}`).length;
    expect(count("lantern")).toBeGreaterThanOrEqual(4);
    expect(count("campfire")).toBeGreaterThanOrEqual(2);
    expect(values).not.toContain("minecraft:grass_block");
    expect(values).not.toContain("minecraft:oak_leaves");
    // 3 类材质：土/金麦/石/木/水色
    const has = (id: string) => values.includes(`minecraft:${id}`);
    expect(has("farmland")).toBe(true);
    expect(has("hay_block")).toBe(true);
    expect(has("stone_bricks")).toBe(true);
    expect(["minecraft:spruce_planks", "minecraft:dark_oak_planks", "minecraft:spruce_log"].some(id => has(id.replace("minecraft:", "")))).toBe(true);
    expect(has("prismarine")).toBe(true);
  });

  it("主路走廊净空：农道/谷仓前空地 y65–67 只允许功能位（谷仓桶/板/草）", async () => {
    const snap = await snapshotOf();
    const allowed = new Set([
      vars.barn.join(","),
      [vars.barn[0], 65, vars.barn[2] + 1].join(","),
      [vars.barn[0] - 1, 65, vars.barn[2]].join(","),
    ]);
    const bad: string[] = [];
    for (const c of L04_SCENE.corridor) {
      for (let x = c.x0; x <= c.x1; x += 1) {
        for (let z = c.z0; z <= c.z1; z += 1) {
          for (let y = 65; y <= 67; y += 1) {
            const cur = blockAt(snap, [x, y, z]);
            if (cur !== "minecraft:air" && !allowed.has(`${x},${y},${z}`)) bad.push(`${x},${y},${z}=${cur}`);
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});
