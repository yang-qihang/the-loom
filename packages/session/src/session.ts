import { createHash } from "node:crypto";
import type { WorldSnapshot } from "../../protocol/src/index";
import type { Golem, World } from "../../sdk/src/index";
import type { AgentActions, LevelContent, WorldPort } from "../../worldport/src/index";
import { grade, type CriterionResult } from "../../grading/src/index";
import { runStudentSandboxed, StudentCodeError } from "../../runner/src/sandbox";
import type { RunSdk, SandboxMultiAgentRuntime } from "../../runner/src/run";
import { runReplLine, type ReplResult } from "../../runner/src/repl";
import { assertTransition, SessionError, type SessionErrorCode, type SessionState } from "./state";

export interface ResultEvent {
  type: "result";
  runId: string;
  epoch: number;
  passed: boolean;
  stars: number;
  criteria: CriterionResult[];
  hidden: CriterionResult[];
  failures: string[];
  observedTick: number;
  /** 快照内容哈希（WorldDigest）。 */
  digest: string;
  /** 与 digest 相同，显式命名以便调用方做快照绑定（RT-04）。 */
  snapshotDigest: string;
  source: "run" | "player-beat";
}

/** run/verify 发布的快照绑定：旧 runId、旧 epoch 或 digest 不符都会被拒绝。 */
export interface SnapshotBinding {
  runId: string;
  epoch: number;
  digest: string;
}

export type SessionMode = "level" | "repl";

/** 运行模式：sequential = Act I–II 自动 await；explicit = Act III 学生显式 await。 */
export type RunMode = "sequential" | "explicit";

/**
 * 按关卡标记选择运行模式（缺省 sequential，旧关卡行为不变）。
 * 兼容两种写法：`def.runMode`（内容侧 LevelDef 顶层，L09 当前写法）与 `meta.runMode`（docs/21 叙述）。
 */
export function levelRunMode(level: LevelContent): RunMode {
  const def = level.def as unknown as { runMode?: unknown; meta?: { runMode?: unknown } };
  const marker = def.runMode ?? def.meta?.runMode;
  return marker === "explicit" ? "explicit" : "sequential";
}

export interface GameSessionOptions {
  id?: string;
  /** 关卡会话（默认）或试符台会话（docs/27：prepare L01、不评分、世界持久）。 */
  mode?: SessionMode;
  /** 试符台单行超时（默认 3000ms；测试可调小）。 */
  replTimeoutMs?: number;
  /** 学生程序运行超时（默认 3000ms）。真实 MC 的参考解要几十秒，paper 模式由 Engine 传大值。 */
  runTimeoutMs?: number;
}

export interface ReplHistoryEntry {
  line: string;
  kind: ReplResult["kind"];
  display: string;
  /** 毫秒时间戳（便于 UI 排序/展示）。 */
  at: number;
}

export class StaleSnapshotError extends SessionError {
  constructor(message: string) {
    super(message, "STALE_SNAPSHOT" satisfies SessionErrorCode);
    this.name = "StaleSnapshotError";
  }
}

export type EngineEvent =
  | { type: "state"; state: SessionState; epoch: number }
  | { type: "log"; line: string }
  | { type: "objective"; id: string; text: string; done: boolean }
  | ResultEvent
  | { type: "hint"; level: 1 | 2 | 3; text: string }
  | { type: "error"; message: string; line?: number };

export interface SessionRunOptions {
  /** 幂等键：同一 commandId 重复提交返回同一 runId（REQ-CMD-01 的会话层实现）。 */
  commandId?: string;
}

interface RunTicket {
  runId: string;
  ticket: number;
}

const MAX_EVENT_HISTORY = 100;
const MAX_COMMAND_INDEX = 200;

