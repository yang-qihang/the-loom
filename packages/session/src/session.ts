import { createHash } from "node:crypto";
import type { WorldSnapshot } from "../../protocol/src/index";
import type { Golem, PointLike, World } from "../../sdk/src/index";
import { resolveTarget, type LevelContent, type RichAgentActions, type WorldPort } from "../../worldport/src/index";
import { evaluateProgress } from "../../level-spec/src/index";
import { grade, type CriterionResult } from "../../grading/src/index";
import { evaluateCodeRequirements } from "../../runner/src/analysis";
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
  /**
   * 「名副其实」代码要求判定（docs/48 §1.9）：对本次学生源码逐条评估的额外可见要求。
   * 结果已同时追加进 criteria（旧 UI 按 criteria 展示也能看到）；此字段供 Studio 单独
   * 展示「本关必须用到的抽象」。player-beat 没有新源码，沿用上一次 run 的源码评估。
   */
  codeCriteria?: CriterionResult[];
  /**
   * 玩家可见任务进度（Studio 目标面板的唯一真值；docs/46 §1.1）。
   * 与 grading criteria 不同：steps 数量/顺序/文案由关卡 progress 声明，Studio 按 id 更新。
   * 旧关卡（尚未声明 progress）为空数组，Studio 回退到 copy.goals。
   */
  progress: CriterionResult[];
  /** 织偶/世界侧已完成，轮到玩家亲手完成最后一步（仅当关卡声明了 progress 才可能为 true）。 */
  playerBeatReady: boolean;
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
  /** 最近一次 verify 评估出的「织偶侧已完成、轮到玩家」；reset 后清零。 */
  #playerBeatReady = false;
  /** 最近一次 run 的学生源码：player-beat 没有新源码时，代码要求沿用这份（reset 清零）。 */
  #lastRunSource: string | null = null;

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

  /**
   * 语义状态快照（HUD 容器计数）：命名点 + 织偶背包 + 容器计数。
   * 端口没有实现语义状态时返回 null（HUD 静默降级）。
   */
  semanticState(): ReturnType<NonNullable<WorldPort["semantic"]>> | null {
    this.#assertAlive();
    if (typeof this.port.semantic !== "function") return null;
    return this.port.semantic();
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
      // 代码要求（docs/48 §1.9）要按学生源码判定：记下本次源码，player-beat 阶段沿用。
      this.#lastRunSource = source;
      this.#transition("RUNNING");
      const sdk = this.#makeSdk(runId, ticket);
      await runStudentSandboxed(sdk, source, {
        timeoutMs: this.#runTimeoutMs,
        mode: this.runMode === "explicit" ? "explicit" : "auto-await",
        onLog: line => this.#emit({ type: "log", line }),
      });
      if (!this.#isCurrent(runId, ticket)) return;
      await this.#verifyAndPublish({ runId, ticket, studentSource: source }, "run");
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
        progress: [],
        playerBeatReady: false,
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

  /**
   * 玩家节拍：默认模拟最后一步（Mock/无人测试）；confirmOnly=true 时只按真实世界状态评分。
   *
   * 线性门控（docs/46 §1.3）：引擎层保持可调用（未 ready 时照常执行并得到普通失败结果，
   * 不抛异常），「轮到玩家」只在 result.playerBeatReady 为 true 时由 Studio 展示、由插件
   * 在 playerBeat.activate 之前拦截提前的右键。这里只在 ready 后才激活游戏内提示。
   */
  async playerBeat(confirmOnly = false): Promise<{ state: SessionState; result: ResultEvent | null }> {
    this.#assertAlive();
    if (this.mode === "repl") {
      throw new SessionError("试符台会话没有玩家节拍", "INVALID_STATE");
    }
    if (this.#state !== "READY" && this.#state !== "PASSED") {
      throw new SessionError(`当前状态 ${this.#state} 不能触发玩家节拍`, "INVALID_STATE");
    }
    const ticket = this.#ticket;
    const runId = `beat-${++this.#runSeq}`;
    if (!confirmOnly && this.level.playerBeat) {
      await this.level.playerBeat(this.port);
    }
    const result = await this.#verifyAndPublish({ runId, ticket, studentSource: this.#lastRunSource }, "player-beat");
    return { state: this.#state, result };
  }

  async #verifyAndPublish(
    { runId, ticket, studentSource }: { runId: string; ticket: number; studentSource?: string | null },
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
    // 「名副其实」代码要求（docs/48 §1.9）：只看学生源码，是世界评分之外的额外可见要求。
    // 直接调用端口玩家节拍时没有新源码（studentSource 为空）→ 沿用上一次 run 的源码；
    // 从未 run 过则按「空源码」判定（代码要求不满足，本关不能算通过）。
    const codeCriteria = evaluateCodeRequirements(this.level.def.codeRequirements, studentSource ?? "");
    // 任务进度真值：与评分共用同一份快照，逐条评估 progress（docs/46 §1.1）。
    const progressSteps = this.level.def.progress ?? [];
    const progressReport = evaluateProgress(this.level.def, snapshot);
    const hasProgress = progressSteps.length > 0;
    // 旧关卡没有 progress：result.playerBeatReady 必须为 false（Studio 不能凭它弹「轮到你」），
    // 但引擎没有可用的解锁信号，行为保持旧版（玩家节拍调用不被额外限制）。
    const playerBeatReady = hasProgress ? progressReport.playerBeatReady : false;
    this.#playerBeatReady = hasProgress ? playerBeatReady : true;
    const progress: CriterionResult[] = progressReport.steps.map(step => ({
      id: step.id,
      text: step.text,
      passed: step.passed,
    }));
    // 可见 criteria = 世界评分 criteria + 代码要求；通过/星级按合并后的可见 criteria 重算。
    // 没有代码要求时与旧行为完全一致（criteria/failures/stars 都不变）。
    const criteria = codeCriteria.length > 0 ? [...report.criteria, ...codeCriteria] : report.criteria;
    const hiddenPassed = report.hidden.length > 0 && report.hidden.every(c => c.passed);
    const playerBeatDone = snapshot.events.some(e => e.type === "block.place" && e.actorType === "player");
    const visiblePassed = criteria.every(c => c.passed);
    const stars = (visiblePassed ? 1 : 0) + (hiddenPassed ? 1 : 0) + (playerBeatDone ? 1 : 0);
    const passed = visiblePassed && hiddenPassed && playerBeatDone;
    const failures = [...criteria, ...report.hidden].filter(c => !c.passed).map(c => c.text);
    const result: ResultEvent = {
      type: "result",
      runId,
      epoch,
      passed,
      stars,
      criteria,
      ...(codeCriteria.length > 0 ? { codeCriteria } : {}),
      hidden: report.hidden,
      failures,
      progress,
      playerBeatReady,
      observedTick: snapshot.tick,
      digest,
      snapshotDigest: digest,
      source,
    };
    this.#lastResult = result;
    if (hasProgress) {
      for (const step of progressReport.steps) this.#emit({ type: "objective", id: step.id, text: step.text, done: step.passed });
    } else {
      // 兼容旧关卡：仍按 grading criteria 发 objective（Studio 按 copy.goals 回退展示）。
      for (const c of report.criteria) this.#emit({ type: "objective", id: c.id, text: c.text, done: c.passed });
    }
    if (passed) {
      this.#transition("PASSED");
    } else {
      // 引导（docs/48 §1.4）：每次失败只发 1 条 actionbar；代码要求未过优先，其次第一条未完成
      // progress 的 hint。Studio 教练卡通过 SSE hint 事件拿到同一段文字。
      const failedCode = codeCriteria.find(c => !c.passed)?.text.trim() || null;
      const progressHint = this.#firstIncompleteProgressHint(progressReport);
      const hintText = failedCode ?? progressHint;
      this.#emit({
        type: "hint",
        level: 1,
        text: hintText ?? (failures[0] ? `还没完成：${failures[0]}` : "还有目标没完成，检查右侧目标面板"),
      });
      this.#transition("READY");
      if (playerBeatReady) {
        if (failedCode) {
          // 代码要求没过但织偶部分已完成：先激活玩家节拍（不重复发 playerBeatHint），actionbar 让位给代码引导。
          await this.#activatePlayerBeat(true);
          await this.#sendActionbar(failedCode);
        } else {
          // 轮到玩家：沿用既有玩家节拍短提示（playerBeatHint）；失败 hint 已通过 SSE 给教练卡。
          await this.#activatePlayerBeat();
        }
      } else if (hintText) {
        await this.#sendActionbar(hintText);
      }
    }
    this.#emit(result);
    return result;
  }

  /** 第一条未完成 progress 步骤的 hint（docs/48 §1.4 的「下一步怎么做」）。 */
  #firstIncompleteProgressHint(progressReport: ReturnType<typeof evaluateProgress>): string | null {
    const steps = this.level.def.progress ?? [];
    for (const [index, step] of progressReport.steps.entries()) {
      if (step.passed) continue;
      const hint = steps[index]?.hint?.trim();
      if (hint) return hint;
    }
    return null;
  }

  /** 把一段中文提示打到游戏内 actionbar；没有真实 MC 界面时静默跳过，不阻断评分。 */
  async #sendActionbar(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    try {
      await this.port.fx({ kind: "actionbar", text: trimmed });
    } catch {
      // Mock 世界没有 Minecraft 界面；真实 MC 不可用也不阻断。
    }
  }

  /**
   * 通知端口「轮到玩家」，并把本关的短提示打到 actionbar；任何一环失败都不阻断评分/事件流。
   * skipActionbar=true 时只激活玩家节拍、不再发 actionbar（本次失败已经发过引导 hint，避免刷屏）。
   */
  async #activatePlayerBeat(skipActionbar = false): Promise<void> {
    try {
      await this.port.activatePlayerBeat();
    } catch {
      // 插件不可用/尚未接线：不影响结果发布（Studio 仍会展示「轮到你」，插件也会在 ready 前拦截）。
    }
    if (skipActionbar) return;
    const hint = this.level.def.task.playerBeatHint ?? this.level.def.task.playerBeat;
    await this.#sendActionbar(hint);
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
    this.#playerBeatReady = false;
    this.#lastRunSource = null;
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

  /**
   * 语义动作代理（docs/48 §1.2）：基础签名保持旧形状（沙箱 worker 里重建），
   * 额外提供命名点重载与 collect/deposit/count/harvest/plant；所有调用仍先过 capability 校验。
   * 参数归一（命名点 / {x,y,z} / [x,y,z]）在这里做；端口若是 Rich 动作表就直接转发。
   */
  #makeActionsProxy(
    actor: string,
    label: string,
    valid: () => boolean,
    cancelledMessage: string,
    log: (line: string) => void,
  ): RichAgentActions {
    const port = this.port;
    const guard = (): RichAgentActions => {
      if (!valid()) throw new Error(cancelledMessage);
      return port.agent(actor) as unknown as RichAgentActions;
    };
    const pointLabel = (target: PointLike): string => {
      if (Array.isArray(target)) return `[${target.join(", ")}]`;
      const named = target as { name?: unknown; x?: unknown; z?: unknown };
      if (named && typeof named.name === "string" && named.name.length > 0) return named.name;
      return `${String(named?.x)}, ${String(named?.z)}`;
    };
    const actions = {
      get pos(): [number, number, number] {
        return guard().pos;
      },
      async moveTo(x: number, z?: number): Promise<void> {
        if (typeof z === "number") {
          const agent = guard();
          log(`${label}.moveTo(${x}, ${z})`);
          await agent.moveTo(x, z);
          return;
        }
        const target = x as unknown as PointLike;
        const agent = guard();
        log(`${label}.moveTo(${pointLabel(target)})`);
        if (typeof agent.moveToPoint === "function") {
          await agent.moveToPoint(target);
          return;
        }
        const [px, , pz] = resolveTarget(target, agent.pos[1]);
        await agent.moveTo(px, pz);
      },
      async goTo(target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.goTo(${pointLabel(target)})`);
        if (typeof agent.goTo === "function") {
          await agent.goTo(target);
          return;
        }
        const [px, , pz] = resolveTarget(target, agent.pos[1]);
        await agent.moveTo(px, pz);
      },
      async moveToPoint(target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.moveTo(${pointLabel(target)})`);
        if (typeof agent.moveToPoint === "function") {
          await agent.moveToPoint(target);
          return;
        }
        const [px, , pz] = resolveTarget(target, agent.pos[1]);
        await agent.moveTo(px, pz);
      },
      async place(block: string, x: number, y?: number, z?: number): Promise<void> {
        if (typeof y === "number" && typeof z === "number") {
          const agent = guard();
          log(`${label}.place("${block}", ${x}, ${y}, ${z})`);
          await agent.place(block, x, y, z);
          return;
        }
        const target = x as unknown as PointLike;
        const agent = guard();
        log(`${label}.place("${block}", ${pointLabel(target)})`);
        if (typeof agent.placePoint === "function") {
          await agent.placePoint(block, target);
          return;
        }
        const [px, py, pz] = resolveTarget(target, agent.pos[1]);
        await agent.place(block, px, py, pz);
      },
      async placePoint(block: string, target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.place("${block}", ${pointLabel(target)})`);
        if (typeof agent.placePoint === "function") {
          await agent.placePoint(block, target);
          return;
        }
        const [px, py, pz] = resolveTarget(target, agent.pos[1]);
        await agent.place(block, px, py, pz);
      },
      async collect(item: string, target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.collect("${item}", ${pointLabel(target)})`);
        if (typeof agent.collect !== "function") {
          throw new Error(`这一关的织偶还不会 collect（收东西）：检查端口实现，或用旧的 place("air", …) 写法`);
        }
        await agent.collect(item, target);
      },
      async deposit(item: string, target: PointLike, count = 1): Promise<void> {
        const n = Math.max(1, Math.floor(Number(count) || 1));
        const agent = guard();
        log(`${label}.deposit("${item}", ${pointLabel(target)}, ${n})`);
        if (typeof agent.deposit !== "function") {
          throw new Error(`这一关的织偶还不会 deposit（倒东西）：检查端口实现，或用旧的 place(item, …) 写法`);
        }
        await agent.deposit(item, target, n);
      },
      count(item: string): number {
        const agent = guard();
        if (typeof agent.count !== "function") return 0;
        const value = agent.count(item);
        log(`${label}.count("${item}") = ${value}`);
        return value;
      },
      async harvest(crop: string, target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.harvest("${crop}", ${pointLabel(target)})`);
        if (typeof agent.harvest !== "function") {
          throw new Error(`这一关的织偶还不会 harvest（收割）：检查端口实现`);
        }
        await agent.harvest(crop, target);
      },
      async plant(crop: string, target: PointLike): Promise<void> {
        const agent = guard();
        log(`${label}.plant("${crop}", ${pointLabel(target)})`);
        if (typeof agent.plant === "function") {
          await agent.plant(crop, target);
          return;
        }
        const [px, py, pz] = resolveTarget(target, agent.pos[1]);
        await agent.place(`${String(crop).includes(":") ? crop : `minecraft:${crop}`}_sprout`, px, py, pz);
      },
      async say(text: string): Promise<void> {
        const agent = guard();
        log(`${label}.say(${JSON.stringify(text)})`);
        await agent.say(text);
      },
    };
    return actions as unknown as RichAgentActions;
  }

  /** 沙箱语义初值：命名点 + 背包 + 容器（WorldPort.semantic()；缺省时沙箱从空状态开始）。 */
  #semanticState(): RunSdk["semantic"] {
    if (typeof this.port.semantic !== "function") return undefined;
    const state = this.port.semantic();
    return {
      points: { ...(this.port.world.points ?? {}), ...state.points },
      bag: state.bag,
      containers: state.containers,
    };
  }

  /** 学生 SDK 注入：每次写操作校验当前运行的 capability，并把调用写入 log 事件流。 */
  #makeSdk(runId: string, ticket: number): RunSdk {
    const log = (line: string): void => {
      if (this.#isCapabilityValid(runId, ticket)) this.#emit({ type: "log", line });
    };
    const makeActions = (actor: string, label: string): RichAgentActions =>
      this.#makeActionsProxy(
        actor,
        label,
        () => this.#isCapabilityValid(runId, ticket),
        "RUN_CANCELLED: 本次运行已被停止或重置",
        log,
      );
    const golem = makeActions("golem", "golem") as unknown as Golem;

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
    const semantic = this.#semanticState();
    return {
      golem,
      world: this.port.world,
      ...(semantic ? { semantic } : {}),
      ...(multiAgent ? { multiAgent } : {}),
    };
  }

  /** 试符台 SDK：与关卡同一 golem/world（含语义方法），但 capability 只校验 epoch/ticket（无评分运行）。 */
  #makeReplSdk(ticket: number, collected: string[]): RunSdk {
    const log = (line: string): void => {
      if (!this.#disposed && ticket === this.#ticket) collected.push(line);
    };
    const golem = this.#makeActionsProxy(
      "golem",
      "golem",
      () => !this.#disposed && ticket === this.#ticket,
      "RUN_CANCELLED: 试符台已停止或重置",
      log,
    ) as unknown as Golem;
    const semantic = this.#semanticState();
    return { golem, world: this.port.world, ...(semantic ? { semantic } : {}) };
  }

  async #safeSnapshotTick(): Promise<number | undefined> {
    try {
      return (await this.port.snapshot(this.level.def.id)).tick;
    } catch {
      return undefined;
    }
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
