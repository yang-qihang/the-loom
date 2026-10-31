// qa/blind-solver.mjs — L01 盲测骨架（规则 solver，不做 LLM 调用）。
// 输入包 = 玩家可见信息：mainTask 文本 + starterCode 中「坐标面板」注释（右侧面板同步显示的坐标）+
// 示例里的放置高度；不给 referenceSolution、不给隐藏测试、不给 spec 内部断言。
// 运行：npx tsx qa/blind-solver.mjs
import {
  L01,
  L01Content,
  MockWorldPort,
  grade,
  makeChecker,
  nowIso,
  runStudentProgram,
  writeEvidence,
} from "./_lib.mjs";

const checker = makeChecker();

/** 从 starterCode 的可见注释解析坐标面板（模拟玩家照面板抄）。 */
function visibleInputPack(def) {
  const panel = [];
  for (const line of def.code.starterCode.split("\n")) {
    for (const m of line.matchAll(/(\d)\s*号:\s*\((-?\d+),\s*(-?\d+)\)/g)) {
      panel.push({ index: Number(m[1]), x: Number(m[2]), z: Number(m[3]) });
    }
  }
  const yMatch = def.code.starterCode.match(/place\("lantern",\s*-?\d+,\s*(\d+),\s*-?\d+\)/);
  const y = yMatch ? Number(yMatch[1]) : null;
  return {
    mainTask: def.task.mainTask,
    playerBeatHint: def.task.playerBeat,
    coordinatePanel: panel.sort((a, b) => a.index - b.index),
    panelPlaceHeight: y,
    starterCode: def.code.starterCode,
  };
}

/** 规则 solver：按面板坐标生成程序（1–3 号由 golem 点亮，4 号留给玩家，最后回艾拉）。 */
function ruleSolve(pack) {
  const lamps = pack.coordinatePanel;
  if (lamps.length < 4 || pack.panelPlaceHeight == null) throw new Error("玩家可见信息不足，无法生成解");
  const lines = ["// 盲测规则解：只使用面板坐标 + starter 示例中的高度"];
  for (const lamp of lamps.slice(0, 3)) {
    lines.push(`golem.moveTo(${lamp.x}, ${lamp.z})`);
    lines.push(`golem.place("lantern", ${lamp.x}, ${pack.panelPlaceHeight}, ${lamp.z})`);
  }
  const last = lamps[3];
  lines.push(`golem.moveTo(${last.x}, ${last.z})`);
  lines.push(`golem.moveTo(0, 6)`);
  return lines.join("\n");
}

const pack = visibleInputPack(L01);
const timings = [];
let attempts = [];

await checker.check("B1", "盲测输入包只有玩家可见信息（不含 reference/隐藏断言）", () => {
  const blob = JSON.stringify(pack);
  checker.assert(!blob.includes(L01.code.referenceSolution.trim()), "输入包泄漏了 referenceSolution");
  checker.assert(!blob.includes("h-physical-walk"), "输入包泄漏了隐藏测试");
  return { fields: Object.keys(pack), lamps: pack.coordinatePanel.length };
});

await checker.check("B2", "规则 solver 第 1 次尝试通关（MockWorld + 玩家节拍）", async () => {
  const program = ruleSolve(pack);
  const t0 = Date.now();
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, program);
  await L01Content.playerBeat(port);
  const report = grade(L01, await port.snapshot("L01"));
  await port.dispose();
  const ms = Date.now() - t0;
  timings.push(ms);
  attempts.push({ attempt: 1, program, passed: report.passed, stars: report.stars, failures: report.failures, ms });
  checker.assert(report.passed === true, `盲测解未通关: ${JSON.stringify(report.failures)}`);
  checker.assert(ms < 15000, `单次尝试超过 15s（盲测时限）: ${ms}ms`);
  return { ms, stars: report.stars };
});

const summary = checker.summary();
const evidence = {
  ts: nowIso(),
  suite: "blind-solver",
  level: "L01",
  solver: "rule-solver（不吃 LLM；只读玩家可见文本）",
  inputPack: pack,
  attempts,
  hintsUsed: 0,
  totalMs: timings.reduce((a, b) => a + b, 0),
  passRate: attempts.length && attempts[0].passed ? 1 : 0,
  summary,
};
const file = writeEvidence("qa-blind-l01.json", evidence);
console.log(JSON.stringify({ suite: "blind-solver", ...summary, attempts: attempts.length, evidence: file }));
process.exit(summary.failed === 0 ? 0 : 1);
