import type { Golem, World } from "../../sdk/src/index";
import type { Vec3, WorldEvent, WorldSnapshot } from "../../protocol/src/index";
import type { LevelDef } from "../../level-spec/src/index";

export interface AgentActions {
  readonly pos: Vec3;
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
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
  /** 给真人玩家发道具；真实流程由玩家右键，道具必须先到手。 */
  playerGive(item: string, count?: number): Promise<void>;
  /** 测试/无人演示：模拟玩家亲手操作（真实流程由真人右键）。 */
  playerPlace(block: string, pos: Vec3): Promise<void>;
  fx(cue: FxCue): Promise<void>;
  annotate(entries: Annotation[]): Promise<void>;
  setAnnotationsVisible(visible: boolean): Promise<void>;
  dispose(): Promise<void>;
}

/** 学生代码使用的 SDK 形状（runner 注入）。 */
export interface StudentSdkRuntime {
  golem: Golem;
  world: World;
}
