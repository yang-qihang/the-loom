/**
 * 引擎快照任务进度契约（docs/49 §2.3 自动检测）+ paper confirm-only 玩家节拍。
 *
 * 覆盖：
 * - GET /api/session/:id/snapshot 顶层与嵌套 snapshot 都带 progress/playerBeatReady/allPassed/
 *   playerBeatRequired/playerBeatDone/sessionEpoch/state（HttpEngine.snapshot 取嵌套路径，不能丢字段）；
 * - 参考解后 progress 逐条更新、playerBeatReady 正确；
 * - paper 模式 player-beat 默认 confirm-only：没看到玩家亲手放置 → 不通过 3 星；世界真值满足后才过；
 * - mock 模式默认模拟玩家节拍（tests 用 fake paper runtime 区分两种模式）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "./server";
import { MockWorldPort } from "../../../packages/worldport/src/mock-port";
import { L01Content } from "../../../content/levels/L01.content";
import { L02Content } from "../../../content/levels/L02.content";
import type { WorldRuntime } from "./world";

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface ProgressStepView {
  id: string;
  text: string;
  passed: boolean;
  player: boolean;
  hint?: string;
}

interface NestedSnapshotView {
  progress?: ProgressStepView[];
  playerBeatReady?: boolean;
  allPassed?: boolean;
  playerBeatRequired?: boolean;
  playerBeatDone?: boolean;
  sessionEpoch?: number;
  state?: string;
}

interface SnapshotEnvelope {
  sessionId: string;
  state: string;
  sessionEpoch: number;
  progress: ProgressStepView[];
  playerBeatReady: boolean;
  allPassed: boolean;
  playerBeatRequired: boolean;
  playerBeatDone: boolean;
  snapshot: NestedSnapshotView;
}

interface SseEvent {
  type: string;
  runId?: string;
  state?: string;
  passed?: boolean;
  stars?: number;
  progress?: Array<{ id: string; passed: boolean }>;
  playerBeatReady?: boolean;
  result?: { passed?: boolean; stars?: number; runId?: string };
}

/** fake paper runtime：只用来验证「引擎在 paper 模式下的 confirm-only 行为」，世界仍是 MockWorldPort。 */
function fakePaperRuntime(): WorldRuntime {
  return {
    mode: "paper",
    version: "test",
    init: async () => undefined,
    createPort: async () => new MockWorldPort(),
    health: async (sessions: number, uptimeSec: number) => ({
      ok: true,
      port: "paper",
      mc: { kind: "paper", connected: true },
      sessions,
      uptimeSec,
      version: "test",
    }),
    close: async () => undefined,
  };
}

async function getJson<T>(base: string, path: string): Promise<JsonResponse<T>> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: (await response.json()) as T };
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<JsonResponse<T>> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

interface SseHandle {
  events: SseEvent[];
  waitFor: (predicate: (event: SseEvent) => boolean, timeoutMs?: number) => Promise<SseEvent>;
  close: () => void;
}

