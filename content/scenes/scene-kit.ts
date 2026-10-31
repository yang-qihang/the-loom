/** 场景美术构件库（只读）：所有关卡共享同一套材质/配色/建筑语法。 */
export type ScenePos = [number, number, number];
export interface SceneBlock { pos: ScenePos; block: string; }

export const SCENE_PALETTE = {
  ground: "minecraft:moss_block",
  path: ["minecraft:gravel", "minecraft:cobblestone"],
  stone: "minecraft:stone_bricks",
  stoneAccent: "minecraft:mossy_stone_bricks",
  wood: "minecraft:oak_planks",
  woodDark: "minecraft:spruce_planks",
  woodDeep: "minecraft:dark_oak_planks",
  log: "minecraft:spruce_log",
  glass: "minecraft:glass_pane",
  light: "minecraft:lantern",
  fire: "minecraft:campfire",
  foliage: ["minecraft:azalea", "minecraft:flowering_azalea"],
  flowers: ["minecraft:poppy", "minecraft:cornflower", "minecraft:dandelion", "minecraft:azure_bluet"],
  banner: ["minecraft:red_wool", "minecraft:orange_wool", "minecraft:yellow_wool"],
} as const;

export function groundPatch(x0: number, x1: number, z0: number, z1: number, y: number, block: string = SCENE_PALETTE.ground): SceneBlock[] {
  const out: SceneBlock[] = [];
  for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) out.push({ pos: [x, y, z], block });
  return out;
}

export function pathLine(x0: number, z0: number, x1: number, z1: number, y: number): SceneBlock[] {
  const out: SceneBlock[] = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(x0 + ((x1 - x0) * i) / Math.max(1, steps));
    const z = Math.round(z0 + ((z1 - z0) * i) / Math.max(1, steps));
    out.push({ pos: [x, y, z], block: SCENE_PALETTE.path[i % 2] });
  }
  return out;
}

export function lampPost(x: number, z: number, groundY: number): SceneBlock[] {
  const out: SceneBlock[] = [];
  for (let y = groundY; y <= groundY + 2; y += 1) out.push({ pos: [x, y, z], block: SCENE_PALETTE.stone });
  out.push({ pos: [x, groundY + 3, z], block: SCENE_PALETTE.light });
  return out;
}

export function villageHouse(x: number, z: number, groundY: number, w = 5, d = 5, style: "oak" | "spruce" = "oak"): SceneBlock[] {
  const wood = style === "oak" ? SCENE_PALETTE.wood : SCENE_PALETTE.woodDark;
  const out: SceneBlock[] = [];
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < d; j += 1) {
      const edge = i === 0 || i === w - 1 || j === 0 || j === d - 1;
      if (!edge) continue;
      out.push({ pos: [x + i, groundY, z + j], block: wood });
      out.push({ pos: [x + i, groundY + 1, z + j], block: (i === 2 || j === 2) ? SCENE_PALETTE.glass : wood });
      out.push({ pos: [x + i, groundY + 2, z + j], block: wood });
    }
  }
  for (let i = -1; i <= w; i += 1) for (let j = -1; j <= d; j += 1) out.push({ pos: [x + i, groundY + 3, z + j], block: SCENE_PALETTE.woodDeep });
  out.push({ pos: [x + 1, groundY + 3, z - 1], block: SCENE_PALETTE.light });
  return out;
}

export function tree(x: number, z: number, groundY: number): SceneBlock[] {
  const out: SceneBlock[] = [];
  for (let y = groundY; y <= groundY + 3; y += 1) out.push({ pos: [x, y, z], block: SCENE_PALETTE.log });
  for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
    if (Math.abs(dx) + Math.abs(dz) <= 3) out.push({ pos: [x + dx, groundY + 4, z + dz], block: Math.abs(dx + dz) % 2 === 0 ? SCENE_PALETTE.foliage[0] : SCENE_PALETTE.foliage[1] });
  }
  return out;
}

export function fenceLine(x0: number, z0: number, x1: number, z1: number, y: number, gapEvery = 4): SceneBlock[] {
  const out: SceneBlock[] = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let i = 0; i <= steps; i += 1) {
    if (gapEvery > 0 && i % gapEvery === 0) continue;
    const x = Math.round(x0 + ((x1 - x0) * i) / Math.max(1, steps));
    const z = Math.round(z0 + ((z1 - z0) * i) / Math.max(1, steps));
    out.push({ pos: [x, y, z], block: "minecraft:oak_fence" });
  }
  return out;
}

export function banner(x: number, y: number, z: number, color = 0): SceneBlock[] {
  return [{ pos: [x, y, z], block: SCENE_PALETTE.banner[color % SCENE_PALETTE.banner.length] }];
}