/** 稳定序列化（键排序），用于 WorldDigest 与 REQ-RESET-01 的规范化比较。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

export function digestSnapshot(snapshot: WorldSnapshot): string {
  return `sha256:${createHash("sha256").update(stableStringify(snapshot)).digest("hex")}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 一个关卡会话：场景准备 → 学生代码运行 → 快照评分 → 玩家节拍 → 重置。
 * 只依赖 WorldPort 接口；T1 用 MockWorldPort，联调时替换为 paper+bot 适配器。
 */
export class GameSession {
  readonly id: string;
  readonly level: LevelContent;
  readonly mode: SessionMode;
  readonly runMode: RunMode;

  #state: SessionState = "DISCONNECTED";
  #epoch = 0;
  #ticket = 0;
  #runSeq = 0;
  #activeRun: (RunTicket & { aborted: boolean }) | null = null;
  #lastResult: ResultEvent | null = null;
  #listeners = new Set<(event: EngineEvent) => void>();
  #history: EngineEvent[] = [];
  #commandIndex = new Map<string, string>();
  #issuedSnapshots = new Map<string, { epoch: number; digest: string }>();
  #disposed = false;
  #replHistory: ReplHistoryEntry[] = [];
  #replTimeoutMs: number;
  #runTimeoutMs: number;

  constructor(
    id: string,
    level: LevelContent,
    private readonly port: WorldPort,
    options: { mode?: SessionMode; replTimeoutMs?: number; runTimeoutMs?: number } = {},
  ) {
    this.id = id;
    this.level = level;
    this.mode = options.mode ?? "level";
    this.runMode = levelRunMode(level);
    this.#replTimeoutMs = options.replTimeoutMs ?? 3000;
    this.#runTimeoutMs = options.runTimeoutMs ?? 3000;
  }

