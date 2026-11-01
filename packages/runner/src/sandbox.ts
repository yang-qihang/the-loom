import { Worker } from "node:worker_threads";
import { transformSync } from "esbuild";
import { transformStudentCode } from "./transform";
import { assertExplicitAwait, MissingAwaitError } from "./explicit";
import { resolveTarget, type SemanticAgentActions } from "../../worldport/src/index";
import type { Golem, NamedPoint, PointLike } from "../../sdk/src/index";
import type { RunSdk } from "./run";

/**
 * RT-02 沙箱执行器：worker_threads + vm.createContext。
 *
 * 学生代码只在一个「只有 golem / world / console（+ 本关命名点）」的 vm 上下文里运行：
 * 没有 process / require / globalThis / Buffer / fetch / eval；
 * eval / Function 构造被 vm codeGeneration:false 禁用；
 * 主线程负责真正执行 WorldPort 调用（能力校验仍在 session 的 golem 代理上）。
 */
export class RunTimeoutError extends Error {
  readonly code = "RUN_TIMEOUT";
  constructor(readonly timeoutMs: number) {
    super(`运行超时（${timeoutMs}ms），已终止`);
    this.name = "RunTimeoutError";
  }
}

export class StudentCodeError extends Error {
  readonly code = "STUDENT_CODE_ERROR";
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "StudentCodeError";
  }
}

export interface SandboxMultiAgentWorkerConfig {
  labels: string[];
  materialsTotal: number;
  positions: Record<string, [number, number, number]>;
}

export interface SandboxRunOptions {
  timeoutMs?: number;
  mode?: "auto-await" | "explicit";
  /** console.log/warn/error 的宿主回调（不暴露 console 对象本身）。 */
  onLog?: (line: string) => void;
}

export interface SandboxCodeOptions extends SandboxRunOptions {
  /** 编译产物内的入口函数名（默认 __loomMain）。 */
  entry?: string;
  /** 是否把入口函数返回值回传（REPL 表达式求值用）。 */
  captureValue?: boolean;
  /** 学生源码行数（错误行号映射用，默认 1）。 */
  studentLineCount?: number;
}

interface WorkerRpcMessage {
  kind: "rpc";
  id: number;
  method: string;
  args: unknown[];
}

interface WorkerDoneMessage {
  kind: "done";
  value?: unknown;
}

interface WorkerErrorMessage {
  kind: "error";
  name?: string;
  message?: string;
  stack?: string;
}

type WorkerMessage = WorkerRpcMessage | WorkerDoneMessage | WorkerErrorMessage;

/** 命名点里不能注入为全局的名字（沙箱既有全局/JS 内建/保留字），与 run.ts 的注入规则保持一致。 */
export const POINT_RESERVED_NAMES = new Set([
  "golem", "world", "console", "agent", "eval", "undefined", "NaN", "Infinity",
  "globalThis", "process", "require", "Buffer", "fetch",
  "Object", "Array", "String", "Number", "Boolean", "JSON", "Math", "Promise", "Date", "Error",
  "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Reflect", "Proxy", "Intl", "BigInt",
  "parseInt", "parseFloat", "isNaN", "isFinite", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "structuredClone", "setTimeout", "clearTimeout",
]);

/** 把命名点生成为沙箱全局常量（`const eira = …` 的等价物：不可写、不可配置）。 */
export function pointGlobalSource(points: Record<string, NamedPoint>): string {
  const lines: string[] = [];
  for (const name of Object.keys(points)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || name.startsWith("__") || POINT_RESERVED_NAMES.has(name)) continue;
    lines.push(
      `Object.defineProperty(this, ${JSON.stringify(name)}, { value: this.__caps.points[${JSON.stringify(name)}], writable: false, enumerable: true, configurable: false });`,
    );
  }
  return lines.join("\n");
}

/**
 * worker 内联脚本（纯 JS）：
 * - vm 上下文只注入 __hostRpc / __vars / __initialPos / __points / __containers / __bag（bootstrap 后删除）；
 * - golem / world 在 vm realm 内定义（内部背包/容器缓存在闭包里，学生看不到原始状态）；
 * - 命名点注入为全局只读常量，同时 world.points 可访问；
 * - world.vars / world.points 在上下文内 deep-freeze；
 * - 运行时错误把 stack 回传主线程，用于映射学生行号。
 */
