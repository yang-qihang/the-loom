import { describe, expect, it } from "vitest";
import { grade } from "../../packages/grading/src/index";
import { validateLevel } from "../../packages/level-spec/src/index";
import { MockWorldPort } from "../../packages/worldport/src/mock-port";
import { createMultiAgentSdk, multiAgentConfigFromVars } from "../../packages/worldport/src/multi-agent-sdk";
import { runStudentProgram } from "../../packages/runner/src/run";
import { L10, L10Content } from "./L10.content";

async function play(source: string, withPlayerBeat = true) {
  const port = new MockWorldPort();
  await port.prepare(L10Content);
  const sdk = createMultiAgentSdk(multiAgentConfigFromVars(port, L10.world.vars));
  await runStudentProgram(sdk as never, source, "explicit");
  if (withPlayerBeat) await L10Content.playerBeat!(port);
  const snap = await port.snapshot("L10");
  return { report: grade(L10, snap), snap };
}

describe("L10 双织者（MockWorld · 双 agent）", () => {
  it("关卡定义通过基础校验（显式 await / 双阶段 / 挑战层 / 隐藏测试）", () => {
    expect(validateLevel(L10)).toEqual([]);
    expect(L10.phases?.length).toBe(2);
    expect((L10 as { runMode?: string }).runMode).toBe("explicit");
  });

  it("参考解 + 玩家合龙 = 3 星；桥面无缝、材料恰好、两只织偶都动过", async () => {
    const { report, snap } = await play(L10.code.referenceSolution);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
    for (const z of [-1, 0, 1]) {
      for (let x = 0; x < Number(L10.world.vars.deck); x++) {
        const id = snap.blocks[`${x},${L10.world.vars.deckY},${z}`];
        if (z === 0 && x === 12) expect(id).toBe("minecraft:lodestone");
        else expect(id).toBe("minecraft:oak_planks");
      }
    }
    const places = (snap.events ?? []).filter(e => e.type === "block.place" && e.actorType === "agent");
    expect(places.map(e => e.actor).sort()).toEqual(["LeftWeaver", "LeftWeaver", "RightWeaver", "RightWeaver"]);
  });

  it("starter 未修改必然失败（只由一只织偶铺一半，中央缺格且份额不均）", async () => {
    const { report } = await play(L10.code.starterCode);
    expect(report.passed).toBe(false);
    expect(report.criteria.find(c => c.id === "materials-exact")?.passed).toBe(false);
  });

  it("少放合龙石不满星：桥面差中央一格", async () => {
    const { report } = await play(L10.code.referenceSolution, false);
    expect(report.passed).toBe(false);
    expect(report.stars).toBeLessThan(3);
    expect(report.criteria.find(c => c.id === "keystone-by-player")?.passed).toBe(false);
  });

  it("确定性：同一程序跑两次，快照一致", async () => {
    const a = await play(L10.code.referenceSolution);
    const b = await play(L10.code.referenceSolution);
    expect(JSON.stringify(a.snap)).toBe(JSON.stringify(b.snap));
  });
});
