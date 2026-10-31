/**
 * PaperWorldPort — real Minecraft WorldPort adapter (T2).
 *
 * Reusable by `apps/engine`: inject an RPC client (plugin service channel), a golem bot
 * (bot/manager.mjs) and the level definition; everything else (scene derivation, session
 * lifecycle, virtual blocks, reset, snapshot) is implemented here.
 *
 * Scene derivation is data-driven: it is computed from
 *   - `def.world.vars` (any [x,y,z] triple anywhere in the vars tree),
 *   - the calls that `content.prepare(port)` makes (clearRegion / setBlocks / spawnEntity / setTime),
 *   - optional explicit `scene` hints (only needed when mock-era coordinates differ from MC geometry,
 *     e.g. L01's lamp pillars).
 *
 * The plugin side is phase-based: session.begin → content.prepare → session.finalize. That keeps the
 * Java plugin free of per-level branches.
 */
import type { Vec3, WorldSnapshot } from "../../protocol/src/index";
import type { LevelDef } from "../../level-spec/src/index";
import type { AgentActions, Annotation, FxCue, LevelContent, WorldPort } from "./index";

// ---------------------------------------------------------------- injected interfaces

export interface RpcClient {
  call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  close(): void;
}

/** Structural subset of bot/manager.mjs GolemBot (keeps this package free of JS imports). */
export interface GolemBotLike {
  readonly name: string;
  /** mineflayer 当前连接状态（引擎健康检查/重连用） */
  readonly connected?: boolean;
  readonly pos: Vec3;
  connect(timeoutMs?: number): Promise<void>;
  moveTo(x: number, z: number, timeoutMs?: number): Promise<unknown>;
  place(block: string, x: number, y: number, z: number, timeoutMs?: number): Promise<unknown>;
  say(text: string): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SceneHint {
  groundY?: number;
  floorY?: number;
  arena?: { from: Vec3; to: Vec3 };
  playerSpawn?: Vec3;
  tracked?: Vec3[];
  timeTicks?: number;
  kit?: string[];
}

export interface PaperWorldPortOptions {
  rpc: RpcClient;
  bot: GolemBotLike;
  /** 额外的真实 bot（L10 双织者）：键是插件里登记的玩家名。 */
  agents?: Record<string, GolemBotLike>;
  def: LevelDef;
  scene?: SceneHint;
  log?: (line: string) => void;
  closeRpcOnDispose?: boolean;
}

// ---------------------------------------------------------------- WebSocket JSON-RPC client

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Minimal JSON-RPC 2.0 over WebSocket client (Node 22 / browser global WebSocket). */
export class WsJsonRpcClient implements RpcClient {
  private socket: any;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  private constructor(socket: any) {
    this.socket = socket;
    socket.onmessage = (event: { data: unknown }) => {
      let message: { id?: string; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const entry = this.pending.get(String(message.id));
      if (!entry) return;
      this.pending.delete(String(message.id));
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message ?? "rpc error"));
      else entry.resolve(message.result);
    };
    socket.onclose = () => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("rpc connection closed"));
      }
      this.pending.clear();
    };
  }

  static connect(url = "ws://127.0.0.1:8765", timeoutMs = 15_000): Promise<WsJsonRpcClient> {
    const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
    if (!WebSocketCtor) return Promise.reject(new Error("WebSocket global is not available (need Node >= 22)"));
    return new Promise((resolve, reject) => {
      const socket: any = new WebSocketCtor(url);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(new Error(`cannot connect to plugin RPC at ${url}`));
      }, timeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve(new WsJsonRpcClient(socket));
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`cannot connect to plugin RPC at ${url}`));
      };
    });
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`rpc closed before ${method}`));
    this.seq += 1;
    const id = `${method}-${this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- helpers

const keyOf = (pos: number[]): string => `${pos[0]},${pos[1]},${pos[2]}`;
const normBlock = (block: string): string => {
  const lower = String(block ?? "air").toLowerCase();
  return lower.includes(":") ? lower : `minecraft:${lower}`;
};

/** Collect every [x,y,z] triple anywhere in the vars tree (positions, arrays of positions). */
export function collectVec3(node: unknown, out: Vec3[] = []): Vec3[] {
  if (Array.isArray(node)) {
    if (node.length === 3 && node.every((v) => typeof v === "number")) {
      out.push([Math.floor(node[0]), Math.floor(node[1]), Math.floor(node[2])]);
    } else {
      for (const child of node) collectVec3(child, out);
    }
  } else if (node && typeof node === "object") {
    for (const child of Object.values(node as Record<string, unknown>)) collectVec3(child, out);
  }
  return out;
}

/** Most common y among all [x,y,z] triples in the def vars — preliminary scene ground level. */
export function deriveGroundY(def: LevelDef): number | undefined {
  const points = collectVec3(def.world.vars);
  if (points.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const point of points) counts.set(point[1], (counts.get(point[1]) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = -1;
  for (const [y, count] of counts) {
    if (count > bestCount) {
      best = y;
      bestCount = count;
    }
  }
  return best;
}

/** Block/item ids the reference solution uses in `place("…")` calls → bot kit. */
export function deriveKit(def: LevelDef): string[] {
  const sources = [def.code.referenceSolution, def.code.starterCode].join("\n");
  const names = new Set<string>();
  const re = /\.place\(\s*["'`]([a-zA-Z0-9_:]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sources)) !== null) {
    const name = normBlock(match[1]);
    if (name !== "minecraft:air") names.add(name);
  }
  return [...names].sort();
}

