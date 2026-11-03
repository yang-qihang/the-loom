import { describe, expect, it } from "vitest";
import { L02Content } from "../../../content/levels/L02.content";
import { MockWorldPort } from "../../worldport/src/mock-port";
import { GameSession, type ResultEvent } from "./index";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function resultOf(session: GameSession): Promise<ResultEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error("result timeout")); }, 3000);
    const off = session.subscribe(event => {
      if (event.type !== "result") return;
      clearTimeout(timer); off(); resolve(event);
    });
  });
}
async function run(session: GameSession, source: string) {
  const result = resultOf(session);
  await session.run(source);
  return result;
}

describe("运行异常、重置故障与旧回调恢复", () => {
  for (const source of [
    L02Content.def.code.starterCode + '\nthrow new Error("runtime failure")',
    'golem.moveTo(perch1)\ngolem.collect("egg", perch1)\ngolem.collect("egg", perch1)',
  ]) {
    it(`部分修改世界后异常，参考解重试自动恢复：${source.includes('throw') ? 'throw' : 'SDK error'}`, async () => {
      const session = await GameSession.create(L02Content, new MockWorldPort());
      try {
        expect((await run(session, source)).failures.length).toBeGreaterThan(0);
        const epoch = session.epoch;
        const next = await run(session, L02Content.def.code.referenceSolution);
        expect(session.epoch).toBe(epoch + 1);
        expect(next.failures).toEqual([]);
        expect(next.playerBeatReady).toBe(true);
        expect((await session.playerBeat()).result?.passed).toBe(true);
      } finally { await session.dispose(); }
    });
  }

  it("reset 后晚到的旧错误快照不得写回新 epoch", async () => {
    const entered = deferred(), release = deferred();
    class DelayedPort extends MockWorldPort {
      delay = true;
      override async snapshot(id: string) {
        if (this.delay) { this.delay = false; entered.resolve(); await release.promise; }
        return super.snapshot(id);
      }
    }
    const session = await GameSession.create(L02Content, new DelayedPort());
    try {
      await session.run('throw new Error("old failure")');
      await entered.promise;
      await session.reset();
      release.resolve();
      await new Promise(setImmediate);
      expect(session.lastResult).toBeNull();
      expect(session.recentEvents().filter(event => event.type === "result")).toEqual([]);
      expect(session.state).toBe("READY");
    } finally { release.resolve(); await session.dispose(); }
  });

  it("reset 后晚到的 actionbar 不得再次发布旧评分", async () => {
    const entered = deferred(), release = deferred();
    class DelayedFxPort extends MockWorldPort {
      delay = true;
      override async fx(action: Parameters<MockWorldPort["fx"]>[0]) {
        if (this.delay && action.kind === "actionbar") { this.delay = false; entered.resolve(); await release.promise; }
        return super.fx(action);
      }
    }
    const session = await GameSession.create(L02Content, new DelayedFxPort());
    try {
      await session.run(L02Content.def.code.referenceSolution);
      await entered.promise;
      await session.reset();
      release.resolve();
      await new Promise(setImmediate);
      expect(session.lastResult).toBeNull();
      expect(session.recentEvents().filter(event => event.type === "result")).toEqual([]);
      expect(session.state).toBe("READY");
    } finally { release.resolve(); await session.dispose(); }
  });

  for (const mode of ["level", "repl"] as const) {
    it(`${mode} 重置 RPC 临时失败后可以重试`, async () => {
      class FlakyPort extends MockWorldPort {
        fails = true;
        override async reset(content: typeof L02Content) {
          if (this.fails) { this.fails = false; throw new Error("temporary RPC timeout"); }
          await super.reset(content);
        }
      }
      const session = await GameSession.create(L02Content, new FlakyPort(), { mode });
      try {
        const reset = () => mode === "level" ? session.reset() : session.replReset();
        await expect(reset()).rejects.toThrow("temporary RPC timeout");
        expect(session.state).toBe("STOPPED");
        expect((await reset()).state).toBe("READY");
        expect(session.epoch).toBe(2);
      } finally { await session.dispose(); }
    });
  }
});
