// @ts-nocheck
/**
 * verifier 验收工具库（docs/46 §4）：
 * - Engine HTTP（/api/session、/api/run、/api/reset、/api/player-beat、/api/levels/:id）
 * - SSE 事件流采集（/api/events），保留原始事件 + 时间戳
 * - mineflayer 真实玩家（普通玩家连接 Paper；不用真实 MC 客户端）
 *
 * 只读/只驱动引擎与玩家端，不修改功能代码。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const EVIDENCE = path.join(ROOT, "evidence", "playtest-fix");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  return file;
}

/** 墙上时间（ISO）+ 单调毫秒，用于跑表。 */
export function now() {
  return { iso: new Date().toISOString(), ms: Date.now() };
}

export async function jfetch(url, { method = "GET", body, timeoutMs = 180_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

export class Engine {
  constructor(base) {
    this.base = base.replace(/\/$/, "");
  }
  async health() {
    return (await jfetch(`${this.base}/api/health`)).json;
  }
  async levels() {
    return (await jfetch(`${this.base}/api/levels`)).json;
  }
  async levelDef(levelId) {
    const res = await jfetch(`${this.base}/api/levels/${encodeURIComponent(levelId)}`);
    return res;
  }
  /** 创建会话；返回 {status, json, createMs}。prepare 在 paper 模式很慢（真实方块摆放）。 */
  async createSession(levelId, extra = {}) {
    const t0 = Date.now();
    const res = await jfetch(`${this.base}/api/session`, { method: "POST", body: { levelId, ...extra }, timeoutMs: 300_000 });
    return { ...res, createMs: Date.now() - t0 };
  }
  async run(sessionId, source) {
    return jfetch(`${this.base}/api/run`, { method: "POST", body: { sessionId, source } });
  }
  async reset(sessionId) {
    return jfetch(`${this.base}/api/reset`, { method: "POST", body: { sessionId }, timeoutMs: 120_000 });
  }
  async playerBeat(sessionId, simulate = false) {
    return jfetch(`${this.base}/api/player-beat`, {
      method: "POST",
      body: { sessionId, simulate },
      timeoutMs: 300_000,
    });
  }
  async inGame(sessionId, text, kind = "actionbar") {
    return jfetch(`${this.base}/api/in-game`, { method: "POST", body: { sessionId, text, kind } });
  }
  /** 停掉/废弃会话（没有专门端点：重新 POST /api/session 时引擎会 dispose 旧 paper 会话）。 */
  async dispose(sessionId) {
    // 引擎没有 DELETE /api/session；这里只做标记，由下一次 createSession 触发的 disposePaperSessions 清理。
    void sessionId;
  }
}

/**
 * SSE 事件采集器：连接 /api/events?sessionId=...，把每条 data 事件连同接收时间记录下来，
 * 并提供 waitFor 以在事件流里等待条件。连接时会先收到引擎回放的最近事件（recentEvents）。
 */
export class EventStream {
  constructor(engine, sessionId) {
    this.engine = engine;
    this.sessionId = sessionId;
    this.events = []; // {t, e}
    this.raw = [];
    this.closed = false;
    this._controller = new AbortController();
    this._waiters = new Set();
    this._ready = null;
  }

  start() {
    this._ready = this._loop();
    return this;
  }

  async _loop() {
    const url = `${this.engine.base}/api/events?sessionId=${encodeURIComponent(this.sessionId)}`;
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: this._controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`SSE 连接失败 HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!this.closed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (!dataLines.length) continue;
        const text = dataLines.join("\n");
        let event;
        try {
          event = JSON.parse(text);
        } catch {
          event = { type: "unparsed", text };
        }
        const entry = { t: Date.now(), e: event };
        this.events.push(entry);
        this.raw.push(block);
        for (const waiter of [...this._waiters]) {
          try {
            if (waiter.predicate(entry)) {
              waiter.resolve(entry);
              this._waiters.delete(waiter);
            }
          } catch (error) {
            waiter.reject(error);
            this._waiters.delete(waiter);
          }
        }
      }
    }
    this._closedResolve?.();
  }

  /** 在已收到+后续事件里等待第一条满足 predicate 的事件。 */
  waitFor(predicate, timeoutMs = 120_000, label = "event") {
    const existing = this.events.find((entry) => predicate(entry));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters.delete(waiter);
        reject(new Error(`等待 SSE ${label} 超时 ${timeoutMs}ms（已收到 ${this.events.length} 条事件）`));
      }, timeoutMs);
      const waiter = {
        predicate,
        resolve: (entry) => {
          clearTimeout(timer);
          resolve(entry);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this._waiters.add(waiter);
    });
  }

  /** 返回满足 predicate 的全部事件。 */
  filter(predicate) {
    return this.events.filter((entry) => predicate(entry));
  }

  async close() {
    this.closed = true;
    try {
      this._controller.abort();
    } catch {
      /* ignore */
    }
    await Promise.race([this._ready.catch(() => undefined), sleep(500)]);
  }
}

export function eventSummary(stream) {
  return stream.events.map(({ t, e }) => ({
    t: new Date(t).toISOString(),
    type: e.type,
    state: e.state,
    phase: e.phase,
    id: e.id,
    text: e.text,
    done: e.done,
    runId: e.runId,
    source: e.source,
    passed: e.passed,
    stars: e.stars,
  }));
}

/** result 事件 → 验收用精简投影。 */
export function resultProjection(event) {
  if (!event) return null;
  const nested = event.result ?? event;
  return {
    passed: nested.passed,
    stars: nested.stars,
    criteria: nested.criteria ?? event.criteria ?? null,
    hiddenCount: (nested.hidden ?? event.hidden ?? []).length,
    failures: nested.failures ?? event.failures ?? [],
    source: event.source,
    hasProgressField: Object.prototype.hasOwnProperty.call(nested, "progress"),
    hasPlayerBeatReadyField: Object.prototype.hasOwnProperty.call(nested, "playerBeatReady"),
    progress: nested.progress ?? null,
    playerBeatReady: nested.playerBeatReady ?? null,
  };
}

/** 旧 Studio 的 waitingForPlayer 判定（Workbench.tsx HEAD 快照第 106 行）。 */
export function oldStudioWaitingForPlayer(resultEvent) {
  const proj = resultProjection(resultEvent);
  if (!proj) return false;
  return Array.isArray(proj.criteria) && proj.criteria.length > 0 && proj.passed === false;
}

// ------------------------------------------------------------------ mineflayer player

export const BOT_NODE_MODULES = path.join(ROOT, "bot", "node_modules");
export const MC_HOST = process.env.MC_HOST ?? "127.0.0.1";
export const MC_PORT = Number(process.env.MC_PORT ?? 25566);

/** 动态载入工作区锁定的 mineflayer（bot/node_modules, 4.39.0）。 */
export async function loadMineflayer() {
  const module = await import(`file://${path.join(BOT_NODE_MODULES, "mineflayer", "index.js")}`);
  return module.default ?? module;
}

export async function loadPathfinder() {
  const module = await import(`file://${path.join(BOT_NODE_MODULES, "mineflayer-pathfinder", "index.js")}`);
  return module.default ?? module;
}

export async function loadVec3() {
  const module = await import(`file://${path.join(BOT_NODE_MODULES, "vec3", "index.js")}`);
  return module.Vec3 ?? module.default?.Vec3 ?? module.default;
}

/**
 * 创建普通玩家 bot 但不等进服：调用方要挂聊天/actionbar 采集的话必须赶在 spawn 之前挂，
 * 否则会漏掉进服瞬间服务端发的道具提示。@returns bot（未 spawn）
 */
export async function createPlayer({ name, host = MC_HOST, port = MC_PORT, log = () => {} } = {}) {
  const mineflayer = await loadMineflayer();
  if (!name) throw new Error("createPlayer 需要 name");
  const bot = mineflayer.createBot({ host, port, username: name, auth: "offline" });
  bot.on("error", (error) => log(`[player:${name}] error: ${error.message}`));
  bot.on("kicked", (reason) => log(`[player:${name}] kicked: ${String(reason).slice(0, 160)}`));
  bot.on("end", (reason) => log(`[player:${name}] end: ${reason}`));
  return bot;
}

/** 等 bot 进服 + 区块就绪。 */
export async function waitSpawn(bot, { timeoutMs = 90_000, log = () => {} } = {}) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`玩家 ${bot.username} ${timeoutMs}ms 内没有进服`)), timeoutMs);
    bot.once("spawn", () => {
      clearTimeout(timer);
      resolve();
    });
    bot.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    await bot.waitForChunksToLoad();
  } catch {
    /* 老版本没有该方法也不影响后续 blockAt 轮询 */
  }
  log(`[player:${bot.username}] spawned at ${fmtPos(bot.entity.position)}`);
  return bot;
}

