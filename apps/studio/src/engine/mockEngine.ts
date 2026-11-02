import { grade } from "../../../../packages/grading/src/index";
import { evaluateProgress, pointsView, progressView, type NamedPoint, type ProgressReport } from "../../../../packages/level-spec/src/index";
import { L01Content } from "../../../../content/levels/L01.content";
import { MockWorld } from "../../../../packages/mockworld/src/index";
import { chrome, fill, levelCards, levelCopy, resolveCopy } from "../copy";
import type {
  EngineMode,
  LevelView,
  ReplHistoryEntry,
  ReplOutcome,
  RunResult,
  SessionPhase,
  SnapshotView,
  StudioEngine,
  StudioEvent,
} from "../types";
import { executeL01, parseL01, type RunnerError, type WorldLogEntry } from "../mock/l01Runner";

/** 本地演示兜底只跑 L01；真值（progress/评分）与内容层共用同一份 LevelDef。 */
const LEVEL = L01Content.def;
const LAMPS = (LEVEL.world.vars.lamps as number[][]) ?? [];
/** 本关命名坐标点（与沙箱注入同源）：`golem.moveTo(eira)` / `golem.place("lantern", lamp1)` 在这里展开成数字。 */
const NAMED_POINTS: Record<string, NamedPoint> = pointsView(LEVEL);
const L01_COPY = levelCopy("L01");
const WORKBENCH = chrome.workbench;
/** 旧内容（尚未声明 progress）回退 copy.goals 时用的历史目标 id，保持既有 DOM 契约。 */
const LEGACY_GOAL_IDS = ["lamps", "fourth", "home"];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 把命名点参数展开成数字（本地演示解释器只认数字）：
 * - `golem.moveTo(eira)` / `golem.goTo(lamp1)` → `golem.moveTo(x, z)`
 * - `golem.place("lantern", lamp1)` → `golem.place("lantern", x, y, z)`
 * - 也接受 `{ x, y, z }` 对象字面量参数。
 * 纯数字写法保持原样；行数不变，错误行号仍对得上学生源码。
 */