async function connectSse(base: string, sessionId: string): Promise<SseHandle> {
  const controller = new AbortController();
  const events: SseEvent[] = [];
  const response = await fetch(`${base}/api/events?sessionId=${sessionId}`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = frame.split("\n").find(line => line.startsWith("data: "));
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)) as SseEvent);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // abort 时正常退出
    }
  })();
  return {
    events,
    waitFor: async (predicate, timeoutMs = 10_000) => {
      const startedAt = Date.now();
      for (;;) {
        const hit = events.find(predicate);
        if (hit) return hit;
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`SSE 等待超时；已收到：${events.map(event => event.type).join(", ")}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
    close: () => controller.abort(),
  };
}

async function createSession(base: string, levelId: string): Promise<string> {
  const { status, body } = await postJson<{ sessionId: string }>(base, "/api/session", { levelId });
  expect(status).toBe(201);
  return body.sessionId;
}

const referenceOf = (content: typeof L01Content | typeof L02Content): string => content.def.code.referenceSolution;

describe("snapshot 任务进度契约（mock 引擎）", () => {
  let engine: StartedEngine;
  beforeAll(async () => {
    engine = await startEngine({ port: 0 });
  });
  afterAll(async () => {
    await engine.close();
  });

  it("新建会话：顶层与嵌套 snapshot 都带 progress/playerBeat/epoch/state", async () => {
    const sessionId = await createSession(engine.url, "L01");
    const snapshot = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
    expect(snapshot.status).toBe(200);
    const top = snapshot.body;
    expect(top.state).toBe("READY");
    expect(top.sessionEpoch).toBe(0);
    expect(top.progress).toHaveLength(3);
    expect(top.progress.map(step => step.id)).toEqual(["l01-three-lamps", "l01-fourth-by-player", "l01-golem-home"]);
    expect(top.progress.filter(step => step.player).map(step => step.id)).toEqual(["l01-fourth-by-player"]);
    expect(top.progress[0]?.hint).toBeTruthy();
    expect(top.playerBeatRequired).toBe(true);
    expect(top.playerBeatDone).toBe(false);
    expect(top.allPassed).toBe(false);
    // HttpEngine.snapshot() 走 `data.snapshot ?? data`：嵌套对象必须也带全部进度字段。
    expect(Array.isArray(top.snapshot?.progress)).toBe(true);
    expect(top.snapshot.progress).toHaveLength(3);
    expect(top.snapshot.sessionEpoch).toBe(0);
    expect(top.snapshot.state).toBe("READY");
    expect(top.snapshot.playerBeatRequired).toBe(true);
    expect(top.snapshot.playerBeatDone).toBe(false);
  });

  it("参考解后：progress 逐条更新、playerBeatReady 表示轮到玩家", async () => {
    const sessionId = await createSession(engine.url, "L01");
    const sse = await connectSse(engine.url, sessionId);
    try {
      const run = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: referenceOf(L01Content) });
      expect(run.status).toBe(202);
      const result = await sse.waitFor(event => event.type === "result");
      expect(result.passed).toBe(false);
      expect(result.progress?.map(step => step.passed)).toEqual([true, false, true]);
      expect(result.playerBeatReady).toBe(true);
      const snapshot = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(snapshot.body.progress.map(step => step.passed)).toEqual([true, false, true]);
      expect(snapshot.body.playerBeatReady).toBe(true);
      expect(snapshot.body.allPassed).toBe(false);
    } finally {
      sse.close();
    }
  });

  it("L02 参考解后 allPassed=true 但玩家步骤未完成（playerBeatDone=false）", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const sse = await connectSse(engine.url, sessionId);
    try {
      await postJson(engine.url, "/api/run", { sessionId, source: referenceOf(L02Content) });
      await sse.waitFor(event => event.type === "result");
      const snapshot = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(snapshot.body.playerBeatRequired).toBe(true);
      expect(snapshot.body.playerBeatDone).toBe(false);
      expect(snapshot.body.allPassed).toBe(true);
    } finally {
      sse.close();
    }
  });

  it("mock 模式默认模拟玩家节拍：player-beat 直接 3 星，快照 playerBeatDone=true", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const sse = await connectSse(engine.url, sessionId);
    try {
      await postJson(engine.url, "/api/run", { sessionId, source: referenceOf(L02Content) });
      await sse.waitFor(event => event.type === "result");
      const beat = await postJson<{ simulate: boolean; result: { passed: boolean; stars: number } }>(engine.url, "/api/player-beat", {
        sessionId,
      });
      expect(beat.status).toBe(200);
      expect(beat.body.simulate).toBe(true);
      expect(beat.body.result.passed).toBe(true);
      expect(beat.body.result.stars).toBe(3);
      const snapshot = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(snapshot.body.playerBeatDone).toBe(true);
      expect(snapshot.body.allPassed).toBe(true);
      expect(snapshot.body.state).toBe("PASSED");
    } finally {
      sse.close();
    }
  });
});

describe("paper 模式 confirm-only 玩家节拍（fake paper runtime + MockWorldPort）", () => {
  let engine: StartedEngine;
  beforeAll(async () => {
    engine = await startEngine({ port: 0, world: fakePaperRuntime() });
  });
  afterAll(async () => {
    await engine.close();
  });

  it("未看到玩家亲手放置时 confirm-only 不给通过；显式模拟后才 3 星", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const sse = await connectSse(engine.url, sessionId);
    try {
      await postJson(engine.url, "/api/run", { sessionId, source: referenceOf(L02Content) });
      await sse.waitFor(event => event.type === "result");
      const before = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(before.body.playerBeatDone).toBe(false);

      // paper 模式：不传 simulate → confirm-only，只按真实世界评分。
      const confirm = await postJson<{ simulate: boolean; result: { passed: boolean; stars: number } }>(
        engine.url,
        "/api/player-beat",
        { sessionId },
      );
      expect(confirm.status).toBe(200);
      expect(confirm.body.simulate).toBe(false);
      expect(confirm.body.result.passed).toBe(false);

      const afterConfirm = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(afterConfirm.body.playerBeatDone).toBe(false);
      expect(afterConfirm.body.state).toBe("READY");

      // 测试/调试显式传 simulate=true：与 mock 一致地模拟玩家动作，验证通过路径。
      const simulated = await postJson<{ simulate: boolean; result: { passed: boolean; stars: number } }>(
        engine.url,
        "/api/player-beat",
        { sessionId, simulate: true },
      );
      expect(simulated.body.simulate).toBe(true);
      expect(simulated.body.result.passed).toBe(true);
      expect(simulated.body.result.stars).toBe(3);
      const after = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(after.body.playerBeatDone).toBe(true);
      expect(after.body.allPassed).toBe(true);
      expect(after.body.state).toBe("PASSED");
    } finally {
      sse.close();
    }
  });

  it("paper 模式场景恢复失败不应 500：reset 后快照回到初始进度", async () => {
    const sessionId = await createSession(engine.url, "L01");
    await postJson(engine.url, "/api/reset", { sessionId });
    const snapshot = await getJson<SnapshotEnvelope>(engine.url, `/api/session/${sessionId}/snapshot`);
    expect(snapshot.body.sessionEpoch).toBe(1);
    expect(snapshot.body.progress.every(step => step.passed === false)).toBe(true);
  });
});