/**
 * 以普通玩家身份连真实 Paper（offline 模式），spawn 后才返回。
 * 需要采集「刚进服」消息时请改用 createPlayer + attachPlayerChatCapture + waitSpawn。
 * @returns mineflayer bot（spawn + chunks 已就绪）
 */
export async function connectPlayer(opts = {}) {
  const bot = await createPlayer(opts);
  return waitSpawn(bot, { timeoutMs: opts.timeoutMs ?? 90_000, log: opts.log ?? (() => {}) });
}

export function fmtPos(p) {
  if (!p) return "(?)";
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}

export function inventoryOf(bot) {
  const items = bot.inventory.items().map((item) => ({ name: item.name, count: item.count, slot: item.slot }));
  const heldItem = bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null;
  return { items, heldItem, slotsUsed: items.length };
}

export async function waitBlock(bot, vec, predicate, timeoutMs = 4_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const block = bot.blockAt(vec);
    if (block && predicate(block)) return block;
    await sleep(80);
  }
  return bot.blockAt(vec);
}

/** 读取玩家客户端视角下的一批方块（真实服务器下发，不是 mock）。 */
export function readBlocks(bot, positions) {
  const Vec3 = bot.entity.position.constructor;
  const out = {};
  for (const [x, y, z] of positions) {
    const block = bot.blockAt(new Vec3(x, y, z));
    out[`${x},${y},${z}`] = block ? block.name : null;
  }
  return out;
}

