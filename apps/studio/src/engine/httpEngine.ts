import { chrome, fill, levelCards, levelCopy, resolveCopy } from "../copy";
import type { Criterion, EngineMode, LevelView, ReplHistoryEntry, ReplKind, ReplOutcome, RunResult, SessionPhase, StudioEngine, StudioEvent } from "../types";
import { EngineUnavailableError } from "../types";

const DEFAULT_BASE = "http://127.0.0.1:4317";

/** 桌面壳可通过 `?engine=` 把真实 Paper 引擎地址传进来；缺省仍是本地 4317。 */
function runtimeBase(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("engine");
    if (fromQuery) return fromQuery.replace(/\/$/, "");
  }
  return import.meta.env.VITE_ENGINE_URL ?? DEFAULT_BASE;
}

const PHASE_BY_STATE: Record<string, SessionPhase> = {
  DISCONNECTED: "loading",
  CONNECTING: "loading",
  PREPARING: "loading",
  READY: "ready",
  STOPPED: "ready",
  COMPILING: "running",
  RUNNING: "running",
  VERIFYING: "running",
  PASSED: "graded",
};

interface RawEvent {
  type?: string;
  state?: string;
  phase?: string;
  epoch?: number;
  line?: string;
  id?: string;
  text?: string;
  done?: boolean;
  message?: string;
  result?: Partial<RunResult>;
  passed?: boolean;
  stars?: number;
  criteria?: Criterion[];
  hidden?: Criterion[];
  failures?: string[];
}

const criteriaOf = (value: unknown): Criterion[] =>
  Array.isArray(value)
    ? value.filter((item): item is Criterion => !!item && typeof item === "object" && typeof (item as Criterion).id === "string")
    : [];

function normalizeEvent(raw: RawEvent): StudioEvent | null {
  if (raw.type === "state") {
    const phase = raw.phase ?? PHASE_BY_STATE[raw.state ?? ""] ?? "ready";
    return { type: "state", state: phase as SessionPhase };
  }
  if (raw.type === "log") return { type: "log", line: String(raw.line ?? "") };
  if (raw.type === "objective") {
    return { type: "objective", id: String(raw.id ?? ""), text: String(raw.text ?? ""), done: Boolean(raw.done) };
  }
  if (raw.type === "result") {
    const payload = raw.result ?? raw;
    return {
      type: "result",
      result: {
        passed: Boolean(payload.passed),
        stars: Number(payload.stars ?? 0),
        criteria: criteriaOf(payload.criteria),
        hidden: criteriaOf(payload.hidden),
        failures: Array.isArray(payload.failures) ? payload.failures.map(String) : [],
      },
    };
  }
  if (raw.type === "error") {
    return { type: "error", message: String(raw.message ?? ""), line: typeof raw.line === "number" ? raw.line : undefined };
  }
  return null;
}

