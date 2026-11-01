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
}

export interface Criterion {
  id: string;
  text: string;
  passed: boolean;
}

export interface RunResult {
  passed: boolean;
  stars: number;
  criteria: Criterion[];
  hidden: Criterion[];
  failures: string[];
  /** 玩家可见任务进度（引擎 progress 真值；旧引擎没有此字段 → 回退 criteria/copy）。 */
  progress?: Criterion[];
  /** 织偶/世界侧已完成，轮到玩家亲手完成最后一步（docs/46 §1.1）。 */
  playerBeatReady?: boolean;
}

export type StudioEvent =
  | { type: "state"; state: SessionPhase }
  | { type: "log"; line: string }
  | { type: "objective"; id: string; text: string; done: boolean }
  | { type: "result"; result: RunResult }
  | { type: "hint"; level: number; text: string }
  | { type: "error"; message: string; line?: number };

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
  run(sessionId: string, source: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  playerBeat(sessionId: string, simulate?: boolean): Promise<void>;
  inGame(sessionId: string, text: string, kind?: "title" | "actionbar"): Promise<void>;
  setAnnotations(sessionId: string, visible: boolean): Promise<void>;
  subscribe(sessionId: string, listener: (event: StudioEvent) => void): () => void;
  createReplSession(): Promise<string>;
  repl(sessionId: string, line: string): Promise<ReplOutcome>;
  replHistory(sessionId: string): Promise<ReplHistoryEntry[]>;
  replReset(sessionId: string): Promise<void>;
}

/** 引擎不可用（没起服务/断网）时抛这个，UI 用它决定展示「切 Mock」提示。 */
export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}
