import * as ts from "typescript";
import { ASYNC_SDK_METHODS, ASYNC_SDK_RECEIVERS } from "../../sdk/src/index";

/** 判断一个 CallExpression 是否是「返回 Promise 的学生 SDK 调用」。 */
export function isAsyncSdkCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.expression;
  if (!ts.isIdentifier(receiver)) return false;
  return ASYNC_SDK_METHODS.has(callee.name.text) && ASYNC_SDK_RECEIVERS.has(receiver.text);
}

/**
 * 顺序门面：把学生代码里的异步 SDK 调用自动变成 await。
 * Act I–II 使用 "auto-await"；L9 使用 "explicit"（学生自己写 await）。
 * 结果包成 async function __loomMain()，由 runStudentProgram 调用。
 */
export function transformStudentCode(source: string, mode: "auto-await" | "explicit" = "auto-await"): string {
  if (mode === "explicit") return `async function __loomMain() {\n${source}\n}`;

  const sourceFile = ts.createSourceFile("student.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const result = ts.transform(sourceFile, [
    context => {
      const visit: ts.Visitor = node => {
        if (ts.isCallExpression(node) && isAsyncSdkCall(node)) {
          const inner = ts.visitEachChild(node, visit, context) as ts.CallExpression;
          return context.factory.createAwaitExpression(inner);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return root => ts.visitNode(root, visit) as ts.SourceFile;
    },
  ]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printed = printer.printFile(result.transformed[0] as ts.SourceFile);
  result.dispose();
  return `async function __loomMain() {\n${printed}\n}`;
}