interface RecordedScene {
  sets: Map<string, { pos: Vec3; block: string }>;
  clearFrom?: Vec3;
  clearTo?: Vec3;
  timeTicks?: number;
  weather?: "clear" | "rain" | "thunder";
  agentSpawn?: Vec3;
  npcSpecs: Array<{ type: string; id?: string; name?: string; pos: Vec3 }>;
  playerPlaces: Array<{ block: string; pos: Vec3 }>;
}

function emptyScene(): RecordedScene {
  return { sets: new Map(), npcSpecs: [], playerPlaces: [] };
}

// ---------------------------------------------------------------- PaperWorldPort

export class PaperWorldPort implements WorldPort {
  readonly kind = "paper+bot" as const;

  private readonly rpc: RpcClient;
  private readonly bot: GolemBotLike;
  private readonly agents: Record<string, GolemBotLike>;
  private def: LevelDef;
  private readonly sceneHint?: SceneHint;
  private readonly log: (line: string) => void;
  private readonly closeRpcOnDispose: boolean;

  private sessionId = "";
  private epoch = 0;
  private recorded: RecordedScene = emptyScene();
  private virtualCache = new Map<string, { isBlock: boolean; physical: string }>();
  private prepared = false;
  private disposed = false;
  private lastLayout: Record<string, unknown> | null = null;
  lastReset: Record<string, unknown> | null = null;

  readonly actions: Array<{ action: string; ms: number }> = [];

  constructor(options: PaperWorldPortOptions) {
    this.rpc = options.rpc;
    this.bot = options.bot;
    this.agents = { golem: options.bot, ...(options.agents ?? {}) };
    this.def = options.def;
    this.sceneHint = options.scene;
    this.log = options.log ?? (() => {});
    this.closeRpcOnDispose = options.closeRpcOnDispose ?? false;
  }

  get session(): { sessionId: string; epoch: number } {
    return { sessionId: this.sessionId, epoch: this.epoch };
  }

  get rpcClient(): RpcClient {
    return this.rpc;
  }

  get world() {
    return { vars: this.def.world.vars };
  }

  // -------------------------------------------------------------- lifecycle