export function expandNamedPointArgs(source: string): string {
  const names = Object.keys(NAMED_POINTS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const pointPattern = names.length > 0 ? names.join("|") : null;
  return source
    .split(/\r?\n/)
    .map((line) => {
      let next = line;
      if (pointPattern) {
        next = next.replace(
          new RegExp(`(\\bgolem\\s*\\.\\s*(?:moveTo|goTo)\\s*\\(\\s*)(${pointPattern})(\\s*\\))`, "g"),
          (_match, head: string, name: string, tail: string) => {
            const point = NAMED_POINTS[name];
            return point ? `${head}${point.pos[0]}, ${point.pos[2]}${tail}` : _match;
          },
        );
        next = next.replace(
          new RegExp(`(\\bgolem\\s*\\.\\s*place\\s*\\(\\s*(?:"[^"]*"|'[^']*')\\s*,\\s*)(${pointPattern})(\\s*\\))`, "g"),
          (_match, head: string, name: string, tail: string) => {
            const point = NAMED_POINTS[name];
            return point ? `${head}${point.pos[0]}, ${point.pos[1]}, ${point.pos[2]}${tail}` : _match;
          },
        );
      }
      // 对象字面量参数：{ x: ..., z: ... } / { x: ..., y: ..., z: ... }
      next = next.replace(
        /(\bgolem\s*\.\s*(?:moveTo|goTo)\s*\(\s*)\{\s*x\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*z\s*:\s*(-?\d+(?:\.\d+)?)\s*\}\s*\)/g,
        "$1$2, $3)",
      );
      next = next.replace(
        /(\bgolem\s*\.\s*place\s*\(\s*(?:"[^"]*"|'[^']*')\s*,\s*)\{\s*x\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*y\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*z\s*:\s*(-?\d+(?:\.\d+)?)\s*\}\s*\)/g,
        "$1$2, $3, $4)",
      );
      return next;
    })
    .join("\n");
}

const samePos = (a: number[] | undefined, b: number[]): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function logLine(entry: WorldLogEntry): string {
  if (entry.kind === "move") return fill(WORKBENCH.logMove, { 横: entry.x, 纵: entry.z });
  if (entry.kind === "say") return fill(WORKBENCH.logSay, { 话语: entry.text });
  if (entry.kind === "placePlayer") {
    return entry.lamp === null ? chrome.workbench.errorGeneric : fill(WORKBENCH.logPlacePlayer, { 序号: entry.lamp });
  }
  if (entry.lamp !== null && entry.block === "lantern") return fill(WORKBENCH.logPlaceAgentLamp, { 序号: entry.lamp });
  const block = entry.block === "lantern" ? WORKBENCH.blockLantern : entry.block;
  return fill(WORKBENCH.logPlaceAgent, { 横: entry.x, 纵: entry.z, 方块: block });
}

function errorMessage(error: RunnerError): string {
  if (error.kind === "unsupported") return WORKBENCH.localOnly;
  if (error.kind === "tooFar") return L01_COPY ? resolveCopy(L01_COPY.errors.noMove) : WORKBENCH.errorGeneric;
  return WORKBENCH.errorGeneric;
}

interface GoalState {
  id: string;
  text: string;
  done: boolean;
}

interface MockSession {
  id: string;
  levelId: string;
  world: MockWorld;
  phase: SessionPhase;
  listeners: Set<(event: StudioEvent) => void>;
  cancelled: boolean;
  runToken: number;
  /** 与真引擎 sessionEpoch 对齐（快照防重放/目标同步用）。 */
  epoch: number;
}

/** 本地演示引擎（无织机时兜底）：复用 packages/mockworld + packages/grading 的 L01。 */
export class MockEngine implements StudioEngine {
  readonly mode: EngineMode = "mock";
  private readonly sessions = new Map<string, MockSession>();
  private readonly replSessions = new Map<string, MockReplState>();
  private counter = 0;

  async listLevels(): Promise<ReturnType<typeof levelCards>> {
    return levelCards(new Set(["L01"]));
  }

  async loadLevel(id: string): Promise<LevelView> {
    if (id !== "L01" || !L01_COPY) throw new Error(chrome.workbench.loadFailed);
    const progress = progressView(LEVEL);
    return {
      id: "L01",
      title: L01_COPY.title,
      act: LEVEL.meta.act,
      order: LEVEL.meta.order,
      starterCode: LEVEL.code.starterCode,
      referenceSolution: LEVEL.code.referenceSolution,
      // 目标面板 id/text 与真引擎一致：优先 progress；旧内容回退 copy.goals。
      // hint/player 供教练卡「下一步怎么做」与玩家节拍高亮（docs/48 §1.4）。
      objectives:
        progress.length > 0
          ? progress.map((step) => ({
              id: step.id,
              text: step.text,
              ...(step.hint ? { hint: step.hint } : {}),
              ...(step.player ? { player: true } : {}),
            }))
          : L01_COPY.goals.map((text, index) => ({ id: LEGACY_GOAL_IDS[index] ?? `goal-${index}`, text })),
      hints: L01_COPY.hints.map((hint) => resolveCopy(hint)),
      points: NAMED_POINTS,
    };
  }

  async createSession(levelId: string): Promise<string> {
    if (levelId !== "L01") throw new Error(chrome.workbench.loadFailed);
    const id = `mock-session-${++this.counter}`;
    const session: MockSession = {
      id,
      levelId,
      world: new MockWorld({ ...LEVEL.world.vars }),
      phase: "loading",
      listeners: new Set(),
      cancelled: false,
      runToken: 0,
      epoch: 0,
    };
    this.sessions.set(id, session);
    session.phase = "ready";
    return id;
  }

  async run(sessionId: string, source: string): Promise<string | null> {
    const session = this.get(sessionId);
    session.cancelled = false;
    session.runToken += 1;
    const token = session.runToken;
    const runId = `mock-run-${token}`;
    this.setPhase(session, "running");
    this.emit(session, { type: "log", line: WORKBENCH.runStarted });

    // 内容层参考解用命名点（如 golem.moveTo(eira) / golem.place("lantern", lamp1)）；
    // 本地演示解释器只认数字参数，先展开再解析（旧的全数字写法原样通过）。
    const parsed = parseL01(expandNamedPointArgs(source));
    if ("error" in parsed) {
      this.fail(session, parsed.error, runId);
      return runId;
    }

    void (async () => {
      const error = await executeL01(session.world, parsed.statements, {
        onLog: (entry) => this.emit(session, { type: "log", line: logLine(entry) }),
        isCancelled: () => session.cancelled || session.runToken !== token,
      });
      if (session.cancelled || session.runToken !== token) return;
      if (error) {
        this.fail(session, error, runId);
        return;
      }
      this.emitGoals(session);
      this.emit(session, { type: "log", line: WORKBENCH.runFinished });
      const progress = this.progressReport(session);
      const ready = this.isPlayerBeatReady(progress);
      // 与真引擎一致：run 结束发布一次失败结果（含 progress/playerBeatReady）。
      // 只有织偶部分真的做完，才进入「轮到你」；否则回到 ready，Studio 显示还没完成的目标。
      this.emit(session, { type: "result", result: this.resultOf(session, runId) });
      this.setPhase(session, ready ? "awaiting-player-beat" : "ready");
    })();
    return runId;
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    session.cancelled = true;
    session.runToken += 1;
    this.setPhase(session, "ready");
    this.emit(session, { type: "log", line: WORKBENCH.runStopped });
  }

  async reset(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    session.cancelled = true;
    session.runToken += 1;
    session.epoch += 1;
    session.world = new MockWorld({ ...LEVEL.world.vars });
    this.setPhase(session, "ready");
    this.emitGoals(session);
    this.emit(session, { type: "log", line: WORKBENCH.resetDone });
  }

  async inGame(_sessionId: string, _text: string, _kind?: "title" | "actionbar"): Promise<void> {
    // Mock 没有 Minecraft 界面；真实模式由 /api/in-game 显示标题。
  }

  async setAnnotations(_sessionId: string, _visible: boolean): Promise<void> {
    // Mock 没有真实世界标注。
  }

  async playerBeat(sessionId: string, simulate = true): Promise<void> {
    // MockWorld 没有真人输入，始终模拟；真实路径由 HttpEngine 传入 simulate=false。
    void simulate;
    const session = this.get(sessionId);
    // 线性门控：只有 run 结束、且引擎真值判定织偶部分已完成，phase 才会是 awaiting-player-beat。
    if (session.phase !== "awaiting-player-beat") {
      this.emit(session, { type: "log", line: WORKBENCH.playerBeatEarly });
      return;
    }
    session.world.playerPlace("lantern", LAMPS[3] as [number, number, number]);
    this.emit(session, { type: "log", line: fill(WORKBENCH.logPlacePlayer, { 序号: 4 }) });
    this.emitGoals(session);
    this.emit(session, { type: "result", result: this.resultOf(session, `mock-beat-${session.runToken}`) });
    this.setPhase(session, "graded");
  }

  async createReplSession(levelId = "L01"): Promise<string> {
    // 本地演示只有 L01；仍接受 levelId 以兼容「打开 REPL 用当前关卡」的新签名。
    if (levelId !== "L01") throw new Error(chrome.workbench.loadFailed);
    const id = `mock-repl-${++this.counter}`;
    const state: MockReplState = { pos: [0, 65, 0], history: [], levelId };
    this.replSessions.set(id, state);
    return id;
  }

  /** 位置 HUD 用：本地演示的世界快照（与真引擎 /api/session/:id/snapshot 同形）。 */
  async snapshot(sessionId: string): Promise<SnapshotView | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const snapshot = session.world.snapshot("L01");
    // 容器坐标 → 命名点名字（HUD 读 snapshot.containers.barrel）；物品名用短名，与引擎端点一致。
    // 同一坐标可能有多个名字（L02 的 barrel / bucket 共用倒蛋位），全部给出。
    const namesByKey = new Map<string, string[]>();
    for (const [name, point] of Object.entries(NAMED_POINTS)) {
      const key = point.pos.join(",");
      namesByKey.set(key, [...(namesByKey.get(key) ?? []), name]);
    }
    const containers: Record<string, Record<string, number>> = {};
    for (const [key, contents] of session.world.containers) {
      const items: Record<string, number> = {};
      for (const [item, count] of contents) if (count > 0) items[item] = count;
      const names = namesByKey.get(key);
      if (names && names.length > 0) for (const name of names) containers[name] = items;
      else containers[key] = items;
    }
    const progress = this.progressReport(session);
    const declared = LEVEL.progress ?? [];
    return {
      agents: snapshot.agents,
      npcs: snapshot.npcs,
      vars: snapshot.vars,
      points: NAMED_POINTS,
      containers,
      tick: snapshot.tick,
      // 与真引擎 /api/session/:id/snapshot 同形的进度字段（docs/49 §2.3）：本地 demo 也能自动同步目标。
      progress: progress.steps.map((step, index) => ({
        id: step.id,
        text: step.text,
        passed: step.passed,
        player: step.player,
        ...(declared[index]?.hint ? { hint: declared[index]!.hint } : {}),
      })),
      playerBeatReady: progress.steps.length > 0 ? progress.playerBeatReady : false,
      allPassed: progress.steps.length > 0 && progress.steps.every((step) => step.passed),
      playerBeatRequired: typeof LEVEL.task?.playerBeat === "string" && LEVEL.task.playerBeat.trim().length > 0,
      playerBeatDone: snapshot.events.some((event) => event.type === "block.place" && event.actorType === "player"),
      sessionEpoch: session.epoch,
      state:
        session.phase === "graded"
          ? "PASSED"
          : session.phase === "running"
            ? "RUNNING"
            : session.phase === "loading"
              ? "PREPARING"
              : "READY",
    };
  }

  private recordRepl(state: MockReplState, line: string, outcome: ReplOutcome): ReplOutcome {
    state.history.push({ line, kind: outcome.kind, display: outcome.display, at: Date.now() });
    return outcome;
  }

  async repl(sessionId: string, line: string): Promise<ReplOutcome> {
    const state = this.replSessions.get(sessionId);
    if (!state) throw new Error(chrome.workbench.errorOffline);
    const text = line.trim();
    if (!text) return this.recordRepl(state, line, { ok: false, kind: "error", display: "还没有写内容：写一句符文，再试一次。", log: [] });
    if (text.includes("\n")) {
      return this.recordRepl(state, line, { ok: false, kind: "error", display: "一次只能试一句：把多余的行删掉，再试一次。", log: [] });
    }
    // 命名点参数（golem.moveTo(eira) / golem.place("lantern", lamp1)）先展开成数字，
    // 再按原有的数字规则解释；旧的全数字写法行为不变。
    const expanded = expandNamedPointArgs(text);
    const move = expanded.match(/^golem\.(?:moveTo|goTo)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
    if (move) {
      state.pos = [Number(move[1]), 65, Number(move[2])];
      return this.recordRepl(state, line, { ok: true, kind: "action", display: "灰崽照做了", log: [`灰崽走到（${move[1]}, ${move[2]}）。`] });
    }
    if (/^golem\.pos$/.test(text)) {
      return this.recordRepl(state, line, { ok: true, kind: "value", display: `[${state.pos.join(", ")}]`, log: [] });
    }
    if (/^golem\.say\(.*\)$/.test(text)) {
      return this.recordRepl(state, line, { ok: true, kind: "action", display: "灰崽照做了", log: [] });
    }
    if (/^golem\.place\(\s*"[^"]+"\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)$/.test(expanded)) {
      return this.recordRepl(state, line, { ok: true, kind: "action", display: "灰崽照做了", log: [] });
    }
    return this.recordRepl(state, line, {
      ok: false,
      kind: "error",
      display: "这一句还没跑通。照着试符台给出的示例写一句，再试一次。",
      log: [],
    });
  }

  async replHistory(sessionId: string): Promise<ReplHistoryEntry[]> {
    return this.replSessions.get(sessionId)?.history ?? [];
  }

  async replReset(sessionId: string): Promise<void> {
    const state = this.replSessions.get(sessionId);
    if (state) state.pos = [0, 65, 0];
  }

  subscribe(sessionId: string, listener: (event: StudioEvent) => void): () => void {
    const session = this.get(sessionId);
    session.listeners.add(listener);
    queueMicrotask(() => {
      if (!session.listeners.has(listener)) return;
      listener({ type: "state", state: session.phase });
      for (const goal of this.goalStates(session)) {
        listener({ type: "objective", id: goal.id, text: goal.text, done: goal.done });
      }
    });
    return () => session.listeners.delete(listener);
  }

  private get(sessionId: string): MockSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(chrome.workbench.loadFailed);
    return session;
  }

  private emit(session: MockSession, event: StudioEvent): void {
    for (const listener of session.listeners) listener(event);
  }

  private setPhase(session: MockSession, phase: SessionPhase): void {
    session.phase = phase;
    this.emit(session, { type: "state", state: phase });
  }

  private fail(session: MockSession, error: RunnerError, runId?: string): void {
    this.emit(session, { type: "error", line: error.line, message: errorMessage(error), ...(runId ? { runId } : {}) });
    this.setPhase(session, "ready");
  }

  private emitGoals(session: MockSession): void {
    for (const goal of this.goalStates(session)) {
      this.emit(session, { type: "objective", id: goal.id, text: goal.text, done: goal.done });
    }
  }

  private goalStates(session: MockSession): GoalState[] {
    // 真值优先：与真引擎同源的 evaluateProgress（按 progress 声明逐条评估，id/text 稳定）。
    const report = this.progressReport(session);
    if (report.steps.length > 0) {
      return report.steps.map((step) => ({ id: step.id, text: step.text, done: step.passed }));
    }
    // ---- 旧内容回退（尚未声明 progress）：沿用 copy.goals 文案 + 等价判定 ----
    const snapshot = session.world.snapshot("L01");
    const goalTexts = L01_COPY?.goals ?? ["", "", ""];
    const litByAgent = (index: number): boolean =>
      snapshot.blocks[LAMPS[index].join(",")] === "minecraft:lantern" &&
      session.world.events.some(
        (event) => event.type === "block.place" && event.actorType === "agent" && samePos(event.pos, LAMPS[index]),
      );
    const threeLamps = [0, 1, 2].every(litByAgent);
    const fourth = session.world.events.some(
      (event) => event.type === "block.place" && event.actorType === "player" && samePos(event.pos, LAMPS[3]),
    );
    const agent = snapshot.agents["golem"];
    const eira = snapshot.npcs?.["eira"];
    const home =
      !!agent && !!eira && Math.hypot(agent.pos[0] - eira.pos[0], agent.pos[1] - eira.pos[1], agent.pos[2] - eira.pos[2]) <= 4;

    return [
      { id: LEGACY_GOAL_IDS[0], text: goalTexts[0], done: threeLamps },
      { id: LEGACY_GOAL_IDS[1], text: goalTexts[1], done: fourth },
      { id: LEGACY_GOAL_IDS[2], text: goalTexts[2], done: home },
    ];
  }

  /** 用与真引擎同源的 evaluateProgress 评估当前 MockWorld 快照。 */
  private progressReport(session: MockSession): ProgressReport {
    return evaluateProgress(LEVEL, session.world.snapshot("L01"));
  }

  /** 旧内容没有 progress：保持旧行为（跑完即可进入玩家节拍）。 */
  private isPlayerBeatReady(report: ProgressReport): boolean {
    return report.steps.length > 0 ? report.playerBeatReady : true;
  }

  /** 与真引擎 ResultEvent 对齐的 RunResult（progress/playerBeatReady 供 Studio 目标面板与门控）。 */
  private resultOf(session: MockSession, runId?: string): RunResult {
    const snapshot = session.world.snapshot("L01");
    const graded = grade(LEVEL, snapshot);
    const progress = evaluateProgress(LEVEL, snapshot);
    return {
      ...(runId ? { runId } : {}),
      passed: graded.passed,
      stars: graded.stars,
      criteria: graded.criteria,
      hidden: graded.hidden,
      failures: graded.failures,
      progress: progress.steps.map((step) => ({ id: step.id, text: step.text, passed: step.passed })),
      playerBeatReady: progress.steps.length > 0 ? progress.playerBeatReady : false,
    };
  }
}

interface MockReplState {
  pos: [number, number, number];
  history: ReplHistoryEntry[];
  /** 试符台打开的关卡（本地演示只有 L01，保留字段供「当前关卡」展示/未来复用）。 */
  levelId: string;
}
