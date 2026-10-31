// qa/contract-check.mjs — T1 契约层校验：LevelMeta / WorldSnapshot / WorldEvent / 评分报告形状。
// 运行：npx tsx qa/contract-check.mjs
import {
  L01,
  LevelMetaSchema,
  L01Content,
  MockWorldPort,
  WorldEventSchema,
  WorldSnapshotSchema,
  grade,
  makeChecker,
  nowIso,
  runStudentProgram,
  writeEvidence,
} from "./_lib.mjs";

const checker = makeChecker();
const results = {};

await checker.check("K1", "L01 meta 通过 protocol LevelMetaSchema", () => {
  const parsed = LevelMetaSchema.safeParse(L01.meta);
  checker.assert(parsed.success, `zod: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  return { metaId: L01.meta.id };
});

await checker.check("K2", "snapshot 通过 WorldSnapshotSchema", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
  await L01Content.playerBeat(port);
  const snapshot = await port.snapshot("L01");
  const parsed = WorldSnapshotSchema.safeParse(snapshot);
  results.snapshot = {
    keys: Object.keys(snapshot),
    events: snapshot.events.length,
    blocks: Object.keys(snapshot.blocks).length,
    agents: Object.keys(snapshot.agents),
  };
  await port.dispose();
  checker.assert(parsed.success, `zod: ${parsed.success ? "" : JSON.stringify(parsed.error.issues).slice(0, 800)}`);
  checker.assert(snapshot.events.length > 0, "snapshot 无事件");
  return results.snapshot;
});

await checker.check("K3", "每条 WorldEvent 通过 WorldEventSchema", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
  await L01Content.playerBeat(port);
  const snapshot = await port.snapshot("L01");
  await port.dispose();
  const bad = [];
  for (const [i, e] of snapshot.events.entries()) {
    const p = WorldEventSchema.safeParse(e);
    if (!p.success) bad.push({ i, issues: p.error.issues.map(x => x.message) });
  }
  results.events = { count: snapshot.events.length, invalid: bad.length };
  checker.assert(bad.length === 0, `非法事件: ${JSON.stringify(bad.slice(0, 3))}`);
  return results.events;
});

await checker.check("K4", "评分报告形状（GradeReport）合法", async () => {
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
  await L01Content.playerBeat(port);
  const report = grade(L01, await port.snapshot("L01"));
  await port.dispose();
  results.report = { passed: report.passed, stars: report.stars };
  checker.assert(typeof report.passed === "boolean", "passed 非 boolean");
  checker.assert(Number.isInteger(report.stars) && report.stars >= 0 && report.stars <= 3, `stars 越界: ${report.stars}`);
  checker.assert(Array.isArray(report.criteria) && report.criteria.length > 0, "criteria 为空");
  checker.assert(Array.isArray(report.failures), "failures 非数组");
  checker.assert(report.criteria.every(c => typeof c.id === "string" && typeof c.passed === "boolean"), "criteria 形状错误");
  return results.report;
});

await checker.check("K5", "同一输入两次快照一致（确定性）", async () => {
  const run = async () => {
    const port = new MockWorldPort();
    await port.prepare(L01Content);
    await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.referenceSolution);
    await L01Content.playerBeat(port);
    const snap = await port.snapshot("L01");
    await port.dispose();
    return JSON.stringify({ events: snap.events, blocks: snap.blocks, agents: snap.agents });
  };
  const a = await run();
  const b = await run();
  results.determinism = { equal: a === b, bytes: a.length };
  checker.assert(a === b, "快照不确定");
  return results.determinism;
});

const summary = checker.summary();
const evidence = { ts: nowIso(), suite: "contract-check", ...summary, results };
const file = writeEvidence("qa-contract.json", evidence);
console.log(JSON.stringify({ suite: "contract-check", ...summary, evidence: file }));
process.exit(summary.failed === 0 ? 0 : 1);
