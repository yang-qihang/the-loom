/**
 * Engine 的 WorldPort 选择器：`LOOM_WORLD=mock|paper`（默认 mock）。
 *
 * mock   → MockWorldPort（无 MC 全流程）
 * paper  → PaperWorldPort + GolemBot（真实 Paper 26.1.2 + 织偶 bot；需先 `npm run mc:up`）
 *
 * 失败原则：**不静默降级**。paper 模式连不上插件 RPC / bot 进不了服时抛
 * {@link WorldUnavailableError}，消息是给人看的中文排查步骤；HTTP 层映射成 503。
 */
import type { LevelContent, WorldPort } from "../../../packages/worldport/src/index";
import { MockWorldPort } from "../../../packages/worldport/src/mock-port";
import {
  PaperWorldPort,
  WsJsonRpcClient,
  type GolemBotLike,
  type SceneHint,
} from "../../../packages/worldport/src/paper-port";

export type WorldMode = "mock" | "paper";

/** 真实 MC unavailable（连不上 RPC / bot 进不了服 / 场景准备失败）。HTTP 层映射为 503。 */
export class WorldUnavailableError extends Error {
  readonly code = "MC_UNAVAILABLE";
  readonly hint: string;
  constructor(message: string, hint: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WorldUnavailableError";
    this.hint = hint;
  }
}

export interface PaperConfig {
  rpcUrl: string;
  mcHost: string;
  mcPort: number;
  botName: string;
  /** 启动时最多等多久（毫秒）真实 MC 就绪。 */
  waitMs: number;
}

export function resolveWorldMode(env: NodeJS.ProcessEnv = process.env): WorldMode {
  const raw = (env.LOOM_WORLD ?? "mock").trim().toLowerCase();
  if (raw === "mock" || raw === "paper") return raw;
  throw new WorldUnavailableError(
    `LOOM_WORLD 只能是 mock 或 paper，收到 "${env.LOOM_WORLD}"。`,
    "检查启动命令：npm run dev:engine（mock）或 npm run dev:engine:paper（真实 MC）。",
  );
}

export function paperConfig(env: NodeJS.ProcessEnv = process.env): PaperConfig {
  return {
    rpcUrl: env.LOOM_RPC_URL ?? "ws://127.0.0.1:8765",
    mcHost: env.LOOM_MC_HOST ?? "127.0.0.1",
    mcPort: Number(env.LOOM_MC_PORT ?? 25565),
    botName: env.LOOM_BOT_NAME ?? "Golem",
    waitMs: Number(env.LOOM_MC_WAIT_MS ?? 30_000),
  };
}

/**
 * 少数关卡的真实几何与 mock 坐标不同，或 arena 中心不是人该落的位置（docs/46 §1.4 试玩反馈）。
 * 依据：tmp/audit-spawn.ts 按 PaperWorldPort.deriveLayout + 插件 buildArena 规则复算，
 * 逐关核对 spawn 格 body/head 为空气、脚下实心、且到主目标的视线无遮挡。
 * - L01 灯柱建在世界 y=14，地面 y=10（站立 y=11）：玩家落在村道 (2,11,4)。
 * - L03 arena 中心正好是钟楼中心的钟格（被钟楼实心结构包住）：玩家落在南侧主路 (0,65,12)，正对钟楼。
 * - L05 arena 中心 (13,-2) 贴着民房后墙、视线被挡：玩家落在东西主路 (13,64,6)，正对五块房区。
 * 其余关卡（L02/L04/L06/L07/L08/L09/L10）默认 arena 中心经验算均可站立且主目标可见，不覆盖。
 */
export const PAPER_SCENE_HINTS: Record<string, SceneHint> = {
  L01: { groundY: 11, floorY: 10, playerSpawn: [2, 11, 4] },
  L03: { playerSpawn: [0, 65, 12] },
  L05: { playerSpawn: [13, 64, 6] },
};

export interface HealthPayload {
  ok: boolean;
  port: WorldMode;
  mc: Record<string, unknown>;
  bot?: Record<string, unknown>;
  sessions: number;
  uptimeSec: number;
  version: string;
  error?: string;
  hint?: string;
}

