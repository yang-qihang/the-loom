import * as ts from "typescript";
import { transformSync as esbuildTransform } from "esbuild";
import { isAsyncSdkCall, transformStudentCode } from "./transform";
import { executeSandboxCode, RunTimeoutError, StudentCodeError, type SandboxRunOptions } from "./sandbox";
import type { RunSdk } from "./run";

/**
 * 试符台（REPL）单行执行器（docs/27 §2）：
 * - 单行表达式：求值并回传 JSON 安全值（如 golem.pos）；
 * - 单行语句 / 裸异步 SDK 调用：自动 await 执行（与关卡同一顺序门面）；
 * - 表达式/语句判定用 TypeScript AST（复用 transform 的 async SDK 判定）；
 * - 沙箱与关卡同一套 worker+vm、超时、只注入 golem/world/console；
 * - 错误翻译成中文人话（不暴露堆栈/RPC）。
 */

export type ReplKind = "value" | "action" | "error";

export interface ReplResult {
  ok: boolean;
  kind: ReplKind;
  /** UI 显示的一行结果（中文；值显示为 JSON 紧凑形式）。 */
  display: string;
  /** 本次执行产生的日志行（console + SDK 调用）。 */
  log: string[];
  /** 错误时的中文说明（与 display 相同，便于 UI 结构化使用）。 */
  error?: string;
  /** 出错行号（单行恒为 1，保留字段对齐 runner 约定）。 */
  line?: number;
}

export interface ReplOptions extends SandboxRunOptions {
  mode?: "auto-await" | "explicit";
  /** 真实走路可能超过 3 秒；仅单条 SDK 动作使用此上限，循环/普通表达式仍保持短超时。 */
  actionTimeoutMs?: number;
}

interface SyntaxErrorLike {
  message?: string;
  errors?: Array<{ text?: string; location?: { line?: number } }>;
}

function firstSyntaxMessage(error: unknown): string {
  const detail = error as SyntaxErrorLike;
  return detail.errors?.[0]?.text ?? detail.message ?? "这一句的语法不对";
}

/** 长等待仅用于参数无需执行用户函数的单条动作，避免把参数里的死循环也放宽到 60 秒。 */
function simpleActionArgument(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isParenthesizedExpression(node)) return simpleActionArgument(node.expression);
  if (ts.isPrefixUnaryExpression(node)) return simpleActionArgument(node.operand);
  if (ts.isPropertyAccessExpression(node)) return simpleActionArgument(node.expression);
  if (ts.isElementAccessExpression(node)) return simpleActionArgument(node.expression) && simpleActionArgument(node.argumentExpression);
  if (ts.isBinaryExpression(node)) return simpleActionArgument(node.left) && simpleActionArgument(node.right);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(element => ts.isExpression(element) && simpleActionArgument(element));
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(property =>
    ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && simpleActionArgument(property.initializer));
  return false;
}

