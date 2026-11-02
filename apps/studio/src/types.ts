/** Studio 与 Engine 的契约视图（对应 docs/21 §3）。 */

export type EngineMode = "mock" | "http";

export type SessionPhase =
  | "loading"
  | "ready"
  | "running"
  | "awaiting-player-beat"
  | "graded"
  | "error";

export interface Goal {
  id: string;
  text: string;
  /** 这一步的详细引导（docs/48 §1.4）：怎样才算完成 + 可照抄写法 + 坐标从哪来。 */
  hint?: string;
  /** true = 需要玩家在世界里亲手完成（玩家节拍）。 */
  player?: boolean;
}

/** 关卡声明的命名坐标点（指令手册 / 位置卡片 / REPL 展示用）。 */
export interface NamedPointView {
  pos: [number, number, number];
  name: string;
}

/** 概念揭晓（结算页/手记/织典；数据来自 levels.json 的 conceptReveal）。 */
export interface ConceptRevealView {
  term: string;
  en?: string;
  what: string;
  why: string;
  mapping: string;
}

/** 指令手册条目（与 packages/sdk/src/api-registry.ts 的 ApiDocPoint 同形）。 */
export interface ApiManualEntry {
  sinceLevel: string;
  signature: string;
  summary: string;
  details?: string;
  example: string;
  kind: string;
}

/** 引擎 /api/api-reference 视图：本关可用 API + 本关命名点。 */
export interface ApiReferenceView {
  api: ApiManualEntry[];
  points: Record<string, NamedPointView>;
}

/** 位置 HUD / 自动检测用世界快照（引擎 /api/session/:id/snapshot，形状为 WorldSnapshot 的子集）。 */
export interface SnapshotProgressStep {
  id: string;
  text: string;
  passed: boolean;
  /** true = 需要玩家在世界里亲手完成的一步。 */
  player: boolean;
  /** 这一步的详细引导（教练卡「下一步怎么做」）。 */
  hint?: string;
}

export interface SnapshotView {
  agents?: Record<string, { pos: number[] }>;
  npcs?: Record<string, { pos: number[] }>;
  vars?: Record<string, unknown>;
  points?: Record<string, NamedPointView>;
  containers?: Record<string, Record<string, number>>;
  tick?: number;
  /**
   * 引擎每秒轮询快照附带的任务进度（docs/49 §2.3）：Workbench 据此实时勾选目标，
   * 并在进度全部通过时自动确认玩家节拍。旧引擎没有这些字段 → UI 静默降级。
   */
  progress?: SnapshotProgressStep[];
  playerBeatReady?: boolean;
  allPassed?: boolean;
  /** 本关是否声明了玩家节拍（task.playerBeat）。 */
  playerBeatRequired?: boolean;
  /** 快照里是否已有玩家亲手完成的动作（与评分同源：block.place + actorType=player）。 */
  playerBeatDone?: boolean;
  /** 会话 epoch：顶层 epoch 可能被插件快照覆盖，Studio 的防重放只认这个字段。 */
  sessionEpoch?: number;
  /** 引擎会话状态（READY/PASSED/…）：自动确认玩家节拍只在 READY 时触发。 */
  state?: string;
}

export interface LevelView {
  id: string;
  title: string;
  act: number;
  order: number;
  starterCode: string;
  referenceSolution: string;
  objectives: Goal[];
  hints: string[];
  /** 本关命名坐标点（`moveTo(eira)` / 手册坐标表用）。 */
  points?: Record<string, NamedPointView>;
  /** 概念揭晓（levels.json 未提供时页面回退织典页）。 */
  conceptReveal?: ConceptRevealView;
}

export interface Criterion {
  id: string;
  text: string;
  passed: boolean;
}

