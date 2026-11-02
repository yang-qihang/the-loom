/**
 * 本地演示（VITE_MOCK=1）参考解可跑通回归（P2-5）。
 *
 * 用户反馈/Lead 侦察：内容层 L01 starter/参考解都以 `/** … *\/` 块注释开头，
 * 而 apps/studio/src/mock/l01Runner.ts 原来只剥离 `//` 行注释 → 本地演示里参考解必报
 * 「第 1 行还没写完」。这里直接测本地解释器（Node 环境可运行，不需要浏览器）：
 * - 块注释被剥离且保留行号；
 * - 内容层参考解（命名点参数先展开）能被解析并真的点亮 1–3 号灯。
 */
import { describe, expect, it } from "vitest";
import { L01Content } from "../../../content/levels/L01.content";
import { MockWorld } from "../../../packages/mockworld/src/index";
import { expandNamedPointArgs } from "../../studio/src/engine/mockEngine";
import { executeL01, parseL01, stripBlockComments } from "../../studio/src/mock/l01Runner";

describe("本地演示解释器：块注释 + L01 参考解（P2-5）", () => {
  it("块注释被剥离且行号不变", () => {
    const source = ["/**", " * L01 说明", " */", "golem.moveTo(0, 6)"].join("\n");
    const stripped = stripBlockComments(source);
    expect(stripped).not.toContain("L01 说明");
    expect(stripped.split("\n")).toHaveLength(4);
    const parsed = parseL01(source);
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) {
      expect(parsed.statements).toHaveLength(1);
      expect(parsed.statements[0]).toMatchObject({ line: 4, kind: "moveTo", args: [0, 6] });
    }
  });

  it("内容层 L01 starter 的块注释不再被判成第 1 行没写完", () => {
    const parsed = parseL01(expandNamedPointArgs(L01Content.def.code.starterCode));
    expect("error" in parsed).toBe(false);
  });

  it("内容层 L01 参考解在本地演示里真的点亮 1–3 号灯", async () => {
    const source = expandNamedPointArgs(L01Content.def.code.referenceSolution);
    const parsed = parseL01(source);
    expect("error" in parsed, `parse error: ${"error" in parsed ? JSON.stringify(parsed.error) : ""}`).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.statements.length).toBeGreaterThanOrEqual(6);
    expect(parsed.statements.length).toBeLessThanOrEqual(12);
    const world = new MockWorld({ ...L01Content.def.world.vars });
    const logs: string[] = [];
    const error = await executeL01(world, parsed.statements, { onLog: () => logs.push("log"), isCancelled: () => false, stepDelayMs: 0 });
    expect(error).toBeNull();
    const lamps = L01Content.def.world.vars.lamps as number[][];
    const snapshot = world.snapshot("L01");
    for (const lamp of lamps.slice(0, 3)) {
      expect(snapshot.blocks[lamp.join(",")]).toBe("minecraft:lantern");
    }
    expect(logs.length).toBeGreaterThan(0);
  });
});