/** 客户端可见实体统计（NPC 累积/清理验收）。 */
export function entityCensus(bot) {
  const byType = {};
  for (const entity of Object.values(bot.entities ?? {})) {
    const type = entity.type ?? entity.name ?? "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return { total: Object.keys(bot.entities ?? {}).length, byType };
}

/** 等玩家位置稳定（传送/落地后）。 */
export async function waitSettled(bot, { timeoutMs = 4_000, eps = 0.05 } = {}) {
  const started = Date.now();
  let prev = bot.entity.position.clone();
  while (Date.now() - started < timeoutMs) {
    await sleep(150);
    const now = bot.entity.position;
    if (now.distanceTo(prev) < eps) return now;
    prev = now.clone();
  }
  return bot.entity.position;
}

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function gitHead() {
  try {
    const head = fs.readFileSync(path.join(ROOT, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice(4).trim();
      const refFile = path.join(ROOT, ".git", ref);
      if (fs.existsSync(refFile)) return fs.readFileSync(refFile, "utf8").trim();
    }
    return head;
  } catch {
    return null;
  }
}

/** 分析旧目标面板：L01 三条 goals 与 result.criteria 的映射（HEAD Workbench.tsx L01_OBJECTIVE_INDEX）。 */
export const L01_GOALS = [
  "让灰崽把 1 到 3 号路灯一盏一盏点亮",
  "走到 4 号灯下，亲手点亮它",
  "最后你回到艾拉身边",
];
export const L01_OBJECTIVE_INDEX = { "four-lamps-lit": 0, "player-lit-fourth": 1, "golem-home": 2 };

export function oldStudioGoalPanel(resultEvent) {
  const proj = resultProjection(resultEvent);
  if (!proj) return null;
  const goalDone = [false, false, false];
  for (const criterion of proj.criteria ?? []) {
    const index = L01_OBJECTIVE_INDEX[criterion.id];
    if (index === undefined) continue;
    goalDone[index] = criterion.passed === true;
  }
  const waiting = oldStudioWaitingForPlayer(resultEvent);
  // HEAD Workbench：等待玩家时把最后一条强制显示为未完成。
  const display = waiting ? goalDone.map((done, index) => (index === 2 ? false : done)) : goalDone;
  return {
    goals: L01_GOALS.map((text, index) => ({ text, done: display[index] })),
    doneCount: `${display.filter(Boolean).length} / 3`,
    waitingForPlayer: waiting,
    waitingCardVisible: waiting,
    playerBeatGuideVisible: waiting, // 旧代码 guide 与 waiting 同条件渲染
    inGameHintSent: waiting, // 旧代码 actionbar「轮到你」在 waiting 时发送
  };
}

// ------------------------------------------------------------------ 插件 RPC（调试/验收）

/**
 * 极简 JSON-RPC 2.0 over WebSocket 客户端（Node 22 全局 WebSocket）。
 * 仅用于验收脚本直连插件调试通道（health/player.inventory/world.blocks/playerBeat.status/player.teleport）。
 */
export class WsRpc {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
  }

  static connect(url, timeoutMs = 10_000) {
    const rpc = new WsRpc(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`连接插件 RPC 超时：${url}`)), timeoutMs);
      const socket = new WebSocket(url);
      rpc.ws = socket;
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(rpc);
      });
      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`连接插件 RPC 失败：${url} ${event?.message ?? ""}`));
      });
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
        } catch {
          return;
        }
        const waiter = rpc.pending.get(message.id);
        if (!waiter) return;
        rpc.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      });
      socket.addEventListener("close", () => {
        rpc.closed = true;
        for (const [, waiter] of rpc.pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error("插件 RPC 连接已关闭"));
        }
        rpc.pending.clear();
      });
    });
  }

  call(method, params = {}, timeoutMs = 180_000) {
    if (!this.ws || this.closed) return Promise.reject(new Error("插件 RPC 未连接"));
    const id = `${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`插件 RPC ${method} 超时 ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** 从 engine /api/health 里取插件会话 id + 插件字段（旧插件也有 sessionId）。 */
export async function pluginSessionOf(engine) {
  const health = await engine.health();
  const mc = health?.mc ?? {};
  return { sessionId: mc.sessionId, prepared: mc.prepared, health };
}

// ------------------------------------------------------------------ 聊天/actionbar 采集

/** 把 MC 聊天组件（JSON 树）拍平成纯文本。 */
export function flattenChatText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((entry) => flattenChatText(entry)).join("");
  if (typeof node === "object") {
    let out = typeof node.text === "string" ? node.text : "";
    if (typeof node.value === "string") out += node.value;
    if (node.extra) out += flattenChatText(node.extra);
    if (node.with) out += flattenChatText(node.with);
    return out;
  }
  return String(node);
}

