import { useEffect, useState } from "react";

/**
 * 桌面壳下发的环境状态（唯一环境状态源）。
 * 契约：docs/55-launcher-env-contract.md §2（Rust `EnvState` 的 camelCase JSON）。
 * 壳在每次 EnvState 变化、以及 iframe load 后通过 `postMessage({ type: "loom:env", env })`
 * 下发给 Studio；Studio 不再自己探测 /api/health，也不再维护第二份「织机在线」状态。
 */
export type EnvLightState = "checking" | "starting" | "ready" | "needs_action" | "error";

export interface EnvLight {
  state: EnvLightState;
  detail?: string;
  hint?: string | null;
  canStart?: boolean;
  canRetry?: boolean;
  guide?: string | null;
}

export interface EnvState {
  engine: EnvLight;
  paper: EnvLight;
  bot: EnvLight;
  client: EnvLight;
  /** L0「进入工坊」门控：四灯全绿。 */
  allReady: boolean;
  /** 正在启动中的长操作（engine / paper / bot / client / all）。 */
  launching: string[];
  /** L2 红色阻断：关卡会话进行中客户端掉线。 */
  clientLost: boolean;
  sessionActive: boolean;
  clientAdapter?: string | null;
  clientAvailableLauncher?: string | null;
  /** 本地演示（Mock 世界）。 */
  mock: boolean;
  updatedAt: number;
}

export type EnvTone = "online" | "mock" | "busy" | "error";

export interface EnvSummary {
  text: string;
  tone: EnvTone;
  /** 悬浮提示：四灯详情。 */
  title: string;
}

const LIGHT_KEYS = ["engine", "paper", "bot", "client"] as const;
const LIGHT_STATES = new Set<string>(["checking", "starting", "ready", "needs_action", "error"]);
const LIGHT_NAMES: Record<(typeof LIGHT_KEYS)[number], string> = {
  engine: "织机",
  paper: "世界",
  bot: "织偶",
  client: "客户端",
};

function parseLight(value: unknown): EnvLight {
  const record = (value ?? {}) as Record<string, unknown>;
  const state = typeof record.state === "string" && LIGHT_STATES.has(record.state)
    ? (record.state as EnvLightState)
    : "checking";
  return {
    state,
    ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
    ...(typeof record.hint === "string" || record.hint === null ? { hint: record.hint as string | null } : {}),
    ...(record.canStart === true ? { canStart: true } : {}),
    ...(record.canRetry === true ? { canRetry: true } : {}),
    ...(typeof record.guide === "string" || record.guide === null ? { guide: record.guide as string | null } : {}),
  };
}

/** 宽容解析壳下发的 EnvState：字段缺失/版本漂移时不崩，按「检查中」兜底。 */
export function parseEnvState(value: unknown): EnvState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!LIGHT_KEYS.every((key) => key in record)) return null;
  return {
    engine: parseLight(record.engine),
    paper: parseLight(record.paper),
    bot: parseLight(record.bot),
    client: parseLight(record.client),
    allReady: record.allReady === true,
    launching: Array.isArray(record.launching) ? record.launching.filter((item): item is string => typeof item === "string") : [],
    clientLost: record.clientLost === true,
    sessionActive: record.sessionActive === true,
    clientAdapter: typeof record.clientAdapter === "string" ? record.clientAdapter : null,
    clientAvailableLauncher: typeof record.clientAvailableLauncher === "string" ? record.clientAvailableLauncher : null,
    mock: record.mock === true,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

/**
 * 订阅桌面壳的 EnvState。
 * - 浏览器直开 / Playwright e2e（无壳）时永远返回 null，沿用本地 engine.mode 显示，不改变开发体验。
 * - 只在被 iframe 嵌入时监听，且只接受来自 `window.parent` 的 `loom:env` 消息。
 */
export function useShellEnv(): EnvState | null {
  const [env, setEnv] = useState<EnvState | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      try {
        if (event.source !== window.parent) return;
      } catch {
        return;
      }
      const data = event.data as { type?: unknown; env?: unknown } | null;
      if (!data || typeof data !== "object" || data.type !== "loom:env") return;
      const parsed = parseEnvState(data.env);
      if (parsed) setEnv(parsed);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return env;
}

function summarizeLights(env: EnvState): string {
  return LIGHT_KEYS.map((key) => {
    const light = env[key];
    const detail = light.detail ? `：${light.detail}` : "";
    return `${LIGHT_NAMES[key]} ${light.state}${detail}`;
  }).join(" · ");
}

/**
 * 把四灯压成一条 Studio 可显示的状态（与壳顶栏同源，不再自己判断「织机在线」）。
 * 有灯不是 ready 时优先报告那盏灯；四灯全绿时才显示「织机在线」/「本地演示」。
 */
export function summarizeEnv(env: EnvState): EnvSummary {
  const title = summarizeLights(env);
  if (env.mock) return { text: "本地演示", tone: "mock", title };
  if (env.clientLost) return { text: "客户端已断开", tone: "error", title };
  const first = LIGHT_KEYS.find((key) => env[key].state !== "ready");
  if (!first) return { text: "织机在线", tone: "online", title };
  const light = env[first];
  const name = LIGHT_NAMES[first];
  if (light.state === "error") return { text: `${name}未连上`, tone: "error", title };
  if (light.state === "needs_action") return { text: `${name}需要处理`, tone: "error", title };
  return { text: `${name}启动中`, tone: "busy", title };
}
