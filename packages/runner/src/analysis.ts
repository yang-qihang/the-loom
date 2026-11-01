/**
 * 学生源码结构分析（docs/48 §1.9「名副其实」）。
 *
 * 用途：关卡通过 `LevelDef.codeRequirements` 声明「本关必须真的用到的编程抽象」
 * （变量、分支、循环、函数、记录、高阶函数、异步并发…），会话在 verify 时对**学生源码**
 * 做 AST 统计并逐条判定。判定不参与世界评分真值，只是额外的可见要求：不满足则本关不通过，
 * 并给出中文的下一条提示。
 *
 * 为什么不用纯正则：正则容易被注释/字符串误伤，也数不清嵌套结构；这里用 TypeScript
 * 编译器 API 解析（仓库已有 typescript 依赖，真实引擎打包时 external 并在 runtime 内带 typescript）。
 */
import ts from "typescript";
import type { CodeRequirement } from "../../level-spec/src/index";

export interface CodeShape {
  /** let 声明次数。 */
  let: number;
  /** const 声明次数。 */
  const: number;
  /** if 语句（含 else if）。 */
  if: number;
  /** 三元表达式（?:）。 */
  ternary: number;
  /** for / for-of / for-in 循环。 */
  for: number;
  /** while / do-while 循环。 */
  while: number;
  /** 函数声明。 */
  function: number;
  /** 箭头函数。 */
  arrow: number;
  /** async 函数（声明/箭头/方法）。 */
  async: number;
  /** await 表达式。 */
  await: number;
  /** Promise.all / Promise.allSettled / Promise.race / Promise.any。 */
  promiseCombinator: number;
  /** 数组方法调用（map/filter/reduce/forEach/find/some/every/sort）。 */
  arrayMethod: number;
  /** 对象字面量。 */
  objectLiteral: number;
  /** 模板字符串。 */
  template: number;
  /** 全部调用表达式。 */
  call: number;
  /** 用到的变量名（去重）。 */
  identifiers: string[];
}

export interface CodeAnalysisResult {
  ok: boolean;
  shape: CodeShape;
  /** 解析失败时的中文原因（语法错误时由会话另外处理，这里只做结构分析）。 */
  error?: string;
}

const ARRAY_METHODS = new Set(["map", "filter", "reduce", "forEach", "find", "some", "every", "sort", "flatMap"]);
const IDENTIFIER_SKIP = new Set([
  "console", "Math", "JSON", "Number", "String", "Boolean", "Array", "Object", "Promise", "Date",
  "golem", "world", "await", "async", "function", "return", "let", "const", "var",
]);

function emptyShape(): CodeShape {
  return {
    let: 0, const: 0, if: 0, ternary: 0, for: 0, while: 0, function: 0, arrow: 0,
    async: 0, await: 0, promiseCombinator: 0, arrayMethod: 0, objectLiteral: 0,
    template: 0, call: 0, identifiers: [],
  };
}

