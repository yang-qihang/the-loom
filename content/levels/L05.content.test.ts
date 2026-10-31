import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import type { WorldSnapshot } from "../../packages/protocol/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L05, L05Content, L05_CHALLENGE, L05_CAM, L05_CLEAR, L05_CORRIDOR, L05_SCENE } from "./L05.content";

type Plot = { x: number; z: number; style: "oak" | "spruce" | "brick" };

const plotList = (v: unknown): Plot[] => v as Plot[];
const signsOf = (plots: Plot[]): number[][] => plots.map(p => [p.x + 1, 64, p.z + 3]);
const digest = (snap: WorldSnapshot): string => JSON.stringify(snap);

/** 克隆一份内容（RT-03 的 vars 是冻结副本，所以隐藏变体只能改 def）。 */
function withVars(patch: Record<string, unknown>): LevelContent {
  return {
    ...L05Content,
    def: { ...L05, world: { ...L05.world, vars: { ...L05.world.vars, ...patch } } },
  };
}

async function play(patch: Record<string, unknown>, source = L05.code.referenceSolution, withPlayerBeat = true) {
  const content = withVars(patch);
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snap = await port.snapshot("L05");
  return { report: grade(content.def, snap), snap };
}

/** 挑战层验收：只判挑战 check（不计星）。 */
async function playChallenge(source: string) {
  const content = withVars({});
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snap = await port.snapshot("L05");
  return L05_CHALLENGE.check(makeGraderApi(snap));
}

/** 只跑场景搭建（不跑学生程序）的快照，用于美术检查。 */
async function preparedSnapshot(): Promise<WorldSnapshot> {
  const port = new MockWorldPort();
  await port.prepare(L05Content);
  return port.snapshot("L05");
}

/** 3 格宽主路走廊的格子（测试侧复算，装饰不得占这条带）。 */
function corridorKeys(): string[] {
  const keys: string[] = [];
  for (const seg of L05_CORRIDOR) {
    const dx = Math.sign(seg.x1 - seg.x0);
    const dz = Math.sign(seg.z1 - seg.z0);
    const steps = Math.max(Math.abs(seg.x1 - seg.x0), Math.abs(seg.z1 - seg.z0));
    for (let i = 0; i <= steps; i += 1) {
      const x = seg.x0 + dx * i;
      const z = seg.z0 + dz * i;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          if (ox !== 0 && oz !== 0) continue;
          for (let y = 64; y <= 67; y += 1) keys.push(`${x + ox},${y},${z + oz}`);
        }
      }
    }
  }
  return keys;
}

const MAIN = plotList(L05.world.vars.plots);
/** 隐藏变体一：五块地整体挪走，风格也换一遍。 */
const SHIFTED: Plot[] = [
  { x: 40, z: -40, style: "brick" },
  { x: 52, z: -40, style: "spruce" },
  { x: 64, z: -40, style: "oak" },
  { x: 40, z: -26, style: "oak" },
  { x: 64, z: -26, style: "spruce" },
];
/** 隐藏变体二：位置不动，三种风格在五块地之间重排。 */
const PERMUTED: Plot[] = [
  { x: 0, z: 0, style: "brick" },
  { x: 12, z: 0, style: "spruce" },
  { x: 24, z: 0, style: "oak" },
  { x: 0, z: 14, style: "oak" },
  { x: 24, z: 14, style: "spruce" },
];

/** 写死坐标的偷懒解：只会在零号地那一块地方造房。 */
const HARDCODED = `golem.moveTo(1, 1)
for (let dx = 0; dx < 3; dx = dx + 1) {
  for (let dz = 0; dz < 3; dz = dz + 1) {
    golem.place("cobblestone", dx, 63, dz)
    golem.place("oak_slab", dx, 65, dz)
  }
}
golem.place("oak_planks", 0, 64, 0)
golem.place("oak_planks", 1, 64, 0)
golem.place("oak_planks", 2, 64, 0)
golem.say("先造一栋。")`;

