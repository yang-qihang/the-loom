import { afterEach, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "./server";
import type { WorldRuntime } from "./world";
import { MockWorldPort } from "../../../packages/worldport/src/mock-port";
import type { WorldPort, RichAgentActions } from "../../../packages/worldport/src/index";
import { GameSession } from "../../../packages/session/src/session";
import { L01Content } from "../../../content/levels/L01.content";

const engines: StartedEngine[] = [];
afterEach(async () => { for (const engine of engines.splice(0)) await engine.close(); });

function paperRuntime() {
  let creates = 0;
  const ports: MockWorldPort[] = [];
  const runtime: WorldRuntime = {
    mode: "paper", version: "test", init: async () => undefined, close: async () => undefined,
    health: async sessions => ({ ok: true, port: "paper", mc: { connected: true }, sessions, uptimeSec: 0, version: "test" }),
    createPort: async () => {
      creates++;
      const base = new MockWorldPort();
      ports.push(base);
      // 替身代表真实 runtime 提供的端口；调用和快照仍来自同一物理世界实例。
      return new Proxy(base, { get(target, key) {
        if (key === "kind") return "paper+bot";
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } }) as unknown as WorldPort;
    },
  };
  return { runtime, ports, creates: () => creates };
}

async function setup() {
  const world = paperRuntime();
  const engine = await startEngine({ port: 0, world: world.runtime });
  engines.push(engine);
  const post = async (path: string, body: unknown) => {
    const response = await fetch(engine.url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const snapshot = async (id: string) => await (await fetch(`${engine.url}/api/session/${id}/snapshot?view=hud`)).json() as Record<string, any>;
  return { ...world, engine, post, snapshot };
}

describe("真实 REPL 接线", () => {
  it("挂接当前关卡同一端口，不重建世界；执行后的坐标在原关卡可见", async () => {
    const ctx = await setup();
    const level = await ctx.post("/api/session", { levelId: "L01" });
    const id = level.body.sessionId;
    await ctx.ports[0]!.agent("golem").moveTo(2, 6);
    const repl = await ctx.post("/api/session", { levelId: "L01", mode: "repl", live: true });
    expect(repl.body.sessionId).toBe(id);
    expect(ctx.creates()).toBe(1);
    expect((await ctx.snapshot(id)).agents.golem.pos).toEqual([2, 65, 6]);
    const action = await ctx.post("/api/repl", { sessionId: id, line: "golem.moveTo(-12, -2)" });
    expect(action.body).toMatchObject({ ok: true, kind: "action" });
    expect((await ctx.snapshot(id)).agents.golem.pos).toEqual([-12, 65, -2]);
    expect((await ctx.snapshot(id)).state).toBe("READY");
    expect((await ctx.snapshot(id)).sessionEpoch).toBe(0);
    const reset = await ctx.post("/api/repl/reset", { sessionId: id });
    expect(reset.body.epoch).toBe(1);
    expect((await ctx.snapshot(id)).agents.golem.pos).toEqual([0, 65, 0]);
    expect((await ctx.post("/api/run", { sessionId: id, source: "golem.say('继续关卡')" })).status).toBe(202);
  });

  it("没有关卡时建立真实试符台；旧客户端的内存练习仍隔离", async () => {
    const ctx = await setup();
    const live = await ctx.post("/api/session", { levelId: "L02", mode: "repl", live: true });
    expect(live.body).toMatchObject({ port: "paper+bot", mode: "repl" });
    expect(ctx.creates()).toBe(1);
    expect((await ctx.post("/api/repl", { sessionId: live.body.sessionId, line: "golem.moveTo(2, 6)" })).body.ok).toBe(true);
    expect((await ctx.snapshot(live.body.sessionId)).agents.golem.pos).toEqual([2, 65, 6]);
    const isolated = await ctx.post("/api/session", { levelId: "L01", mode: "repl" });
    expect(isolated.body.port).toBe("mock");
    expect(ctx.creates()).toBe(1);
    expect((await ctx.snapshot(live.body.sessionId)).agents.golem.pos).toEqual([2, 65, 6]);
  });

  it("不把其它关卡误当当前世界，换关后撤销旧 REPL 接线", async () => {
    const ctx = await setup();
    const level = await ctx.post("/api/session", { levelId: "L01" });
    const oldId = level.body.sessionId;
    expect((await ctx.post("/api/session", { levelId: "L02", mode: "repl", live: true })).status).toBe(409);
    expect((await ctx.snapshot(oldId)).sessionEpoch).toBe(0);
    await ctx.post("/api/session", { levelId: "L01", mode: "repl", live: true });
    const next = await ctx.post("/api/session", { levelId: "L02" });
    expect((await ctx.post("/api/repl", { sessionId: oldId, line: "golem.pos" })).status).toBe(404);
    expect((await ctx.post("/api/repl", { sessionId: next.body.sessionId, line: "golem.pos" })).status).toBe(409);
  });

  it("真实 SDK 动作可等待较久，死循环仍使用短超时", async () => {
    class SlowPort extends MockWorldPort {
      override agent(name: string): RichAgentActions {
        const base = super.agent(name) as RichAgentActions;
        return { ...base, moveTo: async (x, z) => { await new Promise(resolve => setTimeout(resolve, 450)); await base.moveTo(x, z); } };
      }
    }
    const session = await GameSession.create(L01Content, new SlowPort(), { mode: "repl", replTimeoutMs: 300 });
    try {
      expect(await session.repl("golem.moveTo(2, 6)", { actionTimeoutMs: 2000 })).toMatchObject({ ok: true, kind: "action" });
      expect(await session.repl("while (true) {}", { actionTimeoutMs: 2000 })).toMatchObject({ ok: false, kind: "error", display: expect.stringContaining("0.3 秒") });
      expect(await session.repl("golem.say((() => { while (true) {} })())", { actionTimeoutMs: 2000 }))
        .toMatchObject({ ok: false, kind: "error", display: expect.stringContaining("0.3 秒") });
    } finally { await session.dispose(); }
  });

  it("单句期间禁止并发运行；reset 撤销旧 worker 且不写入迟到历史", async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    class WaitingPort extends MockWorldPort {
      override agent(name: string): RichAgentActions {
        const base = super.agent(name) as RichAgentActions;
        return { ...base, moveTo: async () => { entered(); await gate; } };
      }
    }
    const session = await GameSession.create(L01Content, new WaitingPort());
    try {
      const pending = session.repl("golem.moveTo(2, 6)", { allowLevel: true });
      await started;
      await expect(session.run("golem.say('不能并发')")).rejects.toMatchObject({ code: "INVALID_STATE" });
      await expect(session.repl("golem.pos", { allowLevel: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
      await expect(session.playerBeat()).rejects.toMatchObject({ code: "INVALID_STATE" });
      await session.reset();
      expect(await pending).toMatchObject({ ok: false, kind: "error" });
      expect(session.replHistory()).toHaveLength(0);
      expect(await session.repl("golem.pos", { allowLevel: true })).toMatchObject({ ok: true, kind: "value" });
    } finally { release(); await session.dispose(); }
  });
});
