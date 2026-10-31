import { describe, expect, it } from "vitest";
import { L01Content } from "../../../content/levels/L01.content";
import { MockWorldPort } from "../../worldport/src/mock-port";
import { digestSnapshot, GameSession, SessionError, type EngineEvent, type ResultEvent } from "./index";

const reference = L01Content.def.code.referenceSolution;
const starter = L01Content.def.code.starterCode;

function waitForResult(session: GameSession, predicate: (result: ResultEvent) => boolean = () => true): Promise<ResultEvent> {
  return new Promise<ResultEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待 result 事件超时"));
    }, 2000);
    const off = session.subscribe(event => {
      if (event.type === "result" && predicate(event)) {
        clearTimeout(timer);
        off();
        resolve(event);
      }
    });
  });
}

function waitForState(session: GameSession, state: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`等待状态 ${state} 超时`));
    }, 2000);
    const off = session.subscribe(event => {
      if (event.type === "state" && event.state === state) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function newSession(): Promise<GameSession> {
  return GameSession.create(L01Content, new MockWorldPort());
}

const LONG_SOURCE = Array.from({ length: 200 }, (_, i) => `golem.moveTo(${i}, 0)`).join("\n");

describe("GameSession 状态机与评分（MockWorldPort）", () => {
  it("创建会话：DISCONNECTED→READY，快照可用", async () => {
    const session = await newSession();
    try {
      expect(session.state).toBe("READY");
      expect(session.portKind).toBe("mock");
      const snapshot = await session.snapshot();
      expect(snapshot.levelId).toBe("L01");
      expect(snapshot.blocks).toBeTypeOf("object");
    } finally {
      await session.dispose();
    }
  });

  it("参考解：先失败（缺玩家节拍），玩家节拍后 PASSED 3 星", async () => {
    const session = await newSession();
    try {
      const first = waitForResult(session);
      await session.run(reference);
      const initial = await first;
      expect(initial.passed).toBe(false);
      expect(initial.failures.length).toBeGreaterThan(0);
      expect(initial.criteria.find(c => c.id === "player-lit-fourth")?.passed).toBe(false);

      const beat = await session.playerBeat();
      expect(beat.state).toBe("PASSED");
      expect(beat.result?.passed).toBe(true);
      expect(beat.result?.stars).toBe(3);
      expect(beat.result?.source).toBe("player-beat");
      expect(session.state).toBe("PASSED");
    } finally {
      await session.dispose();
    }
  });

  it("starter 未修改：判定失败", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(starter);
      const result = await resultPromise;
      expect(result.passed).toBe(false);
      expect(result.criteria.find(c => c.id === "four-lamps-lit")?.passed).toBe(false);
      expect(session.state).toBe("READY");
    } finally {
      await session.dispose();
    }
  });

  it("stop：撤销能力后拒绝新 run，reset 后可重跑", async () => {
    const session = await newSession();
    try {
      const run = await session.run(LONG_SOURCE);
      expect(run.runId).toMatch(/^run-/);
      await session.stop();
      expect(session.state).toBe("STOPPED");
      await expect(session.run(reference)).rejects.toBeInstanceOf(SessionError);

      await session.reset();
      expect(session.state).toBe("READY");
      const resultPromise = waitForResult(session);
      await session.run(reference);
      await resultPromise;
      const beat = await session.playerBeat();
      expect(beat.result?.passed).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it("reset 确定性：两次重置后的快照 digest 相同，epoch 递增", async () => {
    const session = await newSession();
    try {
      const first = await session.snapshot();
      const epoch0 = session.epoch;
      await session.reset();
      const second = await session.snapshot();
      expect(digestSnapshot(first)).toBe(digestSnapshot(second));
      expect(session.epoch).toBe(epoch0 + 1);
      await session.reset();
      const third = await session.snapshot();
      expect(digestSnapshot(third)).toBe(digestSnapshot(first));
    } finally {
      await session.dispose();
    }
  });

  it("epoch：运行中 reset 会作废旧运行，迟到结果不发布", async () => {
    const session = await newSession();
    try {
      await session.run(LONG_SOURCE);
      await session.reset();
      expect(session.state).toBe("READY");
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(session.lastResult).toBeNull();
      expect(session.state).toBe("READY");
    } finally {
      await session.dispose();
    }
  });

  it("commandId 幂等：重复提交返回同一 runId", async () => {
    const session = await newSession();
    try {
      const first = await session.run(LONG_SOURCE, { commandId: "cmd-1" });
      const second = await session.run(LONG_SOURCE, { commandId: "cmd-1" });
      expect(second.runId).toBe(first.runId);
      await session.stop();
    } finally {
      await session.dispose();
    }
  });

  it("事件流：state/log/objective/result/hint 都会发布", async () => {
    const session = await newSession();
    try {
      const events: EngineEvent[] = [];
      const seen = new Set<string>();
      const off = session.subscribe(event => {
        events.push(event);
        seen.add(event.type);
      });
      const resultPromise = waitForResult(session);
      await session.run(starter);
      await resultPromise;
      off();
      expect(seen.has("state")).toBe(true);
      expect(seen.has("log")).toBe(true);
      expect(seen.has("result")).toBe(true);
      expect(seen.has("objective")).toBe(true);
      expect(seen.has("hint")).toBe(true);
      expect(events.some(e => e.type === "state" && e.state === "VERIFYING")).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it("stop 之后状态事件到达 STOPPED，且等待状态可被观测", async () => {
    const session = await newSession();
    try {
      const stopped = waitForState(session, "STOPPED");
      await session.run(LONG_SOURCE);
      await session.stop();
      await stopped;
      expect(session.state).toBe("STOPPED");
    } finally {
      await session.dispose();
    }
  });
});