describe("L05 一百座房子（MockWorld）", () => {
  it("关卡定义通过基础校验（参考解 ≥50 行、starter 差 ≥25、阶段与挑战齐全）", () => {
    expect(validateLevel(L05)).toEqual([]);
    expect(L05.phases?.length).toBe(3);
    expect(L05.challenge?.title).toContain("挑战");
    expect(L05.narrative?.opening.length).toBe(3);
  });

  it("场景数据：五块地、三种风格；挑战地用另一组位置与风格", () => {
    expect(MAIN.length).toBe(5);
    expect(new Set(MAIN.map(p => p.style)).size).toBe(3);
    const challenge = plotList(L05.world.vars.challengePlots);
    expect(challenge.length).toBe(5);
    expect(challenge.some(p => !MAIN.some(m => m.x === p.x && m.z === p.z))).toBe(true);
  });

  it("美术：稳定方块与色板（≥3 材质 + 工地黄 + 暖光 + 地标）", async () => {
    const snap = await preparedSnapshot();
    const ids = Object.values(snap.blocks) as string[];
    const count = (fragment: string): number => ids.filter(id => id.includes(fragment)).length;
    // 稳定方块：不许出现草方块与树叶（真实服务端会变脏）
    expect(ids.some(id => id.includes("grass_block"))).toBe(false);
    expect(ids.some(id => id.includes("oak_leaves"))).toBe(false);
    // 色板：橡木 / 云杉 / 石砖 + 工地黄（干草、黄羊毛），至少 3 类材质
    const families = ["oak_planks", "spruce_planks", "stone_bricks", "dark_oak_planks"].filter(f => count(f) > 0);
    expect(families.length).toBeGreaterThanOrEqual(3);
    expect(count("hay_block")).toBeGreaterThan(0);
    expect(count("yellow_wool")).toBeGreaterThan(0);
    // 暖光：至少两个灯笼/营火；地标：工棚与半成品房
    const warm = L05_SCENE.warmLights.map(p => String(snap.blocks[p.join(",")] ?? ""));
    expect(warm.filter(id => id.endsWith("lantern") || id.endsWith("campfire")).length).toBeGreaterThanOrEqual(2);
    expect(snap.blocks[L05_SCENE.landmarkRoof.join(",")]).toBe("minecraft:dark_oak_planks");
    expect(snap.blocks[L05_SCENE.banner.join(",")]).toBe("minecraft:yellow_wool");
    // 上午光（6000 tick）由场景常量和 prepare 共用
    expect(L05_SCENE.time).toBe(6000);
  });

  it("美术：装饰避开评分地块与主路走廊", async () => {
    const snap = await preparedSnapshot();
    // 五块地的房子格在学生动工前必须是空的
    for (const p of MAIN) {
      for (let dx = 0; dx < 3; dx += 1) {
        for (let dz = 0; dz < 3; dz += 1) {
          for (let y = 63; y <= 65; y += 1) {
            expect(snap.blocks[`${p.x + dx},${y},${p.z + dz}`]).toBeUndefined();
          }
        }
      }
    }
    // 主路走廊 3 格宽、真实地面（y64–67）净空；y63 是地板层允许铺路
    for (const key of corridorKeys()) {
      expect(snap.blocks[key]).toBeUndefined();
    }
  });

  it("美术：工匠与村民有名字，场景名单可辨认", () => {
    const names = (L05.world.entities ?? []).map(entity => entity.name ?? "");
    for (const craftsman of L05_SCENE.craftsmen) expect(names).toContain(craftsman);
    expect(names).toContain("艾拉");
    expect(names).toContain("搬来的村民");
  });

  // 把 world 坐标投到 scene-shot.mjs 的真实机位画面坐标（fov 70、aspect 1.6、yaw 180、pitch 10）
  const camBasis = (): { fwd: number[]; right: number[]; up: number[]; tanV: number; tanH: number } => {
    const yaw = (L05_CAM.yaw * Math.PI) / 180;
    const pitch = (L05_CAM.pitch * Math.PI) / 180;
    const fwd = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const right = [-fwd[2], 0, fwd[0]];
    const rl = Math.hypot(right[0], right[2]);
    const rightN = [right[0] / rl, 0, right[2] / rl];
    const up = [rightN[1] * fwd[2] - rightN[2] * fwd[1], rightN[2] * fwd[0] - rightN[0] * fwd[2], rightN[0] * fwd[1] - rightN[1] * fwd[0]];
    const ul = Math.hypot(up[0], up[1], up[2]);
    const upN = [up[0] / ul, up[1] / ul, up[2] / ul];
    const tanV = Math.tan((L05_CAM.fovDeg * Math.PI) / 360);
    return { fwd, right: rightN, up: upN, tanV, tanH: tanV * L05_CAM.aspect };
  };
  const project = (target: number[]): { x: number; y: number; fwd: number } | null => {
    const { fwd, right, up, tanV, tanH } = camBasis();
    const d = [target[0] - L05_CAM.pos[0], target[1] - L05_CAM.pos[1], target[2] - L05_CAM.pos[2]];
    const f = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    if (f <= 0.5) return null;
    const x = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (f * tanH);
    const y = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (f * tanV);
    return { x, y, fwd: f };
  };
  const inView = (target: number[], bounds = 1): boolean => {
    const p = project(target);
    return !!p && Math.abs(p.x) <= bounds && Math.abs(p.y) <= bounds;
  };

  it("真实机位核对：arena 中心 = L05_CAM.spawnCenter → playerSpawn → scene-shot 固定机位", () => {
    const cx = Math.round((L05_CLEAR.from[0] + L05_CLEAR.to[0]) / 2);
    const cz = Math.round((L05_CLEAR.from[2] + L05_CLEAR.to[2]) / 2);
    expect([cx, cz]).toEqual(L05_CAM.spawnCenter);
    const base = [cx, L05_SCENE.groundY, cz];
    // scene-shot.mjs：cam = [base.x, groundY + 4, base.z + 14]，yaw 180，pitch 10
    expect([base[0], L05_SCENE.groundY + 4, base[2] + 14]).toEqual(L05_CAM.pos);
  });

  it("真实机位画面：≥3 块地 + 2 个地标 + 近景木料/黄幡/灯", async () => {
    const snap = await preparedSnapshot();
    const visibleGrid = MAIN.filter(p => inView([p.x + 1, 64, p.z + 1]));
    expect(visibleGrid.length).toBeGreaterThanOrEqual(3);
    const landmarks = [L05_SCENE.shed.center, L05_SCENE.halfBuilt.center];
    expect(landmarks.every(t => inView(t))).toBe(true);
    // 近景（距离 < 18）可见道具：木料堆/木架/黄幡/灯笼
    let nearProps = 0;
    let nearWarm = 0;
    for (const [key, block] of Object.entries(snap.blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      if (y < 64) continue;
      const dist = Math.hypot(x - L05_CAM.pos[0], z - L05_CAM.pos[2]);
      if (dist > 18) continue;
      if (!inView([x, y, z], 0.98)) continue;
      nearProps += 1;
      if (String(block).endsWith("lantern") || String(block).endsWith("campfire")) nearWarm += 1;
    }
    expect(nearProps).toBeGreaterThanOrEqual(40);
    expect(nearWarm).toBeGreaterThanOrEqual(2);
    // 四个黄幡/木架区域在画面内
    const banners = Object.entries(snap.blocks).filter(([, b]) => b === "minecraft:yellow_wool");
    expect(banners.some(([key]) => inView(key.split(",").map(Number)))).toBe(true);
  });

  it("点缀色预算：高饱和色（幡/彩羊毛/花）≤ 画面 10%，暖光单独成组且不铺面", async () => {
    const snap = await preparedSnapshot();
    const { fwd, right, up, tanV, tanH } = camBasis();
    const frameArea = 640 * 400;
    const accentIds = new Set([
      "minecraft:yellow_wool", "minecraft:orange_wool", "minecraft:red_wool",
      "minecraft:white_wool", "minecraft:brown_wool",
      "minecraft:poppy", "minecraft:cornflower", "minecraft:dandelion", "minecraft:azure_bluet",
    ]);
    const warmIds = new Set(["minecraft:lantern", "minecraft:campfire", "minecraft:torch"]);
    let accentArea = 0;
    let warmArea = 0;
    for (const [key, block] of Object.entries(snap.blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      const d = [x + 0.5 - L05_CAM.pos[0], y + 0.5 - L05_CAM.pos[1], z + 0.5 - L05_CAM.pos[2]];
      const f = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
      if (f <= 0.8) continue;
      const px = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (f * tanH);
      const py = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (f * tanV);
      if (Math.abs(px) > 1.02 || Math.abs(py) > 1.02) continue;
      const side = Math.max(1, 150 / f);
      const area = (2 * side) * (2 * side);
      const id = String(block);
      if (accentIds.has(id)) accentArea += area;
      if (warmIds.has(id)) warmArea += area;
    }
    // 点缀色（幡/彩羊毛/花）只做小面积点缀：不超过画面 10%
    expect(accentArea / frameArea).toBeLessThanOrEqual(0.1);
    // 暖光（灯笼/营火/火把）成组出现，但也不能铺面
    expect(warmArea / frameArea).toBeLessThanOrEqual(0.05);
    // 主色必须是自然材质；不允许混凝土/釉面陶瓦/霓虹方块这类塑料感材质
    const ids = Object.values(snap.blocks) as string[];
    expect(ids.some(id => /concrete|terracotta|shroomlight|glowstone|sea_lantern|redstone_lamp/.test(id))).toBe(false);
  });

  it("空草地比例：画面下方采样多数落点都有近景道具/构筑", async () => {
    const snap = await preparedSnapshot();
    const { fwd, right, up, tanV, tanH } = camBasis();
    const propPoints: number[][] = [];
    for (const [key, block] of Object.entries(snap.blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      if (y >= 64 || String(block).includes("air")) propPoints.push([x, y, z]);
    }
    let samples = 0;
    let covered = 0;
    for (let sx = -0.9; sx <= 0.91; sx += 0.2) {
      for (let sy = -0.85; sy <= 0.21; sy += 0.2) {
        const dir = [0, 1, 2].map(i => fwd[i] + right[i] * sx * tanH + up[i] * sy * tanV);
        const dl = Math.hypot(dir[0], dir[1], dir[2]);
        const d = dir.map(v => v / dl);
        if (Math.abs(d[1]) < 1e-3) continue;
        const t = (L05_SCENE.groundY - L05_CAM.pos[1]) / d[1];
        if (t <= 0 || t > 45) continue;
        samples += 1;
        const hit = [L05_CAM.pos[0] + d[0] * t, L05_SCENE.groundY, L05_CAM.pos[2] + d[2] * t];
        if (propPoints.some(p => Math.hypot(p[0] - hit[0], p[2] - hit[2]) <= 3)) covered += 1;
      }
    }
    expect(samples).toBeGreaterThan(20);
    expect(covered / samples).toBeGreaterThanOrEqual(0.3);
  });

  it("参考解 + 挂门牌 = 通关 3 星", async () => {
    const { report } = await play({});
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（只铺了一号地的地基）", async () => {
    const { report } = await play({}, L05.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "houses-built")?.passed).toBe(false);
  });

  it("少挂门牌（没有织者之印）星数下降、不算通关", async () => {
    const { report } = await play({}, L05.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(1);
    expect(report.criteria.find(c => c.id === "signs-ready")?.passed).toBe(false);
  });

  it("隐藏变体一：五块地整体挪走、风格重排，参考解仍 3 星", async () => {
    const { report } = await play({ plots: SHIFTED, signs: signsOf(SHIFTED) });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("隐藏变体二：三种风格重排，参考解仍 3 星", async () => {
    const { report } = await play({ plots: PERMUTED, signs: signsOf(PERMUTED) });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("作弊：写死坐标的程序在地块挪走后被隐藏测试拦住", async () => {
    const { report } = await play({ plots: SHIFTED, signs: signsOf(SHIFTED) }, HARDCODED);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "h2a")?.passed).toBe(false);
  });

  it("作弊：在地块之外多摆一块方块会被「只在地块里摆」拦住", async () => {
    const extra = `${L05.code.referenceSolution}
golem.moveTo(5, 5)
golem.place("torch", 5, 64, 5)`;
    const { report } = await play({}, extra);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "h2a")?.passed).toBe(false);
  });

  it("挑战层「不复制粘贴」：挑战参考解通过", async () => {
    expect(await playChallenge(L05_CHALLENGE.reference)).toBe(true);
  });

  it("挑战层：主线参考解只认主线地块，不算过", async () => {
    expect(await playChallenge(L05.code.referenceSolution)).toBe(false);
  });

  it("挑战层：写死一栋房子的偷懒解不算过", async () => {
    expect(await playChallenge(HARDCODED)).toBe(false);
  });

  it("确定性：同一程序跑两次，世界快照完全一致", async () => {
    const a = await play({});
    const b = await play({});
    expect(digest(a.snap)).toBe(digest(b.snap));
  });
});
