import { describe, expect, it } from "vitest";
import { L01Content } from "../../../content/levels/L01.content";
import { MockWorldPort } from "../../worldport/src/mock-port";
import { digestSnapshot, GameSession, StaleSnapshotError, type EngineEvent, type ResultEvent } from "./index";

const reference = L01Content.def.code.referenceSolution;

async function newSession(): Promise<GameSession> {
  return GameSession.create(L01Content, new MockWorldPort());
}

function waitForResult(session: GameSession): Promise<ResultEvent> {
  return new Promise<ResultEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待 result 事件超时"));
    }, 4000);
    const off = session.subscribe(event => {
      if (event.type === "result") {
        clearTimeout(timer);
        off();
        resolve(event);
      }
    });
  });
}

describe("RT-04 快照绑定（epoch/runId/digest）", () => {
  it("result 携带 epoch / runId / snapshotDigest", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(reference);
      const result = await resultPromise;
      expect(result.runId).toMatch(/^run-/);
      expect(result.epoch).toBe(session.epoch);
      expect(result.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.snapshotDigest).toBe(result.digest);
    } finally {
      await session.dispose();
    }
  });

  it("当前快照可用绑定重评分", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(reference);
      const result = await resultPromise;
      const snapshot = await session.snapshot();
      const report = session.gradeWithBinding(snapshot, {
        runId: result.runId,
        epoch: result.epoch,
        digest: result.snapshotDigest,
      });
      expect(report.criteria.length).toBeGreaterThanOrEqual(4);
      expect(report.passed).toBe(false); // 还缺玩家节拍
    } finally {
      await session.dispose();
    }
  });

  it("reset 之后旧 epoch/digest 的快照评分被拒绝 STALE_SNAPSHOT", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(reference);
      const result = await resultPromise;
      const oldSnapshot = await session.snapshot();
      const binding = { runId: result.runId, epoch: result.epoch, digest: result.snapshotDigest };
      await session.reset();
      expect(() => session.gradeWithBinding(oldSnapshot, binding)).toThrow(StaleSnapshotError);
    } finally {
      await session.dispose();
    }
  });

  it("同 runId 但内容被替换的伪造快照被拒绝", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(reference);
      const result = await resultPromise;
      const real = await session.snapshot();
      const forged = { ...real, blocks: { ...real.blocks, "0,65,0": "minecraft:bedrock" } };
      expect(() =>
        session.gradeWithBinding(forged, {
          runId: result.runId,
          epoch: result.epoch,
          digest: digestSnapshot(forged),
        }),
      ).toThrow(StaleSnapshotError);
    } finally {
      await session.dispose();
    }
  });

  it("沙箱执行：process/require/globalThis 不可见（通过 say 日志观测）", async () => {
    const session = await newSession();
    try {
      const logs: string[] = [];
      const off = session.subscribe((event: EngineEvent) => {
        if (event.type === "log") logs.push(event.line);
      });
      const resultPromise = waitForResult(session);
      await session.run('golem.say("probe|" + typeof process + "|" + typeof require + "|" + typeof globalThis);');
      await resultPromise;
      off();
      expect(logs.some(line => line.includes("probe|undefined|undefined|undefined"))).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it("沙箱内篡改 world.vars 不影响评分（参考解仍 3 星）", async () => {
    const session = await newSession();
    try {
      const resultPromise = waitForResult(session);
      await session.run(`world.vars.lamps = [];\n${reference}`);
      const initial = await resultPromise;
      expect(initial.criteria.find(c => c.id === "four-lamps-lit")?.passed).toBe(false);
      const beat = await session.playerBeat();
      expect(beat.result?.passed).toBe(true);
      expect(beat.result?.stars).toBe(3);
    } finally {
      await session.dispose();
    }
  });
});
