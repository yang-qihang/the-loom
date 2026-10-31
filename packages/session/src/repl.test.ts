import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "../../../apps/engine/src/server";
import { L01Content } from "../../../content/levels/L01.content";
import { MockWorldPort } from "../../worldport/src/mock-port";
import { GameSession, SessionError, type EngineEvent, type ReplHistoryEntry, type ReplResult, type ResultEvent } from "./index";

const reference = L01Content.def.code.referenceSolution;

function waitForResult(session: GameSession, predicate: (result: ResultEvent) => boolean = () => true): Promise<ResultEvent> {
  return new Promise<ResultEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待 result 事件超时"));
    }, 3000);
    const off = session.subscribe(event => {
      if (event.type === "result" && predicate(event)) {
        clearTimeout(timer);
        off();
        resolve(event);
      }
    });
  });
}

const createRepl = () => GameSession.create(L01Content, new MockWorldPort(), { mode: "repl" });

describe("试符台会话（mode: repl）", () => {
  it("4 条示例：say/moveTo/place 是动作，pos 返回值", async () => {
    const session = await createRepl();
    expect(session.mode).toBe("repl");

    const say = await session.repl('golem.say("你好，灰崽")');
    expect(say.ok).toBe(true);
    expect(say.kind).toBe("action");
    expect(say.display).toBe("灰崽照做了");
    expect(say.log.some(line => line.includes("golem.say"))).toBe(true);

    const move = await session.repl("golem.moveTo(2, 6)");
    expect(move.ok).toBe(true);
    expect(move.kind).toBe("action");

    const explicitAwait = await session.repl("await golem.moveTo(2, 6)");
    expect(explicitAwait.ok).toBe(true);
    expect(explicitAwait.kind).toBe("action");

    const place = await session.repl('golem.place("lantern", 2, 14, 6)');
    expect(place.ok).toBe(true);
    expect(place.kind).toBe("action");
    const afterPlace = await session.snapshot();
    expect(afterPlace.blocks["2,14,6"]).toBe("minecraft:lantern");

    const pos = await session.repl("golem.pos");
    expect(pos.ok).toBe(true);
    expect(pos.kind).toBe("value");
    expect(JSON.parse(pos.display)).toEqual([2, 65, 6]);

    // 表达式支持算术/属性访问，同样返回 JSON 安全值
    const math = await session.repl("golem.pos[0] + 3");
    expect(math.ok).toBe(true);
    expect(math.kind).toBe("value");
    expect(math.display).toBe("5");

    // 一次只试一句：多行直接拒绝
    const multi = await session.repl("golem.pos\ngolem.say(\"x\")");
    expect(multi.ok).toBe(false);
    expect(multi.kind).toBe("error");
    expect(multi.display).toContain("一次试一句");

    await session.dispose();
  });

  it("错误是中文人话，且失败后还能继续试", async () => {
    const session = await createRepl();
    const error = await session.repl("golem.fly()");
    expect(error.ok).toBe(false);
    expect(error.kind).toBe("error");
    expect(/[\u4e00-\u9fa5]/.test(error.display)).toBe(true);
    expect(error.display).not.toContain("is not a function");
    expect(error.error).toBe(error.display);

    // 世界层错误（离目标太远）原样中文展示
    const tooFar = await session.repl('golem.place("lantern", 100, 14, 100)');
    expect(tooFar.ok).toBe(false);
    expect(tooFar.display).toContain("太远");

    const after = await session.repl("golem.pos");
    expect(after.ok).toBe(true);
    await session.dispose();
  });

  it("死循环在超时内终止，且不会污染后续试符", async () => {
    const session = await GameSession.create(L01Content, new MockWorldPort(), { mode: "repl", replTimeoutMs: 300 });
    const started = Date.now();
    const timeout = await session.repl("while (true) {}");
    expect(Date.now() - started).toBeLessThan(2500);
    expect(timeout.ok).toBe(false);
    expect(timeout.kind).toBe("error");
    expect(timeout.display).toContain("太久");
    const recovered = await session.repl("golem.pos");
    expect(recovered.ok).toBe(true);
    await session.dispose();
  });

  it("重置试符台回到初始场景（history 保留）", async () => {
    const session = await createRepl();
    await session.repl("golem.moveTo(2, 6)");
    await session.repl('golem.place("lantern", 2, 14, 6)');
    expect((await session.snapshot()).blocks["2,14,6"]).toBe("minecraft:lantern");

    const reset = await session.replReset();
    expect(reset.state).toBe("READY");
    // prepare 会把 4 个灯位清成空气；重置后不应再有灯笼
    expect(reset.snapshot.blocks["2,14,6"]).toBeUndefined();
    for (const [x, y, z] of L01Content.def.world.vars.lamps as Array<[number, number, number]>) {
      expect(reset.snapshot.blocks[`${x},${y},${z}`] ?? "minecraft:air").toBe("minecraft:air");
    }
    expect(reset.epoch).toBe(1);
    expect(session.replHistory().length).toBe(2);

    const pos = await session.repl("golem.pos");
    expect(JSON.parse(pos.display)).toEqual([0, 65, 0]);
    await session.dispose();
  });

  it("history 按执行顺序记录", async () => {
    const session = await createRepl();
    await session.repl("golem.pos");
    await session.repl('golem.say("一")');
    await session.repl("golem.moveTo(2, 6)");
    const history = session.replHistory() as ReplHistoryEntry[];
    expect(history.map(entry => entry.line)).toEqual(["golem.pos", 'golem.say("一")', "golem.moveTo(2, 6)"]);
    expect(history.map(entry => entry.kind)).toEqual(["value", "action", "action"]);
    expect(history.every(entry => typeof entry.at === "number")).toBe(true);
    await session.dispose();
  });

  it("不影响关卡会话：不评分、不产生 result、关卡照常运行", async () => {
    const repl = await createRepl();
    const level = await GameSession.create(L01Content, new MockWorldPort());
    const replEvents: EngineEvent[] = [];
    repl.subscribe(event => replEvents.push(event));

    await repl.repl("golem.moveTo(2, 6)");
    const resultPromise = waitForResult(level);
    await level.run(reference);
    const result = await resultPromise;
    expect(result.type).toBe("result");
    expect(result.criteria.length).toBeGreaterThan(0);
    expect(replEvents.some(event => event.type === "result")).toBe(false);
    expect(repl.lastResult).toBeNull();
    await expect(repl.run("golem.pos")).rejects.toBeInstanceOf(SessionError);
    await expect(repl.run("golem.pos")).rejects.toMatchObject({ code: "INVALID_STATE" });

    // 关卡自身可继续 player-beat 拿到 3 星，试符台世界互不干扰
    const beat = await level.playerBeat();
    expect(beat.result?.stars).toBe(3);
    expect((await repl.snapshot()).agents.golem.pos).toEqual([2, 65, 6]);
    await repl.dispose();
    await level.dispose();
  });
});

