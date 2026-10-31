import { describe, expect, it } from "vitest";
import { MockWorld } from "../../mockworld/src/index";
import { L01, validateLevel } from "../../level-spec/src/index";
import { grade } from "../../grading/src/index";
import { runStudentProgram } from "./run";

const lamps = L01.world.vars.lamps as [number, number, number][];

describe("L01 垂直切片（MockWorld）", () => {
  it("关卡 spec 通过基础校验", () => {
    expect(validateLevel(L01)).toEqual([]);
  });

  it("参考解 + 玩家节拍 = 通关 3 星", async () => {
    const world = new MockWorld({ ...L01.world.vars });
    await runStudentProgram({ golem: world.golem, world: world.world }, L01.code.referenceSolution);
    world.playerPlace("lantern", lamps[3]);
    const report = grade(L01, world.snapshot());
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });

  it("starter 未修改必然失败", async () => {
    const world = new MockWorld({ ...L01.world.vars });
    await runStudentProgram({ golem: world.golem, world: world.world }, L01.code.starterCode);
    world.playerPlace("lantern", lamps[3]);
    const report = grade(L01, world.snapshot());
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "four-lamps-lit")?.passed).toBe(false);
  });

  it("玩家不参与第 4 盏灯则不能通关", async () => {
    const world = new MockWorld({ ...L01.world.vars });
    await runStudentProgram({ golem: world.golem, world: world.world }, L01.code.referenceSolution);
    const report = grade(L01, world.snapshot());
    expect(report.passed).toBe(false);
  });
});
