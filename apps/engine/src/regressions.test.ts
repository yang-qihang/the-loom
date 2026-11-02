/**
 * 运行状态鲁棒性回归（用户反馈 7：第一次失败后粘正确参考解仍报错）+ 自动恢复场景。
 *
 * 覆盖（docs/49 §2.4）：
 * 1. 同一会话里 starter 失败已经把世界改脏 → 再跑参考解：引擎自动恢复场景（epoch+1、log 提示）并通过；
 * 2. 语法缺右括号：按语法错误处理（带行号），**不执行半截代码**（P0：TS parser 容错恢复会补全并真的改世界）；
 * 3. 并发/重复 run：第二次明确 409 INVALID_STATE（错误体带 message+hint），这一轮结束后可再次运行；
 * 4. SSE 断线重连：新连接不回放上一轮 error/hint/result 旧事件；reset 清空历史；
 * 5. 帧带 event id + 支持 Last-Event-ID 续传；error/result/state 事件带 runId（Studio 据此过滤旧事件）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "./server";
import { L01Content } from "../../../content/levels/L01.content";
import { L02Content } from "../../../content/levels/L02.content";

const L01_REFERENCE = L01Content.def.code.referenceSolution;
const L02_REFERENCE = L02Content.def.code.referenceSolution;
const L02_STARTER = L02Content.def.code.starterCode;

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface ErrorBody {
  error?: { code?: string; message?: string; hint?: string };
}

interface SseEvent {
  type: string;
  runId?: string;
  state?: string;
  epoch?: number;
  line?: string;
  message?: string;
  passed?: boolean;
  stars?: number;
  failures?: string[];
  playerBeatReady?: boolean;
  hint?: string;
  progress?: Array<{ id: string; passed: boolean }>;
  result?: { passed?: boolean; stars?: number; runId?: string; playerBeatReady?: boolean };
}

interface SseFrame {
  id: number | null;
  event: SseEvent;
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<JsonResponse<T & ErrorBody>> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T & ErrorBody };
}

async function getJson<T>(base: string, path: string): Promise<JsonResponse<T>> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: (await response.json()) as T };
}

interface SseHandle {
  frames: SseFrame[];
  waitFor: (predicate: (event: SseEvent) => boolean, timeoutMs?: number) => Promise<SseEvent>;
  close: () => void;
}

async function connectSse(base: string, sessionId: string, headers: Record<string, string> = {}, collectMs = 0): Promise<SseHandle> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];
  const response = await fetch(`${base}/api/events?sessionId=${sessionId}`, {
    headers: { accept: "text/event-stream", ...headers },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentId: number | null = null;
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
          const lines = frame.split("\n");
          const idLine = lines.find(line => line.startsWith("id: "));
          currentId = idLine ? Number(idLine.slice(4)) : null;
          const dataLine = lines.find(line => line.startsWith("data: "));
          if (dataLine) frames.push({ id: currentId, event: JSON.parse(dataLine.slice(6)) as SseEvent });
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // abort 时正常退出
    }
  })();
  const handle: SseHandle = {
    frames,
    waitFor: async (predicate, timeoutMs = 10_000) => {
      const startedAt = Date.now();
      for (;;) {
        const hit = frames.find(frame => predicate(frame.event));
        if (hit) return hit.event;
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`SSE 等待超时；已收到：${frames.map(frame => frame.event.type).join(", ")}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
    close: () => controller.abort(),
  };
  if (collectMs > 0) await new Promise(resolve => setTimeout(resolve, collectMs));
  return handle;
}

async function createSession(base: string, levelId: string): Promise<string> {
  const { status, body } = await postJson<{ sessionId: string }>(base, "/api/session", { levelId });
  expect(status).toBe(201);
  return body.sessionId;
}

interface SnapshotBody {
  state: string;
  sessionEpoch: number;
  events?: Array<{ type: string; actorType?: string; pos?: number[] }>;
  blocks?: Record<string, string>;
  agents?: Record<string, { pos: number[] }>;
  progress?: Array<{ id: string; passed: boolean }>;
  allPassed?: boolean;
  playerBeatDone?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe("运行状态鲁棒性回归（mock 引擎）", () => {
  let engine: StartedEngine;
  beforeAll(async () => {
    engine = await startEngine({ port: 0 });
  });
  afterAll(async () => {
    await engine.close();
  });

  it("P0-1：starter 失败改脏世界 → 同会话再跑参考解自动恢复场景并通过", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const sse = await connectSse(engine.url, sessionId);
    try {
      const run1 = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: L02_STARTER });
      expect(run1.status).toBe(202);
      const result1 = await sse.waitFor(event => event.type === "result" && event.runId === run1.body.runId);
      expect(result1.passed).toBe(false);

      const before = await getJson<SnapshotBody>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(before.body.state).toBe("READY");
      const epochBefore = before.body.sessionEpoch;

      const run2 = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: L02_REFERENCE });
      expect(run2.status).toBe(202);
      const result2 = await sse.waitFor(event => event.type === "result" && event.runId === run2.body.runId);
      // 旧的 bug：这里会报「(-16, 10) 这一格没有可以收走的 egg」等脏世界错误。
      expect(result2.failures ?? []).toEqual([]);
      expect(result2.playerBeatReady).toBe(true);

      const autoRestoreLog = sse.frames.find(
        frame => frame.event.type === "log" && String(frame.event.line ?? "").includes("自动恢复场景"),
      );
      expect(autoRestoreLog, "第二次 run 前必须自动恢复场景并提示").toBeTruthy();
      const after = await getJson<SnapshotBody>(engine.url, `/api/session/${sessionId}/snapshot`);
      expect(after.body.sessionEpoch).toBe(epochBefore + 1);

      const beat = await postJson<{ result: { passed: boolean; stars: number } }>(engine.url, "/api/player-beat", { sessionId });
      expect(beat.status).toBe(200);
      expect(beat.body.result.passed).toBe(true);
      expect(beat.body.result.stars).toBe(3);
    } finally {
      sse.close();
    }
  });

  it("P0-2：缺右括号判语法错误且不执行半截代码", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const before = await getJson<SnapshotBody>(engine.url, `/api/session/${sessionId}/snapshot`);
    const sse = await connectSse(engine.url, sessionId);
    try {
      const run = await postJson<{ runId: string }>(engine.url, "/api/run", {
        sessionId,
        source: 'golem.moveTo(perch1)\ngolem.collect("egg", perch1',
      });
      expect(run.status).toBe(202);
      const error = await sse.waitFor(event => event.type === "error");
      expect(error.message ?? "").toMatch(/SyntaxError/);
      expect(error.message ?? "").toContain("expected");
      expect(error.line).toBe(2);
      // 本 run 的 error 事件带 runId（Studio 只接受当前活跃 run 的事件）。
      expect(error.runId).toBe(run.body.runId);
      const result = await sse.waitFor(event => event.type === "result" && event.runId === run.body.runId);
      expect(result.passed).toBe(false);

      const after = await getJson<SnapshotBody>(engine.url, `/api/session/${sessionId}/snapshot`);
      const placements = (after.body.events ?? []).filter(event => event.type === "block.place");
      expect(placements, "语法错误不能产生任何世界写入").toEqual([]);
      expect(after.body.blocks?.["-16,65,10"]).toBe("minecraft:egg");
      expect(after.body.agents?.golem?.pos).toEqual(before.body.agents?.golem?.pos);
    } finally {
      sse.close();
    }
  });

  it("P1-3：并发/重复 run 明确 409（错误可读），该轮结束后可再次运行", async () => {
    const sessionId = await createSession(engine.url, "L01");
    const sse = await connectSse(engine.url, sessionId);
    try {
      // for(;;) 会触发沙箱超时，保证第二次 POST 落在 RUNNING 状态里。
      const first = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: "for (;;) { }" });
      expect(first.status).toBe(202);
      const second = await postJson(engine.url, "/api/run", { sessionId, source: L01_REFERENCE });
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe("INVALID_STATE");
      expect(second.body.error?.message).toContain("不能运行");
      expect(second.body.error?.hint).toBeTruthy();
      // 这一轮超时失败后状态回到 READY，可以继续跑（不用手动重建会话）。
      const failed = await sse.waitFor(event => event.type === "result" && event.runId === first.body.runId, 15_000);
      expect(failed.passed).toBe(false);
      const retry = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: L01_REFERENCE });
      expect(retry.status).toBe(202);
      const retried = await sse.waitFor(event => event.type === "result" && event.runId === retry.body.runId, 15_000);
      expect(retried.playerBeatReady).toBe(true);
    } finally {
      sse.close();
    }
  });

  it("P1-4：新 SSE 连接不回放旧 error/hint；帧带 id 且支持 Last-Event-ID 续传", async () => {
    const sessionId = await createSession(engine.url, "L01");
    const live = await connectSse(engine.url, sessionId);
    try {
      const run = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: "golem.moveTo(" });
      expect(run.status).toBe(202);
      await live.waitFor(event => event.type === "result" && event.runId === run.body.runId);
    } finally {
      live.close();
    }
    await sleep(200);

    // 模拟断线重连（浏览器没带 Last-Event-ID）：只允许 state/result/少量 log，绝不回放 error。
    const replay = await connectSse(engine.url, sessionId, {}, 500);
    try {
      const types = replay.frames.map(frame => frame.event.type);
      expect(types, `重连回放事件：${types.join(", ")}`).not.toContain("error");
      expect(types).not.toContain("hint");
      expect(types.every(type => ["state", "result", "log"].includes(type))).toBe(true);
      const replayedResults = replay.frames.filter(frame => frame.event.type === "result");
      expect(replayedResults.length).toBeLessThanOrEqual(1);
      const stateFrames = replay.frames.filter(frame => frame.event.type === "state");
      expect(stateFrames.some(frame => frame.event.state === "READY")).toBe(true);

      // Last-Event-ID 续传：只补发游标之后的事件。
      const ids = replay.frames.flatMap(frame => (typeof frame.id === "number" ? [frame.id] : []));
      expect(ids.length, "回放帧应带 id").toBeGreaterThan(0);
      const cursor = Math.max(...ids);
      const resumed = await connectSse(engine.url, sessionId, { "Last-Event-ID": String(cursor) }, 400);
      try {
        for (const frame of resumed.frames) {
          if (typeof frame.id === "number") expect(frame.id).toBeGreaterThan(cursor);
        }
      } finally {
        resumed.close();
      }
    } finally {
      replay.close();
    }
  });

  it("P1-4：reset 清空事件历史，旧 error/result 不再回放", async () => {
    const sessionId = await createSession(engine.url, "L02");
    const live = await connectSse(engine.url, sessionId);
    try {
      const run = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: "golem.moveTo(" });
      await live.waitFor(event => event.type === "error" && event.runId === run.body.runId);
      const reset = await postJson<{ state: string; epoch: number }>(engine.url, "/api/reset", { sessionId });
      expect(reset.status).toBe(200);
      expect(reset.body.state).toBe("READY");
    } finally {
      live.close();
    }
    const replay = await connectSse(engine.url, sessionId, {}, 500);
    try {
      expect(replay.frames.filter(frame => frame.event.type === "result")).toEqual([]);
      expect(replay.frames.filter(frame => frame.event.type === "error")).toEqual([]);
    } finally {
      replay.close();
    }
  });

  it("SSE 运行期事件带 runId（error/result/state），result 嵌套也带", async () => {
    const sessionId = await createSession(engine.url, "L01");
    const sse = await connectSse(engine.url, sessionId);
    try {
      const run = await postJson<{ runId: string }>(engine.url, "/api/run", { sessionId, source: "golem.moveTo(" });
      const error = await sse.waitFor(event => event.type === "error");
      expect(error.runId).toBe(run.body.runId);
      const result = await sse.waitFor(event => event.type === "result");
      expect(result.runId).toBe(run.body.runId);
      expect(result.result?.runId).toBe(run.body.runId);
      const runStates = sse.frames.filter(frame => frame.event.type === "state" && frame.event.runId === run.body.runId);
      expect(runStates.length).toBeGreaterThan(0);
    } finally {
      sse.close();
    }
  });

  it("错误响应带可操作提示：未知会话 404、STOPPED 后 run 409 + hint", async () => {
    const missing = await postJson(engine.url, "/api/run", { sessionId: "nope", source: L01_REFERENCE });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("NOT_FOUND");
    expect(missing.body.error?.hint).toBeTruthy();

    const sessionId = await createSession(engine.url, "L01");
    await postJson(engine.url, "/api/stop", { sessionId });
    const rejected = await postJson(engine.url, "/api/run", { sessionId, source: L01_REFERENCE });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe("INVALID_STATE");
    expect(rejected.body.error?.message).toContain("STOPPED");
    expect(rejected.body.error?.hint).toContain("重置本关");
  });
});
