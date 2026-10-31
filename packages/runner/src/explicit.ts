import * as ts from "typescript";
import { isAsyncSdkCall } from "./transform";

/**
 * Act III「显式 await」运行模式（D36 / docs/07 §3.4 / docs/12 §1.1）：
 * - 保留 TypeScript 类型剥离，但**不自动插 await**（学生必须自己写）；
 * - 显式 await / 存变量后 await / Promise.all / Promise.race 都合法；
 * - 漏 await 的异步 SDK 调用在运行前被静态检查拦下（2588 中文提示，带行号）；
 * - 顶层 await 允许（学生代码包在 async function 里执行）。
 */

export class MissingAwaitError extends Error {
  readonly code = "MISSING_AWAIT";
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "MissingAwaitError";
  }
}

export interface UnawaitedSdkCall {
  /** 从 1 开始的行号。 */
  line: number;
  /** 调用文本（截断到 80 字符，用于提示）。 */
  text: string;
  /** 若调用赋给了变量，附变量名（提示里能说清是哪一句）。 */
  variable?: string;
}

const PROMISE_COMBINATORS = new Set(["all", "allSettled", "race", "any"]);
const MAX_SNIPPET = 80;
const HINT = "这里是异步操作，前面要加 `await`，不然你会带着 `Promise` 往下跑";

/** 去掉括号 / as / 非空断言 / satisfies 等包装，找到真正的表达式。 */
function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** 收集 await 子树里的所有标识符（用于识别「先存变量、后面 await」的写法）。 */
function collectIdentifiers(node: ts.Node, out: Set<string>): void {
  if (ts.isIdentifier(node)) {
    out.add(node.text);
    return;
  }
  ts.forEachChild(node, child => collectIdentifiers(child, out));
}

function isDirectlyAwaited(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isAwaitExpression(parent)) return true;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
}

/** 返回 Promise（return / 表达式体箭头函数）视为把等待责任交给调用方。 */
function isReturned(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isReturnStatement(parent)) return true;
    if (ts.isArrowFunction(parent)) return parent.body === current;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
}

function isPromiseCombinatorArgument(call: ts.CallExpression): boolean {
  const parent = call.parent;
  if (!parent || !ts.isArrayLiteralExpression(parent)) return false;
  const grand = parent.parent;
  return (
    !!grand &&
    ts.isCallExpression(grand) &&
    ts.isPropertyAccessExpression(grand.expression) &&
    ts.isIdentifier(grand.expression.expression) &&
    grand.expression.expression.text === "Promise" &&
    PROMISE_COMBINATORS.has(grand.expression.name.text)
  );
}

/** 扫描学生代码：找出没被 await / 没交给 Promise.all 的异步 SDK 调用。 */
export function findUnawaitedSdkCalls(source: string): UnawaitedSdkCall[] {
  const sourceFile = ts.createSourceFile("explicit.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const awaitedIdentifiers = new Set<string>();
  const sdkCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) collectIdentifiers(node.expression, awaitedIdentifiers);
    if (ts.isCallExpression(node) && isAsyncSdkCall(node)) sdkCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const missing: UnawaitedSdkCall[] = [];
  for (const call of sdkCalls) {
    if (isDirectlyAwaited(call) || isReturned(call) || isPromiseCombinatorArgument(call)) continue;
    let variable: string | undefined;
    const parent = call.parent;
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer && unwrap(parent.initializer) === call) {
      variable = ts.isIdentifier(parent.name) ? parent.name.text : undefined;
      // 先存变量、稍后 await 是 Act III 的合法写法。
      if (variable && awaitedIdentifiers.has(variable)) continue;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1;
    const text = call.getText(sourceFile).replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET);
    missing.push({ line, text, variable });
  }
  return missing.sort((a, b) => a.line - b.line);
}

/**
 * 显式模式运行前检查：有漏 await 的异步调用就抛 MissingAwaitError（2588 中文提示）。
 * 行号取第一个漏 await 的调用行；session 会把它转成 error 事件的 line。
 */
export function assertExplicitAwait(source: string): void {
  const missing = findUnawaitedSdkCalls(source);
  if (missing.length === 0) return;
  const first = missing[0];
  const where = first.variable ? `（这句存进了 ${first.variable}，但一直没 await）` : "";
  throw new MissingAwaitError(
    `第 ${first.line} 行还没等它做完：${first.text} ${HINT}。${where}`,
    first.line,
  );
}
