import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type StartedEngine } from "./server";
import { L01Content } from "../../../content/levels/L01.content";

describe("HUD 轻量快照不改变实时进度/默认完整快照", () => {
  let engine: StartedEngine;
  beforeAll(async () => { engine = await startEngine({ port: 0 }); });
  afterAll(async () => { await engine.close(); });
  const post = async <T = unknown>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(engine.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.ok).toBe(true);
    return await response.json() as T;
  };
  const get = async (id: string) => await (await fetch(`${engine.url}/api/session/${id}/snapshot?view=hud`)).json() as {
    state: string; playerBeatReady: boolean; allPassed: boolean; playerBeatDone: boolean; sessionEpoch: number;
  };

  for (const levelId of ["L01", "L05", "L10"]) {
    it(`${levelId} HUD 字段与完整快照一致，传输量不足完整数据的 10%`, async () => {
      const { sessionId } = await post<{ sessionId: string }>("/api/session", { levelId });
      const fullText = await (await fetch(`${engine.url}/api/session/${sessionId}/snapshot`)).text();
      const hudText = await (await fetch(`${engine.url}/api/session/${sessionId}/snapshot?view=hud`)).text();
      const full = JSON.parse(fullText), hud = JSON.parse(hudText);
      for (const key of ["sessionId", "state", "sessionEpoch", "agents", "npcs", "points", "containers", "tick", "progress", "playerBeatReady", "allPassed", "playerBeatRequired", "playerBeatDone"]) {
        expect(hud[key], key).toEqual(full.snapshot[key]);
      }
      expect(full.blocks).toBeDefined();
      expect(full.snapshot.blocks).toEqual(full.blocks);
      for (const key of ["blocks", "events", "snapshot"]) expect(hud).not.toHaveProperty(key);
      expect(Buffer.byteLength(hudText)).toBeLessThan(Buffer.byteLength(fullText) * 0.1);
    });
  }

  it("HUD 持续反映执行、玩家节拍和 reset，不缓存旧进度", async () => {
    const { sessionId } = await post<{ sessionId: string }>("/api/session", { levelId: "L01" });
    await post("/api/run", { sessionId, source: L01Content.def.code.referenceSolution });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const view = await get(sessionId);
      if (view.state === "READY" && view.playerBeatReady) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(ready).toBe(true);
    expect((await get(sessionId)).allPassed).toBe(false);
    await post("/api/player-beat", { sessionId });
    expect(await get(sessionId)).toMatchObject({ state: "PASSED", allPassed: true, playerBeatDone: true });
    await post("/api/reset", { sessionId });
    expect(await get(sessionId)).toMatchObject({ state: "READY", allPassed: false, sessionEpoch: 1 });
  });
});
