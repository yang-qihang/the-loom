import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { MockWorldPort } from "../../../packages/worldport/src/mock-port";
import type { WorldSnapshot } from "../../../packages/protocol/src/index";
import { pointsView, progressView } from "../../../packages/level-spec/src/index";
import { registryForLevel } from "../../../packages/sdk/src/api-registry";
import { GameSession, SessionError, type EngineEvent, type ResultEvent } from "../../../packages/session/src/index";
import { findLevelContent, listLevels } from "./catalog";
import { createWorldRuntime, WorldUnavailableError, type WorldRuntime } from "./world";

export interface EngineServerOptions {
  host?: string;
  port?: number;
  /** 测试/嵌入时可注入 WorldRuntime；默认按 LOOM_WORLD 环境变量创建。 */
  world?: WorldRuntime;
}

export interface StartedEngine {
  server: http.Server;
  url: string;
  port: number;
  worldMode: "mock" | "paper";
  close: () => Promise<void>;
}

const ENGINE_VERSION = "1.0.0-t1";

// 运行时目录可能被重新打包删除（旧进程 cwd 失效）；沙箱/缓存需要合法 cwd。
try {
  process.cwd();
} catch {
  process.chdir(os.tmpdir());
}

/** 引擎机器状态 → Studio 的 SessionPhase（apps/studio/src/types.ts）。 */
function studioPhase(state: string): string {
  switch (state) {
    case "CONNECTING":
    case "PREPARING":
      return "loading";
    case "READY":
    case "STOPPED":
      return "ready";
    case "COMPILING":
    case "RUNNING":
    case "VERIFYING":
      return "running";
    case "PASSED":
      return "graded";
    default:
      return "error";
  }
}

/**
 * SSE 载荷：默认 message 事件（Studio 用 EventSource.onmessage 解析 JSON）。
 * 兼容字段：state 事件带 `phase`（Studio SessionPhase）；result 事件带嵌套 `result`
 * （Studio StudioEvent 形状），同时保留 docs/21 §3 的扁平字段。
 */
function ssePayload(event: EngineEvent): unknown {
  if (event.type === "state") return { ...event, phase: studioPhase(event.state) };
  if (event.type === "result") {
    return {
      ...event,
      result: {
        passed: event.passed,
        stars: event.stars,
        criteria: event.criteria,
        hidden: event.hidden,
        failures: event.failures,
        // Studio 的 RunResult 形状（docs/46 §2.3）：目标面板/玩家节拍门控直接用这两个真值。
        progress: event.progress,
        playerBeatReady: event.playerBeatReady,
        // 「名副其实」代码要求（docs/48 §1.9）：已并入 criteria，这里单独透传供 Studio 分区展示。
        ...(event.codeCriteria ? { codeCriteria: event.codeCriteria } : {}),
      },
    };
  }
  return event;
}
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

