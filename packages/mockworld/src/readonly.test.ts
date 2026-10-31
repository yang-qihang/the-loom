import { describe, expect, it } from "vitest";
import { deepFreeze, frozenClone, MockWorld } from "./index";

const INITIAL_VARS = {
  lamps: [
    [-12, 14, 10],
    [-12, 14, -2],
  ],
  nested: { count: 2, labels: ["a", "b"] },
};

describe("RT-03 world.vars 只读快照", () => {
  it("vars 是 deep-frozen 副本：顶层与嵌套都不可写", () => {
    const world = new MockWorld(structuredClone(INITIAL_VARS));
    expect(Object.isFrozen(world.vars)).toBe(true);
    expect(Object.isFrozen(world.vars.lamps)).toBe(true);
    expect(Object.isFrozen((world.vars.nested as { labels: string[] }).labels)).toBe(true);
    expect(() => {
      (world.vars as { lamps: unknown }).lamps = [];
    }).toThrow(TypeError);
    expect(() => {
      (world.vars.lamps as unknown[]).push([0, 0, 0]);
    }).toThrow(TypeError);
    expect(world.vars.lamps).toEqual(INITIAL_VARS.lamps);
  });

  it("attempted 篡改不污染评分快照（snapshot.vars 仍为原值）", () => {
    const world = new MockWorld(structuredClone(INITIAL_VARS));
    const before = world.snapshot("L01");
    try {
      (world.world.vars.lamps as number[][]).length = 0;
    } catch {
      // strict 模式下冻结写入会抛错；非严格模式静默失效，两者都不得污染
    }
    const after = world.snapshot("L01");
    expect(after.vars).toEqual(before.vars);
    expect((after.vars.lamps as number[][]).length).toBe(2);
  });

  it("snapshot 与构造参数隔离：改入参不影响世界", () => {
    const input = structuredClone(INITIAL_VARS);
    const world = new MockWorld(input);
    input.lamps.length = 0;
    expect((world.vars.lamps as number[][]).length).toBe(2);
  });

  it("deepFreeze/frozenClone 递归冻结且保持值不变", () => {
    const value = frozenClone(INITIAL_VARS);
    expect(value).toEqual(INITIAL_VARS);
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen((value.nested as { labels: string[] }).labels)).toBe(true);
  });
});
