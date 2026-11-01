import { transformSync as esbuildTransform } from "esbuild";
import { transformStudentCode } from "./transform";
import { assertExplicitAwait } from "./explicit";
import { resolveTarget } from "../../worldport/src/index";
import type { Golem, NamedPoint, PointLike, World } from "../../sdk/src/index";

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

/**
 * 沙箱语义初值（docs/48 §1.2–1.3）：命名点 + 织偶背包 + 容器计数。
 * 由 session 从 `WorldPort.semantic()` 取；worker 内据此建本地同步缓存，
 * 保证 `golem.count(item)` / `world.container(point)` 在沙箱里是同步调用。
 */
export interface RunSdkSemanticState {
  points?: Record<string, NamedPoint>;
  bag?: Record<string, number>;
  containers?: Record<string, Record<string, number>>;
}

export interface RunSdk {
  golem: Golem;
  world: World;
  /** 非沙箱执行（it/l10-real 等）直接用注入函数；沙箱执行时通过 multiAgent 配置重建。 */
  agent?: (name: string) => unknown;
  multiAgent?: SandboxMultiAgentRuntime;
  /** 沙箱语义初值（可选；缺省时 worker 从空背包/空容器开始）。 */
  semantic?: RunSdkSemanticState;
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

/** 合法 JS 标识符（命名点作为函数参数注入时的过滤）。 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * 命名点 → 函数参数（docs/48 §1.1）：`sdk.world.points` 的每个合法键作为 `new Function(...names)`
 * 的同名参数注入，内容测试里的 raw SDK 因此能直接写 `golem.moveTo(eira)` / `place("lantern", lamp1)`。
 * 与 SDK 已有键同名或不是合法标识符的点跳过（仍可用 world.points["…"] 访问）。
 */
export function pointArguments(sdk: RunSdk): { names: string[]; values: unknown[] } {
  const points = (sdk.semantic?.points ?? sdk.world.points ?? {}) as Record<string, unknown>;
  const names: string[] = [];
  const values: unknown[] = [];
  const taken = new Set(Object.keys(sdk));
  for (const [name, value] of Object.entries(points)) {
    if (!IDENTIFIER.test(name) || taken.has(name)) continue;
    taken.add(name);
    names.push(name);
    values.push(value);
  }
  return { names, values };
}

function isPointLike(value: unknown): value is PointLike {
  if (Array.isArray(value)) return value.length === 3 && value.every(entry => typeof entry === "number");
  const object = value as { x?: unknown; z?: unknown } | null;
  return object !== null && typeof object === "object" && typeof object.x === "number" && typeof object.z === "number";
}

/**
 * 非沙箱路径的语义门面：raw 端口 agent（MockWorldPort/PaperWorldPort）的旧签名只吃数字，
 * 这里把命名点形式归一成 (x,z)/(block,x,y,z) 转发；端口本身带 Rich 方法（collect/deposit…）时直接转。
 * 评分语义不变：底层仍是同一个端口方法、同一条 block.place 事件。
 */
function semanticGolem(raw: Golem): Golem {
  const rich = raw as Golem & {
    moveToPoint?(target: PointLike): Promise<void>;
    placePoint?(block: string, target: PointLike): Promise<void>;
    goTo?(target: PointLike): Promise<void>;
    collect?(item: string, target: PointLike): Promise<void>;
    deposit?(item: string, target: PointLike, count?: number): Promise<void>;
    count?(item: string): number;
    harvest?(crop: string, target: PointLike): Promise<void>;
    plant?(crop: string, target: PointLike): Promise<void>;
  };
  const requireRich = (method: "collect" | "deposit" | "harvest" | "plant"): void => {
    if (typeof rich[method] !== "function") {
      throw new Error(`这一关的织偶还不会 ${method}：请用旧的 place/collect 写法，或检查端口实现`);
    }
  };
  const golem = {
    get pos() {
      return raw.pos;
    },
    async moveTo(x: number, z?: number): Promise<void> {
      if (typeof z === "number") {
        await raw.moveTo(x, z);
        return;
      }
      if (!isPointLike(x)) throw new Error(`不认识的坐标：${String(x)}（可以用命名点如 eira，或 (x, z) 两个数字）`);
      if (typeof rich.moveToPoint === "function") {
        await rich.moveToPoint(x);
        return;
      }
      const [px, , pz] = resolveTarget(x, raw.pos[1]);
      await raw.moveTo(px, pz);
    },
    async goTo(target: PointLike): Promise<void> {
      if (typeof rich.goTo === "function") {
        await rich.goTo(target);
        return;
      }
      const [px, , pz] = resolveTarget(target, raw.pos[1]);
      await raw.moveTo(px, pz);
    },
    async place(block: string, x: number, y?: number, z?: number): Promise<void> {
      if (typeof y === "number" && typeof z === "number") {
        await raw.place(block, x, y, z);
        return;
      }
      if (!isPointLike(x)) throw new Error(`place 的第二个参数要用命名点或坐标：收到 ${String(x)}`);
      if (typeof rich.placePoint === "function") {
        await rich.placePoint(block, x);
        return;
      }
      const [px, py, pz] = resolveTarget(x, raw.pos[1]);
      await raw.place(block, px, py, pz);
    },
    // 语义方法透传底层返回值：transform.test 里 stub collect 返回计数，学生 `const n = golem.collect(...)`
    // 必须拿到 1（renderer 的「先写后读」教学语义），不能吞成 undefined。
    async collect(item: string, target: PointLike): Promise<unknown> {
      requireRich("collect");
      return rich.collect!(item, target);
    },
    async deposit(item: string, target: PointLike, count = 1): Promise<unknown> {
      requireRich("deposit");
      return rich.deposit!(item, target, count);
    },
    count(item: string): number {
      return typeof rich.count === "function" ? rich.count(item) : 0;
    },
    async harvest(crop: string, target: PointLike): Promise<unknown> {
      requireRich("harvest");
      return rich.harvest!(crop, target);
    },
    async plant(crop: string, target: PointLike): Promise<unknown> {
      requireRich("plant");
      return rich.plant!(crop, target);
    },
    async say(text: string): Promise<void> {
      await raw.say(text);
    },
  };
  return golem as unknown as Golem;
}

export async function runStudentProgram(
  sdk: RunSdk,
  source: string,
  options: RunProgramOptions | RunModeOption = {},
): Promise<void> {
  const mode = resolveRunModeOption(options);
  if (mode === "explicit") assertExplicitAwait(source);
  const js = compileStudent(source, mode);
  // 把 SDK 的每个键都作为工厂参数注入（L10 会注入 agent；单织偶关卡仍只有 golem/world），
  // 再把本关命名点作为同名参数注入（内容测试的 raw SDK 也能用 eira/barrel/lamp1）。
  const names = Object.keys(sdk).filter(name => name !== "semantic");
  const values = names.map(name => (name === "golem" ? semanticGolem(sdk.golem) : sdk[name]));
  const points = pointArguments(sdk);
  const factory = new Function(...names, ...points.names, `${js}\nreturn __loomMain();`) as (
    ...args: unknown[]
  ) => Promise<void>;
  await factory(...values, ...points.values);
}
