// qa/content-check.mjs — L1 关卡内容验收（MockWorld，无 MC）。
// 验收点（docs/21 §8）：reference 3 星；starter 必失败；缺玩家节拍必失败；validateLevel 通过。
// 运行：npx tsx qa/content-check.mjs
import {
  L01,
  L01Content,
  MockWorldPort,
  grade,
  nowIso,
  runStudentProgram,
  validateLevel,
  writeEvidence,
  makeChecker,
} from "./_lib.mjs";

const checker = makeChecker();
const results = {};

await checker.check("C1", "L01 validateLevel 无 issue", () => {
  const issues = validateLevel(L01);
  checker.assert(issues.length === 0, `issues: ${issues.join("; ")}`);
  return { issues };
});

await checker.check("C2", "reference + playerBeat = 3 星 / passed / failures 空", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
  await L01Content.playerBeat(port);
  const snap = await port.snapshot("L01");
  const report = grade(L01, snap);
  results.reference = { passed: report.passed, stars: report.stars, failures: report.failures };
  await port.dispose();
  checker.assert(report.passed === true, "reference 未通过");
  checker.assert(report.stars === 3, `stars=${report.stars}`);
  checker.assert(report.failures.length === 0, `failures=${JSON.stringify(report.failures)}`);
  return results.reference;
});

await checker.check("C3", "starter 未修改必然失败", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.starterCode);
  await L01Content.playerBeat(port);
  const report = grade(L01, await port.snapshot("L01"));
  results.starter = { passed: report.passed, stars: report.stars, failures: report.failures };
  await port.dispose();
  checker.assert(report.passed === false, "starter 竟然通过了");
  return results.starter;
});

await checker.check("C4", "缺玩家节拍必失败（player-lit-fourth）", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
  const report = grade(L01, await port.snapshot("L01"));
  results.noPlayerBeat = { passed: report.passed, failures: report.failures };
  await port.dispose();
  checker.assert(report.passed === false, "缺玩家节拍仍然通过");
  checker.assert(
    report.criteria.some(c => c.id === "player-lit-fourth" && !c.passed),
    "没有定位到 player-lit-fourth 失败",
  );
  return results.noPlayerBeat;
});

await checker.check("C5", "Mock 场景确定性（两次 reference 结果一致）", async () => {
  const run = async () => {
    const port = new MockWorldPort();
    await port.prepare(L01Content);
    await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
    await L01Content.playerBeat(port);
    const snap = await port.snapshot("L01");
    const report = grade(L01, snap);
    await port.dispose();
    return { stars: report.stars, passed: report.passed, blockCount: Object.keys(snap.blocks).length, eventCount: snap.events.length };
  };
  const a = await run();
  const b = await run();
  results.determinism = { a, b };
  checker.assert(JSON.stringify(a) === JSON.stringify(b), "两次结果不同");
  return results.determinism;
});

const summary = checker.summary();
const evidence = { ts: nowIso(), suite: "content-check", level: "L01", ...summary, results };
const file = writeEvidence("qa-content-l01.json", evidence);
console.log(JSON.stringify({ suite: "content-check", ...summary, evidence: file }));
process.exit(summary.failed === 0 ? 0 : 1);
