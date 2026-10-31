import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { effectiveLines, validateLevel } from "../../packages/level-spec/src/index";
import { digestSnapshot } from "../../packages/session/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { GameSession, type ResultEvent } from "../../packages/session/src/index";
import { BASE_STANDS, L09, L09_CHALLENGE, L09Content, L09_SCENE, type L09LevelDef, type StandSpec } from "./L09.content";

/**
 * L09 验收（显式 await 草稿）：prepare → 跑学生程序（"explicit" 模式）→ 玩家节拍 → grade。
 * 注意：Engine/Session 的 runMode 选择等 task-51 完成后接入；本测试直接用 runner 的显式入口。
 */
async function play(source: string, content: LevelContent = L09Content, withPlayerBeat = true, mode: "auto-await" | "explicit" = "explicit") {
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source, mode);
  if (withPlayerBeat) await content.playerBeat!(port);
  const snapshot = await port.snapshot("L09");
  return { report: grade(content.def, snapshot), snapshot };
}

/** 克隆一份内容，替换场景变量（缺料 / 平移 / 台序 / 三坛）。 */
function withVars(patch: Record<string, unknown>): LevelContent {
  return {
    ...L09Content,
    def: { ...L09, world: { ...L09.world, vars: { ...L09.world.vars, ...patch } } },
  };
}

const shiftPos = (p: [number, number, number], dx: number, dz: number): [number, number, number] => [p[0] + dx, p[1], p[2] + dz];

const shiftedStands = (dx: number, dz: number): StandSpec[] =>
  BASE_STANDS.map(台 => ({
    ...台,
    stand: shiftPos(台.stand, dx, dz),
    shelf: shiftPos(台.shelf, dx, dz),
  }));

const withShiftedScene = (dx = 20, dz = 12): LevelContent =>
  withVars({
    brewStands: shiftedStands(dx, dz),
    cage: shiftPos(L09.world.vars.cage as [number, number, number], dx, dz),
    chest: shiftPos(L09.world.vars.chest as [number, number, number], dx, dz),
    cauldron: shiftPos(L09.world.vars.cauldron as [number, number, number], dx, dz),
    bell: shiftPos(L09.world.vars.bell as [number, number, number], dx, dz),
    eira: shiftPos(L09.world.vars.eira as [number, number, number], dx, dz),
  });

const THIRD_STAND: StandSpec = {
  id: "regen",
  name: "再生台",
  stand: [0, 65, -5],
  shelf: [0, 65, -3],
  ingredient: "ghast_tear",
  backup: "golden_carrot",
};

const withThreeStands = (dx = 0, dz = 0): LevelContent => {
  const base = withShiftedScene(dx, dz);
  const three = [
    ...(base.def.world.vars.brewStands as StandSpec[]),
    {
      ...THIRD_STAND,
      stand: shiftPos(THIRD_STAND.stand, dx, dz),
      shelf: shiftPos(THIRD_STAND.shelf, dx, dz),
    },
  ];
  return { ...base, def: { ...base.def, world: { ...base.def.world, vars: { ...base.def.world.vars, brewStands: three } } } };
};

/** 偷懒版：三坛一坛等完再一坛（顺序写法，过不了并发判定）。 */
const LAZY_THREE = `const vars = world.vars
const stands = vars.brewStands as { stand: [number, number, number]; shelf: [number, number, number]; ingredient: string }[]
async function 酿(台: { stand: [number, number, number]; shelf: [number, number, number]; ingredient: string }): Promise<void> {
  await golem.moveTo(台.stand[0], 台.stand[2])
  await golem.place("water_bottle", 台.stand[0], 台.stand[1], 台.stand[2])
  await golem.moveTo(台.shelf[0], 台.shelf[2])
  await golem.place(台.ingredient, 台.shelf[0], 台.shelf[1], 台.shelf[2])
  await golem.moveTo(台.stand[0], 台.stand[2])
  await golem.place("potion", 台.stand[0], 台.stand[1], 台.stand[2])
}
for (const 台 of stands) {
  await 酿(台)
}
const cauldron = vars.cauldron as [number, number, number]
await golem.moveTo(cauldron[0], cauldron[2])
for (let i = 0; i < 3; i++) {
  await golem.place("potion", cauldron[0], cauldron[1], cauldron[2])
}
await golem.say("三坛一坛一坛出坛")`;