const SANDBOX_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const { code, vars, initialPos, entry, captureValue, multi, points, containers, bag, pointSource } = workerData;
const pending = new Map();
let seq = 0;

parentPort.on("message", (message) => {
  if (!message || message.kind !== "rpcResult") return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.ok) entry.resolve(message.value);
  else entry.reject(new Error(message.message || "world 调用失败"));
});

function hostRpc(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ kind: "rpc", id, method, args });
  });
}

function errorPayload(error) {
  return {
    kind: "error",
    name: error && error.name,
    message: error && error.message,
    stack: error && error.stack,
  };
}

/** REPL 表达式求值：只回传 JSON 安全值（函数/循环引用等降级为字符串）。 */
function safeValue(value) {
  if (value === undefined) return null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function") return "（函数）";
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

try {
  const sandbox = {
    __hostRpc: hostRpc,
    __vars: vars,
    __initialPos: initialPos,
    __multi: multi,
    __points: points,
    __containers: containers,
    __bag: bag,
    eval: undefined,
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const bootstrap = [
    "const __rpc = __hostRpc;",
    "const __cfg = { vars: __vars, pos: __initialPos, multi: __multi, points: __points, containers: __containers, bag: __bag };",
    "function __deepFreeze(value) {",
    "  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {",
    "    for (const key of Object.keys(value)) __deepFreeze(value[key]);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "}",
    "function __normItem(item) {",
    "  const lower = String(item === undefined || item === null ? '' : item).toLowerCase();",
    "  return lower.indexOf(':') >= 0 ? lower : 'minecraft:' + lower;",
    "}",
    "function __itemKey(item) { return __normItem(item).replace('minecraft:', ''); }",
    "function __posKey(pos) { return Math.floor(pos[0]) + ',' + Math.floor(pos[1]) + ',' + Math.floor(pos[2]); }",
    "function __resolvePoint(target, fallbackY) {",
    "  if (Array.isArray(target)) return [Number(target[0]), Number(target[1]), Number(target[2])];",
    "  if (typeof target === 'string' && __cfg.points && __cfg.points[target]) {",
    "    const named = __cfg.points[target];",
    "    return [named.x, named.y, named.z];",
    "  }",
    "  if (target !== null && typeof target === 'object' && typeof target.x === 'number' && typeof target.z === 'number') {",
    "    return [Number(target.x), typeof target.y === 'number' ? Number(target.y) : (typeof fallbackY === 'number' ? fallbackY : 0), Number(target.z)];",
    "  }",
    "  throw new Error('不认识的坐标：' + String(target) + '（可以用命名点如 eira、barrel，或 (x, z) 两个数字）');",
    "}",
    "this.__caps = (function () {",
    "  let cachedPos = __cfg.pos.slice();",
    "  const bagCache = {};",
    "  Object.keys(__cfg.bag || {}).forEach(function (k) { bagCache[k] = __cfg.bag[k]; });",
    "  const containerCache = {};",
    "  Object.keys(__cfg.containers || {}).forEach(function (k) { containerCache[k] = Object.assign({}, __cfg.containers[k]); });",
    "  const pointCache = __deepFreeze(__cfg.points || {});",
    "  const golem = {",
    "    get pos() { return cachedPos.slice(); },",
    "    moveTo(x, z) {",
    "      if (typeof x === 'number' && typeof z === 'number') {",
    "        return __rpc('moveTo', [x, z]).then(function () { cachedPos[0] = x; cachedPos[2] = z; });",
    "      }",
    "      const point = __resolvePoint(x, cachedPos[1]);",
    "      return __rpc('moveToPoint', [x]).then(function () { cachedPos = [point[0], cachedPos[1], point[2]]; });",
    "    },",
    "    goTo(point) { return golem.moveTo(point); },",
    "    place(block, x, y, z) {",
    "      if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') return __rpc('place', [block, x, y, z]);",
    "      return __rpc('placePoint', [block, x]);",
    "    },",
    "    collect(item, target) {",
    "      return __rpc('collect', [item, target]).then(function (serverCount) {",
    "        const key = __itemKey(item);",
    "        bagCache[key] = typeof serverCount === 'number' ? serverCount : (bagCache[key] || 0) + 1;",
    "      });",
    "    },",
    "    deposit(item, target, count) {",
    "      const n = Math.max(1, Math.floor(Number(count) || 1));",
    "      const base = __resolvePoint(target, cachedPos[1]);",
    "      return __rpc('deposit', [item, target, n]).then(function (serverCount) {",
    "        const key = __itemKey(item);",
    "        bagCache[key] = typeof serverCount === 'number' ? serverCount : Math.max(0, (bagCache[key] || 0) - n);",
    "        const cKey = __posKey(base);",
    "        const contents = containerCache[cKey] || (containerCache[cKey] = {});",
    "        contents[key] = (contents[key] || 0) + n;",
    "      });",
    "    },",
    "    count(item) { return bagCache[__itemKey(item)] || 0; },",
    "    harvest(crop, target) {",
    "      return __rpc('harvest', [crop, target]).then(function (serverCount) {",
    "        const key = __itemKey(crop);",
    "        if (typeof serverCount === 'number') bagCache[key] = serverCount;",
    "      });",
    "    },",
    "    plant(crop, target) { return __rpc('plant', [crop, target]); },",
    "    say(text) { return __rpc('say', [text]); },",
    "  };",
    "  const world = {",
    "    vars: __deepFreeze(__vars),",
    "    points: pointCache,",
    "    container(target) {",
    "      const base = __resolvePoint(target, cachedPos[1]);",
    "      const cKey = __posKey(base);",
    "      return {",
    "        count(item) { const contents = containerCache[cKey] || {}; return contents[__itemKey(item)] || 0; },",
    "        items() {",
    "          const contents = containerCache[cKey] || {};",
    "          return Object.keys(contents).filter(function (k) { return contents[k] > 0; })",
    "            .map(function (k) { return { item: __normItem(k), count: contents[k] }; });",
    "        },",
    "      };",
    "    },",
    "    supply: function (pos) { return { count: function () { return __cfg.multi ? __cfg.multi.materialsTotal : 0; } }; },",
    "    keystone: function () { return __rpc('keystone', []); },",
    "  };",
    "  return { golem: golem, world: world, points: pointCache };",
    "})();",
    "const golem = this.__caps.golem;",
    "const world = this.__caps.world;",
    pointSource || "",
    "delete this.__caps;",
    "var __mailboxes = {};",
    "var __agentPos = {};",
    "function __mailbox(label) { if (!__mailboxes[label]) __mailboxes[label] = []; return __mailboxes[label]; }",
    "function __sleep(ms) { return __rpc('sandboxSleep', [Number(ms) || 0]); }",
    "var agent = function (name) {",
    "  if (!__cfg.multi || __cfg.multi.labels.indexOf(name) < 0) { throw new Error('不认识的织偶：' + String(name)); }",
    "  if (!__agentPos[name]) __agentPos[name] = (__cfg.multi.positions[name] || [0, 0, 0]).slice();",
    "  return {",
    "    get pos() { return __agentPos[name].slice(); },",
    "    moveTo: function (x, z) { return __rpc('agentMoveTo', [name, x, z]).then(function () { __agentPos[name] = [x, __agentPos[name][1], z]; }); },",
    "    place: function (block, x, y, z) { return __rpc('agentPlace', [name, block, x, y, z]); },",
    "    say: function (text) { return __rpc('agentSay', [name, text]); },",
    "    collect: function (item, pos) { return __rpc('agentCollect', [name, item, pos]); },",
    "    send: function (msg) { __mailbox(name).push({ from: name, text: String(msg) }); return Promise.resolve(); },",
    "    receive: function (timeoutSec) {",
    "      var deadline = Date.now() + (Number(timeoutSec) || 10) * 1000;",
    "      function poll() {",
    "        var box = __mailbox(name);",
    "        if (box.length > 0) { return Promise.resolve(box.shift()); }",
    "        if (Date.now() >= deadline) { return Promise.reject(new Error('等不到对方的回话：先发消息、再等回话。')); }",
    "        return __sleep(20).then(poll);",
    "      }",
    "      return poll();",
    "    },",
    "  };",
    "};",
    "agent.waitIdle = function () { return __rpc('agentWaitIdle', []); };",
    "function __consoleLine(level) { return function () {",
    "  var text = Array.prototype.slice.call(arguments).map(String).join(' ');",
    "  return __rpc('console', [level, text]);",
    "}; }",
    "var console = { log: __consoleLine('log'), warn: __consoleLine('warn'), error: __consoleLine('error') };",
  ].join("\n");
  vm.runInContext(bootstrap, context, { filename: "loom-bootstrap.js" });
  delete sandbox.__hostRpc;
  delete sandbox.__vars;
  delete sandbox.__initialPos;
  delete sandbox.__multi;
  delete sandbox.__points;
  delete sandbox.__containers;
  delete sandbox.__bag;
  sandbox.globalThis = undefined;

  vm.runInContext(code, context, { filename: "loom-student.js" });
  Promise.resolve(vm.runInContext((entry || "__loomMain") + "()", context)).then(
    (value) => parentPort.postMessage({ kind: "done", value: captureValue ? safeValue(value) : undefined }),
    (error) => parentPort.postMessage(errorPayload(error)),
  );
} catch (error) {
  parentPort.postMessage(errorPayload(error));
}
`;

const WRAPPER_LINES = 1;

function compileForSandbox(source: string, mode: "auto-await" | "explicit"): { code: string; studentLineCount: number } {
  const wrapped = transformStudentCode(source, mode);
  try {
    const output = transformSync(wrapped, { loader: "ts", target: "es2022", format: "cjs" });
    return { code: output.code, studentLineCount: source.split("\n").length };
  } catch (error) {
    const detail = error as { message?: string; errors?: Array<{ text?: string; location?: { line?: number } }> };
    const first = detail.errors?.[0];
    const line = first?.location?.line !== undefined ? Math.max(1, first.location.line - WRAPPER_LINES) : undefined;
    throw new StudentCodeError(`[SyntaxError] ${first?.text ?? detail.message ?? "学生代码无法编译"}`, line);
  }
}

function mapStudentLine(stack: string | undefined, studentLineCount: number): number | undefined {
  const match = /loom-student\.js:(\d+):(\d+)/.exec(stack ?? "");
  if (!match) return undefined;
  const line = Number(match[1]) - WRAPPER_LINES;
  return Math.max(1, Math.min(studentLineCount, line));
}

function numberAt(args: unknown[], index: number): number {
  const value = args[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`参数 ${index} 必须是数字（收到 ${String(value)}）`);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 端口 agent 的语义方法（端口声明仍是 AgentActions，运行时对象带 Rich 方法）。 */
type RichGolem = Golem & Partial<SemanticAgentActions>;

function richGolem(sdk: RunSdk): RichGolem {
  return sdk.golem as RichGolem;
}

/** 语义动作完成后回传宿主侧权威计数：沙箱用它在本地缓存里同步 `golem.count`。 */
function serverCount(sdk: RunSdk, item: string): number | undefined {
  const rich = richGolem(sdk);
  return typeof rich.count === "function" ? rich.count(item) : undefined;
}

function semanticUnavailable(method: string): Error {
  return new Error(`这一关的织偶还不会 ${method}：检查端口实现，或先用 place/collect 的旧写法`);
}

async function dispatch(sdk: RunSdk, method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "moveTo":
      return sdk.golem.moveTo(numberAt(args, 0), numberAt(args, 1));
    case "place":
      return sdk.golem.place(String(args[0]), numberAt(args, 1), numberAt(args, 2), numberAt(args, 3));
    case "say":
      return sdk.golem.say(String(args[0]));
    case "moveToPoint": {
      const target = args[0] as PointLike;
      const rich = richGolem(sdk);
      if (typeof rich.moveToPoint === "function") return rich.moveToPoint(target);
      const fallbackY = sdk.golem.pos?.[1] ?? 0;
      const [x, , z] = resolveTarget(target, fallbackY);
      return sdk.golem.moveTo(x, z);
    }
    case "placePoint": {
      const block = String(args[0]);
      const target = args[1] as PointLike;
      const rich = richGolem(sdk);
      if (typeof rich.placePoint === "function") return rich.placePoint(block, target);
      const fallbackY = sdk.golem.pos?.[1] ?? 0;
      const [x, y, z] = resolveTarget(target, fallbackY);
      return sdk.golem.place(block, x, y, z);
    }
    case "collect": {
      const item = String(args[0]);
      const target = args[1] as PointLike;
      const rich = richGolem(sdk);
      if (typeof rich.collect !== "function") throw semanticUnavailable("collect（收东西）");
      await rich.collect(item, target);
      return serverCount(sdk, item);
    }
    case "deposit": {
      const item = String(args[0]);
      const target = args[1] as PointLike;
      const n = Math.max(1, Math.floor(Number(args[2]) || 1));
      const rich = richGolem(sdk);
      if (typeof rich.deposit !== "function") throw semanticUnavailable("deposit（倒东西）");
      await rich.deposit(item, target, n);
      return serverCount(sdk, item);
    }
    case "harvest": {
      const crop = String(args[0]);
      const target = args[1] as PointLike;
      const rich = richGolem(sdk);
      if (typeof rich.harvest !== "function") throw semanticUnavailable("harvest（收割）");
      await rich.harvest(crop, target);
      return serverCount(sdk, crop);
    }
    case "plant": {
      const crop = String(args[0]);
      const target = args[1] as PointLike;
      const rich = richGolem(sdk);
      if (typeof rich.plant === "function") return rich.plant(crop, target);
      const fallbackY = sdk.golem.pos?.[1] ?? 0;
      const [x, y, z] = resolveTarget(target, fallbackY);
      return sdk.golem.place(`${String(crop).includes(":") ? String(crop) : `minecraft:${crop}`}_sprout`, x, y, z);
    }
    case "agentMoveTo": {
      const actions = sdk.multiAgent?.agents[String(args[0])];
      if (!actions) throw new Error(`未知 agent: ${String(args[0])}`);
      return actions.moveTo(numberAt(args, 1), numberAt(args, 2));
    }
    case "agentPlace": {
      const actions = sdk.multiAgent?.agents[String(args[0])];
      if (!actions) throw new Error(`未知 agent: ${String(args[0])}`);
      return actions.place(String(args[1]), numberAt(args, 2), numberAt(args, 3), numberAt(args, 4));
    }
    case "agentSay": {
      const actions = sdk.multiAgent?.agents[String(args[0])];
      if (!actions) throw new Error(`未知 agent: ${String(args[0])}`);
      return actions.say(String(args[1]));
    }
    case "agentCollect":
      return 1;
    case "sandboxSleep":
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(1000, numberAt(args, 0)))));
      return undefined;
    case "agentWaitIdle":
      await new Promise(resolve => setTimeout(resolve, 80));
      return undefined;
    case "keystone":
      // 正式流程由玩家右键；测试模式由 session.playerBeat() 等价落位。沙箱里只保留可 await 的动词。
      await new Promise(resolve => setTimeout(resolve, 40));
      return undefined;
    default:
      throw new Error(`未知 SDK 方法 ${method}`);
  }
}

/**
 * 沙箱执行器：在 worker+vm 内运行已编译代码，返回入口函数的（JSON 安全）返回值。
 * session 用它执行学生程序；REPL 用它求值单行表达式。
 */
function multiWorkerConfig(sdk: RunSdk): SandboxMultiAgentWorkerConfig | null {
  if (!sdk.multiAgent) return null;
  const labels = Object.keys(sdk.multiAgent.agents);
  const positions: Record<string, [number, number, number]> = {};
  for (const label of labels) {
    const p = sdk.multiAgent.agents[label].pos;
    positions[label] = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  }
  return { labels, materialsTotal: sdk.multiAgent.materialsTotal, positions };
}

/** 沙箱语义初值：命名点 + 背包 + 容器（session 从 WorldPort.semantic() 取；缺省为空）。 */
function semanticWorkerData(sdk: RunSdk): {
  points: Record<string, NamedPoint>;
  containers: Record<string, Record<string, number>>;
  bag: Record<string, number>;
  pointSource: string;
} {
  const points = (sdk.semantic?.points ?? sdk.world.points ?? {}) as Record<string, NamedPoint>;
  const containers = sdk.semantic?.containers ?? {};
  const bag = sdk.semantic?.bag ?? {};
  return {
    points: structuredClone(points) as Record<string, NamedPoint>,
    containers: structuredClone(containers) as Record<string, Record<string, number>>,
    bag: structuredClone(bag) as Record<string, number>,
    pointSource: pointGlobalSource(points),
  };
}

export async function executeSandboxCode(sdk: RunSdk, code: string, options: SandboxCodeOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const studentLineCount = options.studentLineCount ?? 1;
  const vars: unknown = structuredClone(sdk.world.vars);
  const initialPos: [number, number, number] = [sdk.golem.pos[0], sdk.golem.pos[1], sdk.golem.pos[2]];
  const semantic = semanticWorkerData(sdk);
  const worker = new Worker(SANDBOX_WORKER_SOURCE, {
    eval: true,
    workerData: {
      code,
      vars,
      initialPos,
      points: semantic.points,
      containers: semantic.containers,
      bag: semantic.bag,
      pointSource: semantic.pointSource,
      entry: options.entry ?? "__loomMain",
      captureValue: options.captureValue ?? false,
      multi: multiWorkerConfig(sdk),
    },
  });

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      action();
    };
    timer = setTimeout(() => finish(() => reject(new RunTimeoutError(timeoutMs))), timeoutMs);
    worker.on("message", (message: WorkerMessage) => {
      if (!message || settled) return;
      if (message.kind === "rpc") {
        void (async () => {
          try {
            if (message.method === "console") {
              options.onLog?.(String(message.args?.[1] ?? ""));
              worker.postMessage({ kind: "rpcResult", id: message.id, ok: true });
              return;
            }
            const value = await dispatch(sdk, message.method, message.args ?? []);
            if (!settled) worker.postMessage({ kind: "rpcResult", id: message.id, ok: true, value });
          } catch (error) {
            if (!settled) {
              worker.postMessage({ kind: "rpcResult", id: message.id, ok: false, message: messageOf(error) });
            }
          }
        })();
        return;
      }
      if (message.kind === "done") {
        finish(() => resolve(message.value));
        return;
      }
      const line = mapStudentLine(message.stack, studentLineCount);
      const name = message.name ?? "Error";
      const text = `[${name}] ${message.message ?? "学生代码运行失败"}${line !== undefined ? `（第 ${line} 行）` : ""}`;
      finish(() => reject(new StudentCodeError(text, line)));
    });
    worker.on("error", error => {
      finish(() => reject(new StudentCodeError(`[SandboxError] ${error.message}`)));
    });
    worker.on("exit", exitCode => {
      if (exitCode !== 0) finish(() => reject(new StudentCodeError(`[SandboxError] 沙箱异常退出（exit ${exitCode}）`)));
    });
  });
}

/** 沙箱入口：session 用它执行学生代码；结果通过 WorldPort 调用回到主线程。 */
export async function runStudentSandboxed(sdk: RunSdk, source: string, options: SandboxRunOptions = {}): Promise<void> {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new StudentCodeError("[SyntaxError] 学生代码为空");
  }
  const mode = options.mode ?? "auto-await";
  if (mode === "explicit") {
    // Act III：不自动插 await；漏 await 的异步调用在运行前给出 2588 中文提示。
    try {
      assertExplicitAwait(source);
    } catch (error) {
      if (error instanceof MissingAwaitError) throw new StudentCodeError(error.message, error.line);
      throw error;
    }
  }
  const { code, studentLineCount } = compileForSandbox(source, mode);
  await executeSandboxCode(sdk, code, { ...options, entry: "__loomMain", captureValue: false, studentLineCount });
}