/** 判断一行是「表达式求值」还是「语句/动作执行」；多行、多条语句直接拒绝。 */
export function classifyReplLine(line: string): { expression: boolean; sdkAction?: boolean } | { error: string } {
  const sourceFile = ts.createSourceFile("repl.ts", line, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const statements = [...sourceFile.statements];
  if (statements.length === 0) return { error: "写一句再试，比如 golem.pos" };
  if (statements.length > 1) return { error: "一次试一句：只写一条语句或一个表达式。" };
  const statement = statements[0];
  if (!ts.isExpressionStatement(statement)) {
    // 单条语句（例如 while 循环、变量声明）按动作执行 → 由沙箱超时拦截死循环。
    return { expression: false };
  }
  // 裸的异步 SDK 调用（含 await 形式）是「动作」（自动 await），其余表达式求值并返回值。
  const isSdkCall = (node: ts.Expression): boolean => {
    let current: ts.Expression = node;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    if (ts.isAwaitExpression(current)) current = current.expression;
    return ts.isCallExpression(current) && isAsyncSdkCall(current);
  };
  const sdkAction = isSdkCall(statement.expression);
  let call = statement.expression;
  while (ts.isParenthesizedExpression(call) || ts.isAwaitExpression(call)) call = call.expression;
  const longAction = sdkAction && ts.isCallExpression(call) && call.arguments.every(simpleActionArgument);
  return { expression: !sdkAction, sdkAction: longAction };
}

function compileReplExpression(line: string): string {
  const source = `async function __loomReplExpr() {\nreturn (\n${line}\n);\n}`;
  try {
    return esbuildTransform(source, { loader: "ts", target: "es2022", format: "cjs" }).code;
  } catch (error) {
    throw new StudentCodeError(`[SyntaxError] ${firstSyntaxMessage(error)}`, 1);
  }
}

function compileReplStatement(line: string, mode: "auto-await" | "explicit"): string {
  try {
    return esbuildTransform(transformStudentCode(line, mode), { loader: "ts", target: "es2022", format: "cjs" }).code;
  } catch (error) {
    throw new StudentCodeError(`[SyntaxError] ${firstSyntaxMessage(error)}`, 1);
  }
}

/** 值 → 一行可读文本；字符串带引号，数组/对象紧凑 JSON。 */
export function formatReplValue(value: unknown): string {
  if (value === null || value === undefined) return "空值";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 把沙箱/世界错误翻译成中文人话（docs/27：不出现英文堆栈/RPC/JSON）。 */
export function translateReplError(raw: string): string {
  const message = raw.trim();
  const stripped = message
    .replace(/^\[[A-Za-z]+\]\s*/, "")
    .replace(/（第 \d+ 行）$/, "")
    .trim();
  // 世界/校验层抛出的错误已经是中文，原样展示。
  if (/[\u4e00-\u9fa5]/.test(stripped)) return stripped;
  if (/RUN_CANCELLED/.test(stripped)) return "这一句被停止了。";
  const notDefined = /^(\w+) is not defined/.exec(stripped);
  if (notDefined) return `找不到「${notDefined[1]}」：检查拼写，它可能还没解锁。`;
  const notFunction = /^(.*?) is not a function/.exec(stripped);
  if (notFunction) return `「${notFunction[1]}」不能这样调用；试试 golem.say / golem.moveTo / golem.place。`;
  if (/Cannot find name/.test(stripped)) return "不认识这个名字：检查拼写，它可能还没解锁。";
  if (/Cannot read propert/.test(stripped)) return "读到了空值：先检查前面的步骤，或换个表达式。";
  if (/Unexpected|Expected|Unexpected token/.test(stripped)) return "这一句的语法不对，检查括号和引号。";
  return `这一句没跑通：${stripped}`;
}

/**
 * 执行试符台的一行。
 *
 * @param sdk   与关卡相同的 SDK 代理（session 注入 capability 校验与日志）
 * @param line  玩家输入的一行
 * @param mode  自动 await / 显式 await（默认 auto-await）
 */
export async function runReplLine(sdk: RunSdk, line: string, options: ReplOptions = {}): Promise<ReplResult> {
  const log: string[] = [];
  const recordLog = (text: string): void => {
    log.push(text);
    options.onLog?.(text);
  };
  const text = typeof line === "string" ? line.trim() : "";
  if (!text) {
    return { ok: false, kind: "error", display: "写一句再试，比如 golem.pos", log, error: "写一句再试，比如 golem.pos" };
  }
  if (text.includes("\n")) {
    const display = "一次试一句：只写一行。";
    return { ok: false, kind: "error", display, log, error: display };
  }
  const classification = classifyReplLine(text);
  if ("error" in classification) {
    return { ok: false, kind: "error", display: classification.error, log, error: classification.error };
  }
  const timeoutMs = (classification.sdkAction ? options.actionTimeoutMs : undefined) ?? options.timeoutMs ?? 3000;

  try {
    if (classification.expression) {
      const code = compileReplExpression(text);
      const value = await executeSandboxCode(sdk, code, {
        entry: "__loomReplExpr",
        captureValue: true,
        timeoutMs,
        signal: options.signal,
        studentLineCount: 1,
        onLog: recordLog,
      });
      return { ok: true, kind: "value", display: formatReplValue(value), log };
    }
    const code = compileReplStatement(text, options.mode ?? "auto-await");
    await executeSandboxCode(sdk, code, {
      entry: "__loomMain",
      captureValue: false,
      timeoutMs,
      signal: options.signal,
      studentLineCount: 1,
      onLog: recordLog,
    });
    return { ok: true, kind: "action", display: "灰崽照做了", log };
  } catch (error) {
    if (error instanceof RunTimeoutError) {
      const seconds = Math.round((timeoutMs / 1000) * 10) / 10;
      const display = `这一句跑太久（超过 ${seconds} 秒），已停下。`;
      return { ok: false, kind: "error", display, log, error: display };
    }
    if (error instanceof StudentCodeError) {
      const display = translateReplError(error.message);
      return { ok: false, kind: "error", display, log, error: display, line: error.line };
    }
    const display = translateReplError(error instanceof Error ? error.message : String(error));
    return { ok: false, kind: "error", display, log, error: display };
  }
}
