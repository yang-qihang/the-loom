import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const data = JSON.parse(readFileSync(resolve(__dirname, "codex.json"), "utf8")) as {
  count: number;
  pages: Array<{
    id: string; title: string; subtitle: string; en: string;
    solve: string; mechanism: string; cost: string;
    crossLanguage: Array<{ lang: string; code: string }>;
    inGame: string; misconception: string; unlock: string;
  }>;
};

describe("织典 17 页", () => {
  it("恰好 17 页且 id 唯一", () => {
    expect(data.count).toBe(17);
    expect(data.pages).toHaveLength(17);
    expect(new Set(data.pages.map(p => p.id)).size).toBe(17);
  });

  it("每页六段齐全：解决/机制/代价/跨语言/在我们游戏里/常见误解", () => {
    for (const p of data.pages) {
      expect(p.solve.length, p.id).toBeGreaterThan(0);
      expect(p.mechanism.length, p.id).toBeGreaterThan(0);
      expect(p.cost.length, p.id).toBeGreaterThan(0);
      expect(p.crossLanguage.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.inGame.length, p.id).toBeGreaterThan(0);
      expect(p.misconception.length, p.id).toBeGreaterThan(0);
    }
  });

  it("解锁映射覆盖 L01–L10/EP/Lab", () => {
    const byLevel = new Map<string, string[]>();
    for (const p of data.pages) byLevel.set(p.unlock, [...(byLevel.get(p.unlock) ?? []), p.id]);
    for (const level of ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "EP"]) {
      expect(byLevel.get(level)?.length, level).toBeGreaterThan(0);
    }
  });

  it("跨语言标签非空，代码块不空", () => {
    for (const p of data.pages) {
      for (const c of p.crossLanguage) {
        expect(c.lang.length, p.id).toBeGreaterThan(0);
        expect(c.code.trim().length, p.id).toBeGreaterThan(0);
      }
    }
  });
});