/** 分析学生源码结构。语法错误返回 ok:false（不抛异常）。 */
export function analyzeStudentCode(source: string): CodeAnalysisResult {
  const shape = emptyShape();
  const identifiers = new Set<string>();
  const text = String(source ?? "");
  if (!text.trim()) return { ok: true, shape, error: "源码为空" };
  let file: ts.SourceFile;
  try {
    file = ts.createSourceFile("student.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  } catch (error) {
    return { ok: false, shape, error: error instanceof Error ? error.message : String(error) };
  }
  const syntaxErrors = (file as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (syntaxErrors.length > 0) {
    const first = syntaxErrors[0];
    const message = ts.flattenDiagnosticMessageText(first.messageText, "\n");
    return { ok: false, shape, error: message };
  }

  const isAsync = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword);

  const visit = (node: ts.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.VariableDeclarationList: {
        const flags = (node as ts.VariableDeclarationList).flags;
        if (flags & ts.NodeFlags.Let) shape.let += 1;
        if (flags & ts.NodeFlags.Const) shape.const += 1;
        break;
      }
      case ts.SyntaxKind.IfStatement:
        shape.if += 1;
        break;
      case ts.SyntaxKind.ConditionalExpression:
        shape.ternary += 1;
        break;
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.ForInStatement:
        shape.for += 1;
        break;
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
        shape.while += 1;
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        shape.function += 1;
        if (isAsync(node)) shape.async += 1;
        break;
      case ts.SyntaxKind.ArrowFunction:
        shape.arrow += 1;
        if (isAsync(node)) shape.async += 1;
        break;
      case ts.SyntaxKind.AwaitExpression:
        shape.await += 1;
        break;
      case ts.SyntaxKind.ObjectLiteralExpression:
        shape.objectLiteral += 1;
        break;
      case ts.SyntaxKind.TemplateExpression:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        shape.template += 1;
        break;
      case ts.SyntaxKind.CallExpression: {
        shape.call += 1;
        const expression = (node as ts.CallExpression).expression;
        if (ts.isPropertyAccessExpression(expression)) {
          const name = expression.name.text;
          if (ARRAY_METHODS.has(name)) shape.arrayMethod += 1;
          if (name === "all" || name === "allSettled" || name === "race" || name === "any") {
            const receiver = expression.expression.getText();
            if (receiver === "Promise") shape.promiseCombinator += 1;
          }
        }
        break;
      }
      case ts.SyntaxKind.Identifier: {
        const name = (node as ts.Identifier).text;
        if (name.length > 1 && !IDENTIFIER_SKIP.has(name)) identifiers.add(name);
        break;
      }
      default:
        break;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  shape.identifiers = [...identifiers].sort();
  return { ok: true, shape };
}

/** 便捷：只要结构统计。语法错误时返回空结构。 */
export function codeShape(source: string): CodeShape {
  return analyzeStudentCode(source).shape;
}

// ---------------------------------------------------------------- 声明式要求与判定

/** 把「要求 + 源码」判定成结果（会话/Studio 用）。 */
export interface CodeRequirementResult {
  id: string;
  text: string;
  passed: boolean;
}

const countByKind = (shape: CodeShape, kind: CodeRequirement["kind"]): number => {
  switch (kind) {
    case "calls": return shape.call;
    case "variables": return shape.let + shape.const;
    case "mutable-variable": return shape.let;
    case "branch": return shape.if + shape.ternary;
    case "loop": return shape.for + shape.while;
    case "function": return shape.function + shape.arrow;
    case "object": return shape.objectLiteral;
    case "higher-order": return shape.arrayMethod;
    case "async": return shape.await;
    case "promise-combinator": return shape.promiseCombinator;
    case "template": return shape.template;
    default: return 0;
  }
};

/** 评估一关的 codeRequirements（test 自定义优先；AST 解析失败按不满足处理）。 */
export function evaluateCodeRequirements(
  requirements: ReadonlyArray<CodeRequirement> | undefined,
  source: string,
): CodeRequirementResult[] {
  if (!requirements || requirements.length === 0) return [];
  const analysis = analyzeStudentCode(source);
  return requirements.map(requirement => {
    let passed = false;
    try {
      if (requirement.test) {
        passed = requirement.test(source) === true;
      } else if (analysis.ok) {
        const min = requirement.min ?? defaultMin(requirement.kind);
        passed = countByKind(analysis.shape, requirement.kind) >= min;
      }
    } catch {
      passed = false;
    }
    return { id: requirement.id, text: requirement.text, passed };
  });
}

function defaultMin(kind: CodeRequirement["kind"]): number {
  switch (kind) {
    case "variables": return 2;
    case "mutable-variable": return 1;
    case "calls": return 4;
    case "function": return 1;
    default: return 1;
  }
}

// ---------------------------------------------------------------- content 可复用的声明式构造器（无 typescript 依赖，浏览器安全）

export function requireVariables(id: string, text: string, min = 2): CodeRequirement {
  return { id, text, kind: "variables", min };
}

export function requireMutableVariable(id: string, text: string): CodeRequirement {
  return { id, text, kind: "mutable-variable", min: 1 };
}

export function requireCalls(id: string, text: string, min = 4): CodeRequirement {
  return { id, text, kind: "calls", min };
}

export function requireBranch(id: string, text: string): CodeRequirement {
  return { id, text, kind: "branch", min: 1 };
}

export function requireLoop(id: string, text: string): CodeRequirement {
  return { id, text, kind: "loop", min: 1 };
}

export function requireFunction(id: string, text: string, min = 1): CodeRequirement {
  return { id, text, kind: "function", min };
}

export function requireObjectLiteral(id: string, text: string): CodeRequirement {
  return { id, text, kind: "object", min: 1 };
}

export function requireHigherOrder(id: string, text: string): CodeRequirement {
  return { id, text, kind: "higher-order", min: 1 };
}

export function requireAsync(id: string, text: string): CodeRequirement {
  return { id, text, kind: "async", min: 2 };
}

export function requirePromiseCombinator(id: string, text: string): CodeRequirement {
  return { id, text, kind: "promise-combinator", min: 1 };
}

export function requireTemplate(id: string, text: string): CodeRequirement {
  return { id, text, kind: "template", min: 1 };
}
