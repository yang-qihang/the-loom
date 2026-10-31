import { describe, expect, it } from "vitest";
import {
  createWorldRuntime,
  paperConfig,
  resolveWorldMode,
  waitForMcReady,
  WorldUnavailableError,
} from "./world";

describe("Engine WorldRuntime 选择（LOOM_WORLD）", () => {
  it("默认 mock，health 报 port=mock", async () => {
    const runtime = createWorldRuntime({});
    expect(runtime.mode).toBe("mock");
    const health = await runtime.health(0, 1);
    expect(health.ok).toBe(true);
    expect(health.port).toBe("mock");
    expect((health.mc as { kind: string }).kind).toBe("mock");
  });

  it("LOOM_WORLD=paper 选择真实端口", () => {
    const runtime = createWorldRuntime({ LOOM_WORLD: "paper", LOOM_MC_WAIT_MS: "300" });
    expect(runtime.mode).toBe("paper");
  });

  it("非法 LOOM_WORLD 抛中文错误（不静默降级）", () => {
    expect(() => resolveWorldMode({ LOOM_WORLD: "fabric" })).toThrowError(/mock 或 paper/);
    expect(() => createWorldRuntime({ LOOM_WORLD: "fabric" })).toThrowError(/mock 或 paper/);
  });

  it("paper 连不上插件 RPC 时抛中文错误 + 排查提示", async () => {
    const config = paperConfig({
      LOOM_RPC_URL: "ws://127.0.0.1:59999",
      LOOM_MC_WAIT_MS: "600",
    });
    let caught: unknown;
    try {
      await waitForMcReady(config, () => undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorldUnavailableError);
    expect((caught as Error).message).toMatch(/真实 MC 未就绪/);
    expect((caught as WorldUnavailableError).hint).toMatch(/mc:up/);
  });
});
