import type { Container, Golem, NamedPoint as SdkNamedPoint, PointLike, World } from "../../sdk/src/index";
import type { Vec3, WorldEvent, WorldSnapshot } from "../../protocol/src/index";
import { pointsView, type LevelDef, type NamedPoint } from "../../level-spec/src/index";

/** 学生可见的语义动作（docs/48 §1.2）：基础签名保持兼容，语义化方法在运行时由端口实现。 */
export interface AgentActions {
  readonly pos: Vec3;
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
}

/** 语义化扩展动作：端口实现 `agent()` 时一并提供（运行时调用方用 as RichAgentActions 取用）。 */
export interface SemanticAgentActions {
  /** 走到命名点 / {x,y,z} / [x,y,z]。 */
  moveToPoint(target: PointLike): Promise<void>;
  /** 在命名点所在格放置方块（高度取点上的 y）。 */
  placePoint(block: string, target: PointLike): Promise<void>;
  /** moveToPoint 的同义词。 */
  goTo(target: PointLike): Promise<void>;
  /** 把目标格上的 item 收进背包。 */
  collect(item: string, target: PointLike): Promise<void>;
  /** 把背包里的 item 放进目标容器，默认 1 件。 */
  deposit(item: string, target: PointLike, count?: number): Promise<void>;
  /** 背包里 item 的数量。 */
  count(item: string): number;
  /** 收割成熟的作物（目标格收走，语义同 collect；L04 起可选扩展）。 */
  harvest?(crop: string, target: PointLike): Promise<void>;
  /** 在目标格种下作物幼苗（等价 place(`${crop}_sprout`, target)；L04 起可选扩展）。 */
  plant?(crop: string, target: PointLike): Promise<void>;
}
export type RichAgentActions = AgentActions & SemanticAgentActions;

/** LevelDef 的命名点 → 学生可见 {x,y,z,name} 视图（深冻结）。 */
export function toSdkPoints(level: LevelDef): Record<string, SdkNamedPoint> {
  const out: Record<string, SdkNamedPoint> = {};
  for (const [key, point] of Object.entries(pointsView(level))) {
    out[key] = Object.freeze({ x: point.pos[0], y: point.pos[1], z: point.pos[2], name: point.name });
  }
  return Object.freeze(out) as Record<string, SdkNamedPoint>;
}

/** 解析 PointLike：命名点对象 / {x,y,z} / [x,y,z]。 */
export function resolveTarget(target: PointLike, fallbackY = 0): Vec3 {
  if (Array.isArray(target)) {
    return [Number(target[0]), Number(target[1]), Number(target[2])];
  }
  const object = target as { x?: unknown; y?: unknown; z?: unknown };
  if (object && typeof object.x === "number" && typeof object.z === "number") {
    return [object.x, typeof object.y === "number" ? object.y : fallbackY, object.z];
  }
  throw new Error(`不认识的坐标：${JSON.stringify(target)}（可以用命名点如 eira、barrel，或 (x, z) 两个数字）`);
}

export const posKey = (pos: ArrayLike<number>): string => `${Math.floor(pos[0])},${Math.floor(pos[1])},${Math.floor(pos[2])}`;

/** 从任意目标里拿 y（没有就 fallback）。 */
export function targetY(target: PointLike, fallbackY = 0): number {
  if (Array.isArray(target)) return Number(target[1]);
  const object = target as { y?: unknown };
  return typeof object.y === "number" ? object.y : fallbackY;
}
export type FxCue =
  | { kind: "title"; text: string }
  | { kind: "actionbar"; text: string }
  | { kind: "sound"; id: string }
  | { kind: "particle"; id: string; at: Vec3; count?: number };

export interface Annotation {
  id: string;
  text: string;
  pos: Vec3;
}

export interface LevelContent {
  def: LevelDef;
  prepare(port: WorldPort): Promise<void>;
  /** 场景 finalize（arena/tracked/agentSpawn 已定）之后的内容钩子；多 agent 关卡在这里把各 bot 放到各自起点。 */
  afterPrepare?(port: WorldPort): Promise<void>;
  playerBeat?(port: WorldPort): Promise<void>;
  /** 真实世界里的中文浮空标注（灯号、角色、目标物件）；可选。 */
  annotate?(port: WorldPort): Promise<void>;
}

export interface WorldPort {
  readonly kind: "mock" | "paper+bot";
  prepare(content: LevelContent): Promise<void>;
  reset(content: LevelContent): Promise<void>;
  snapshot(levelId: string): Promise<WorldSnapshot>;
  agent(name: string): AgentActions;
  /** 本关命名坐标点（docs/48 §1.1；world.points 同源，HUD/指令手册直接读）。 */
  readonly points?: Record<string, SdkNamedPoint>;
  /** 把某个真实 bot 传送到指定位置（模拟/无凭据实现可空操作）。 */
  teleportAgent(name: string, pos: Vec3): Promise<void>;
  readonly world: World;
  onEvent(listener: (event: WorldEvent) => void): () => void;
  teleportPlayer(pos: Vec3): Promise<void>;
  setBlocks(entries: Array<{ pos: Vec3; block: string }>): Promise<void>;
  clearRegion(from: Vec3, to: Vec3): Promise<void>;
  spawnEntity(spec: { type: string; id?: string; name?: string; pos: Vec3; role?: string }): Promise<void>;
  clearEntities(ids?: string[]): Promise<void>;
  setTime(ticks: number): Promise<void>;
  setWeather(weather: "clear" | "rain" | "thunder"): Promise<void>;
  /** 引擎判定「织偶部分已完成」后调用：插件显示玩家节拍标记并允许完成（mock 为空操作）。 */
  activatePlayerBeat(): Promise<void>;
  /** 给真人玩家发道具；真实流程由玩家右键，道具必须先到手。 */
  playerGive(item: string, count?: number): Promise<void>;
  /** 测试/无人演示：模拟玩家亲手操作（真实流程由真人右键）。 */
  playerPlace(block: string, pos: Vec3): Promise<void>;
  fx(cue: FxCue): Promise<void>;
  annotate(entries: Annotation[]): Promise<void>;
  setAnnotationsVisible(visible: boolean): Promise<void>;
  dispose(): Promise<void>;
  /**
   * 语义状态快照（docs/48 §1.2–1.3）：命名点 + 织偶背包 + 容器计数。
   * 沙箱 worker 拿它在本地维护同步缓存（`golem.count` / `world.container` 必须同步返回）；
   * 可选实现——没实现的端口从空状态开始，评分只依赖快照/事件，不依赖这份缓存。
   */
  semantic?(): SemanticStateSnapshot;
}

/** `WorldPort.semantic()` 的返回形状（物品名不带 `minecraft:` 前缀，容器 key 为底座方块坐标 `x,y,z`）。 */
export interface SemanticStateSnapshot {
  points: Record<string, SdkNamedPoint>;
  /** 织偶背包：物品短名（如 `egg`）→ 数量。 */
  bag: Record<string, number>;
  /** 容器：容器底座坐标 `x,y,z` → 物品短名 → 数量。 */
  containers: Record<string, Record<string, number>>;
}

/** 学生代码使用的 SDK 形状（runner 注入）。 */
export interface StudentSdkRuntime {
  golem: Golem;
  world: World;
}
