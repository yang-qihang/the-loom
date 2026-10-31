import { describe, expect, it } from "vitest";
import { SCENE_PALETTE, groundPatch, pathLine, villageHouse, tree, lampPost, fenceLine, banner } from "./scene-kit";

describe("SceneKit 构件库", () => {
  it("地面/小径覆盖给定矩形与端点", () => {
    expect(groundPatch(0, 1, 0, 1, 10)).toHaveLength(4);
    const path = pathLine(0, 0, 3, 0, 10);
    expect(path[0].pos).toEqual([0, 10, 0]);
    expect(path[path.length - 1].pos).toEqual([3, 10, 0]);
  });
  it("房屋有墙、窗与屋顶；树有木头与树冠；灯柱有灯笼", () => {
    const house = villageHouse(0, 0, 10);
    expect(house.some(b => b.block === "minecraft:glass_pane")).toBe(true);
    expect(house.some(b => b.block === "minecraft:dark_oak_planks")).toBe(true);
    const t = tree(4, 4, 10);
    expect(t.some(b => b.block === "minecraft:spruce_log")).toBe(true);
    expect(t.some(b => b.block.includes("azalea"))).toBe(true);
    expect(lampPost(2, 2, 10).some(b => b.block === "minecraft:lantern")).toBe(true);
  });
  it("只使用稳定材质，不用草方块/落叶", () => {
    const all = [...groundPatch(0, 2, 0, 2, 10), ...villageHouse(0, 0, 10), ...tree(4, 4, 10), ...fenceLine(0, 0, 4, 0, 10), ...banner(0, 11, 0)];
    expect(all.some(b => b.block === "minecraft:grass_block" || b.block.endsWith("_leaves"))).toBe(false);
    expect(SCENE_PALETTE.ground).toBe("minecraft:moss_block");
  });
});
