// code-gate 自测：分析器在典型学生程序上的统计是否符合预期 + 各关参考解抽象使用审计。
import { L01Content } from "../content/levels/L01.content";
import { L02Content } from "../content/levels/L02.content";
import { L03Content } from "../content/levels/L03.content";
import { L04Content } from "../content/levels/L04.content";
import { L05Content } from "../content/levels/L05.content";
import { L06Content } from "../content/levels/L06.content";
import { L07Content } from "../content/levels/L07.content";
import { L08Content } from "../content/levels/L08.content";
import { L09Content } from "../content/levels/L09.content";
import { L10Content } from "../content/levels/L10.content";
import { analyzeStudentCode, codeShape, evaluateCodeRequirements } from "../packages/runner/src/analysis";
import fs from "node:fs";

const cases = [
  { name: "empty", source: "" },
  { name: "plain calls", source: "golem.moveTo(-12, 10)\ngolem.place(\"lantern\", -12, 14, 10)\n" },
  { name: "variables", source: "let banked = 0\nconst barrel = { x: 0, z: -6 }\nbanked += 1\ngolem.say(`桶里有 ${banked} 枚`)\n" },
  { name: "branch", source: "if (world.vars.threat > 0) { golem.moveTo(0, 0) } else { golem.say(\"安全\") }\n" },
  { name: "loop", source: "for (const cell of cells) { golem.moveTo(cell.x, cell.z) }\nwhile (golem.count(\"egg\") < 4) { golem.collect(\"egg\", perch) }\n" },
  { name: "function", source: "function pack(list) { return list.map(x => x * 2) }\npack([1, 2])\n" },
  { name: "async", source: "async function run() { await golem.moveTo(0, 0); await golem.say(\"ok\") }\nrun()\n" },
  { name: "promise all", source: "await Promise.all([golem.moveTo(0, 0), golem.say(\"hi\")])\n" },
  { name: "syntax error", source: "golem.moveTo(\n" },
];
for (const c of cases) {
  const r = analyzeStudentCode(c.source);
  console.log(c.name.padEnd(14), "ok=", r.ok, "shape=", JSON.stringify({ let: r.shape.let, const: r.shape.const, if: r.shape.if, for: r.shape.for, while: r.shape.while, function: r.shape.function, arrow: r.shape.arrow, await: r.shape.await, promise: r.shape.promiseCombinator, array: r.shape.arrayMethod, object: r.shape.objectLiteral, template: r.shape.template }));
}

const levels = [
  ["L01", L01Content], ["L02", L02Content], ["L03", L03Content], ["L04", L04Content],
  ["L05", L05Content], ["L06", L06Content], ["L07", L07Content], ["L08", L08Content], ["L09", L09Content], ["L10", L10Content],
] as const;
const audit: Array<Record<string, unknown>> = [];
const sampleRequirements = [
  { id: "vars", text: "用变量", kind: "variables" as const, min: 2 },
  { id: "loop", text: "用循环", kind: "loop" as const, min: 1 },
];
for (const [id, content] of levels) {
  const shape = codeShape(content.def.code.referenceSolution);
  audit.push({ level: id, abstractions: content.def.meta.abstractions, shape, sampleRequirements: evaluateCodeRequirements(sampleRequirements, content.def.code.referenceSolution) });
  console.log(id, "abstractions", content.def.meta.abstractions.join(","), "shape", JSON.stringify({ let: shape.let, const: shape.const, if: shape.if, for: shape.for, while: shape.while, function: shape.function, arrow: shape.arrow, await: shape.await, promise: shape.promiseCombinator, array: shape.arrayMethod, object: shape.objectLiteral }));
}
fs.mkdirSync("evidence", { recursive: true });
fs.writeFileSync("evidence/code-analysis.json", JSON.stringify({ generatedAt: new Date().toISOString(), cases: cases.map(c => ({ name: c.name, analysis: analyzeStudentCode(c.source) })), audit }, null, 2) + "\n");
console.log("evidence/code-analysis.json written");
