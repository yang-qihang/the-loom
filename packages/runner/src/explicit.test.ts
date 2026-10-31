import { describe, expect, it } from "vitest";
import { assertExplicitAwait, findUnawaitedSdkCalls, MissingAwaitError } from "./explicit";
import { resolveRunModeOption, runStudentProgram } from "./run";
import { transformStudentCode } from "./transform";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function makeGolem(log: string[] = []) {
  return {
    get pos(): [number, number, number] {
      return [0, 65, 0];
    },
    async moveTo(x: number, z: number): Promise<void> {
      log.push(`move:${x},${z}`);
    },
    async place(block: string): Promise<void> {
      log.push(`place:${block}`);
    },
    async say(text: string): Promise<void> {
      log.push(`say:${text}`);
    },
  };
}

describe("Act III 显式 await 运行模式", () => {
  it("不再自动插 await，但保留 TS 类型剥离（显式 await 正常执行）", async () => {
    const log: string[] = [];
    const transformed = transformStudentCode(`golem.moveTo(1, 2)`, "explicit");
    expect(transformed).not.toContain("await golem.moveTo");

    await runStudentProgram(
      { golem: makeGolem(log) as never, world: { vars: {} } as never },
      `const p: Promise<void> = golem.moveTo(1, 2)\nawait p\nawait golem.moveTo(3, 4)`,
      { autoAwait: false },
    );
    expect(log).toEqual(["move:1,2", "move:3,4"]);
  });

  it("漏 await 被拦下：2588 中文提示 + 行号，且不会执行世界动作", async () => {
    const log: string[] = [];
    const source = `golem.moveTo(1, 2)\ngolem.say("还没等它做完")`;
    const missing = findUnawaitedSdkCalls(source);
    expect(missing.map(call => call.line)).toEqual([1, 2]);
    await expect(
      runStudentProgram({ golem: makeGolem(log) as never, world: { vars: {} } as never }, source, { autoAwait: false }),
    ).rejects.toThrow(MissingAwaitError);
    expect(log).toEqual([]);

    try {
      assertExplicitAwait(source);
      expect.unreachable();
    } catch (error) {
      const missingAwait = error as MissingAwaitError;
      expect(missingAwait.line).toBe(1);
      expect(missingAwait.message).toContain("还没等它做完");
      expect(missingAwait.message).toContain("await");
      expect(/[\u4e00-\u9fa5]/.test(missingAwait.message)).toBe(true);
    }
  });

  it("显式 await / 存变量后 await / Promise.all 元素 / return 都算合法", () => {
    expect(findUnawaitedSdkCalls(`await golem.say("hi")`)).toEqual([]);
    expect(findUnawaitedSdkCalls(`const p = golem.moveTo(1, 2)\nawait p`)).toEqual([]);
    expect(findUnawaitedSdkCalls(`const p = golem.moveTo(1, 2)\nawait Promise.all([p, golem.moveTo(3, 4)])`)).toEqual([]);
    expect(findUnawaitedSdkCalls(`async function go() { return golem.moveTo(1, 2) }\nawait go(0)`)).toEqual([]);
    // 存了变量却一直没 await → 仍然提示
    const missing = findUnawaitedSdkCalls(`const p = golem.moveTo(1, 2)\ngolem.say("x")`);
    expect(missing.map(call => call.line)).toEqual([1, 2]);
    expect(missing[0].variable).toBe("p");
  });

  it("Promise.all 并行完成（用时接近单个调用，而不是串行两倍）", async () => {
    const moves: number[] = [];
    const golem = {
      get pos(): [number, number, number] {
        return [0, 65, 0];
      },
      async moveTo(x: number): Promise<void> {
        await sleep(40);
        moves.push(x);
      },
      async place(): Promise<void> {},
      async say(): Promise<void> {},
    };
    const started = Date.now();
    await runStudentProgram(
      { golem: golem as never, world: { vars: {} } as never },
      `const a = golem.moveTo(1, 0)\nconst b = golem.moveTo(2, 0)\nawait Promise.all([a, b])`,
      { autoAwait: false },
    );
    const elapsed = Date.now() - started;
    expect(moves.sort()).toEqual([1, 2]);
    expect(elapsed).toBeLessThan(75); // 串行需要 80ms
  });

  it("autoAwait:true 与旧 mode 字符串保持兼容（回归）", () => {
    expect(resolveRunModeOption(undefined)).toBe("auto-await");
    expect(resolveRunModeOption({ autoAwait: true })).toBe("auto-await");
    expect(resolveRunModeOption("explicit")).toBe("explicit");
    expect(resolveRunModeOption({ mode: "explicit" })).toBe("explicit");
    expect(resolveRunModeOption({ autoAwait: false })).toBe("explicit");
    expect(transformStudentCode(`golem.moveTo(1, 2)`)).toContain("await golem.moveTo");
  });
});