function setCors(res: http.ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  setCors(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function errorStatus(error: SessionError): number {
  switch (error.code) {
    case "INVALID_ARGUMENT":
      return 400;
    case "INVALID_STATE":
      return 409;
    case "NOT_FOUND":
      return 404;
    case "DISPOSED":
      return 410;
    default:
      return 500;
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new SessionError("请求体过大", "INVALID_ARGUMENT");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SessionError("请求体不是合法 JSON", "INVALID_ARGUMENT");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SessionError("请求体必须是 JSON 对象", "INVALID_ARGUMENT");
  }
  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SessionError(`缺少字符串字段 ${key}`, "INVALID_ARGUMENT");
  }
  return value;
}

/** 端点校验/错误映射之后的最小工具：把会话语义状态里的容器计数映射成 HUD 用的命名点视图。 */
function sessionContainers(
  session: GameSession,
  points: ReturnType<typeof pointsView>,
): Record<string, Record<string, number>> {
  const containers: Record<string, Record<string, number>> = {};
  try {
    const semantic = session.semanticState();
    if (!semantic) return containers;
    // 同一坐标可能对应多个名字（如 L02 的倒蛋位 = barrel / bucket），全部给出，HUD 读 barrel 即可。
    const namesByKey = new Map<string, string[]>();
    for (const [name, point] of Object.entries(points)) {
      const key = point.pos.join(",");
      namesByKey.set(key, [...(namesByKey.get(key) ?? []), name]);
    }
    for (const [key, items] of Object.entries(semantic.containers)) {
      const names = namesByKey.get(key);
      if (names && names.length > 0) {
        for (const name of names) containers[name] = { ...items };
      } else {
        containers[key] = { ...items };
      }
    }
  } catch {
    // 端口已释放/尚未准备：HUD 降级为空，不影响每秒轮询。
  }
  return containers;
}

export function createEngineServer(world?: WorldRuntime): http.Server {
  const runtime = world ?? createWorldRuntime();
  const sessions = new Map<string, GameSession>();
  const startedAt = Date.now();

  /** paper 模式同一时间只允许一个真实会话（一个世界/一只织偶）；新建前一并释放旧会话。 */
  const disposePaperSessions = async (): Promise<void> => {
    if (runtime.mode !== "paper" || sessions.size === 0) return;
    for (const session of sessions.values()) {
      await session.dispose().catch(() => undefined);
    }
    sessions.clear();
  };

  const requireSession = (sessionId: string): GameSession => {
    const session = sessions.get(sessionId);
    if (!session) throw new SessionError(`未知会话 ${sessionId}`, "NOT_FOUND");
    return session;
  };

  const route = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> => {
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "OPTIONS") {
      setCors(res);
      res.writeHead(204).end();
      return;
    }

    if (method === "GET" && path === "/api/health") {
      const uptimeSec = Math.round((Date.now() - startedAt) / 1000);
      try {
        const health = await runtime.health(sessions.size, uptimeSec);
        sendJson(res, 200, { ...health, version: ENGINE_VERSION });
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          port: runtime.mode,
          version: ENGINE_VERSION,
          sessions: sessions.size,
          uptimeSec,
          mc: { kind: runtime.mode, connected: false },
          error: `健康检查失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }

    if (method === "GET" && path === "/api/levels") {
      sendJson(res, 200, { levels: listLevels() });
      return;
    }

    const levelMatch = /^\/api\/levels\/([^/]+)$/.exec(path);
    if (method === "GET" && levelMatch) {
      const content = findLevelContent(decodeURIComponent(levelMatch[1]));
      if (!content) throw new SessionError(`未知关卡 ${levelMatch[1]}`, "NOT_FOUND");
      // progressView 只含 {id,text,player,hint}：Studio 目标面板/引导的唯一来源（docs/46 §2.3、docs/48 §1.4）。
      // points 是本关命名坐标点（Studio 指令手册坐标表/REPL 用）。
      sendJson(res, 200, {
        def: content.def,
        starterCode: content.def.code.starterCode,
        progress: progressView(content.def),
        points: pointsView(content.def),
      });
      return;
    }

    // 指令手册（docs/48 §1.5）：本关可用 API 列表（按关卡引入顺序）+ 命名坐标点。
    if (method === "GET" && path === "/api/api-reference") {
      const levelId = url.searchParams.get("levelId")?.trim();
      if (!levelId) throw new SessionError("缺少 levelId", "INVALID_ARGUMENT");
      const content = findLevelContent(levelId);
      if (!content) throw new SessionError(`未知关卡 ${levelId}`, "NOT_FOUND");
      const orders = new Map(listLevels().map(level => [level.id, level.order]));
      const order = (id: string): number => orders.get(id) ?? Number.MAX_SAFE_INTEGER;
      const apis = registryForLevel(levelId, order);
      sendJson(res, 200, {
        levelId,
        title: content.def.meta.title.zh,
        // `api` 是 Studio 契约里的字段名（apps/studio/src/types.ts ApiReferenceView），
        // `apis` 是任务卡里的名字：两个都返回，避免调用方二选一踩空。
        api: apis,
        apis,
        points: pointsView(content.def),
      });
      return;
    }

    if (method === "POST" && path === "/api/session") {
      const body = await readJson(req);
      const levelId = requireString(body, "levelId");
      const content = findLevelContent(levelId);
      if (!content) throw new SessionError(`未知关卡 ${levelId}`, "NOT_FOUND");
      const mode = typeof body.mode === "string" && body.mode === "repl" ? "repl" : "level";
      if (runtime.mode === "paper") await disposePaperSessions();
      let session: GameSession;
      try {
        const port = await runtime.createPort(content);
        const runTimeoutMs =
          runtime.mode === "paper" ? Number(process.env.LOOM_RUN_TIMEOUT_MS ?? 240_000) : undefined;
        if (process.env.LOOM_DEBUG_ENGINE === "1") {
          console.log(`[debug] session create level=${levelId} world=${runtime.mode} runTimeoutMs=${runTimeoutMs}`);
        }
        session = await GameSession.create(content, port, { mode, runTimeoutMs });
      } catch (error) {
        if (error instanceof WorldUnavailableError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new WorldUnavailableError(
          `真实 MC 场景准备失败（${levelId}）：${message}`,
          "排查顺序：① Paper 是否在跑且插件 RPC 8765 可连；② 织偶 bot 是否在线（见 Paper 日志）；③ 先 `npm run mc:reset` 或重启 Paper；④ 详细日志在 it/.mc-server/console.log。",
          error,
        );
      }
      sessions.set(session.id, session);
      const snapshot = await session.snapshot();
      sendJson(res, 201, {
        sessionId: session.id,
        state: session.state,
        epoch: session.epoch,
        port: session.portKind,
        mode: session.mode,
        snapshot,
      });
      return;
    }

    // 会话快照（docs/48 §1.6）：Studio HUD 每秒轮询显示灰崽/关键点坐标。
    // 顶层直接展开 WorldSnapshot（agents/npcs/vars/…），同时保留 snapshot 字段兼容；
    // 两条路径都带 points（HUD「艾拉/木桶在哪」、REPL 命名点说明）与 containers
    // （HUD「木桶里已倒 N 件」：容器坐标 → 命名点名字，物品名不带前缀）。
    const sessionSnapshotMatch = /^\/api\/session\/([^/]+)\/snapshot$/.exec(path);
    if (method === "GET" && sessionSnapshotMatch) {
      const session = requireSession(decodeURIComponent(sessionSnapshotMatch[1]));
      const snapshot = await session.snapshot();
      const points = pointsView(session.level.def);
      const containers = sessionContainers(session, points);
      const envelope = {
        ok: true,
        sessionId: session.id,
        state: session.state,
        epoch: session.epoch,
        port: session.portKind,
        mode: session.mode,
        ...snapshot,
        points,
        containers,
        snapshot: { ...snapshot, points, containers },
      };
      sendJson(res, 200, envelope);
      return;
    }

    if (method === "POST" && path === "/api/run") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      const source = requireString(body, "source");
      const commandId = typeof body.commandId === "string" ? body.commandId : undefined;
      const { runId } = await session.run(source, commandId ? { commandId } : {});
      sendJson(res, 202, { runId, state: session.state });
      return;
    }

    if (method === "POST" && path === "/api/stop") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      await session.stop();
      sendJson(res, 200, { ok: true, state: session.state });
      return;
    }

    if (method === "POST" && path === "/api/reset") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      const { state, epoch, snapshot } = await session.reset();
      sendJson(res, 200, { ok: true, state, epoch, snapshot });
      return;
    }

    if (method === "POST" && path === "/api/in-game") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      await session.inGame(String(body.text ?? ""), body.kind === "actionbar" ? "actionbar" : "title");
      return sendJson(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/annotations") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      await session.setAnnotationsVisible(body.visible !== false);
      return sendJson(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/player-beat") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      // 模拟还是真实确认由引擎的运行模式决定（docs/46 §1.3）：
      // mock 世界没有真人输入 → 默认模拟最后一步；paper 世界永远只按真实世界评分（confirm-only）。
      // 显式传 simulate 时以调用方为准（测试/调试）。
      const simulate = body.simulate === undefined ? runtime.mode === "mock" : body.simulate !== false;
      const { state, result } = await session.playerBeat(!simulate);
      sendJson(res, 200, { ok: true, simulate, state, result });
      return;
    }

    if (method === "POST" && path === "/api/repl") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      const line = typeof body.line === "string" ? body.line : "";
      const result = await session.repl(line);
      sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && path === "/api/repl/history") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) throw new SessionError("缺少 sessionId", "INVALID_ARGUMENT");
      const session = requireSession(sessionId);
      sendJson(res, 200, { entries: session.replHistory() });
      return;
    }

    if (method === "POST" && path === "/api/repl/reset") {
      const body = await readJson(req);
      const session = requireSession(requireString(body, "sessionId"));
      const { state, epoch, snapshot } = await session.replReset();
      sendJson(res, 200, { ok: true, state, epoch, snapshot });
      return;
    }

    if (method === "GET" && path === "/api/events") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) throw new SessionError("缺少 sessionId", "INVALID_ARGUMENT");
      const session = requireSession(sessionId);
      setCors(res);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (event: EngineEvent): void => {
        res.write(`data: ${JSON.stringify(ssePayload(event))}\n\n`);
      };
      res.write("retry: 1000\n\n");
      for (const event of session.recentEvents().slice(-40)) send(event);
      send({ type: "state", state: session.state, epoch: session.epoch });
      const unsubscribe = session.subscribe(send);
      const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);
      heartbeat.unref();
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    throw new SessionError(`未知接口 ${method} ${path}`, "NOT_FOUND");
  };

  const studioDir = path.resolve(process.env.LOOM_STUDIO_DIR ?? path.join(process.cwd(), "studio"));
  const mime = (file: string): string => {
    const ext = path.extname(file).toLowerCase();
    return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon" } as Record<string, string>)[ext] ?? "application/octet-stream";
  };
  const serveStatic = (res: http.ServerResponse, pathname: string): boolean => {
    if (!fs.existsSync(studioDir)) return false;
    let rel = pathname;
    if (rel === "/" || rel === "/studio" || rel === "/studio/") rel = "/studio/index.html";
    if (rel === "/companion.html") rel = "/companion.html";
    if (!rel.startsWith("/studio/") && rel !== "/companion.html") return false;
    const file = path.resolve(studioDir, "." + rel.replace(/^\/studio/, "").replace(/^\/companion\.html$/, "/companion.html"));
    if (!file.startsWith(studioDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
    return true;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (req.method === "GET" && serveStatic(res, url.pathname)) return;
    void route(req, res, url).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof WorldUnavailableError) {
        sendJson(res, 503, {
          error: { code: error.code, message: error.message, hint: error.hint },
        });
        return;
      }
      if (error instanceof SessionError) {
        sendJson(res, errorStatus(error), { error: { code: error.code, message: error.message } });
        return;
      }
      sendJson(res, 500, {
        error: { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) },
      });
    });
  });

  server.on("close", () => {
    for (const session of sessions.values()) {
      void session.dispose().catch(() => undefined);
    }
    sessions.clear();
  });

  return server;
}

export async function startEngine(options: EngineServerOptions = {}): Promise<StartedEngine> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const runtime = options.world ?? createWorldRuntime();
  // paper 模式：启动时等真实 MC（RPC + bot）就绪；失败直接抛中文错误，不静默降级成 mock。
  await runtime.init();
  const server = createEngineServer(runtime);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(requestedPort, host);
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  return {
    server,
    url,
    port: address.port,
    worldMode: runtime.mode,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await runtime.close();
    },
  };
}

/** 直接运行 `tsx apps/engine/src/server.ts` 时启动默认端口。 */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const started = await startEngine({
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    host: process.env.HOST ?? DEFAULT_HOST,
  });
  console.log(`LOOM engine ready: ${started.url} (port=${started.port}, world=${started.worldMode})`);
  const shutdown = async (): Promise<void> => {
    console.log("LOOM engine shutting down…");
    await started.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

export type { ResultEvent, WorldSnapshot };
