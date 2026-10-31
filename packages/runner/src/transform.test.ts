import { describe, expect, it } from "vitest";
import { transformStudentCode } from "./transform";
import { runStudentProgram } from "./run";

describe("顺序门面（auto-await）", () => {
  it("给异步 SDK 调用插入 await，同步读不插入", () => {
    const out = transformStudentCode(`golem.moveTo(1, 2)\ngolem.place("lantern", 1, 3, 2)\nconst p = golem.pos`);
    expect(out).toContain("await golem.moveTo");
    expect(out).toContain("await golem.place");
    expect(out).not.toContain("await golem.pos");
  });

  it("先写后读拿到的是完成后的值（而不是 Promise）", async () => {
    let eggCount = 0;
    let said = "";
    const golem = {
      get pos() { return [0, 65, 0] as [number, number, number]; },
      async moveTo() {},
      async place() {},
      async say(text: string) { said = text; },
      async collect() { eggCount += 1; return eggCount; },
    };
    await runStudentProgram(
      { golem: golem as never, world: { vars: {} } as never },
      `const n = golem.collect("egg", 0, 0)\ngolem.say(String(n))`,
    );
    expect(said).toBe("1");
  });

  it("循环里的调用也按序 await", async () => {
    const moves: number[] = [];
    const golem = {
      get pos() { return [0, 65, 0] as [number, number, number]; },
      async moveTo(x: number) { moves.push(x); },
      async place() {},
      async say() {},
    };
    await runStudentProgram(
      { golem: golem as never, world: { vars: {} } as never },
      `for (const x of [1, 2, 3]) {\n  golem.moveTo(x, 0)\n}`,
    );
    expect(moves).toEqual([1, 2, 3]);
  });
});
