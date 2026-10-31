import { describe, expect, it } from "vitest";
import { grade } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { runStudentProgram } from "../../packages/runner/src/run";
import { makeGraderApi } from "../../packages/grading/src/index";
import { L02, L02Content } from "./L02.content";

/** L02 验收：prepare → 跑学生程序 → 玩家节拍 → grade（MockWorld，全自动）。 */
async function play(source: string, withPlayerBeat = true) {
  const port = new MockWorldPort();
  await port.prepare(L02Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  if (withPlayerBeat) await L02Content.playerBeat!(port);
  return grade(L02, await port.snapshot("L02"));
}

/** 挑战层验收：跑挑战参考解（或别的程序），只判挑战 check（不计星）。 */
async function playChallenge(source: string) {
  const port = new MockWorldPort();
  await port.prepare(L02Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  const snap = await port.snapshot("L02");
  return L02Content.challenge.check(makeGraderApi(snap));
}

describe("L02 会数数的织偶（MockWorld）", () => {
  it("关卡定义通过基础校验", () => {
    expect(validateLevel(L02)).toEqual([]);
  });

  it("参考解 + 玩家节拍 = 通关 3 星", async () => {
    const report = await play(L02.code.referenceSolution);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败（只收了 1 枚蛋）", async () => {
    const report = await play(L02.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "six-collected")?.passed).toBe(false);
  });

  it("少玩家节拍只能拿 2 星", async () => {
    const report = await play(L02.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBe(2);
  });

  it("作弊：一次搬完（不分两趟）会被隐藏测试拦住", async () => {
    const oneTrip = `golem.moveTo(-16, 10)
golem.place("air", -16, 65, 10)
golem.moveTo(-14, 10)
golem.place("air", -14, 65, 10)
golem.moveTo(-12, 10)
golem.place("air", -12, 65, 10)
golem.moveTo(-10, 10)
golem.place("air", -10, 65, 10)
golem.moveTo(-8, 10)
golem.place("air", -8, 65, 10)
golem.moveTo(-6, 10)
golem.place("air", -6, 65, 10)
golem.moveTo(1, -6)
golem.place("egg", 1, 65, -6)
golem.moveTo(0, 6)
golem.say("木桶里有 6 枚蛋")`;
    const report = await play(oneTrip);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "two-trips")?.passed).toBe(false);
  });

  it("挑战层「一趟搬完」：挑战参考解通过", async () => {
    expect(await playChallenge(L02Content.challenge.reference)).toBe(true);
  });

  it("挑战层：主线参考解（两趟）不算过挑战", async () => {
    expect(await playChallenge(L02.code.referenceSolution)).toBe(false);
  });

  it("挑战层：见蛋就收（多拿）不算过挑战", async () => {
    const greedy = `golem.moveTo(-16, 10)
golem.place("air", -16, 65, 10)
golem.moveTo(-16, 12)
golem.place("air", -16, 65, 12)`;
    expect(await playChallenge(greedy)).toBe(false);
  });

  it("作弊：见蛋就收（连孵蛋窝一起）会被隐藏测试拦住", async () => {
    const greedy = `golem.moveTo(-16, 10)
golem.place("air", -16, 65, 10)
golem.moveTo(-14, 10)
golem.place("air", -14, 65, 10)
golem.moveTo(-12, 10)
golem.place("air", -12, 65, 10)
golem.moveTo(-10, 10)
golem.place("air", -10, 65, 10)
golem.moveTo(-8, 10)
golem.place("air", -8, 65, 10)
golem.moveTo(-6, 10)
golem.place("air", -6, 65, 10)
golem.moveTo(-16, 12)
golem.place("air", -16, 65, 12)
golem.moveTo(-14, 12)
golem.place("air", -14, 65, 12)
golem.moveTo(-12, 12)
golem.place("air", -12, 65, 12)
golem.moveTo(1, -6)
golem.place("egg", 1, 65, -6)
golem.moveTo(0, 6)
golem.say("木桶里有 9 枚蛋")`;
    const report = await play(greedy);
    expect(report.passed).toBe(false);
    expect(report.hidden.find(h => h.id === "only-egg-perches")?.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "hatch-intact")?.passed).toBe(false);
  });

  it("FR-016/017/018/019：术语统一、错误带行号与可照抄写法、麦穗节说清楚", () => {
    const copy = L02Content.copy;
    const def = L02;
    const all = [
      def.task.mainTask,
      def.task.makeTask,
      def.task.playerBeat,
      ...def.task.successCriteria.map(c => c.text),
      copy.coordinateRule,
      copy.golemNote,
      copy.timeout,
      ...(copy.hints ?? []),
      ...copy.errors.flatMap(e => [e.reason, e.fix, e.sample]),
    ].join("\n");
    // 术语统一：带玻璃罩的窝 / 木桶 / 小筐
    expect(all).toContain("带玻璃罩的窝");
    expect(all).toContain("木桶");
    expect(all).toContain("小筐");
    expect(all).not.toMatch(/玩家|用户|您|写死|玻璃罩不能动|孵蛋窝/);
    // 麦穗节背景一句话讲清
    expect(def.task.mainTask).toContain("麦穗节");
    expect(def.task.mainTask).toContain("蛋糕");
    expect(def.task.mainTask).toContain("木桶");
    // 错误固定「第 N 行 + 原因 + 可照抄写法」
    for (const e of copy.errors) {
      expect(e.reason).toMatch(/^第 \d+ 行/);
      expect(e.fix.length).toBeGreaterThan(8);
      expect(e.sample.length).toBeGreaterThan(3);
    }
    expect(def.code.starterCode).not.toContain("TODO");
  });
});
