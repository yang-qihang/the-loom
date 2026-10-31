import { transformSync as esbuildTransform } from "esbuild";
import { transformStudentCode } from "./transform";
import { assertExplicitAwait } from "./explicit";
import type { Golem, World } from "../../sdk/src/index";

/**
 * 学生代码运行时的 SDK 形状。
 * 单织偶关卡只有 golem + world；L10 双织者额外注入 agent(name)（并允许 golem/world 上挂扩展动词）。
 */
export interface SandboxAgentActionsLike {
  readonly pos: [number, number, number];
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
}

/** 沙箱内双 agent SDK 的宿主侧动作表（L10：左织/右织各自绑定一个真实/模拟 agent）。 */
export interface SandboxMultiAgentRuntime {
  agents: Record<string, SandboxAgentActionsLike>;
  materialsTotal: number;
}

export interface RunSdk {
  golem: Golem;
  world: World;
  /** 非沙箱执行（it/l10-real 等）直接用注入函数；沙箱执行时通过 multiAgent 配置重建。 */
  agent?: (name: string) => unknown;
  multiAgent?: SandboxMultiAgentRuntime;
  [key: string]: unknown;
}

export function compileStudent(source: string, mode: "auto-await" | "explicit" = "auto-await"): string {
  const wrapped = transformStudentCode(source, mode);
  const out = esbuildTransform(wrapped, { loader: "ts", target: "es2022", format: "cjs" });
  return out.code;
}

export type RunModeOption = "auto-await" | "explicit";

export interface RunProgramOptions {
  mode?: RunModeOption;
  /** false = Act III 显式 await（不自动插 await，漏 await 抛 MissingAwaitError）；等价于 mode:"explicit"。 */
  autoAwait?: boolean;
}

export function resolveRunModeOption(options: RunProgramOptions | RunModeOption | undefined): RunModeOption {
  if (!options) return "auto-await";
  if (typeof options === "string") return options;
  if (options.autoAwait === false) return "explicit";
  return options.mode ?? "auto-await";
}

export async function runStudentProgram(
  sdk: RunSdk,
  source: string,
  options: RunProgramOptions | RunModeOption = {},
): Promise<void> {
  const mode = resolveRunModeOption(options);
  if (mode === "explicit") assertExplicitAwait(source);
  const js = compileStudent(source, mode);
  // 把 SDK 的每个键都作为工厂参数注入（L10 会注入 agent；单织偶关卡仍只有 golem/world）。
  const names = Object.keys(sdk);
  const values = names.map(name => sdk[name]);
  const factory = new Function(...names, `${js}\nreturn __loomMain();`) as (...args: unknown[]) => Promise<void>;
  await factory(...values);
}
