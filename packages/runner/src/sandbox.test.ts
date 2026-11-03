import { describe, expect, it } from "vitest";
import { L01 } from "../../level-spec/src/index";
import { MockWorld } from "../../mockworld/src/index";
import { RunTimeoutError, runStudentSandboxed, StudentCodeError } from "./sandbox";

function makeHost() {
  const calls: string[] = [];
  const pos: [number, number, number] = [0, 65, 0];
  const host = {
    golem: {
      get pos() {
        return pos;
      },
      async moveTo(x: number, z: number) {
        pos[0] = x;
        pos[2] = z;
        calls.push(`moveTo:${x},${z}`);
      },
      async place(block: string, x: number, y: number, z: number) {
        calls.push(`place:${block}@${x},${y},${z}`);
      },
      async say(text: string) {
        calls.push(`say:${text}`);
      },
    },
    world: { vars: { lamps: [[1, 2, 3]], nested: { x: 1 } } },
  };
  return { host, calls, pos };
}

describe("RT-02 worker_threads + vm 沙箱", () => {
  it("上下文没有 process/require/globalThis/Buffer/fetch/eval", async () => {
    const { host, calls } = makeHost();
    await runStudentSandboxed(
      host,
      'golem.say("probe|" + typeof process + "|" + typeof require + "|" + typeof globalThis + "|" + typeof Buffer + "|" + typeof fetch + "|" + typeof eval);',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("say:probe|undefined|undefined|undefined|undefined|undefined|undefined");
  });

  it("无法通过构造器逃逸到宿主 realm（eval/Function 被禁用）", async () => {
    const { host } = makeHost();
    await expect(
      runStudentSandboxed(host, 'golem.say("x"); ({}).constructor.constructor("return typeof process")();'),
    ).rejects.toBeInstanceOf(StudentCodeError);
    await expect(runStudentSandboxed(host, 'eval("1 + 1");')).rejects.toBeInstanceOf(StudentCodeError);
  });

  it("world.vars 只读：赋值静默失效，宿主 vars 不被污染", async () => {
    const { host, calls } = makeHost();
    await runStudentSandboxed(host, 'world.vars.lamps = []; golem.say(JSON.stringify(world.vars.lamps));');
    expect(calls[0]).toBe("say:[[1,2,3]]");
    expect(host.world.vars.lamps).toEqual([[1, 2, 3]]);
    await expect(runStudentSandboxed(host, "world.vars.lamps.push([9,9,9]);")).rejects.toBeInstanceOf(StudentCodeError);
  });

  it("死循环被终止（默认 1s 内）", async () => {
    const { host } = makeHost();
    const started = Date.now();
    await expect(runStudentSandboxed(host, "while (true) {}", { timeoutMs: 300 })).rejects.toBeInstanceOf(RunTimeoutError);
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it("错误映射回学生行号", async () => {
    const { host } = makeHost();
    const error = await runStudentSandboxed(host, 'golem.moveTo(1, 0)\nthrow new Error("boom")').catch(value => value);
    expect(error).toBeInstanceOf(StudentCodeError);
    expect((error as StudentCodeError).message).toContain("boom");
    expect((error as StudentCodeError).line).toBe(2);
  });

  it("console.log 走宿主回调，不暴露宿主 console", async () => {
    const { host } = makeHost();
    const lines: string[] = [];
    await runStudentSandboxed(host, 'console.log("hello", 1 + 1);', { onLog: line => lines.push(line) });
    expect(lines).toEqual(["hello 2"]);
  });

  it("正常参考解在沙箱中仍能驱动世界（MockWorld）", async () => {
    const world = new MockWorld({ ...L01.world.vars });
    await runStudentSandboxed({ golem: world.golem, world: world.world }, L01.code.referenceSolution);
    const lamps = L01.world.vars.lamps as [number, number, number][];
    world.playerPlace("lantern", lamps[3]);
    expect(world.blocks.size).toBeGreaterThanOrEqual(4);
  });
});

describe("宿主取消沙箱", () => {
  it("取消死循环时终止 worker，无需等待原来的长超时", async () => {
    const { host } = makeHost();
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const running = runStudentSandboxed(host, 'console.log("started"); while (true) {}', {
      timeoutMs: 10_000,
      signal: controller.signal,
      onLog: () => started(),
    });
    const outcome = running.catch(error => error);
    await ready;
    controller.abort();
    expect(await outcome).toMatchObject({ name: "AbortError" });
  });

  it("已取消的运行不发出任何世界动作", async () => {
    const { host, calls } = makeHost();
    const controller = new AbortController();
    controller.abort();
    await expect(runStudentSandboxed(host, 'golem.say("must not run")', { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });
});
