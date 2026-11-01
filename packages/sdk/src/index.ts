export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type BlockId = string;

/** 世界里的命名坐标点（LevelDef.world.points / 命名点全局常量）：学生可见 {x,y,z,name}。 */
export interface NamedPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly name: string;
}

/** 可以传给 moveTo/place/collect/deposit/container 的目标：命名点对象 / {x,y,z} / [x,y,z]。 */
export type PointLike = NamedPoint | { readonly x: number; readonly y?: number; readonly z: number } | Vec3;

/** 容器视图（木桶/箱子等）：学生只读。 */
export interface Container {
  /** 容器里某种物品的数量。 */
  count(item: BlockId): number;
  /** 容器里的全部物品。 */
  items(): Array<{ item: BlockId; count: number }>;
}

/**
 * 学生可见的织偶。
 *
 * 注意：基础方法保持最小签名（`moveTo(x,z)` / `place(block,x,y,z)`）以兼容既有测试桩；
 * 语义化扩展（命名点重载、collect/deposit/count）在**运行时**由端口/沙箱实现，并在
 * Monaco 声明（apps/studio/src/data/sdk.ts）里以完整重载呈现。学生代码不经过 TS 类型检查，
 * 所以 `golem.moveTo(eira)` 可直接运行；TypeScript 类型层面看不到重载只是为了不破坏历史测试桩。
 */
export interface Golem {
  /** 当前位置（只读快照）。 */
  readonly pos: Vec3;
  /** 走到 (x, z)；运行时也接受命名点（如 eira / barrel / lamp1）或 {x,y,z}。 */
  moveTo(x: number, z: number): Promise<void>;
  /** 在 (x, y, z) 放置方块；运行时也接受 `place(block, 命名点)`。 */
  place(block: BlockId, x: number, y: number, z: number): Promise<void>;
  /** 说一句话（头顶气泡/聊天）。 */
  say(text: string): Promise<void>;
  /** moveTo 的同义词：走到一个命名点。 */
  goTo?(target: PointLike): Promise<void>;
  /** 把目标格子上的物品收进背包（如 collect("egg", perch1) 收蛋）。 */
  collect?(item: BlockId, target: PointLike): Promise<void>;
  /** 把背包里的物品放进目标容器（如 deposit("egg", barrel)），默认 1 件。 */
  deposit?(item: BlockId, target: PointLike, count?: number): Promise<void>;
  /** 背包里某种物品的数量（同步读数）。 */
  count?(item: BlockId): number;
}

export interface World {
  /** 只读世界变量（如 lamps 坐标数组）。 */
  readonly vars: Record<string, unknown>;
  /** 本关命名坐标点（运行时由端口注入）。 */
  readonly points?: Record<string, NamedPoint>;
  /** 按位置取容器视图（如 world.container(barrel).count("egg")），运行时由端口注入。 */
  container?(point: PointLike): Container;
}

export interface StudentSdk {
  golem: Golem;
  world: World;
}

export { ASYNC_SDK_METHODS, ASYNC_SDK_RECEIVERS } from "../../protocol/src/index";
