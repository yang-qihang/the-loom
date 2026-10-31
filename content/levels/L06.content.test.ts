import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import type { WorldSnapshot } from "../../packages/protocol/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L06, L06Content, L06_CHALLENGE, L06_CORRIDOR, L06_SCENE } from "./L06.content";

type CargoItem = { id: string; kind: "tool" | "supply"; food?: boolean };
const cargoList = (v: unknown): CargoItem[] => v as CargoItem[];
const digest = (snap: WorldSnapshot): string => JSON.stringify(snap);

function withVars(patch: Record<string, unknown>): LevelContent {
  return {
    ...L06Content,
    def: { ...L06, world: { ...L06.world, vars: { ...L06.world.vars, ...patch } } },
  };
}

async function play(patch: Record<string, unknown>, source = L06.code.referenceSolution, withPlayerBeat = true) {
  const content = withVars(patch);
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snap = await port.snapshot("L06");
  return { report: grade(content.def, snap), snap };
}

async function playChallenge(source: string) {
  const content = withVars({});
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snap = await port.snapshot("L06");
  return L06_CHALLENGE.check(makeGraderApi(snap));
}

const MAIN_CARGO = cargoList(L06.world.vars.cargo);

/** 只跑场景搭建（不跑学生程序）的快照，用于美术检查。 */
async function preparedSnapshot(): Promise<WorldSnapshot> {
  const port = new MockWorldPort();
  await port.prepare(L06Content);
  return port.snapshot("L06");
}

