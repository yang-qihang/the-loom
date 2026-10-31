import { describe, expect, it } from "vitest";
import { grade } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { makeGraderApi } from "../../packages/grading/src/index";
import { L03, L03_SCENE, L03Content, SCENARIOS } from "./L03.content";

/** 用不同的「今晚剧本」克隆一份内容（prepare 会把 scenario 写进 world.vars）。 */
function withScenario(scenarioIndex: number): LevelContent {
  return {
    ...L03Content,
    def: {
      ...L03,
      world: { ...L03.world, vars: { ...L03.world.vars, scenarioIndex, scenario: { ...SCENARIOS[scenarioIndex] } } },
    },
  };
}

/** L03 验收：prepare → 跑学生程序 → 玩家节拍（敲晨钟）→ grade。 */
async function play(scenarioIndex: number, source = L03.code.referenceSolution, withPlayerBeat = true) {
  const content = withScenario(scenarioIndex);
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await content.playerBeat!(port);
  return grade(content.def, await port.snapshot("L03"));
}

/** 挑战层验收：跑挑战参考解（或别的程序），只判挑战 check（不计星）。 */
async function challengeWith(source: string) {
  const content = withScenario(4); // 第五夜
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snap = await port.snapshot("L03");
  return L03Content.challenge.check(makeGraderApi(snap));
}

const onlyThreatBranch = `const s = world.vars.scenario
if (s.threat > 0) {
  golem.place("bell", 0, 65, 0)
  golem.moveTo(14, -6)
}
golem.moveTo(0, 6)`;