describe("试符台 HTTP（/api/repl）", () => {
  let engine: StartedEngine;

  beforeAll(async () => {
    engine = await startEngine({ port: 0 });
  });

  afterAll(async () => {
    await engine.close();
  });

  async function postJson<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${engine.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
    const response = await fetch(`${engine.url}${path}`);
    return { status: response.status, body: (await response.json()) as T };
  }

  it("创建 repl 会话 → 4 条示例 → history → reset → 错误中文", async () => {
    const created = await postJson<{ sessionId: string; mode: string }>("/api/session", { levelId: "L01", mode: "repl" });
    expect(created.status).toBe(201);
    expect(created.body.mode).toBe("repl");
    const sessionId = created.body.sessionId;

    const lines: Array<[string, string]> = [
      ['golem.say("你好，灰崽")', "action"],
      ["golem.moveTo(2, 6)", "action"],
      ['golem.place("lantern", 2, 14, 6)', "action"],
      ["golem.pos", "value"],
    ];
    for (const [line, kind] of lines) {
      const response = await postJson<ReplResult>("/api/repl", { sessionId, line });
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.kind).toBe(kind);
    }

    const history = await getJson<{ entries: ReplHistoryEntry[] }>(`/api/repl/history?sessionId=${sessionId}`);
    expect(history.status).toBe(200);
    expect(history.body.entries.map(entry => entry.line)).toEqual(lines.map(([line]) => line));
    expect(history.body.entries.map(entry => entry.kind)).toEqual(lines.map(([, kind]) => kind));

    const reset = await postJson<{ ok: boolean; snapshot: { blocks: Record<string, string>; agents: { golem: { pos: number[] } } } }>(
      "/api/repl/reset",
      { sessionId },
    );
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);
    expect(reset.body.snapshot.blocks["2,14,6"]).toBeUndefined();
    for (const [x, y, z] of L01Content.def.world.vars.lamps as Array<[number, number, number]>) {
      expect(reset.body.snapshot.blocks[`${x},${y},${z}`] ?? "minecraft:air").toBe("minecraft:air");
    }
    expect(reset.body.snapshot.agents.golem.pos).toEqual([0, 65, 0]);

    const error = await postJson<ReplResult>("/api/repl", { sessionId, line: "golem.fly()" });
    expect(error.status).toBe(200);
    expect(error.body.ok).toBe(false);
    expect(error.body.kind).toBe("error");
    expect(/[\u4e00-\u9fa5]/.test(error.body.display)).toBe(true);
  });
});