const CAM = L06_SCENE.camera;
/** 把世界坐标投到 scene-shot.mjs 的真实机位画面坐标（fov 70、aspect 1.6、yaw 180、pitch 10）。 */
function camBasis() {
  const yaw = (CAM.yaw * Math.PI) / 180;
  const pitch = (CAM.pitch * Math.PI) / 180;
  const fwd = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const rightRaw = [-fwd[2], 0, fwd[0]];
  const rl = Math.hypot(rightRaw[0], rightRaw[2]);
  const right = [rightRaw[0] / rl, 0, rightRaw[2] / rl];
  const upRaw = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const ul = Math.hypot(upRaw[0], upRaw[1], upRaw[2]);
  const up = [upRaw[0] / ul, upRaw[1] / ul, upRaw[2] / ul];
  const tanV = Math.tan((CAM.fovDeg * Math.PI) / 360);
  return { fwd, right, up, tanV, tanH: tanV * CAM.aspect };
}
function project(target: number[]): { x: number; y: number; fwd: number } | null {
  const { fwd, right, up, tanV, tanH } = camBasis();
  const d = [target[0] - CAM.pos[0], target[1] - CAM.pos[1], target[2] - CAM.pos[2]];
  const f = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
  if (f <= 0.5) return null;
  return {
    x: (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (f * tanH),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (f * tanV),
    fwd: f,
  };
}
function inView(target: number[], bounds = 1): boolean {
  const p = project(target);
  return !!p && Math.abs(p.x) <= bounds && Math.abs(p.y) <= bounds;
}
/** 3 格宽主路走廊的格子（测试侧复算，装饰不得占这条带）。 */
function corridorKeys(): string[] {
  const keys: string[] = [];
  for (const seg of L06_CORRIDOR) {
    const dx = Math.sign(seg.x1 - seg.x0);
    const dz = Math.sign(seg.z1 - seg.z0);
    const steps = Math.max(Math.abs(seg.x1 - seg.x0), Math.abs(seg.z1 - seg.z0));
    for (let i = 0; i <= steps; i += 1) {
      const x = seg.x0 + dx * i;
      const z = seg.z0 + dz * i;
      for (let ox = -1; ox <= 1; ox += 1) for (let oz = -1; oz <= 1; oz += 1) {
        if (ox !== 0 && oz !== 0) continue;
        for (let y = 65; y <= 68; y += 1) keys.push(`${x + ox},${y},${z + oz}`);
      }
    }
  }
  return keys;
}

/** 隐藏变体一：货物数量与到货顺序都打乱（斧头两把、少一根胡萝卜）。 */
const SHUFFLED: CargoItem[] = [
  { id: "bread", kind: "supply", food: true },
  { id: "iron_axe", kind: "tool" },
  { id: "raw_iron", kind: "supply", food: false },
  { id: "iron_sword", kind: "tool" },
  { id: "iron_axe", kind: "tool" },
  { id: "honeycomb", kind: "supply", food: false },
  { id: "carrot", kind: "supply", food: true },
];

/** 隐藏变体二：验收送来一种没见过的工具（锄头）。 */
const NEW_TOOL: CargoItem[] = [...MAIN_CARGO, { id: "iron_hoe", kind: "tool" }];

/** 写死工具的偷懒解：只认斧、镐、剑，验收的新工具会被漏掉。 */
const HARDCODED = `const boxes = world.vars.boxes
golem.moveTo(boxes.tools[0][0], boxes.tools[0][2])
golem.place("iron_axe", boxes.tools[0][0], boxes.tools[0][1], boxes.tools[0][2])
golem.moveTo(boxes.tools[1][0], boxes.tools[1][2])
golem.place("iron_pickaxe", boxes.tools[1][0], boxes.tools[1][1], boxes.tools[1][2])
golem.moveTo(boxes.tools[2][0], boxes.tools[2][2])
golem.place("iron_sword", boxes.tools[2][0], boxes.tools[2][1], boxes.tools[2][2])
golem.say("三件工具放好了。")`;

describe("L06 商队的账本（MockWorld）", () => {
  it("关卡定义通过基础校验（参考解 ≥50 行、starter 差 ≥25、阶段与挑战齐全）", () => {
    expect(validateLevel(L06)).toEqual([]);
    expect(L06.phases?.length).toBe(3);
    expect(L06.challenge?.title).toContain("挑战");
    expect(L06.narrative?.opening.length).toBe(3);
  });

  it("场景数据：八件货（三件工具、两件食物）、三个工作点", () => {
    expect(MAIN_CARGO.length).toBe(8);
    expect(MAIN_CARGO.filter(item => item.kind === "tool").length).toBe(3);
    expect(MAIN_CARGO.filter(item => item.food === true).length).toBe(2);
    expect((L06.world.vars.jobs as unknown[]).length).toBe(3);
  });

  it("真实机位核对：arena 中心 (8,12) → playerSpawn → scene-shot 固定机位 (8,69,26)", () => {
    const cx = Math.round((L06_SCENE.clear.from[0] + L06_SCENE.clear.to[0]) / 2);
    const cz = Math.round((L06_SCENE.clear.from[2] + L06_SCENE.clear.to[2]) / 2);
    expect([cx, cz]).toEqual(CAM.spawnCenter);
    expect([cx, L06_SCENE.groundY + 4, cz + 14]).toEqual(CAM.pos);
    expect(L06_SCENE.time).toBe(12000);
  });

  it("主视角一屏能认出商队营地：帐篷、货箱、账本桌、营火、商队动物、暖光都在画面内", async () => {
    const snap = await preparedSnapshot();
    const blocks = snap.blocks as Record<string, string>;
    // 两顶帐篷 + 账本桌 + 营火 + 木箱（≥2）+ 两只羊驼
    expect(inView(L06_SCENE.tents.left.center)).toBe(true);
    expect(inView(L06_SCENE.tents.right.center)).toBe(true);
    expect(inView(L06_SCENE.ledger)).toBe(true);
    expect(inView(L06_SCENE.campfire)).toBe(true);
    const cratesInView = L06_SCENE.crates.filter(p => inView([p[0], p[1], p[2]])).length;
    expect(cratesInView).toBeGreaterThanOrEqual(2);
    const llamasInView = L06_SCENE.llamas.filter(p => inView(p)).length;
    expect(llamasInView).toBe(2);
    // 暖光至少 2 处在画面内，且分别是灯笼/营火
    const warmInView = L06_SCENE.warmLights.filter(p => {
      const id = blocks[p.join(",")] ?? "";
      return (id.endsWith("lantern") || id.endsWith("campfire")) && inView(p);
    });
    expect(warmInView.length).toBeGreaterThanOrEqual(2);
    // 动物与旅商在场景名单里
    const names = (L06.world.entities ?? []).map(entity => entity.name ?? "");
    expect(names).toContain("驮货的羊驼");
    expect(names).toContain("小羊驼");
    expect(names).toContain("驴");
    expect(names).toContain("旅商塔卡");
    // 近景（距离 < 20）可见道具数量：不是空草地
    let nearProps = 0;
    for (const [key] of Object.entries(blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      if (y < 65 || y > 70) continue;
      if (Math.hypot(x - CAM.pos[0], z - CAM.pos[2]) > 20) continue;
      if (inView([x, y, z], 0.98)) nearProps += 1;
    }
    expect(nearProps).toBeGreaterThanOrEqual(40);
  });

  it("点缀色预算：高饱和色（彩羊毛/花）≤ 画面 10%，暖光 ≤5%", async () => {
    const snap = await preparedSnapshot();
    const { fwd, right, up, tanV, tanH } = camBasis();
    const frameArea = 640 * 400;
    const accentIds = new Set([
      "minecraft:yellow_wool", "minecraft:orange_wool", "minecraft:red_wool",
      "minecraft:blue_wool", "minecraft:cyan_wool", "minecraft:lime_wool",
      "minecraft:magenta_wool", "minecraft:purple_wool", "minecraft:green_wool",
      "minecraft:poppy", "minecraft:cornflower", "minecraft:dandelion", "minecraft:azure_bluet",
    ]);
    const warmIds = new Set(["minecraft:lantern", "minecraft:campfire", "minecraft:torch"]);
    let accentArea = 0;
    let warmArea = 0;
    for (const [key, block] of Object.entries(snap.blocks)) {
      const [x, y, z] = key.split(",").map(Number);
      const d = [x + 0.5 - CAM.pos[0], y + 0.5 - CAM.pos[1], z + 0.5 - CAM.pos[2]];
      const f = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
      if (f <= 0.8) continue;
      const px = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (f * tanH);
      const py = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (f * tanV);
      if (Math.abs(px) > 1.02 || Math.abs(py) > 1.02) continue;
      const side = Math.max(1, 150 / f);
      const area = (2 * side) * (2 * side);
      if (accentIds.has(String(block))) accentArea += area;
      if (warmIds.has(String(block))) warmArea += area;
    }
    expect(accentArea / frameArea).toBeLessThanOrEqual(0.1);
    expect(warmArea / frameArea).toBeLessThanOrEqual(0.05);
    const ids = Object.values(snap.blocks) as string[];
    expect(ids.some(id => /concrete|terracotta|shroomlight|glowstone|sea_lantern|redstone_lamp/.test(id))).toBe(false);
  });

  it("稳定方块与实心落位：不用草方块/树叶，y≥66 道具都压在下一层方块上", async () => {
    const snap = await preparedSnapshot();
    const blocks = snap.blocks as Record<string, string>;
    const ids = Object.values(blocks);
    expect(ids.some(id => id.includes("grass_block"))).toBe(false);
    expect(ids.some(id => id.includes("oak_leaves"))).toBe(false);
    const occupied = new Set(Object.keys(blocks));
    for (const key of Object.keys(blocks)) {
      const y = Number(key.split(",")[1]);
      if (y < 66) continue;
      const [x, , z] = key.split(",").map(Number);
      expect(occupied.has(`${x},${y - 1},${z}`), `${key} 下方是空的（插件会补石柱）`).toBe(true);
    }
  });

  it("装饰避开评分点位与主路：放货格/工作点（y65）在学生动工前是空的", async () => {
    const snap = await preparedSnapshot();
    const blocks = snap.blocks as Record<string, string>;
    const boxes = L06.world.vars.boxes as { tools: number[][]; materials: number[][]; food: number[][] };
    for (const row of [boxes.tools, boxes.materials, boxes.food]) {
      for (const slot of row) expect(blocks[slot.join(",")]).toBeUndefined();
    }
    for (const job of L06.world.vars.jobs as Array<{ station: number[] }>) {
      expect(blocks[job.station.join(",")]).toBeUndefined();
    }
    // 货箱/旅商/护符盒是功能块，允许存在
    expect(blocks[(L06.world.vars.cargoBox as number[]).join(",")]).toBe("minecraft:chest");
    expect(blocks[(L06.world.vars.shrine as number[]).join(",")]).toBe("minecraft:chiseled_stone_bricks");
    // 主路走廊 y65–68 净空（货箱/旅商/护符盒这三个交互点是允许的例外）
    const furnitureKeys = new Set(
      [L06.world.vars.cargoBox, L06.world.vars.trader, L06.world.vars.shrine].map(p => (p as number[]).join(",")),
    );
    for (const key of corridorKeys()) {
      if (furnitureKeys.has(key)) continue;
      expect(blocks[key]).toBeUndefined();
    }
  });

  it("参考解 + 插织线 = 通关 3 星", async () => {
    const { report } = await play({});
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（只放了一把斧头）", async () => {
    const { report } = await play({}, L06.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "tools-box")?.passed).toBe(false);
  });

  it("少插织线（没有织者之印）只能拿 2 星", async () => {
    const { report } = await play({}, L06.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(2);
  });

  it("隐藏变体一：货物数量与顺序打乱，参考解仍 3 星", async () => {
    const { report } = await play({ cargo: SHUFFLED });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("隐藏变体二：验收送来没见过的工具，参考解仍 3 星", async () => {
    const { report } = await play({ cargo: NEW_TOOL });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("作弊：写死工具清单的偷懒解被隐藏测试拦住", async () => {
    const { report } = await play({ cargo: NEW_TOOL }, HARDCODED);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "h1a")?.passed).toBe(false);
  });

  it("挑战层「新增工具种类」：挑战参考解通过", async () => {
    expect(await playChallenge(L06_CHALLENGE.reference)).toBe(true);
  });

  it("挑战层：主线参考解只认主线货物，不算过", async () => {
    expect(await playChallenge(L06.code.referenceSolution)).toBe(false);
  });

  it("挑战层：写死三种工具的偷懒解不算过", async () => {
    expect(await playChallenge(HARDCODED)).toBe(false);
  });

  it("确定性：同一程序跑两次，世界快照完全一致", async () => {
    const a = await play({});
    const b = await play({});
    expect(digest(a.snap)).toBe(digest(b.snap));
  });
});