/**
 * 采集玩家客户端真实收到的聊天/actionbar/title。
 * 26.1 协议里 actionbar 是独立包 `action_bar`（不是 systemChat positionId=2），
 * mineflayer 4.39 没有对应事件，所以这里同时挂钩原始 packet。
 */
export function attachPlayerChatCapture(bot) {
  const capture = { actionBars: [], titles: [], messages: [] };
  bot.on("message", (message) => {
    capture.messages.push({ at: new Date().toISOString(), text: message?.toString?.() ?? flattenChatText(message) });
  });
  bot.on("actionBar", (message) => {
    capture.actionBars.push({ at: new Date().toISOString(), via: "event:actionBar", text: message?.toString?.() ?? flattenChatText(message) });
  });
  bot._client.on("packet", (data, meta) => {
    const name = meta?.name ?? "";
    if (name === "action_bar") {
      capture.actionBars.push({ at: new Date().toISOString(), via: "packet:action_bar", text: flattenChatText(data?.text) });
    } else if (name === "set_title_text" || name === "title_text") {
      capture.titles.push({ at: new Date().toISOString(), via: `packet:${name}`, kind: "title", text: flattenChatText(data?.text) });
    } else if (name === "set_title_subtitle" || name === "title_subtitle") {
      capture.titles.push({ at: new Date().toISOString(), via: `packet:${name}`, kind: "subtitle", text: flattenChatText(data?.text) });
    }
  });
  return capture;
}