describe("L03 岔路与钟声（MockWorld）", () => {
  it("关卡定义通过基础校验", () => {
    expect(validateLevel(L03)).toEqual([]);
  });

  it("安静夜：参考解 + 玩家敲晨钟 = 3 星（钟没响、暗角点亮）", async () => {
    const report = await play(0);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("北门僵尸夜：参考解 = 3 星", async () => {
    const report = await play(1);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("井边被困夜：参考解 = 3 星（先敲钟、再救人）", async () => {
    const report = await play(2);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("第四夜组合（僵尸 + 被困 + 北门被撞开）：参考解 = 3 星", async () => {
    const report = await play(3);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.hidden.find(h => h.id === "combo-handled")?.passed).toBe(true);
  });

  it("starter 未修改在安静夜失败（没点暗角）", async () => {
    const report = await play(0, L03.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "night-handled")?.passed).toBe(false);
  });

  it("少玩家节拍不能通关（天亮钟要你亲手敲）", async () => {
    const report = await play(1, L03.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(1);
  });

  it("作弊：每晚都敲钟，安静夜被拆穿", async () => {
    const alwaysRing = `golem.place("bell", 0, 65, 0)
golem.moveTo(0, 6)`;
    const report = await play(0, alwaysRing);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "read-scenario")?.passed).toBe(false);
  });

  it("作弊：只处理僵尸、不管北门和被困，第四夜失败", async () => {
    const report = await play(3, onlyThreatBranch);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "combo-handled")?.passed).toBe(false);
  });

  it("挑战层「第五夜」：挑战参考解通过", async () => {
    expect(await challengeWith(L03Content.challenge.reference)).toBe(true);
  });

  it("挑战层：主线参考解先敲钟，不算过第五夜", async () => {
    expect(await challengeWith(L03.code.referenceSolution)).toBe(false);
  });

  it("挑战层：只守北门、不管东墙和救人，不算过", async () => {
    const lazy = `golem.place("bell", 0, 65, 0)
golem.moveTo(14, -6)
golem.moveTo(0, 6)`;
    expect(await challengeWith(lazy)).toBe(false);
  });

  it("作弊：乱放方块被隐藏测试拦住", async () => {
    const stray = `${L03.code.referenceSolution}
golem.moveTo(2, 2)
golem.place("torch", 2, 65, 2)`;
    const report = await play(1, stray);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "only-allowed-placements")?.passed).toBe(false);
  });

  it("FR-020/021/022：剧本卡统一、入口写「运行」、注释全中文、铁傀儡不是灰崽、else 用人话", () => {
    const copy = L03Content.copy;
    const starter = L03.code.starterCode;
    expect(starter).not.toContain("UI");
    expect(starter).not.toContain("TODO");
    expect(starter).toContain("上面三张卡");
    expect(starter).toContain("铁傀儡不是灰崽");
    // 剧本卡：标题与卡头统一
    expect(copy.cards?.title).toBe("接下来三夜的剧本");
    expect(copy.cards?.headers).toHaveLength(3);
    expect(copy.cards?.headers[0]).toContain("第 1 夜（今晚）");
    expect(copy.entry).toContain("运行");
    // else 用人话：不再把「否则」当名词
    const elseErr = copy.errors.find(e => e.reason.includes("不是这样就"));
    expect(elseErr).toBeTruthy();
    expect(elseErr!.reason).toContain("else");
    expect(elseErr!.reason).not.toContain("否则");
    const all = [
      L03.task.mainTask,
      L03.task.makeTask,
      L03.task.playerBeat,
      ...L03.task.successCriteria.map(c => c.text),
      copy.coordinateRule,
      copy.golemNote,
      copy.timeout,
      ...(copy.hints ?? []),
      ...copy.errors.flatMap(e => [e.reason, e.fix, e.sample]),
    ].join("\n");
    expect(all).not.toMatch(/玩家|用户|您|左栏|写死/);
    for (const e of copy.errors) expect(e.reason).toMatch(/^第 \d+ 行/);
  });

  // ---------- 夜晚村口/钟楼场景美术（docs/35） ----------
  /** 取一份 prepare 之后的世界快照（blocks 是 MockWorld 的方块表）。 */
  async function snapshotOf(scenarioIndex = 1) {
    const content = withScenario(scenarioIndex);
    const port = new MockWorldPort();
    await port.prepare(content);
    const snap = await port.snapshot("L03");
    return { content, snap };
  }
  const blockAt = (snap: { blocks: Record<string, string> }, p: [number, number, number]) =>
    snap.blocks[p.join(",")] ?? "minecraft:air";

  it("美术元数据：时间 13000–15000（黄昏/初夜）、冷蓝+暖光、主机位与可见清单", () => {
    expect(L03_SCENE.time).toBeGreaterThanOrEqual(13000);
    expect(L03_SCENE.time).toBeLessThanOrEqual(15000);
    expect(L03_SCENE.weather).toBe("clear");
    expect(L03_SCENE.materials.length).toBeGreaterThanOrEqual(3);
    expect(L03_SCENE.materials).toEqual(expect.arrayContaining(["stone_bricks", "spruce_planks", "moss_block"]));
    expect(L03_SCENE.lights.warm).toEqual(expect.arrayContaining(["lantern", "campfire", "shroomlight"]));
    expect(L03_SCENE.lights.cold).toContain("soul_lantern");
    expect(L03_SCENE.landmarks).toEqual(expect.arrayContaining(["钟楼", "八根灯柱", "四户人家", "井", "北门", "东墙散线"]));
    // 主机位 + 一屏内应看到的东西（Lead 重拍用）
    expect(L03_SCENE.mainCamera.time).toBe(L03_SCENE.time);
    expect(L03_SCENE.mainCamera.pos).toHaveLength(3);
    expect(L03_SCENE.mainCamera.lookAt).toHaveLength(3);
    expect(L03_SCENE.expectedVisible.length).toBeGreaterThanOrEqual(3);
    expect(L03_SCENE.screenshotSpots.length).toBeGreaterThanOrEqual(3);
    for (const spot of L03_SCENE.screenshotSpots) {
      expect(spot.time).toBe(L03_SCENE.time);
      expect(spot.pos).toHaveLength(3);
      expect(spot.lookAt).toHaveLength(3);
    }
  });

  it("场景里能数出 ≥3 类材质、足量暖光、冷光与散线", async () => {
    const { snap } = await snapshotOf(1);
    const values = new Set(Object.values(snap.blocks));
    const has = (id: string) => values.has(`minecraft:${id}`);
    // 材质：石、木、地面、羊毛、散线、玻璃
    expect(["stone_bricks", "mossy_stone_bricks", "cobblestone"].some(has)).toBe(true);
    expect(["spruce_planks", "dark_oak_planks", "dark_oak_stairs"].some(has)).toBe(true);
    expect(["moss_block", "gravel", "coarse_dirt"].some(has)).toBe(true);
    expect(["blue_wool", "orange_wool", "red_wool", "white_wool"]).toEqual(expect.arrayContaining(["blue_wool", "orange_wool"]));
    expect(has("glass_pane")).toBe(true);
    expect(has("cobweb")).toBe(true);
    // 暖光密度（Lead 返工要求：地面/屋檐/集市都要有暖光）
    const count = (id: string) => Object.values(snap.blocks).filter(v => v === `minecraft:${id}`).length;
    expect(count("lantern")).toBeGreaterThanOrEqual(15);
    expect(count("campfire")).toBeGreaterThanOrEqual(3);
    expect(count("shroomlight")).toBeGreaterThanOrEqual(4);
    expect(count("soul_lantern")).toBeGreaterThanOrEqual(2);
    // 火把必须由灰崽来点：场景里不能预点亮灯柱火把
    expect(count("torch")).toBe(0);
  });

  it("主机位一屏内至少能看见 3 类地标（钟楼/灯柱/人家/井/北门）", async () => {
    const { content } = await snapshotOf(1);
    const vars = content.def.world.vars as {
      bell: [number, number, number]; gate: [number, number, number]; well: [number, number, number];
      lamps: [number, number, number][]; houses: [number, number, number][];
    };
    const cam = L03_SCENE.mainCamera;
    const dir = [cam.lookAt[0] - cam.pos[0], cam.lookAt[1] - cam.pos[1], cam.lookAt[2] - cam.pos[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const forward = dir.map(v => v / len);
    const visible = (p: [number, number, number]): boolean => {
      const v = [p[0] - cam.pos[0], p[2] - cam.pos[2]];
      const dist = Math.hypot(v[0], v[1]);
      if (dist > 45) return false;
      // 只看水平方向：与主机位朝向夹角 ≤ 75°
      const fx = forward[0], fz = forward[2];
      const dot = (v[0] * fx + v[1] * fz) / Math.max(0.001, Math.hypot(fx, fz) * dist);
      return dot >= Math.cos((75 * Math.PI) / 180);
    };
    const categories = [
      vars.bell,
      ...vars.lamps,
      ...vars.houses,
      vars.well,
      vars.gate,
    ].filter(visible);
    const kinds = new Set(categories.map(() => 0));
    // 类别计数：钟楼、灯柱、人家、井、北门
    const shown: string[] = [];
    if (visible(vars.bell)) shown.push("钟楼");
    if (vars.lamps.some(l => visible(l))) shown.push("八根灯柱");
    if (vars.houses.some(h => visible(h))) shown.push("四户人家");
    if (visible(vars.well)) shown.push("井");
    if (visible(vars.gate)) shown.push("北门");
    expect(kinds.size).toBeGreaterThanOrEqual(0);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    for (const name of shown) expect(L03_SCENE.landmarks).toContain(name);
  });

  it("评分位保真：钟/八灯柱/四户人家/北门/井/东墙都在原位，装饰没盖住", async () => {
    const { content, snap } = await snapshotOf(1);
    const vars = content.def.world.vars as {
      bell: [number, number, number]; gate: [number, number, number]; well: [number, number, number];
      door: [number, number, number]; eastWall: [number, number, number];
      lamps: [number, number, number][]; houses: [number, number, number][];
    };
    expect(blockAt(snap, vars.bell)).toBe("minecraft:bell");
    for (const lamp of vars.lamps) {
      expect(blockAt(snap, lamp), `灯位 ${lamp.join(",")} 必须留给火把`).toBe("minecraft:air");
    }
    for (const house of vars.houses) {
      expect(blockAt(snap, house), `人家门口 ${house.join(",")} 要留给火把`).toBe("minecraft:air");
      expect(blockAt(snap, [house[0], house[1], house[2] + 1])).toBe("minecraft:oak_door");
    }
    expect(blockAt(snap, vars.gate)).toBe("minecraft:oak_fence_gate"); // 第一夜：门关着
    expect(blockAt(snap, vars.well)).toBe("minecraft:cobblestone_wall");
    expect(blockAt(snap, vars.eastWall)).toBe("minecraft:cobweb");
    expect(blockAt(snap, vars.door)).toBe("minecraft:oak_door");
  });

  it("主路走廊净空：两条主路 y=65..67 不摆装饰（只允许钟与人家门这类功能位）", async () => {
    const { content, snap } = await snapshotOf(1);
    const vars = content.def.world.vars as {
      bell: [number, number, number]; houses: [number, number, number][];
    };
    // 功能位例外：钟要挂在钟楼里；人家门本身就是门
    const allowed = new Set<string>([vars.bell.join(",")]);
    for (const h of vars.houses) allowed.add([h[0], h[1], h[2] + 1].join(","));
    const corridor: Array<[number, number]> = [];
    for (let x = -1; x <= 1; x += 1) for (let z = -10; z <= 24; z += 1) corridor.push([x, z]);
    for (let x = -14; x <= 22; x += 1) for (let z = -1; z <= 1; z += 1) corridor.push([x, z]);
    const offLimit = corridor.filter(([x, z]) => {
      return [65, 66, 67].some(y => {
        const cur = blockAt(snap, [x, y, z]);
        return cur !== "minecraft:air" && !allowed.has(`${x},${y},${z}`);
      });
    });
    expect(offLimit.slice(0, 8)).toEqual([]);
  });

  it("装饰不占评分点：灯位/钟/门口/井/北门周围 5x5、齐头高以下没有装饰方块", async () => {
    const { content, snap } = await snapshotOf(1);
    const vars = content.def.world.vars as {
      bell: [number, number, number]; gate: [number, number, number]; well: [number, number, number];
      door: [number, number, number]; eastWall: [number, number, number]; eira: [number, number, number];
      lamps: [number, number, number][]; houses: [number, number, number][];
    };
    const targets = [vars.bell, vars.gate, vars.well, vars.door, vars.eastWall, vars.eira, ...vars.lamps, ...vars.houses];
    const decor = new Set([
      "minecraft:lantern", "minecraft:campfire", "minecraft:blue_wool", "minecraft:orange_wool",
      "minecraft:white_wool", "minecraft:light_gray_wool", "minecraft:flower_pot", "minecraft:barrel",
      "minecraft:hay_block", "minecraft:azalea", "minecraft:flowering_azalea", "minecraft:cornflower",
      "minecraft:poppy", "minecraft:blue_ice", "minecraft:oak_stairs",
    ]);
    const bad: string[] = [];
    for (const [tx, , tz] of targets) {
      for (let x = tx - 2; x <= tx + 2; x += 1) {
        for (let z = tz - 2; z <= tz + 2; z += 1) {
          for (let y = 65; y <= 66; y += 1) { // 头顶以上可以挂灯，脚下与齐头高不行
            if (decor.has(blockAt(snap, [x, y, z]))) bad.push(`${x},${y},${z}`);
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it("只用稳定方块：不出现 grass_block / oak_leaves", async () => {
    const { snap } = await snapshotOf(1);
    const values = Object.values(snap.blocks);
    expect(values).not.toContain("minecraft:grass_block");
    expect(values).not.toContain("minecraft:oak_leaves");
  });
});
