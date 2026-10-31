import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "../../../apps/engine/src/server";
import { L01Content } from "../../../content/levels/L01.content";
import type { EngineEvent } from "./index";

const reference = L01Content.def.code.referenceSolution;
const starter = L01Content.def.code.starterCode;
const LONG_SOURCE = Array.from({ length: 300 }, (_, i) => `golem.moveTo(${i % 20}, 0)`).join("\n");

let engine: StartedEngine;

beforeAll(async () => {
  engine = await startEngine({ port: 0 });
});

afterAll(async () => {
  await engine.close();
});

interface JsonResponse<T> {
  status: number;
  body: T;
}

async function getJson<T>(path: string): Promise<JsonResponse<T>> {
  const response = await fetch(`${engine.url}${path}`);
  return { status: response.status, body: (await response.json()) as T };
}

async function postJson<T>(path: string, body: unknown): Promise<JsonResponse<T>> {
  const response = await fetch(`${engine.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function createSession(): Promise<string> {
  const { status, body } = await postJson<{ sessionId: string }>("/api/session", { levelId: "L01" });
  expect(status).toBe(201);
  return body.sessionId;
}

interface SseHandle {
  events: EngineEvent[];
  waitFor: (predicate: (event: EngineEvent) => boolean, timeoutMs?: number) => Promise<EngineEvent>;
  close: () => void;
}

async function connectSse(sessionId: string): Promise<SseHandle> {
  const controller = new AbortController();
  const events: EngineEvent[] = [];
  const response = await fetch(`${engine.url}/api/events?sessionId=${sessionId}`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.body).not.toBeNull();
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
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)) as EngineEvent);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // abort 时正常退出
    }
  })();
  return {
    events,
    waitFor: async (predicate, timeoutMs = 3000) => {
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

describe("Engine HTTP API（MockWorldPort）", () => {
  it("GET /api/health 报告 mock 端口", async () => {
    const { status, body } = await getJson<{
      ok: boolean;
      port: string;
      mc: { kind: string };
      version: string;
    }>("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.port).toBe("mock");
    expect(body.mc.kind).toBe("mock");
    expect(body.version).toBe("1.0.0-t1");
  });

  it("GET /api/levels 与 /api/levels/:id", async () => {
    const list = await getJson<{ levels: Array<{ id: string; title: string }> }>("/api/levels");
    expect(list.status).toBe(200);
    expect(list.body.levels[0]).toMatchObject({ id: "L01", title: "第一缕光" });

    const detail = await getJson<{ def: typeof L01Content.def; starterCode: string }>("/api/levels/L01");
    expect(detail.status).toBe(200);
    expect(detail.body.def.id).toBe("L01");
    expect(detail.body.starterCode).toContain("golem.moveTo");

    const missing = await getJson<{ error: { code: string } }>("/api/levels/L99");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("POST /api/session 建会话并 prepare 场景", async () => {
    const sessionId = await createSession();
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("全流程：run 参考解 → result 失败（缺玩家节拍）→ player-beat → PASSED 3 星", async () => {
    const sessionId = await createSession();
    const sse = await connectSse(sessionId);
    try {
      const run = await postJson<{ runId: string; state: string }>("/api/run", { sessionId, source: reference });
      expect(run.status).toBe(202);
      expect(run.body.runId).toMatch(/^run-/);
      expect(["COMPILING", "RUNNING"]).toContain(run.body.state);

      const first = (await sse.waitFor(event => event.type === "result")) as Extract<EngineEvent, { type: "result" }>;
      expect(first.passed).toBe(false);
      expect(first.criteria.length).toBeGreaterThanOrEqual(4);

      const beat = await postJson<{ ok: boolean; state: string; result: { passed: boolean; stars: number } }>(
        "/api/player-beat",
        { sessionId },
      );
      expect(beat.status).toBe(200);
      expect(beat.body.ok).toBe(true);
      expect(beat.body.state).toBe("PASSED");
      expect(beat.body.result.passed).toBe(true);
      expect(beat.body.result.stars).toBe(3);

      await sse.waitFor(event => event.type === "state" && (event as { state?: string }).state === "PASSED");
      const passedState = sse.events.find(
        event => event.type === "state" && (event as { state?: string }).state === "PASSED",
      ) as { phase?: string } | undefined;
      expect(passedState?.phase).toBe("graded");
      const finalResult = sse.events.filter(event => event.type === "result").at(-1) as
        | { result?: { stars?: number } }
        | undefined;
      expect(finalResult?.result?.stars).toBe(3);
      const states = new Set(sse.events.filter(event => event.type === "state").map(event => (event as { state: string }).state));
      expect(states.has("READY")).toBe(true);
      expect(states.has("RUNNING") || states.has("COMPILING")).toBe(true);
      expect(states.has("VERIFYING")).toBe(true);
      expect(states.has("PASSED")).toBe(true);
      expect(sse.events.some(event => event.type === "log" && event.line.includes("golem."))).toBe(true);
    } finally {
      sse.close();
    }
  });

  it("starter 未修改：result 失败", async () => {
    const sessionId = await createSession();
    const sse = await connectSse(sessionId);
    try {
      await postJson("/api/run", { sessionId, source: starter });
      const result = (await sse.waitFor(event => event.type === "result")) as Extract<EngineEvent, { type: "result" }>;
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    } finally {
      sse.close();
    }
  });

  it("stop 后不能再 run；reset 后可以重跑并通过", async () => {
    const sessionId = await createSession();
    await postJson("/api/run", { sessionId, source: LONG_SOURCE });
    const stopped = await postJson<{ ok: boolean; state: string }>("/api/stop", { sessionId });
    expect(stopped.status).toBe(200);
    expect(stopped.body.state).toBe("STOPPED");

    const rejected = await postJson<{ error: { code: string } }>("/api/run", { sessionId, source: reference });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("INVALID_STATE");

    const reset = await postJson<{ ok: boolean; state: string; epoch: number }>("/api/reset", { sessionId });
    expect(reset.status).toBe(200);
    expect(reset.body.state).toBe("READY");
    expect(reset.body.epoch).toBe(1);

    const sse = await connectSse(sessionId);
    try {
      await postJson("/api/run", { sessionId, source: reference });
      await sse.waitFor(event => event.type === "result");
      await postJson("/api/player-beat", { sessionId });
      const result = (await sse.waitFor(
        event => event.type === "result" && (event as { passed?: boolean }).passed === true,
      )) as Extract<EngineEvent, { type: "result" }>;
      expect(result.stars).toBe(3);
    } finally {
      sse.close();
    }
  });

  it("参数校验：未知会话 404、缺 source 400、空 commandId 幂等", async () => {
    const missing = await postJson<{ error: { code: string } }>("/api/run", { sessionId: "nope", source: reference });
    expect(missing.status).toBe(404);

    const sessionId = await createSession();
    const bad = await postJson<{ error: { code: string } }>("/api/run", { sessionId });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_ARGUMENT");

    const first = await postJson<{ runId: string }>("/api/run", { sessionId, source: LONG_SOURCE, commandId: "cmd-http" });
    const second = await postJson<{ runId: string }>("/api/run", { sessionId, source: LONG_SOURCE, commandId: "cmd-http" });
    expect(first.status).toBe(202);
    expect(second.body.runId).toBe(first.body.runId);
    await postJson("/api/stop", { sessionId });
  });

  it("player-beat 端点可直接触发（无 run 时也能执行）", async () => {
    const sessionId = await createSession();
    const response = await postJson<{ ok: boolean; result: { passed: boolean } }>("/api/player-beat", { sessionId });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.result.passed).toBe(false);
  });
});
