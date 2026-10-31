import { grade } from "../../../../packages/grading/src/index";
import { L01 } from "../../../../packages/level-spec/src/index";
import { MockWorld } from "../../../../packages/mockworld/src/index";
import { chrome, fill, levelCards, levelCopy, resolveCopy } from "../copy";
import type { EngineMode, LevelView, ReplHistoryEntry, ReplOutcome, RunResult, SessionPhase, StudioEngine, StudioEvent } from "../types";
import { executeL01, parseL01, type RunnerError, type WorldLogEntry } from "../mock/l01Runner";

const LAMPS = (L01.world.vars.lamps as number[][]) ?? [];
const L01_COPY = levelCopy("L01");
const WORKBENCH = chrome.workbench;

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
    return {
      id: "L01",
      title: L01_COPY.title,
      act: L01.meta.act,
      order: L01.meta.order,
      starterCode: L01.code.starterCode,
      referenceSolution: L01.code.referenceSolution,
      objectives: L01_COPY.goals.map((text, index) => ({ id: ["lamps", "fourth", "home"][index], text })),
      hints: L01_COPY.hints.map((hint) => resolveCopy(hint)),
    };
  }

  async createSession(levelId: string): Promise<string> {
    if (levelId !== "L01") throw new Error(chrome.workbench.loadFailed);
    const id = `mock-session-${++this.counter}`;
    const session: MockSession = {
      id,
      levelId,
      world: new MockWorld({ ...L01.world.vars }),
      phase: "loading",
      listeners: new Set(),
      cancelled: false,
      runToken: 0,
    };
    this.sessions.set(id, session);
    session.phase = "ready";
    return id;
  }

  async run(sessionId: string, source: string): Promise<void> {
    const session = this.get(sessionId);
    session.cancelled = false;
    session.runToken += 1;
    const token = session.runToken;
    this.setPhase(session, "running");
    this.emit(session, { type: "log", line: WORKBENCH.runStarted });

    const parsed = parseL01(source);
    if ("error" in parsed) {
      this.fail(session, parsed.error);
      return;
    }

    void (async () => {
      const error = await executeL01(session.world, parsed.statements, {
        onLog: (entry) => this.emit(session, { type: "log", line: logLine(entry) }),
        isCancelled: () => session.cancelled || session.runToken !== token,
      });
      if (session.cancelled || session.runToken !== token) return;
      if (error) {
        this.fail(session, error);
        return;
      }
      this.emitGoals(session);
      this.emit(session, { type: "log", line: WORKBENCH.runFinished });
      this.setPhase(session, "awaiting-player-beat");
    })();
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
    session.world = new MockWorld({ ...L01.world.vars });
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
    if (session.phase !== "awaiting-player-beat") {
      this.emit(session, { type: "log", line: WORKBENCH.playerBeatEarly });
      return;
    }
    session.world.playerPlace("lantern", LAMPS[3] as [number, number, number]);
    this.emit(session, { type: "log", line: fill(WORKBENCH.logPlacePlayer, { 序号: 4 }) });
    this.emitGoals(session);

    const report = grade(L01, session.world.snapshot("L01"));
    const result: RunResult = {
      passed: report.passed,
      stars: report.stars,
      criteria: report.criteria,
      hidden: report.hidden,
      failures: report.failures,
    };
    this.emit(session, { type: "result", result });
    this.setPhase(session, "graded");
  }

  async createReplSession(): Promise<string> {
    const id = `mock-repl-${++this.counter}`;
    this.replSessions.set(id, { pos: [0, 65, 0], history: [] });
    return id;
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
    const move = text.match(/^golem\.moveTo\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
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
    if (/^golem\.place\(\s*"lantern"\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\)$/.test(text)) {
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

  private fail(session: MockSession, error: RunnerError): void {
    this.emit(session, { type: "error", line: error.line, message: errorMessage(error) });
    this.setPhase(session, "ready");
  }

  private emitGoals(session: MockSession): void {
    for (const goal of this.goalStates(session)) {
      this.emit(session, { type: "objective", id: goal.id, text: goal.text, done: goal.done });
    }
  }

  private goalStates(session: MockSession): GoalState[] {
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
      { id: "lamps", text: goalTexts[0], done: threeLamps },
      { id: "fourth", text: goalTexts[1], done: fourth },
      { id: "home", text: goalTexts[2], done: home },
    ];
  }
}

interface MockReplState {
  pos: [number, number, number];
  history: ReplHistoryEntry[];
}