/** 写死坐标版：只用基础工坊的坐标，换一套布局就失效。 */
const HARDCODED = `const 甲 = { stand: [-6, 65, -6], shelf: [-9, 65, -6] }
const 乙 = { stand: [6, 65, -6], shelf: [9, 65, -6] }
async function 酿(台: { stand: number[]; shelf: number[] }, 材料: string): Promise<void> {
  await golem.moveTo(台.stand[0], 台.stand[2])
  await golem.place("water_bottle", 台.stand[0], 台.stand[1], 台.stand[2])
  await golem.moveTo(台.shelf[0], 台.shelf[2])
  await golem.place(材料, 台.shelf[0], 台.shelf[1], 台.shelf[2])
  await golem.moveTo(台.stand[0], 台.stand[2])
  await golem.place("potion", 台.stand[0], 台.stand[1], 台.stand[2])
}
await 酿(甲, "fermented_spider_eye")
await 酿(乙, "glistering_melon")
await golem.moveTo(-10, -8)
await golem.place("potion", -10, 65, -8)
await golem.place("potion", -10, 65, -8)
await golem.place("potion", -10, 65, -8)
await golem.moveTo(10, 7)
await golem.place("golden_apple", 10, 65, 7)
await golem.moveTo(-7, 2)
await golem.place("air", -7, 65, 2)
await golem.moveTo(0, 14)
await golem.say("全部做完")`;

const challengeWith = async (source: string, content: LevelContent): Promise<boolean> => {
  const port = new MockWorldPort();
  await port.prepare(content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source, "explicit");
  return L09_CHALLENGE.check(makeGraderApi(await port.snapshot("L09")));
};