  async prepare(content: LevelContent): Promise<void> {
    this.def = content.def;
    for (const agentBot of new Set(Object.values(this.agents))) await agentBot.connect();
    const botNames = [...new Set(Object.values(this.agents).map((agentBot) => agentBot.name))];
    await this.rpc.call("bots.set", { names: botNames });
    const preliminaryGroundY = this.sceneHint?.groundY ?? deriveGroundY(content.def) ?? 65;
    const begin = await this.rpc.call<{ sessionId: string; epoch: number }>("session.begin", {
      levelId: content.def.id,
      seed: 1,
      vars: content.def.world.vars,
      groundY: preliminaryGroundY,
    });
    this.sessionId = begin.sessionId;
    this.epoch = begin.epoch;
    this.recorded = emptyScene();
    this.virtualCache.clear();

    await content.prepare(this);
    const layout = this.deriveLayout(content);
    this.lastLayout = layout;
    await this.rpc.call("session.finalize", { sessionId: this.sessionId, layout });
    this.prepared = true;
    await this.waitForBotAtScene();
    await content.afterPrepare?.(this);
    this.log(`prepared ${content.def.id} session=${this.sessionId.slice(0, 8)} epoch=${this.epoch}`);
  }

  async reset(_content?: LevelContent): Promise<void> {
    const started = Date.now();
    this.lastReset = (await this.rpc.call<Record<string, unknown>>("world.reset", {
      sessionId: this.sessionId,
    })) as Record<string, unknown>;
    // the server teleports the golem during reset; wait until the client has applied it, otherwise the
    // next moveTo can "fast-path" using the pre-reset position and the first placement falls back to virtual.
    await this.waitForBotAtScene();
    this.actions.push({ action: "reset", ms: Date.now() - started });
  }

  async snapshot(levelId: string): Promise<WorldSnapshot> {
    return this.rpc.call<WorldSnapshot>("world.snapshot", { levelId, sessionId: this.sessionId });
  }

  /** Reject a stale sessionId (REQ-EPOCH probe used by the harness). */
  async probeSession(staleSessionId: string): Promise<{ staleRejected: boolean }> {
    try {
      await this.rpc.call("world.snapshot", { levelId: this.def.id, sessionId: staleSessionId });
      return { staleRejected: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { staleRejected: /STALE_SESSION|stale/i.test(message) };
    }
  }

  // -------------------------------------------------------------- scene derivation

  private deriveLayout(content: LevelContent): Record<string, unknown> {
    const hint = this.sceneHint ?? {};
    const varPoints = collectVec3(content.def.world.vars);
    const setPoints = [...this.recorded.sets.values()].map((entry) => entry.pos);
    const golem = this.recorded.agentSpawn;
    const npcPoints = this.recorded.npcSpecs.map((npc) => npc.pos);
    const allPoints = [...varPoints, ...setPoints, ...npcPoints, ...(golem ? [golem] : [])];

    const groundY = hint.groundY ?? (golem ? golem[1] : 65);
    const floorY = hint.floorY ?? groundY - 1;
    const arena = hint.arena ?? this.deriveArena(allPoints, floorY, groundY);

    const tracked = new Map<string, Vec3>();
    for (const point of [...varPoints, ...setPoints, ...(hint.tracked ?? [])]) tracked.set(keyOf(point), point);
    for (const { pos } of this.recorded.playerPlaces) tracked.set(keyOf(pos), pos);

    const playerSpawn =
      hint.playerSpawn ??
      ([
        Math.round((arena.from[0] + arena.to[0]) / 2),
        groundY,
        Math.round((arena.from[2] + arena.to[2]) / 2),
      ] as Vec3);

    const layout: Record<string, unknown> = {
      arena,
      tracked: [...tracked.values()],
      playerSpawn,
      groundY,
      floorY,
      kit: hint.kit ?? deriveKit(content.def),
      gamerules: { doDaylightCycle: false, doMobSpawning: false, doFireTick: false, keepInventory: true },
    };
    if (hint.timeTicks !== undefined) layout.timeTicks = hint.timeTicks;
    if (golem) layout.agentSpawn = golem;
    return layout;
  }

  private deriveArena(points: Vec3[], floorY: number, groundY: number): { from: Vec3; to: Vec3 } {
    if (this.recorded.clearFrom && this.recorded.clearTo) {
      return { from: this.recorded.clearFrom, to: this.recorded.clearTo };
    }
    if (points.length === 0) return { from: [-16, floorY, -16], to: [16, groundY + 4, 16] };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minZ = Math.min(minZ, point[2]);
      maxZ = Math.max(maxZ, point[2]);
    }
    const margin = 10;
    return {
      from: [minX - margin, floorY - 1, minZ - margin],
      to: [maxX + margin, groundY + 4, maxZ + margin],
    };
  }

