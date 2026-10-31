// qa/red-team.mjs — 红队 6 条（对应 docs/08 附录 A.4 的 12 条中的 6 条可测项）。
// 目的：用攻击证明「当前 T1 代码在 MockWorld/runner/grading 层」哪些防住（defended）、
// 哪些攻击成功但只能记录（gap，交给 engine/hash 冻结层修）。不攻击真实 MC/公网；不改产品代码。
// 运行：npx tsx qa/red-team.mjs
import {
  L01,
  L01Content,
  MockWorldPort,
  grade,
  nowIso,
  runStudentProgram,
  writeEvidence,
} from "./_lib.mjs";
import { MockWorld } from "../packages/mockworld/src/index.ts";

const attacks = {};
const record = (id, name, status, detail, fix) => {
  attacks[id] = { id, name, status, detail, fix };
};
const lamps = L01.world.vars.lamps;

async function runOnMock(source, vars = { ...L01.world.vars }) {
  const world = new MockWorld(vars);
  let error = null;
  try {
    await runStudentProgram({ golem: world.golem, world: world.world }, source);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { world, error, snapshot: world.snapshot("L01") };
}

// RT-01 硬编码 / 物理走位绕过：不移动直接放置 → 期望被「距离 ≤4.5」防住。
{
  const src = `golem.place("lantern", ${lamps[0][0]}, ${lamps[0][1]}, ${lamps[0][2]})`;
  const { snapshot, error } = await runOnMock(src);
  const placed = snapshot.events.filter(e => e.type === "block.place").length;
  record(
    "RT-01",
    "硬编码坐标：不走到灯下直接 place",
    placed === 0 && /太远/.test(error ?? "") ? "defended" : "gap",
    { placed, error },
    "无需修复；引擎侧同样在 place 前校验 reach≤4.5",
  );
}

// RT-02 绕过 SDK：探测宿主能力（process/eval/globalThis）是否可被学生代码触达。
{
  const src = `golem.say("probe" + "|process:" + typeof process + "|eval:" + typeof eval + "|globalThis:" + typeof globalThis + "|curl:" + typeof world.curl)`;
  const { world } = await runOnMock(src);
  const probe = world.events.find(e => e.type === "say")?.data?.text ?? null;
  const hostVisible = /process:object/.test(probe ?? "");
  record(
    "RT-02",
    "绕过 SDK/沙箱：学生代码读取宿主对象",
    hostVisible ? "gap" : "defended",
    { probe, hostVisible },
    hostVisible
      ? "runner 用 new Function，process/eval/globalThis 全局可见；engine 层需 worker_threads/独立进程隔离（docs/07 §4）"
      : "已隔离",
  );
}

// RT-03 伪造世界状态：学生改写 world.vars（评分真值来源之一）→ 期望快照不可被学生改。
{
  const before = JSON.stringify(L01.world.vars.lamps);
  const src = `world.vars.lamps = [[0, 65, 0], [0, 65, 1], [0, 65, 2], [0, 65, 3]]`;
  const { world } = await runOnMock(src);
  const after = JSON.stringify(world.vars.lamps);
  const tampered = before !== after;
  record(
    "RT-03",
    "伪造世界状态：学生改写 world.vars.lamps",
    tampered ? "gap" : "defended",
    { before, after, tampered },
    tampered
      ? "world.vars 直接暴露可变引用；SDK 应对 vars 做 deep-freeze 或只读副本（评分真值只从引擎侧快照注入）"
      : "已只读",
  );
}

// RT-04 重放/伪造快照：不跑程序，手工构造 snapshot 喂 grade（模拟绕过引擎直接篡改真值）。
{
  const blocks = Object.fromEntries(lamps.map(p => [p.join(","), "minecraft:lantern"]));
  const events = [];
  let seq = 0;
  for (let i = 0; i < 3; i++) {
    const [x, y, z] = lamps[i];
    events.push({ seq: ++seq, type: "agent.move", actor: "golem", actorType: "agent", pos: [x - 1, 65, z], tick: seq });
    events.push({ seq: ++seq, type: "block.place", actor: "golem", actorType: "agent", pos: [x, y, z], tick: seq });
  }
  events.push({ seq: ++seq, type: "block.place", actor: "player", actorType: "player", pos: lamps[3], tick: seq });
  const forged = {
    levelId: "L01",
    seed: 1,
    vars: L01.world.vars,
    blocks,
    agents: { golem: { pos: [0, 65, 6] } },
    npcs: { eira: { pos: [0, 65, 6] } },
    events,
    tick: seq,
  };
  const report = grade(L01, forged);
  record(
    "RT-04",
    "伪造/重放快照：手写 snapshot 喂 grade",
    report.passed ? "gap" : "defended",
    { passed: report.passed, stars: report.stars, failures: report.failures },
    report.passed
      ? "grade 只信任调用方传入的 snapshot，无签名/epoch/seq 绑定；engine 必须保证 snapshot 只来自插件且与 session/epoch 绑定（docs/21 §3）"
      : "已拒绝伪造快照",
  );
}

// RT-06 断言恒真/测试篡改：把 level 的断言全部替换成 () => true 后，starter 也能 3 星。
{
  const tampered = JSON.parse(JSON.stringify({ id: L01.id, meta: L01.meta, world: L01.world, code: L01.code, task: L01.task }));
  tampered.task.successCriteria = tampered.task.successCriteria.map(c => ({ ...c, check: "() => true" }));
  tampered.task.hiddenTests = [
    { id: "t", name: "tampered", setup: {}, assertions: [{ id: "t1", text: "tampered", check: "() => true" }] },
  ];
  // 用真实函数（JSON 序列化不保留函数）
  const level = {
    ...tampered,
    task: {
      ...tampered.task,
      successCriteria: L01.task.successCriteria.map(c => ({ ...c, check: () => true })),
      hiddenTests: [{ id: "t", name: "tampered", setup: {}, assertions: [{ id: "t1", text: "tampered", check: () => true }] }],
    },
  };
  const port = new MockWorldPort();
  await port.prepare({ ...L01Content, def: level });
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, L01.code.starterCode);
  await L01Content.playerBeat(port);
  const report = grade(level, await port.snapshot("L01"));
  await port.dispose();
  record(
    "RT-06",
    "测试篡改：断言恒真后 starter 通过",
    report.passed ? "gap" : "defended",
    { starterPassed: report.passed, stars: report.stars },
    report.passed
      ? "断言与测试文件无 hash 冻结/签名，任何 agent 都能改断言变绿；需 scripts/guard-tests.mjs（docs/08 §6）"
      : "已被隐藏测试/玩家节拍拦下",
  );
}