export interface WorldRuntime {
  readonly mode: WorldMode;
  version: string;
  /** 引擎启动时调用（paper 模式：等待 RPC 就绪并让织偶进服）。失败抛 WorldUnavailableError。 */
  init(): Promise<void>;
  /** 为一次关卡会话创建端口（paper 模式每个会话一个新 PaperWorldPort，复用同一个 bot/rpc）。 */
  createPort(content: LevelContent): Promise<WorldPort>;
  health(sessions: number, uptimeSec: number): Promise<HealthPayload>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describePlugin(health: Record<string, unknown>): string {
  const mc = typeof health.mc === "string" ? health.mc : "?";
  const version = typeof health.version === "string" ? health.version : "?";
  return `Paper ${mc} / 插件 ${version}`;
}

/** 连接插件 RPC 并等它健康（含重试）；失败给中文排查提示。 */
export async function waitForMcReady(
  config: PaperConfig,
  log: (line: string) => void = () => undefined,
): Promise<{ client: WsJsonRpcClient; plugin: Record<string, unknown> }> {
  const deadline = Date.now() + Math.max(500, config.waitMs);
  let lastError = "未知错误";
  while (Date.now() <= deadline) {
    try {
      const client = await WsJsonRpcClient.connect(config.rpcUrl, 1_500);
      const plugin = (await client.call<Record<string, unknown>>("health", {}, 3_000)) ?? {};
      if (plugin.ok === true) return { client, plugin };
      lastError = `插件健康检查返回 ok=false（${describePlugin(plugin)}）`;
      client.close();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    log(`等待真实 MC 插件 RPC（${config.rpcUrl}）… ${lastError}`);
    await sleep(400);
  }
  throw new WorldUnavailableError(
    `真实 MC 未就绪：${Math.round(config.waitMs / 1000)}s 内连不上插件服务通道 ${config.rpcUrl}。最近错误：${lastError}`,
    "排查顺序：① `npm run mc:up` 并确认日志出现 Done；② `curl 127.0.0.1:4317/api/health` 不是这里，改看 Paper 日志 it/.mc-server/console.log 是否有 LoomCraft 插件加载与 RPC listening：ws://127.0.0.1:8765；③ 端口被旧进程占用时先 `npm run mc:down` 再起。",
  );
}

class MockRuntime implements WorldRuntime {
  readonly mode = "mock" as const;
  readonly version = "1.0.0-t1";
  async init(): Promise<void> {}
  async createPort(_content: LevelContent): Promise<WorldPort> {
    return new MockWorldPort();
  }
  async health(sessions: number, uptimeSec: number): Promise<HealthPayload> {
    return {
      ok: true,
      port: "mock",
      mc: { kind: "mock", connected: true },
      sessions,
      uptimeSec,
      version: this.version,
    };
  }
  async close(): Promise<void> {}
}

class PaperRuntime implements WorldRuntime {
  readonly mode = "paper" as const;
  readonly version = "1.0.0-t1";
  private readonly config: PaperConfig;
  private readonly log: (line: string) => void;
  private client: WsJsonRpcClient | null = null;
  private bot: GolemBotLike | null = null;
  private ready = false;

  constructor(config: PaperConfig, log: (line: string) => void) {
    this.config = config;
    this.log = log;
  }

  get botName(): string {
    return this.config.botName;
  }

  async init(): Promise<void> {
    await this.ensureClient(true);
    await this.ensureBot();
    this.ready = true;
    this.log(`真实 MC 已连接：${describePlugin(await this.pluginHealth())}，织偶 ${this.config.botName} 已进服`);
  }

  private async ensureClient(force = false): Promise<WsJsonRpcClient> {
    if (this.client) return this.client;
    const { client, plugin } = await waitForMcReady(this.config, this.log);
    this.client = client;
    void plugin;
    return client;
  }

  private async ensureBot(): Promise<GolemBotLike> {
    if (this.bot?.connected) return this.bot;
    // bot/manager.mjs 是纯 JS（由 MC 线维护、不带类型声明）；engine 只依赖它的结构化子集，
    // 所以在这一个边界用 unknown 断言成 GolemBotLike（不是 any 污染）。
    const { GolemBot } = (await import("../../../bot/manager.mjs")) as unknown as {
      GolemBot: new (opts: Record<string, unknown>) => GolemBotLike;
    };
    const bot = new GolemBot({
      name: this.config.botName,
      host: this.config.mcHost,
      port: this.config.mcPort,
      log: (line: string) => this.log(`[bot] ${line}`),
    });
    try {
      await bot.connect(this.config.waitMs);
    } catch (firstError) {
      // a previous session just disconnected this bot; give the server a moment to drop the old entity
      await sleep(800);
      try {
        await bot.connect(this.config.waitMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new WorldUnavailableError(
          `织偶 ${this.config.botName} 无法进入真实 MC（${this.config.mcHost}:${this.config.mcPort}）：${message}`,
          "排查顺序：① Paper 的 server.properties 必须是 online-mode=false + enforce-secure-profile=false；② 看 Paper 日志是否有该玩家断线/被踢；③ 同名 bot 残留时先重启 Paper（npm run mc:down && npm run mc:up）；④ 检查 LOOM_MC_HOST/LOOM_MC_PORT。",
          error instanceof Error ? error : firstError,
        );
      }
    }
    this.bot = bot;
    return bot;
  }

  private async pluginHealth(): Promise<Record<string, unknown>> {
    const client = await this.ensureClient();
    return (await client.call<Record<string, unknown>>("health", {}, 3_000)) ?? {};
  }

  async createPort(content: LevelContent): Promise<WorldPort> {
    const client = await this.ensureClient();
    const bot = await this.ensureBot();
    return new PaperWorldPort({
      rpc: client,
      bot,
      def: content.def,
      scene: PAPER_SCENE_HINTS[content.def.id],
      log: (line: string) => this.log(`[port:${content.def.id}] ${line}`),
      closeRpcOnDispose: false,
    });
  }

  async health(sessions: number, uptimeSec: number): Promise<HealthPayload> {
    const base = { port: this.mode, sessions, uptimeSec, version: this.version } as const;
    try {
      const plugin = await this.pluginHealth();
      const botConnected = !!this.bot?.connected;
      return {
        ok: plugin.ok === true && botConnected,
        ...base,
        mc: {
          kind: "paper",
          connected: plugin.ok === true,
          version: typeof plugin.mc === "string" ? plugin.mc : "26.1.2",
          pluginVersion: typeof plugin.version === "string" ? plugin.version : undefined,
          tick: plugin.tick,
          prepared: plugin.prepared,
          sessionId: plugin.sessionId,
          epoch: plugin.epoch,
        },
        bot: { name: this.config.botName, connected: botConnected },
        ...(botConnected
          ? {}
          : {
              error: "插件已连接，但织偶尚未进服。",
              hint: "检查 Paper 是否 online-mode=false、织偶是否被同名会话踢掉；可 POST /api/reset 后重试。",
            }),
      };
    } catch (error) {
      this.client = null;
      return {
        ok: false,
        ...base,
        mc: { kind: "paper", connected: false },
        bot: { name: this.config.botName, connected: false },
        error: `真实 MC 未连接：${error instanceof Error ? error.message : String(error)}`,
        hint: "先 `npm run mc:up`，确认 Paper 日志出现 Done 且插件 RPC 8765 已监听；然后重启 engine（npm run dev:engine:paper）。",
      };
    }
  }

  async close(): Promise<void> {
    try {
      await this.bot?.disconnect();
    } catch {
      /* ignore */
    }
    this.bot = null;
    try {
      this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.ready = false;
  }
}

export function createWorldRuntime(
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = line => console.log(line),
): WorldRuntime {
  const mode = resolveWorldMode(env);
  if (mode === "paper") return new PaperRuntime(paperConfig(env), log);
  return new MockRuntime();
}