/** 与 apps/engine 的 docs/21 §3 HTTP API 对接（T2 真实联调）。 */
export class HttpEngine implements StudioEngine {
  readonly mode: EngineMode = "http";
  constructor(private readonly base: string = runtimeBase()) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.base}${path}`, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
        ...init,
      });
      if (!response.ok) {
        throw new EngineUnavailableError(fill(chrome.workbench.errorStatus, { 状态: response.status }));
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof EngineUnavailableError) throw error;
      throw new EngineUnavailableError(chrome.workbench.errorOffline);
    }
  }

  async listLevels(): Promise<ReturnType<typeof levelCards>> {
    const data = await this.request<{ levels: Array<{ id: string }> }>("/api/levels");
    const available = new Set((data.levels ?? []).map((level) => level.id));
    return levelCards(available);
  }

  async loadLevel(id: string): Promise<LevelView> {
    const data = await this.request<{
      def?: {
        id?: string;
        meta?: { title?: { zh?: string }; act?: number; order?: number };
        code?: { starterCode?: string; referenceSolution?: string };
      };
      starterCode?: string;
    }>(`/api/levels/${id}`);
    const copy = levelCopy(id);
    const def = data.def ?? {};
    return {
      id,
      title: copy?.title ?? def.meta?.title?.zh ?? id,
      act: def.meta?.act ?? 1,
      order: def.meta?.order ?? (Number(id.slice(1)) || 1),
      starterCode: data.starterCode ?? def.code?.starterCode ?? "",
      referenceSolution: def.code?.referenceSolution ?? "",
      objectives: copy ? copy.goals.map((text, index) => ({ id: ["lamps", "fourth", "home"][index] ?? `goal-${index}`, text })) : [],
      hints: copy ? copy.hints.map((hint) => resolveCopy(hint)) : [],
    };
  }

  async createSession(levelId: string): Promise<string> {
    const data = await this.request<{ sessionId: string }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ levelId }),
    });
    return data.sessionId;
  }

  async run(sessionId: string, source: string): Promise<void> {
    await this.request("/api/run", { method: "POST", body: JSON.stringify({ sessionId, source }) });
  }

  async createReplSession(): Promise<string> {
    const data = await this.request<{ sessionId: string }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ levelId: "L01", mode: "repl" }),
    });
    return data.sessionId;
  }

  async repl(sessionId: string, line: string): Promise<ReplOutcome> {
    const data = await this.request<{ ok?: boolean; kind?: ReplKind; display?: string; log?: string[]; error?: string; line?: number }>("/api/repl", {
      method: "POST",
      body: JSON.stringify({ sessionId, line }),
    });
    const kind: ReplKind = data.kind === "value" || data.kind === "action" ? data.kind : "error";
    return {
      ok: Boolean(data.ok) && kind !== "error",
      kind,
      display: String(data.display ?? ""),
      log: Array.isArray(data.log) ? data.log.map(String) : [],
      error: data.error ? String(data.error) : undefined,
      line: typeof data.line === "number" ? data.line : undefined,
    };
  }

  async replHistory(sessionId: string): Promise<ReplHistoryEntry[]> {
    const data = await this.request<{ entries?: Array<{ line?: string; kind?: string; display?: string; at?: number }> }>(
      `/api/repl/history?sessionId=${encodeURIComponent(sessionId)}`,
    );
    return (data.entries ?? []).map((entry) => ({
      line: String(entry.line ?? ""),
      kind: (entry.kind === "value" || entry.kind === "action" ? entry.kind : "error") as ReplKind,
      display: String(entry.display ?? ""),
      at: Number(entry.at ?? 0),
    }));
  }

  async replReset(sessionId: string): Promise<void> {
    await this.request("/api/repl/reset", { method: "POST", body: JSON.stringify({ sessionId }) });
  }

  async stop(sessionId: string): Promise<void> {
    await this.request("/api/stop", { method: "POST", body: JSON.stringify({ sessionId }) });
  }

  async reset(sessionId: string): Promise<void> {
    await this.request("/api/reset", { method: "POST", body: JSON.stringify({ sessionId }) });
  }

  async playerBeat(sessionId: string): Promise<void> {
    await this.request("/api/player-beat", { method: "POST", body: JSON.stringify({ sessionId }) });
  }

  async inGame(sessionId: string, text: string, kind: "title" | "actionbar" = "title"): Promise<void> {
    await this.request("/api/in-game", { method: "POST", body: JSON.stringify({ sessionId, text, kind }) });
  }

  async setAnnotations(sessionId: string, visible: boolean): Promise<void> {
    await this.request("/api/annotations", { method: "POST", body: JSON.stringify({ sessionId, visible }) });
  }

  subscribe(sessionId: string, listener: (event: StudioEvent) => void): () => void {
    const source = new EventSource(`${this.base}/api/events?sessionId=${encodeURIComponent(sessionId)}`);
    source.onmessage = (message) => {
      try {
        const event = normalizeEvent(JSON.parse(message.data) as RawEvent);
        if (event) listener(event);
      } catch {
        listener({ type: "log", line: chrome.workbench.eventMalformed });
      }
    };
    source.onerror = () => {
      listener({ type: "log", line: chrome.workbench.eventDisconnected });
    };
    return () => source.close();
  }
}