describe("L09 破晓之前（MockWorld · 显式 await 草稿）", () => {
  it("关卡定义通过基础校验（体量 / 阶段 / 挑战 / 引导 / runMode）", () => {
    expect(validateLevel(L09)).toEqual([]);
    const ref = effectiveLines(L09.code.referenceSolution);
    const starter = effectiveLines(L09.code.starterCode);
    expect(ref).toBeGreaterThanOrEqual(60);
    expect(ref - starter).toBeGreaterThanOrEqual(35);
    expect(L09.code.expectedLoc).toBe(ref);
    expect(L09.phases?.length).toBe(2);
    expect(L09.task.hiddenTests.length).toBeGreaterThanOrEqual(2);
    expect((L09 as L09LevelDef).runMode).toBe("explicit");
    expect(L09.narrative?.opening).toHaveLength(3);
    for (const line of L09.narrative!.opening) expect(line.length).toBeGreaterThan(0);
    expect(L09.narrative!.worldState).not.toMatch(/[A-Za-z]/);
    expect(L09.narrative!.whyYou).not.toMatch(/[A-Za-z]/);
  });

  it("显式 await 参考解 + 玩家节拍 = 通关 3 星", async () => {
    const { report } = await play(L09.code.referenceSolution);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.criteria.every(c => c.passed)).toBe(true);
  });

  it("starter（顺序版）未修改必然失败：并发判定过不了", async () => {
    const { report } = await play(L09.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "brews-overlap")?.passed).toBe(false);
  });

  it("漏写 await 会被显式运行时拦下（中文行号提示）", async () => {
    const missingAwait = L09.code.referenceSolution.replace(/\bawait /g, "");
    await expect(play(missingAwait)).rejects.toThrow(/还没等它做完/);
  });

  it("先存 Promise、稍后 await 的写法合法", async () => {
    const port = new MockWorldPort();
    await port.prepare(L09Content);
    await expect(
      runStudentProgram({ golem: port.agent("golem"), world: port.world }, 'const 话 = golem.say("先存着")\nawait 话\n', "explicit"),
    ).resolves.toBeUndefined();
  });

  it("Promise.all 的结果顺序不被依赖：酿造台顺序颠倒也 3 星", async () => {
    const content = withVars({ brewStands: [...BASE_STANDS].reverse() });
    const { report } = await play(L09.code.referenceSolution, content);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("隐藏变体一：缺一种材料，参考解换备方仍 3 星", async () => {
    const content = withVars({ materials: { weakness: "够", healing: "缺" } });
    const { report, snapshot } = await play(L09.code.referenceSolution, content);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.hidden.every(h => h.passed)).toBe(true);
    const backups = snapshot.events.filter(e => e.type === "block.place" && String(e.data?.block ?? "").endsWith("melon_slice"));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it("隐藏变体二：两种材料都缺，仍然完成", async () => {
    const content = withVars({ materials: { weakness: "缺", healing: "缺" } });
    const { report } = await play(L09.code.referenceSolution, content);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    expect(report.hidden.find(h => h.id === "backup-ingredient-used")?.passed).toBe(true);
  });

  it("隐藏变体三：工坊整体平移，参考解仍 3 星；写死坐标的程序失败", async () => {
    const content = withShiftedScene();
    const good = await play(L09.code.referenceSolution, content);
    expect(good.report.passed).toBe(true);
    expect(good.report.stars).toBe(3);

    const shiftedHardcoded = await play(HARDCODED, content);
    expect(shiftedHardcoded.report.passed).toBe(false);
    expect(shiftedHardcoded.report.hidden.find(h => h.id === "declared-positions-only")?.passed).toBe(false);
  });

  it("挑战层三态：三坛并行通过；偷懒顺序失败；写死坐标换布局失败", async () => {
    const three = withThreeStands();
    expect(await challengeWith(L09_CHALLENGE.reference!, three)).toBe(true);
    expect(await challengeWith(LAZY_THREE, three)).toBe(false);
    expect(await challengeWith(HARDCODED, withThreeStands(20, 12))).toBe(false);
  });

  it("挑战参考解不用 try/catch（先查材料再开火）", () => {
    expect(L09_CHALLENGE.reference).toBeTypeOf("string");
    expect(/\bcatch\b/.test(L09_CHALLENGE.reference!)).toBe(false);
  });

  it("确定性：同一程序 + 玩家节拍两次运行，快照 digest 与评分一致", async () => {
    const first = await play(L09.code.referenceSolution);
    const second = await play(L09.code.referenceSolution);
    expect(digestSnapshot(first.snapshot)).toBe(digestSnapshot(second.snapshot));
    expect(second.report).toEqual(first.report);
  });

  it("Session 读取 def.runMode=explicit：参考解 + 玩家节拍 = 3 星", async () => {
    const session = await GameSession.create(L09Content, new MockWorldPort());
    expect(session.runMode).toBe("explicit");
    const waitResult = (): Promise<ResultEvent> =>
      new Promise<ResultEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error("等待 result 超时"));
        }, 5000);
        const off = session.subscribe(event => {
          if (event.type !== "result") return;
          clearTimeout(timer);
          off();
          resolve(event);
        });
      });
    const firstResult = waitResult();
    await session.run(L09.code.referenceSolution);
    const afterRun = await firstResult;
    expect(afterRun.passed).toBe(false); // 缺玩家节拍
    const secondResult = waitResult();
    await session.playerBeat();
    const finalResult = await secondResult;
    expect(finalResult.passed).toBe(true);
    expect(finalResult.stars).toBe(3);
    await session.dispose();
  });

  it("场景钩子齐全，真实 Minecraft 版可复用同一套内容契约", () => {
    expect(L09Content.def.id).toBe("L09");
    expect(L09Content.prepare).toBeTypeOf("function");
    expect(L09Content.playerBeat).toBeTypeOf("function");
    expect(L09Content.challenge.id).toBe("L09-three-stands");
    expect((L09 as L09LevelDef).runMode).toBe("explicit");
  });

  // ---------- 破晓营地场景美术（docs/35 + 用户 2026-10-31 自然色红线） ----------
  const blockAt = (snap: { blocks: Record<string, string> }, p: [number, number, number]) =>
    snap.blocks[p.join(",")] ?? "minecraft:air";
  const countOf = (snap: { blocks: Record<string, string> }, id: string) =>
    Object.values(snap.blocks).filter(v => v === `minecraft:${id}`).length;
  const vars = L09.world.vars as {
    brewStands: StandSpec[]; cage: [number, number, number]; chest: [number, number, number];
    cauldron: [number, number, number]; bell: [number, number, number];
  };

  it("美术元数据：入夜前黄昏 12500、自然色板 60/30/10、主视角与可见清单", () => {
    expect(L09_SCENE.time).toBeGreaterThanOrEqual(12000);
    expect(L09_SCENE.time).toBeLessThanOrEqual(13000);
    expect(L09_SCENE.weather).toBe("clear");
    expect(L09_SCENE.floorY).toBe(64);
    expect(L09_SCENE.groundY).toBe(65);
    expect(L09_SCENE.palette.main.length).toBeGreaterThanOrEqual(2);
    expect(L09_SCENE.palette.secondary.length).toBeGreaterThanOrEqual(4);
    expect(L09_SCENE.palette.accentBudget).toBeLessThanOrEqual(0.1);
    expect(L09_SCENE.palette.forbidden).toEqual(expect.arrayContaining(["purple_", "blue_wool", "red_wool"]));
    expect(L09_SCENE.landmarks.length).toBeGreaterThanOrEqual(3);
    expect(L09_SCENE.mainCamera.time).toBe(L09_SCENE.time);
    expect(L09_SCENE.cameraHint.offset).toEqual([0, 5, 28]); // scene-shot --y 5 --z 28
    expect(L09_SCENE.expectedVisible.length).toBeGreaterThanOrEqual(3);
    expect(L09_SCENE.screenshotSpots.length).toBeGreaterThanOrEqual(3);
    for (const spot of L09_SCENE.screenshotSpots) {
      expect(spot.time).toBe(L09_SCENE.time);
      expect(spot.pos).toHaveLength(3);
      expect(spot.lookAt).toHaveLength(3);
    }
  });

  it("功能位保真：三座酿造台/材料架/木桶/炼药锅/牢笼/钟都在原位", async () => {
    const { snapshot: snap } = await play("await golem.say(\"准备\")", L09Content, false);
    // 上面只跑一个空程序，确保 prepare 已完成；直接读方块即可
    expect(blockAt(snap, vars.bell)).toBe("minecraft:bell");
    expect(blockAt(snap, vars.cauldron)).toBe("minecraft:cauldron");
    expect(blockAt(snap, vars.chest)).toBe("minecraft:barrel");
    expect(blockAt(snap, vars.cage)).toBe("minecraft:iron_bars");
    for (const 台 of vars.brewStands) {
      expect(blockAt(snap, 台.stand)).toBe("minecraft:brewing_stand");
      expect(blockAt(snap, 台.shelf)).toBe("minecraft:barrel");
    }
    expect(countOf(snap, "brewing_stand")).toBeGreaterThanOrEqual(3); // 两座功能台 + 一座备料台
  });

  it("自然色红线：无荧光紫/蓝/红/粉/草方块/树叶，点缀 ≤10%，主色 60%", async () => {
    const { snapshot: snap } = await play("await golem.say(\"准备\")", L09Content, false);
    const values = Object.values(snap.blocks);
    const total = values.length;
    const ids = values.map(v => v.replace("minecraft:", ""));
    // 禁止色：荧光紫/粉/绿、蓝/红羊毛、草方块、会衰变的树叶
    const banned = ids.filter(id => L09_SCENE.palette.forbidden.some(prefix => id.startsWith(prefix)));
    expect([...new Set(banned)]).toEqual([]);
    // 点缀（灯/火/花/玻璃瓶）≤10%
    const accent = ["lantern", "torch", "campfire", "shroomlight", "glass_pane", "poppy", "dandelion", "azure_bluet"];
    const accentCount = ids.filter(id => accent.includes(id)).length;
    expect(accentCount / total).toBeLessThanOrEqual(L09_SCENE.palette.accentBudget);
    // 主色泥土（约 60%）与次色石灰/木/帆布
    const earthCount = ids.filter(id => ["coarse_dirt", "moss_block", "gravel"].includes(id)).length;
    expect(earthCount / total).toBeGreaterThanOrEqual(0.45);
    expect(earthCount / total).toBeLessThanOrEqual(0.75);
    const secondary = ["stone_bricks", "mossy_stone_bricks", "cobblestone", "spruce_log", "spruce_planks", "dark_oak_planks", "white_wool", "brown_wool", "azalea"];
    expect(ids.filter(id => secondary.includes(id)).length / total).toBeGreaterThanOrEqual(0.2);
  });

  it("暖光密度：火焰/火把/灯笼足够点亮营地，不是黑屏", async () => {
    const { snapshot: snap } = await play("await golem.say(\"准备\")", L09Content, false);
    expect(countOf(snap, "lantern")).toBeGreaterThanOrEqual(8);
    expect(countOf(snap, "torch")).toBeGreaterThanOrEqual(6);
    expect(countOf(snap, "campfire")).toBeGreaterThanOrEqual(3);
    expect(countOf(snap, "shroomlight")).toBeGreaterThanOrEqual(1);
  });

  it("结构成立：钟架柱子落地 + 梁落在柱顶 + 铁链吊钟；帐篷杆落地 + 屋脊可见", async () => {
    const { snapshot: snap } = await play("await golem.say(\"准备\")", L09Content, false);
    // 钟架：柱子在 y65..68、横梁在 y69（G+4）落在柱顶、链子在梁下
    for (const dx of [-2, 2]) {
      for (let y = 65; y <= 68; y++) expect(blockAt(snap, [dx, y, vars.bell[2]])).toBeTruthy();
    }
    expect(blockAt(snap, [0, 69, vars.bell[2]])).toBe("minecraft:dark_oak_planks");
    expect(blockAt(snap, [0, 65, vars.bell[2]])).toBe("minecraft:bell");
    for (const y of [66, 67, 68]) expect(blockAt(snap, [0, y, vars.bell[2]])).toBe("minecraft:iron_chain");
    // 帐篷：三顶帐篷的屋脊（棕布）在 y68，杆子从 y65 落地
    expect(blockAt(snap, [-14, 68, -10])).toBe("minecraft:brown_wool");
    expect(blockAt(snap, [10, 68, -14])).toBe("minecraft:brown_wool");
    expect(blockAt(snap, [-16, 68, 4])).toBe("minecraft:brown_wool");
    // 三座酿造台都立在石台上（不是浮空）
    for (const 台 of vars.brewStands) expect(blockAt(snap, [台.stand[0], 64, 台.stand[2]])).toBe("minecraft:stone_bricks");
    expect(blockAt(snap, [0, 64, -10])).toBe("minecraft:stone_bricks");
  });

  it("主路净空：营地走廊 y65–67 只允许功能位，装饰不挡路", async () => {
    const { snapshot: snap } = await play("await golem.say(\"准备\")", L09Content, false);
    const allowed = new Set<string>();
    for (const 台 of vars.brewStands) { allowed.add(台.stand.join(",")); allowed.add(台.shelf.join(",")); }
    for (const p of [vars.chest, vars.cauldron, vars.cage, vars.bell]) allowed.add(p.join(","));
    const bad: string[] = [];
    for (const c of L09_SCENE.corridor) {
      for (let x = c.x0; x <= c.x1; x++) for (let z = c.z0; z <= c.z1; z++) {
        for (let y = 65; y <= 67; y++) {
          const cur = blockAt(snap, [x, y, z]);
          if (cur !== "minecraft:air" && !allowed.has(`${x},${y},${z}`)) bad.push(`${x},${y},${z}=${cur}`);
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it("文案与画面一致：黄昏入夜前，不再写「破晓/午夜/晨钟/天亮之前」", () => {
    const def = L09 as unknown as {
      meta: { title: { zh: string } };
      narrative?: { worldState: string; opening: string[]; whyYou: string };
      task: { mainTask: string; makeTask: string; playerBeat: string; successCriteria: Array<{ text: string }> };
      code: { starterCode: string; referenceSolution: string };
    };
    const all = [
      def.meta.title.zh,
      def.narrative?.worldState ?? "",
      ...(def.narrative?.opening ?? []),
      def.narrative?.whyYou ?? "",
      def.task.mainTask,
      def.task.makeTask,
      def.task.playerBeat,
      ...def.task.successCriteria.map(c => c.text),
      def.code.starterCode,
      def.code.referenceSolution,
    ].join("\n");
    expect(all).not.toMatch(/破晓之前|午夜|晨钟|天亮之前|黎明/);
    expect(def.meta.title.zh).toBe("入夜之前");
    expect(def.narrative?.opening[1] ?? "").toContain("入夜之前");
    // 场景时间与主视角保持一致
    expect(L09_SCENE.mainCamera.time).toBe(L09_SCENE.time);
    for (const spot of L09_SCENE.screenshotSpots) expect(spot.time).toBe(L09_SCENE.time);
  });
});
