import type { MockWorld } from "../../../../packages/mockworld/src/index";

/** Mock 模式只解释 L01 需要的三条顺序指令；真实执行由 Engine/runner 负责。 */
export interface Statement {
  line: number;
  kind: "moveTo" | "place" | "say";
  args: (string | number)[];
}

export type RunnerErrorKind = "unsupported" | "tooFar" | "failed";

export interface RunnerError {
  line: number;
  kind: RunnerErrorKind;
}

export type WorldLogEntry =
  | { kind: "move"; x: number; z: number }
  | { kind: "placeAgent"; lamp: number | null; block: string; x: number; z: number }
  | { kind: "placePlayer"; lamp: number | null }
  | { kind: "say"; text: string };

export interface ExecuteHooks {
  onLog: (entry: WorldLogEntry) => void;
  isCancelled: () => boolean;
  stepDelayMs?: number;
}

type ParseResult = { statements: Statement[] } | { error: RunnerError };

const MOVE_RE = /^golem\s*\.\s*moveTo\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*;?$/;
const PLACE_RE =
  /^golem\s*\.\s*place\s*\(\s*["']([a-zA-Z0-9_:]+)["']\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*;?$/;
const SAY_RE = /^golem\s*\.\s*say\s*\(\s*["']([^"']*)["']\s*\)\s*;?$/;

const stripComment = (line: string): string => {
  let inQuote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
};

/**
 * 去掉块注释（可跨行），保留行号：
 * 内容层 starter/参考解都以 JSDoc 块注释开头（见 content/levels/L01.content.ts），
 * 本地演示解释器原来只处理行注释，会把块注释起始符当成一句代码 → 参考解必报「第 1 行没写完」。
 */
export function stripBlockComments(source: string): string {
  let inBlock = false;
  return source
    .split(/\r?\n/)
    .map((line) => {
      let out = "";
      let i = 0;
      while (i < line.length) {
        if (inBlock) {
          const end = line.indexOf("*/", i);
          if (end < 0) return out;
          inBlock = false;
          i = end + 2;
        } else {
          const start = line.indexOf("/*", i);
          if (start < 0) {
            out += line.slice(i);
            break;
          }
          out += line.slice(i, start);
          inBlock = true;
          i = start + 2;
        }
      }
      return out;
    })
    .join("\n");
}

export function parseL01(source: string): ParseResult {
  const statements: Statement[] = [];
  const lines = stripBlockComments(source).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const raw = stripComment(lines[index]).trim();
    if (!raw || raw === ";" || raw === "{}") continue;

    const move = raw.match(MOVE_RE);
    if (move) {
      statements.push({ line: lineNo, kind: "moveTo", args: [Number(move[1]), Number(move[2])] });
      continue;
    }
    const place = raw.match(PLACE_RE);
    if (place) {
      statements.push({
        line: lineNo,
        kind: "place",
        args: [place[1].replace(/^minecraft:/, ""), Number(place[2]), Number(place[3]), Number(place[4])],
      });
      continue;
    }
    const say = raw.match(SAY_RE);
    if (say) {
      statements.push({ line: lineNo, kind: "say", args: [say[1]] });
      continue;
    }
    return { error: { line: lineNo, kind: "unsupported" } };
  }
  return { statements };
}

const samePos = (a: number[] | undefined, b: number[]): boolean =>
  !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeL01(
  world: MockWorld,
  statements: Statement[],
  hooks: ExecuteHooks,
): Promise<RunnerError | null> {
  const lamps = (world.vars.lamps as number[][]) ?? [];
  const delay = hooks.stepDelayMs ?? 140;
  let seen = world.events.length;

  for (const statement of statements) {
    if (hooks.isCancelled()) return null;
    await sleep(delay);
    if (hooks.isCancelled()) return null;

    try {
      if (statement.kind === "moveTo") {
        await world.golem.moveTo(Number(statement.args[0]), Number(statement.args[1]));
      } else if (statement.kind === "place") {
        await world.golem.place(
          String(statement.args[0]),
          Number(statement.args[1]),
          Number(statement.args[2]),
          Number(statement.args[3]),
        );
      } else {
        await world.golem.say(String(statement.args[0]));
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      return { line: statement.line, kind: raw.includes("离目标太远") ? "tooFar" : "failed" };
    }

    for (const event of world.events.slice(seen)) {
      if (event.type === "agent.move" && event.pos) {
        hooks.onLog({ kind: "move", x: event.pos[0], z: event.pos[2] });
      } else if (event.type === "block.place" && event.pos) {
        const lampIndex = lamps.findIndex((lamp) => samePos(event.pos, lamp));
        if (event.actorType === "player") {
          hooks.onLog({ kind: "placePlayer", lamp: lampIndex >= 0 ? lampIndex + 1 : null });
        } else {
          hooks.onLog({
            kind: "placeAgent",
            lamp: lampIndex >= 0 ? lampIndex + 1 : null,
            block: String(event.data?.block ?? "block").replace(/^minecraft:/, ""),
            x: event.pos[0],
            z: event.pos[2],
          });
        }
      } else if (event.type === "say" && event.data?.text) {
        hooks.onLog({ kind: "say", text: String(event.data.text) });
      }
    }
    seen = world.events.length;
  }
  return null;
}