export interface RunResult {
  /** 这次结果属于哪一次运行（SSE 旧事件过滤依据；旧引擎没有此字段）。 */
  runId?: string;
  passed: boolean;
  stars: number;
  criteria: Criterion[];
  hidden: Criterion[];
  failures: string[];
  /** 玩家可见任务进度（引擎 progress 真值；旧引擎没有此字段 → 回退 criteria/copy）。 */
  progress?: Criterion[];
  /** 织偶/世界侧已完成，轮到玩家亲手完成最后一步（docs/46 §1.1）。 */
  playerBeatReady?: boolean;
  /** 「名副其实」代码要求判定（docs/48 §1.9；api-engine 接入后才有）。 */
  codeCriteria?: Criterion[];
}

export type StudioEvent =
  | { type: "state"; state: SessionPhase }
  | { type: "log"; line: string }
  | { type: "objective"; id: string; text: string; done: boolean }
  | { type: "result"; result: RunResult }
  | { type: "hint"; level: number; text: string }
  | { type: "error"; message: string; line?: number; runId?: string };

export type ReplKind = "value" | "action" | "error";

export interface ReplOutcome {
  ok: boolean;
  kind: ReplKind;
  display: string;
  log: string[];
  error?: string;
  line?: number;
}

export interface ReplHistoryEntry {
  line: string;
  kind: ReplKind;
  display: string;
  at: number;
}

export interface StudioEngine {
  readonly mode: EngineMode;
  listLevels(): Promise<import("./copy").LevelCard[]>;
  loadLevel(id: string): Promise<LevelView>;
  createSession(levelId: string): Promise<string>;
  /** 提交运行；返回引擎的 runId（旧引擎没有 runId 时返回 null）。 */
  run(sessionId: string, source: string): Promise<string | null>;
  stop(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  playerBeat(sessionId: string, simulate?: boolean): Promise<void>;
  inGame(sessionId: string, text: string, kind?: "title" | "actionbar"): Promise<void>;
  setAnnotations(sessionId: string, visible: boolean): Promise<void>;
  subscribe(sessionId: string, listener: (event: StudioEvent) => void): () => void;
  /** 打开试符台；levelId 缺省时由引擎/应用选最近关卡。 */
  createReplSession(levelId?: string): Promise<string>;
  repl(sessionId: string, line: string): Promise<ReplOutcome>;
  replHistory(sessionId: string): Promise<ReplHistoryEntry[]>;
  replReset(sessionId: string): Promise<void>;
  /** 位置 HUD / 手册：引擎的世界快照（可选，mock 旧实现没有时 UI 降级）。 */
  snapshot?(sessionId: string): Promise<SnapshotView | null>;
  /** 指令手册数据（可选；无端点时 Studio 直接读本地 registry）。 */
  apiReference?(levelId: string): Promise<ApiReferenceView | null>;
}

/** 引擎请求返回的错误体（docs/21 §3：`{ error: { code, message, hint? } }`）。 */
export interface EngineErrorInfo {
  code?: string;
  hint?: string;
  /** HTTP 状态码（网络不可达时没有）。 */
  status?: number;
}

/**
 * 引擎不可用 / 引擎明确拒绝请求时抛这个。
 * 保留原类名以兼容既有调用方；新增 code/hint/status 让错误卡能显示真实原因与可操作建议
 * （不再统一显示「织机回了一个错(409)」）。
 */
export class EngineUnavailableError extends Error {
  readonly code?: string;
  readonly hint?: string;
  readonly status?: number;

  constructor(message: string, info: EngineErrorInfo = {}) {
    super(message);
    this.name = "EngineUnavailableError";
    this.code = info.code;
    this.hint = info.hint;
    this.status = info.status;
  }

  /** 可恢复错误（重置会话/重进关卡后能继续玩）：错误卡给「重置本关后重试」动作。 */
  get recoverable(): boolean {
    return (
      this.code === "INVALID_STATE" ||
      this.code === "STALE_SNAPSHOT" ||
      this.code === "NOT_FOUND" ||
      this.code === "DISPOSED"
    );
  }

  /** 引擎完全联系不上（没起服务/断网）。 */
  get offline(): boolean {
    return this.code === "ENGINE_OFFLINE";
  }
}