  // -------------------------------------------------------------- agent

  agent(name: string): AgentActions {
    const bot = this.agents[name] ?? this.bot;
    const port = this;
    return {
      get pos(): Vec3 {
        return bot.pos;
      },
      async moveTo(x: number, z: number): Promise<void> {
        const started = Date.now();
        await bot.moveTo(x, z);
        // always mark the arrival: the bot adapter may skip walking when already close (L04 perf),
        // and the grader's "did the golem really reach the spot" check needs a move event.
        await port.rpc.call("agent.mark", { sessionId: port.sessionId, actor: bot.name, pos: bot.pos });
        port.actions.push({ action: `moveTo(${x},${z})`, ms: Date.now() - started });
      },
      async place(block: string, x: number, y: number, z: number): Promise<void> {
        const started = Date.now();
        const requested = normBlock(block);
        const info = await port.classify(requested);
        if (requested !== "minecraft:air" && info.isBlock) {
          try {
            await bot.place(requested, x, y, z);
            port.actions.push({ action: `place(${requested}@${x},${y},${z})`, ms: Date.now() - started });
            return;
          } catch (error) {
            port.log(`bot.place fallback → virtual (${requested}): ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        await port.rpc.call("world.virtualPlace", {
          sessionId: port.sessionId,
          pos: [x, y, z],
          block: requested,
          actor: bot.name,
        });
        port.actions.push({ action: `virtualPlace(${requested}@${x},${y},${z})`, ms: Date.now() - started });
      },
      async say(text: string): Promise<void> {
        await bot.say(text);
        port.actions.push({ action: `say(${text})`, ms: 0 });
      },
    };
  }

  async teleportAgent(name: string, pos: Vec3): Promise<void> {
    await this.rpc.call("player.teleport", { sessionId: this.sessionId, name, pos, yaw: 180, pitch: 0 });
  }

  private async classify(block: string): Promise<{ isBlock: boolean; physical: string }> {
    const cached = this.virtualCache.get(block);
    if (cached) return cached;
    const result = await this.rpc.call<{ isBlock: boolean; physical: string }>("world.classify", { block });
    const info = { isBlock: result.isBlock !== false, physical: String(result.physical ?? block) };
    this.virtualCache.set(block, info);
    return info;
  }

  // -------------------------------------------------------------- scene painter (recorded)

  async setBlocks(entries: Array<{ pos: Vec3; block: string }>): Promise<void> {
    for (const entry of entries) {
      this.recorded.sets.set(keyOf(entry.pos), { pos: entry.pos, block: normBlock(entry.block) });
    }
    await this.rpc.call("world.setBlocks", { sessionId: this.sessionId, entries });
  }

  async clearRegion(from: Vec3, to: Vec3): Promise<void> {
    this.recorded.clearFrom = from;
    this.recorded.clearTo = to;
    for (const key of [...this.recorded.sets.keys()]) {
      const [x, y, z] = key.split(",").map(Number);
      if (
        x >= Math.min(from[0], to[0]) &&
        x <= Math.max(from[0], to[0]) &&
        y >= Math.min(from[1], to[1]) &&
        y <= Math.max(from[1], to[1]) &&
        z >= Math.min(from[2], to[2]) &&
        z <= Math.max(from[2], to[2])
      ) {
        this.recorded.sets.delete(key);
      }
    }
    await this.rpc.call("world.clearRegion", { sessionId: this.sessionId, from, to });
  }

  async spawnEntity(spec: {
    type: string;
    id?: string;
    name?: string;
    pos: Vec3;
    role?: string;
  }): Promise<void> {
    this.recorded.npcSpecs.push({ type: spec.type, id: spec.id, name: spec.name, pos: spec.pos });
    if (spec.type.toLowerCase() === "golem" || spec.type.toLowerCase() === "agent") {
      this.recorded.agentSpawn = spec.pos;
    }
    await this.rpc.call("entity.spawn", { sessionId: this.sessionId, ...spec });
  }

  async clearEntities(ids?: string[]): Promise<void> {
    await this.rpc.call("entity.clear", { sessionId: this.sessionId, ids });
  }

  async setTime(ticks: number): Promise<void> {
    this.recorded.timeTicks = ticks;
    await this.rpc.call("world.setTime", { sessionId: this.sessionId, ticks });
  }

  async setWeather(weather: "clear" | "rain" | "thunder"): Promise<void> {
    this.recorded.weather = weather;
    await this.rpc.call("world.setWeather", { sessionId: this.sessionId, weather });
  }

  async teleportPlayer(pos: Vec3): Promise<void> {
    await this.rpc.call("player.teleport", { sessionId: this.sessionId, pos });
  }

  async playerGive(item: string, count = 1): Promise<void> {
    await this.rpc.call("player.give", { sessionId: this.sessionId, item, count });
  }

  async playerPlace(block: string, pos: Vec3): Promise<void> {
    this.recorded.playerPlaces.push({ block: normBlock(block), pos });
    await this.rpc.call("player.place", {
      sessionId: this.sessionId,
      block: normBlock(block),
      pos,
      testMode: true,
    });
  }

  async annotate(entries: Annotation[]): Promise<void> {
    await this.rpc.call("annotations.set", { sessionId: this.sessionId, entries });
  }

  async setAnnotationsVisible(visible: boolean): Promise<void> {
    await this.rpc.call("annotations.visible", { sessionId: this.sessionId, visible });
  }

  async fx(cue: FxCue): Promise<void> {
    if (cue.kind === "title") await this.rpc.call("fx.title", { sessionId: this.sessionId, text: cue.text });
    else if (cue.kind === "actionbar") await this.rpc.call("fx.actionbar", { sessionId: this.sessionId, text: cue.text });
    else if (cue.kind === "sound") await this.rpc.call("fx.sound", { sessionId: this.sessionId, id: cue.id });
    else await this.rpc.call("fx.particle", { sessionId: this.sessionId, id: cue.id, at: cue.at, count: cue.count ?? 10 });
  }

  onEvent(): () => void {
    return () => {};
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.bot.disconnect();
    } catch {
      /* ignore */
    }
    if (this.closeRpcOnDispose) this.rpc.close();
  }

  /** Wait until the bot client position matches the scene agent spawn (after prepare/reset). */
  private async waitForBotAtScene(timeoutMs = 8_000): Promise<void> {
    const spawn = this.lastLayout?.agentSpawn as Vec3 | undefined;
    const started = Date.now();
    await this.bot.connect().catch(() => {});
    // give the teleport packet a tick to arrive even when spawn is unknown
    if (!spawn) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return;
    }
    while (Date.now() - started < timeoutMs) {
      const pos = this.bot.pos;
      if (Math.abs(pos[0] - spawn[0]) <= 2 && Math.abs(pos[1] - spawn[1]) <= 2 && Math.abs(pos[2] - spawn[2]) <= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // -------------------------------------------------------------- debug

  get isPrepared(): boolean {
    return this.prepared;
  }

  get recordedScene(): RecordedScene {
    return this.recorded;
  }

  get layout(): Record<string, unknown> | null {
    return this.lastLayout;
  }
}

export default PaperWorldPort;
