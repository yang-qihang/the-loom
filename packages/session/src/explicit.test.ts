import { describe, expect, it } from "vitest";
import { L01Content } from "../../../content/levels/L01.content";
import { L02Content } from "../../../content/levels/L02.content";
import { L03Content } from "../../../content/levels/L03.content";
import { L04Content } from "../../../content/levels/L04.content";
import { L05Content } from "../../../content/levels/L05.content";
import { L06Content } from "../../../content/levels/L06.content";
import { L07Content } from "../../../content/levels/L07.content";
import { L08Content } from "../../../content/levels/L08.content";
import type { AgentActions, LevelContent } from "../../worldport/src/index";
import { MockWorldPort } from "../../worldport/src/mock-port";
import { GameSession, levelRunMode, type EngineEvent, type ResultEvent } from "./index";

const reference = L01Content.def.code.referenceSolution;

/** 把 L01 参考解改成 Act III 显式 await 版本（仅测试用，不改 content）。 */
function toExplicitSource(source: string): string {
  return source
    .split("\n")
    .map(line => line.replace(/^(\s*)golem\.(moveTo|place|say)\(/, "$1await golem.$2("))
    .join("\n");
}

/** 给 level.def.meta 打上 runMode:"explicit"（协议 schema 尚未收编该可选字段，测试里断言读取路径）。 */
function withExplicit(base: LevelContent): LevelContent {
  const def = { ...base.def, meta: { ...base.def.meta, runMode: "explicit" } };
  return { ...base, def } as unknown as LevelContent;
}

function waitForResult(session: GameSession): Promise<ResultEvent> {
  return new Promise<ResultEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待 result 事件超时"));
    }, 3000);
    const off = session.subscribe(event => {
      if (event.type === "result") {
        clearTimeout(timer);
        off();
        resolve(event);
      }
    });
  });
}

/** 每次 moveTo/place/say 慢 40ms 的端口：用于验证 Promise.all 真的并行。 */
class SlowPort extends MockWorldPort {
  readonly marks: Array<{ start: number; end: number }> = [];

  override agent(name: string): AgentActions {
    const base = super.agent(name);
    const marks = this.marks;
    const delay = () => new Promise<void>(resolve => setTimeout(resolve, 40));
    return {
      get pos() {
        return base.pos;
      },
      async moveTo(x: number, z: number): Promise<void> {
        const start = Date.now();
        await delay();
        marks.push({ start, end: Date.now() });
        return base.moveTo(x, z);
      },
      async place(block: string, x: number, y: number, z: number): Promise<void> {
        await delay();
        return base.place(block, x, y, z);
      },
      async say(text: string): Promise<void> {
        await delay();
        return base.say(text);
      },
    };
  }
}

describe("session 按 level meta.runMode 选择运行模式（Act III explicit）", () => {
  it("显式 await 参考解通过，玩家节拍拿到 3 星", async () => {
    const session = await GameSession.create(withExplicit(L01Content), new MockWorldPort());
    expect(session.runMode).toBe("explicit");

    const errors: EngineEvent[] = [];
    session.subscribe(event => {
      if (event.type === "error") errors.push(event);
    });
    const resultPromise = waitForResult(session);
    await session.run(toExplicitSource(reference));
    const result = await resultPromise;
    expect(errors).toHaveLength(0);
    expect(result.failures.some(failure => failure.includes("await"))).toBe(false);

    const beat = await session.playerBeat();
    expect(beat.result?.stars).toBe(3);
    await session.dispose();
  });

  it("LevelDef 顶层 runMode（L09 当前写法）同样被识别", async () => {
    const def = { ...L01Content.def, runMode: "explicit" };
    const level = { ...L01Content, def } as unknown as LevelContent;
    expect(levelRunMode(level)).toBe("explicit");
    const session = await GameSession.create(level, new MockWorldPort());
    expect(session.runMode).toBe("explicit");
    await session.dispose();
  });

  it("漏 await：中文提示 + 行号进 error 事件与 result.failures，世界不动", async () => {
    const session = await GameSession.create(withExplicit(L01Content), new MockWorldPort());
    const events: EngineEvent[] = [];
    session.subscribe(event => events.push(event));
    const expectedLine = reference.split("\n").findIndex(line => /^\s*golem\./.test(line)) + 1;
    expect(expectedLine).toBeGreaterThan(1);

    const resultPromise = waitForResult(session);
    await session.run(reference); // Act I 写法，放到 explicit 模式里应被拦下
    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("await");
    expect(result.failures[0]).toContain("还没等它做完");

    const errorEvent = events.find(event => event.type === "error");
    expect(errorEvent && errorEvent.type === "error" ? errorEvent.line : undefined).toBe(expectedLine);
    expect(errorEvent && errorEvent.type === "error" ? errorEvent.message : "").toContain(`第 ${expectedLine} 行`);

    // 静态检查在运行前拦下 → 世界没有被改动
    const snapshot = await session.snapshot();
    expect(snapshot.agents.golem.pos).toEqual([0, 65, 0]);
    for (const [x, y, z] of L01Content.def.world.vars.lamps as Array<[number, number, number]>) {
      expect(snapshot.blocks[`${x},${y},${z}`] ?? "minecraft:air").toBe("minecraft:air");
    }
    await session.dispose();
  });

  it("Promise.all 并行完成（40ms 端口：两次移动重叠，串行会相隔 40ms）", async () => {
    const port = new SlowPort();
    const session = await GameSession.create(withExplicit(L01Content), port);
    const started = Date.now();
    const resultPromise = waitForResult(session);
    await session.run(
      `const p1 = golem.moveTo(2, 6)\nconst p2 = golem.moveTo(6, 6)\nawait Promise.all([p1, p2])`,
    );
    const result = await resultPromise;
    const elapsed = Date.now() - started;
    expect(result.failures.some(failure => failure.includes("await"))).toBe(false);
    expect(port.marks).toHaveLength(2);
    // 并行：两次 40ms 移动的起止窗口重叠（串行时第二次开始要等第一次结束）
    const windowMs = Math.max(...port.marks.map(mark => mark.end)) - Math.min(...port.marks.map(mark => mark.start));
    expect(windowMs).toBeLessThan(75);

    const snapshot = await session.snapshot();
    const moves = snapshot.events.filter(event => event.type === "agent.move");
    expect(moves).toHaveLength(2);
    await session.dispose();
  });

  it("自动 await 模式回归：L01–L08 仍是 sequential，L01 参考解照常 3 星", async () => {
    const contents: LevelContent[] = [L01Content, L02Content, L03Content, L04Content, L05Content, L06Content, L07Content, L08Content];
    for (const content of contents) {
      expect(levelRunMode(content)).toBe("sequential");
      const probe = await GameSession.create(content, new MockWorldPort());
      expect(probe.runMode).toBe("sequential");
      await probe.dispose();
    }

    const session = await GameSession.create(L01Content, new MockWorldPort());
    const resultPromise = waitForResult(session);
    await session.run(reference);
    const result = await resultPromise;
    expect(result.failures.some(failure => failure.includes("await"))).toBe(false);
    const beat = await session.playerBeat();
    expect(beat.result?.stars).toBe(3);
    await session.dispose();
  });
});