  static async create(level: LevelContent, port: WorldPort, options: string | GameSessionOptions = {}): Promise<GameSession> {
    const normalized = typeof options === "string" ? { id: options } : options;
    const id = normalized.id ?? `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session = new GameSession(id, level, port, {
      mode: normalized.mode,
      replTimeoutMs: normalized.replTimeoutMs,
      runTimeoutMs: normalized.runTimeoutMs,
    });
    await session.#connect();
    return session;
  }

  async #connect(): Promise<void> {
    this.#transition("CONNECTING");
    this.#transition("PREPARING");
    try {
      await this.port.prepare(this.level);
      if (this.level.annotate) await this.level.annotate(this.port);
    } catch (error) {
      this.#transition("DISCONNECTED");
      throw error;
    }
    this.#transition("READY");
  }

  get state(): SessionState {
    return this.#state;
  }

  get epoch(): number {
    return this.#epoch;
  }

  get lastResult(): ResultEvent | null {
    return this.#lastResult;
  }

  get portKind(): WorldPort["kind"] {
    return this.port.kind;
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 供 SSE 断线重连时回放（最近 MAX_EVENT_HISTORY 条）。 */
  recentEvents(): EngineEvent[] {
    return [...this.#history];
  }

  async snapshot(): Promise<WorldSnapshot> {
    return this.port.snapshot(this.level.def.id);
  }

  /** 提交一次运行：立即返回 runId，结果通过事件流（result）发布。 */
  async run(source: string, options: SessionRunOptions = {}): Promise<{ runId: string }> {
    this.#assertAlive();
    if (this.mode === "repl") {
      throw new SessionError("试符台会话不运行关卡程序；请用 repl(line) 或 POST /api/repl", "INVALID_STATE");
    }
    const commandId = options.commandId?.trim();
    if (commandId) {
      const existing = this.#commandIndex.get(commandId);
      if (existing) return { runId: existing };
    }
    if (this.#state !== "READY" && this.#state !== "PASSED") {
      throw new SessionError(`当前状态 ${this.#state} 不能运行；请先 reset 回到 READY`, "INVALID_STATE");
    }
    if (typeof source !== "string" || source.trim().length === 0) {
      throw new SessionError("source 不能为空", "INVALID_ARGUMENT");
    }
    const runId = `run-${++this.#runSeq}`;
    if (commandId) {
      if (this.#commandIndex.size >= MAX_COMMAND_INDEX) this.#commandIndex.clear();
      this.#commandIndex.set(commandId, runId);
    }
    const ticket = this.#ticket;
    this.#activeRun = { runId, ticket, aborted: false };
    this.#transition("COMPILING");
    void this.#executeRun(runId, source, ticket);
    return { runId };
  }

  async #executeRun(runId: string, source: string, ticket: number): Promise<void> {
    try {
      if (!this.#isCurrent(runId, ticket)) return;
      this.#transition("RUNNING");
      const sdk = this.#makeSdk(runId, ticket);
      await runStudentSandboxed(sdk, source, {
        timeoutMs: this.#runTimeoutMs,
        mode: this.runMode === "explicit" ? "explicit" : "auto-await",
        onLog: line => this.#emit({ type: "log", line }),
      });
      if (!this.#isCurrent(runId, ticket)) return;
      await this.#verifyAndPublish({ runId, ticket }, "run");
    } catch (error) {
      if (!this.#isCurrent(runId, ticket)) return;
      const line = error instanceof StudentCodeError ? error.line : undefined;
      this.#emit({ type: "error", message: messageOf(error), ...(line !== undefined ? { line } : {}) });
      const observedTick = (await this.#safeSnapshotTick()) ?? 0;
      const result: ResultEvent = {
        type: "result",
        runId,
        epoch: this.#epoch,
        passed: false,
        stars: 0,
        criteria: [],
        hidden: [],
        failures: [messageOf(error)],
        observedTick,
        digest: "",
        snapshotDigest: "",
        source: "run",
      };
      this.#lastResult = result;
      this.#emit(result);
      this.#settle();
      this.#toReady();
    } finally {
      if (this.#activeRun?.runId === runId) this.#activeRun = null;
    }
  }

  /**
   * RT-04：只接受本会话已发布（runId + epoch + digest）的快照；旧 epoch / 伪造快照一律 STALE_SNAPSHOT。
   * session 内部 verify 也走这条路径，保证评分输入无法被替换。
   */
  gradeWithBinding(snapshot: WorldSnapshot, binding: SnapshotBinding): ReturnType<typeof grade> {
    this.#assertAlive();
    const issued = this.#issuedSnapshots.get(binding.runId);
    if (!issued) {
      throw new StaleSnapshotError(`快照不属于本会话（runId=${binding.runId}）`);
    }
    if (issued.epoch !== binding.epoch || binding.epoch !== this.#epoch) {
      throw new StaleSnapshotError(`快照 epoch 过期（snapshot=${binding.epoch}，当前=${this.#epoch}）`);
    }
    const digest = digestSnapshot(snapshot);
    if (digest !== issued.digest || digest !== binding.digest) {
      throw new StaleSnapshotError("快照内容与登记 digest 不一致（疑似伪造或重放）");
    }
    return grade(this.level.def, snapshot);
  }

  #issueSnapshot(runId: string, binding: { epoch: number; digest: string }): void {
    this.#issuedSnapshots.set(runId, binding);
    if (this.#issuedSnapshots.size > 100) this.#issuedSnapshots.clear();
    this.#issuedSnapshots.set(runId, binding);
  }

  async setAnnotationsVisible(visible: boolean): Promise<void> {
    this.#assertAlive();
    try {
      await this.port.setAnnotationsVisible(visible);
    } catch {
      /* Mock 世界没有真实标注。 */
    }
  }

  /** 把一句中文提示直接显示在 Minecraft 的界面里（标题/聊天由端口实现）。 */
  async inGame(text: string, kind: "title" | "actionbar" = "title"): Promise<void> {
    this.#assertAlive();
    const t = String(text ?? "").trim();
    if (!t) return;
    try {
      await this.port.fx({ kind, text: t });
    } catch {
      // Mock 世界没有 Minecraft 界面；真实 MC 不可用时也不阻断游戏逻辑。
    }
  }

  /** 玩家节拍：模拟玩家亲手完成最后一步，然后重新快照评分。 */
  async playerBeat(): Promise<{ state: SessionState; result: ResultEvent | null }> {
    this.#assertAlive();
    if (this.mode === "repl") {
      throw new SessionError("试符台会话没有玩家节拍", "INVALID_STATE");
    }
    if (this.#state !== "READY" && this.#state !== "PASSED") {
      throw new SessionError(`当前状态 ${this.#state} 不能触发玩家节拍`, "INVALID_STATE");
    }
    const ticket = this.#ticket;
    const runId = `beat-${++this.#runSeq}`;
    if (this.level.playerBeat) {
      await this.level.playerBeat(this.port);
    }
    const result = await this.#verifyAndPublish({ runId, ticket }, "player-beat");
    return { state: this.#state, result };
  }

  async #verifyAndPublish(
    { runId, ticket }: { runId: string; ticket: number },
    source: "run" | "player-beat",
  ): Promise<ResultEvent | null> {
    if (this.#disposed || ticket !== this.#ticket) return null;
    if (this.#state !== "RUNNING" && this.#state !== "READY" && this.#state !== "PASSED") return null;
    this.#transition("VERIFYING");
    const snapshot = await this.port.snapshot(this.level.def.id);
    if (this.#disposed || ticket !== this.#ticket) return null;
    const epoch = this.#epoch;
    const digest = digestSnapshot(snapshot);
    this.#issueSnapshot(runId, { epoch, digest });
    const report = this.gradeWithBinding(snapshot, { runId, epoch, digest });
    const result: ResultEvent = {
      type: "result",
      runId,
      epoch,
      passed: report.passed,
      stars: report.stars,
      criteria: report.criteria,
      hidden: report.hidden,
      failures: report.failures,
      observedTick: snapshot.tick,
      digest,
      snapshotDigest: digest,
      source,
    };
    this.#lastResult = result;
    for (const c of report.criteria) this.#emit({ type: "objective", id: c.id, text: c.text, done: c.passed });
    if (report.passed) {
      this.#transition("PASSED");
    } else {
      this.#emitHint(report.failures);
      this.#transition("READY");
    }
    this.#emit(result);
    return result;
  }

  /** 中止当前运行并撤销 capability（REQ-STOP-01 / REQ-RUN-01）。 */
  async stop(): Promise<void> {
    this.#assertAlive();
    if (this.#state === "STOPPED") return;
    if (!["READY", "COMPILING", "RUNNING", "VERIFYING", "PASSED"].includes(this.#state)) {
      throw new SessionError(`当前状态 ${this.#state} 不能停止`, "INVALID_STATE");
    }
    this.#ticket += 1;
    this.#activeRun = null;
    this.#transition("STOPPED");
    this.#emit({ type: "log", line: "已停止当前运行（能力已撤销）" });
  }

  /** 重置到检查点：epoch +1，旧运行的结果一律作废（REQ-EPOCH-01 / REQ-RESET-01）。 */
  async reset(): Promise<{ state: SessionState; epoch: number; snapshot: WorldSnapshot }> {
    this.#assertAlive();
    if (this.#state === "DISCONNECTED") {
      throw new SessionError("会话尚未连接", "INVALID_STATE");
    }
    this.#ticket += 1;
    this.#activeRun = null;
    this.#lastResult = null;
    this.#commandIndex.clear();
    this.#issuedSnapshots.clear();
    this.#transition("PREPARING");
    this.#epoch += 1;
    await this.port.reset(this.level);
    const snapshot = await this.port.snapshot(this.level.def.id);
    this.#transition("READY");
    this.#emit({ type: "log", line: `场景已重置（epoch ${this.#epoch}）` });
    return { state: this.#state, epoch: this.#epoch, snapshot };
  }

  /**
   * 试符台：执行一行（不评分、不写关卡进度、世界在本会话内持久）。
   * 与关卡共用 runner 沙箱；超时/错误翻译在 runner 侧完成。
   */
  async repl(line: string): Promise<ReplResult> {
    this.#assertAlive();
    if (this.mode !== "repl") {
      throw new SessionError("只有试符台会话可以执行单句", "INVALID_STATE");
    }
    if (this.#state !== "READY" && this.#state !== "PASSED") {
      throw new SessionError(`当前状态 ${this.#state} 不能执行试符台；请先重置`, "INVALID_STATE");
    }
    const ticket = this.#ticket;
    const collected: string[] = [];
    const sdk = this.#makeReplSdk(ticket, collected);
    const result = await runReplLine(sdk, line, { timeoutMs: this.#replTimeoutMs, onLog: () => undefined });
    if (this.#disposed || ticket !== this.#ticket) {
      return {
        ok: false,
        kind: "error",
        display: "试符台已重置，这一句的结果作废。",
        log: [],
        error: "试符台已重置，这一句的结果作废。",
      };
    }
    result.log = [...collected, ...result.log];
    this.#replHistory.push({ line: String(line ?? "").trim(), kind: result.kind, display: result.display, at: Date.now() });
    return result;
  }

  /** 试符台历史（按执行顺序；不含变量/敏感信息）。 */
  replHistory(): ReplHistoryEntry[] {
    this.#assertAlive();
    return [...this.#replHistory];
  }

  /** 重置试符台场景（不评分、不清历史；history 由 UI「清空记录」处理）。 */
  async replReset(): Promise<{ state: SessionState; epoch: number; snapshot: WorldSnapshot }> {
    this.#assertAlive();
    if (this.mode !== "repl") {
      throw new SessionError("只有试符台会话可以重置试符台", "INVALID_STATE");
    }
    if (this.#state === "DISCONNECTED") {
      throw new SessionError("会话尚未连接", "INVALID_STATE");
    }
    this.#ticket += 1;
    this.#activeRun = null;
    this.#transition("PREPARING");
    this.#epoch += 1;
    await this.port.reset(this.level);
    const snapshot = await this.port.snapshot(this.level.def.id);
    this.#transition("READY");
    return { state: this.#state, epoch: this.#epoch, snapshot };
  }

  async dispose(): Promise<void> {
    this.#assertAlive();
    this.#ticket += 1;
    this.#disposed = true;
    this.#listeners.clear();
    await this.port.dispose();
  }

  #assertAlive(): void {
    if (this.#disposed) throw new SessionError("会话已释放", "DISPOSED");
  }

  #transition(next: SessionState): void {
    this.#state = assertTransition(this.#state, next);
    this.#emit({ type: "state", state: this.#state, epoch: this.#epoch });
  }

  #toReady(): void {
    if (this.#state === "COMPILING" || this.#state === "RUNNING" || this.#state === "VERIFYING") {
      this.#transition("READY");
    }
  }

  #settle(): void {
    this.#activeRun = null;
  }

  #isCurrent(runId: string, ticket: number): boolean {
    if (this.#disposed) return false;
    if (ticket !== this.#ticket) return false;
    if (this.#state === "STOPPED" || this.#state === "PREPARING") return false;
    return this.#activeRun?.runId === runId;
  }

  #isCapabilityValid(runId: string, ticket: number): boolean {
    return this.#isCurrent(runId, ticket) && this.#activeRun !== null && !this.#activeRun.aborted;
  }

  /** 学生 SDK 注入：每次写操作校验当前运行的 capability，并把调用写入 log 事件流。 */
  #makeSdk(runId: string, ticket: number): RunSdk {
    const port = this.port;
    const log = (line: string): void => {
      if (this.#isCapabilityValid(runId, ticket)) this.#emit({ type: "log", line });
    };
    const makeActions = (actor: string, label: string): AgentActions => {
      const guard = (): AgentActions => {
        if (!this.#isCapabilityValid(runId, ticket)) {
          throw new Error("RUN_CANCELLED: 本次运行已被停止或重置");
        }
        return port.agent(actor);
      };
      return {
        get pos() {
          return guard().pos;
        },
        async moveTo(x: number, z: number): Promise<void> {
          const agent = guard();
          log(`${label}.moveTo(${x}, ${z})`);
          await agent.moveTo(x, z);
        },
        async place(block: string, x: number, y: number, z: number): Promise<void> {
          const agent = guard();
          log(`${label}.place("${block}", ${x}, ${y}, ${z})`);
          await agent.place(block, x, y, z);
        },
        async say(text: string): Promise<void> {
          const agent = guard();
          log(`${label}.say(${JSON.stringify(text)})`);
          await agent.say(text);
        },
      };
    };
    const golem: Golem = makeActions("golem", "golem") as unknown as Golem;

    // L10 等多 agent 关卡：def.world.vars 声明 leftAgent/rightAgent 时，把两只织偶的动作表一起注入沙箱。
    // 沙箱 worker 只能接收结构化配置，函数在 worker 内重建；动作仍经 capability 校验回宿主端口执行。
    const vars = this.level.def.world.vars as Record<string, unknown>;
    const leftAgent = typeof vars.leftAgent === "string" ? vars.leftAgent : undefined;
    const rightAgent = typeof vars.rightAgent === "string" ? vars.rightAgent : undefined;
    let multiAgent: SandboxMultiAgentRuntime | undefined;
    if (leftAgent && rightAgent) {
      multiAgent = {
        agents: {
          左织: makeActions(leftAgent, "左织"),
          右织: makeActions(rightAgent, "右织"),
        },
        materialsTotal: Number(vars.materialsTotal ?? 0),
      };
    }
    return { golem, world: port.world, ...(multiAgent ? { multiAgent } : {}) };
  }

  /** 试符台 SDK：与关卡同一 golem/world，但 capability 只校验 epoch/ticket（无评分运行）。 */
  #makeReplSdk(ticket: number, collected: string[]): { golem: Golem; world: World } {
    const port = this.port;
    const guard = (): AgentActions => {
      if (this.#disposed || ticket !== this.#ticket) {
        throw new Error("RUN_CANCELLED: 试符台已停止或重置");
      }
      return port.agent("golem");
    };
    const log = (line: string): void => {
      if (!this.#disposed && ticket === this.#ticket) collected.push(line);
    };
    const golem: Golem = {
      get pos() {
        return guard().pos;
      },
      async moveTo(x: number, z: number): Promise<void> {
        const agent = guard();
        log(`golem.moveTo(${x}, ${z})`);
        await agent.moveTo(x, z);
      },
      async place(block: string, x: number, y: number, z: number): Promise<void> {
        const agent = guard();
        log(`golem.place("${block}", ${x}, ${y}, ${z})`);
        await agent.place(block, x, y, z);
      },
      async say(text: string): Promise<void> {
        const agent = guard();
        log(`golem.say(${JSON.stringify(text)})`);
        await agent.say(text);
      },
    };
    return { golem, world: port.world };
  }

  async #safeSnapshotTick(): Promise<number | undefined> {
    try {
      return (await this.port.snapshot(this.level.def.id)).tick;
    } catch {
      return undefined;
    }
  }

  #emitHint(failures: string[]): void {
    const first = failures[0];
    this.#emit({
      type: "hint",
      level: 1,
      text: first ? `还没完成：${first}` : "还有目标没完成，检查右侧目标面板",
    });
  }

  #emit(event: EngineEvent): void {
    this.#history.push(event);
    if (this.#history.length > MAX_EVENT_HISTORY) this.#history.splice(0, this.#history.length - MAX_EVENT_HISTORY);
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者异常不影响会话
      }
    }
  }
}

export { SessionError, SESSION_STATES } from "./state";
export type { SessionState } from "./state";