// RT-11 模拟玩家输入：用 agent 身份点第 4 盏灯，冒充玩家节拍。
{
  const port = new MockWorldPort();
  await port.prepare(L01Content);
  const src = `${L01.code.referenceSolution}\ngolem.moveTo(${lamps[3][0]}, ${lamps[3][2]})\ngolem.place("lantern", ${lamps[3][0]}, ${lamps[3][1]}, ${lamps[3][2]})`;
  await runStudentProgram({ golem: port.agent("golem"), world: port.world }, src);
  const report = grade(L01, await port.snapshot("L01"));
  await port.dispose();
  const pc = report.criteria.find(c => c.id === "player-lit-fourth");
  record(
    "RT-11",
    "模拟玩家输入：agent 冒充玩家点第 4 盏",
    report.passed === false && pc?.passed === false ? "defended" : "gap",
    { passed: report.passed, playerLitFourth: pc?.passed },
    "无需修复；playerBeat 判定必须用 actorType==='player'（docs/07 §3.3）",
  );
}

const list = Object.values(attacks);
const summary = {
  total: list.length,
  defended: list.filter(a => a.status === "defended").length,
  gaps: list.filter(a => a.status === "gap").length,
  executed: list.length,
};
const evidence = {
  ts: nowIso(),
  suite: "red-team",
  implemented: "6/12（RT-01/RT-02/RT-03/RT-04/RT-06/RT-11）",
  mapping: {
    "RT-01": "硬编码坐标（canonical RT-01）",
    "RT-02": "绕过 SDK 直连宿主（canonical RT-02/RT-07）",
    "RT-03": "伪造成世界状态（canonical RT-03）",
    "RT-04": "重放/伪造快照（canonical RT-04）",
    "RT-06": "断言恒真/测试篡改（canonical RT-06）",
    "RT-11": "模拟玩家输入（canonical RT-11）",
  },
  summary,
  attacks,
};
const file = writeEvidence("qa-red-team.json", evidence);
console.log(JSON.stringify({ suite: "red-team", ...summary, gaps: list.filter(a => a.status === "gap").map(a => a.id), evidence: file }));
process.exit(0); // 记录型门禁：defended/gap 都已留证；gap 由 Lead 分派修复
