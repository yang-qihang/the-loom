import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { grade, makeGraderApi } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import { MockWorld } from "../../packages/mockworld/src/index";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L01, L01_CHALLENGE, L01_COPY, L01Content, lampPlaceCall } from "./L01.content";

const lamps = L01.world.vars.lamps as [number, number, number][];

/** L01 验收：跑学生程序 → 玩家右键第 4 盏 → 评分。 */
async function play(source: string, withPlayerBeat = true) {
  const world = new MockWorld({ ...L01.world.vars });
  await runStudentProgram({ golem: world.golem, world: world.world }, source);
  if (withPlayerBeat) world.playerPlace("lantern", lamps[3]);
  return grade(L01, world.snapshot("L01"));
}

/** 挑战层验收：跑一段程序（+ 玩家点亮第 4 盏），只判挑战 check（不计星）。 */
async function challengeWith(source: string) {
  const world = new MockWorld({ ...L01.world.vars });
  await runStudentProgram({ golem: world.golem, world: world.world }, source);
  world.playerPlace("lantern", lamps[3]);
  return L01Content.challenge.check(makeGraderApi(world.snapshot("L01")));
}

const allCopyStrings = (): string[] => {
  const { def, copy } = L01Content;
  return [
    def.task.mainTask,
    def.task.makeTask,
    def.task.playerBeat,
    ...def.code.starterCode.split("\n").filter(l => l.trim().startsWith("//")),
    ...def.meta.objectives.map(o => o.learnerView),
    copy.coordinateRule,
    copy.golemNote,
    copy.timeout,
    ...copy.errors.flatMap(e => [e.reason, e.fix, e.sample]),
    ...(copy.hints ?? []),
    ...(copy.entry ? [copy.entry] : []),
  ];
};

describe("L01 第一缕光 · 内容层（Fresh Reader 修复）", () => {
  it("关卡定义通过基础校验", () => {
    expect(validateLevel(L01)).toEqual([]);
  });

  it("参考解 + 玩家节拍 = 通关 3 星", async () => {
    const report = await play(L01.code.referenceSolution);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（只点亮第 1 盏）", async () => {
    const report = await play(L01.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "four-lamps-lit")?.passed).toBe(false);
  });

  it("FR-009：按「第 2 个数是高度、第 3 个数是前后」写，灯就亮", async () => {
    const correct = `golem.moveTo(-12, 10)
${lampPlaceCall(0)}
golem.moveTo(-12, -2)
${lampPlaceCall(1)}
golem.moveTo(2, -2)
${lampPlaceCall(2)}
golem.moveTo(2, 16)
golem.moveTo(0, 6)`;
    const world = new MockWorld({ ...L01.world.vars });
    await runStudentProgram({ golem: world.golem, world: world.world }, correct);
    world.playerPlace("lantern", lamps[3]);
    const snap = world.snapshot("L01");
    for (const lamp of lamps) {
      expect(snap.blocks[lamp.join(",")]).toBe("minecraft:lantern");
    }
  });

  it("FR-009：把高度和前后写反，灯就点不亮（示例与错误说明对得上）", async () => {
    const swapped = `golem.moveTo(-12, 10)
golem.place("lantern", -12, 10, 14) // 把前后当成了高度
golem.moveTo(0, 6)`;
    const report = await play(swapped);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "four-lamps-lit")?.passed).toBe(false);
    expect(L01_COPY.coordinateRule).toContain("第二个数字管高低");
    expect(L01_COPY.coordinateRule).toContain("第三个数字管前后");
  });

  it("FR-009：4 个灯位的坐标高度都写在第二个数上（示例可互相核对）", () => {
    expect(lamps).toHaveLength(4);
    for (let i = 0; i < lamps.length; i++) {
      const [x, y, z] = lamps[i];
      expect(y).toBe(14); // 高度
      expect(lampPlaceCall(i)).toBe(`golem.place("lantern", ${x}, ${y}, ${z})`);
    }
    // spec 的说明与代码里的示例必须能互相核对
    const spec = fs.readFileSync("content/levels/L01-first-light.md", "utf8");
    expect(spec).not.toContain("第三个数字是高度");
    expect(spec).toContain("第二个数字是高度");
    expect(spec).toContain("第三个数字是前后");
  });

  it("FR-011/FR-031：错误固定「第 N 行 + 原因 + 可照抄写法」", () => {
    expect(L01_COPY.errors.length).toBeGreaterThanOrEqual(5);
    for (const e of L01_COPY.errors) {
      expect(e.reason).toMatch(/^第 \d+ 行/);
      expect(e.sample).toMatch(/^golem\./);
      expect(e.fix.length).toBeGreaterThan(6);
    }
    expect(L01_COPY.timeout).toContain("绕圈");
    expect(L01_COPY.timeout).toContain("重置");
  });

  it("FR-032：starter 注释全中文、没有 TODO，并说明 golem 就是灰崽", () => {
    const starter = L01.code.starterCode;
    expect(starter).not.toContain("TODO");
    expect(starter).not.toContain("右侧面板"); // FR-010：不再承诺不存在的面板
    expect(starter).toContain("golem 就是灰崽");
    expect(starter).toContain("第二个数字是高度");
    expect(starter).toContain("第三个数字是前后");
    // 注释里没有英文句子（只允许 golem/place/moveTo/lantern 这类代码名）
    for (const line of starter.split("\n")) {
      const comment = line.trim();
      if (!comment.startsWith("//")) continue;
      const latinWords = comment.replace(/golem|moveTo|place|lantern/gi, "").match(/[A-Za-z]{2,}/g) ?? [];
      expect(latinWords).toEqual([]);
    }
  });

  it("玩家可见文案：完整句、纯中文，不出现「玩家 / 用户 / 您」", () => {
    for (const text of allCopyStrings()) {
      expect(text).not.toMatch(/玩家|用户|您/);
      expect(text).not.toContain("TODO");
    }
    expect(L01.code.referenceSolution).not.toContain("?");
  });

  it("主线缺玩家节拍（没有织者之印）不能通关", async () => {
    const report = await play(L01.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "player-lit-fourth")?.passed).toBe(false);
  });

  it("挑战层：挑战参考解通过（一步不多走）", async () => {
    expect(await challengeWith(L01_CHALLENGE.reference!)).toBe(true);
  });

  it("挑战层：主线参考解不算过（多走了第 4 盏灯那一段）", async () => {
    expect(await challengeWith(L01.code.referenceSolution)).toBe(false);
  });

  it("挑战层：绕路解不算过（多走一段就失败）", async () => {
    const detour = `golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(2, 24)
golem.moveTo(0, 6)`;
    expect(await challengeWith(detour)).toBe(false);
  });

  it("挑战层：回头路解不算过（1→2→1→3→艾拉）", async () => {
    const backtrack = `golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(-12, 10)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(0, 6)`;
    expect(await challengeWith(backtrack)).toBe(false);
  });

  it("挑战层：写死坐标的解不算过", async () => {
    const hardcoded = `golem.moveTo(-2, 0)
golem.place("lantern", -2, 14, 0)
golem.moveTo(0, 6)`;
    expect(await challengeWith(hardcoded)).toBe(false);
  });

  it("挑战层不计星：绕路解主线仍 3 星，但挑战不过", async () => {
    const detour = `golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
golem.moveTo(2, 24)
golem.moveTo(0, 6)`;
    const report = await play(detour);
    expect(report.stars).toBe(3);
    expect(await challengeWith(detour)).toBe(false);
  });
});
