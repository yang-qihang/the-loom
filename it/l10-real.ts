// @ts-nocheck
// Real-MC e2e for L10 — two real mineflayer bots, real handshake, real placements, production grading,
// player keystone beat and Mock digest comparison (docs/02c route A; it/l10-real.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "../packages/grading/src/index";
import { MockWorldPort } from "../packages/worldport/src/mock-port";
import { PaperWorldPort, WsJsonRpcClient } from "../packages/worldport/src/paper-port";
import { createMultiAgentSdk, multiAgentConfigFromVars } from "../packages/worldport/src/multi-agent-sdk";
import { runStudentProgram } from "../packages/runner/src/run";
import { GolemBot } from "../bot/manager.mjs";
import { L10, L10Content, L10_BRIDGE } from "../content/levels/L10.content";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");

const reportShape = (report) => ({
  passed: report.passed,
  stars: report.stars,
  criteria: report.criteria.map((c) => ({ id: c.id, passed: c.passed })),
  hidden: report.hidden.map((c) => ({ id: c.id, passed: c.passed })),
  failures: report.failures.slice().sort(),
});

const digestOf = (snapshot, mockSnapshot) => {
  // 双织偶是并发执行：事件到达顺序本来就不保证。对照语义时按事件内容排序，
  // 与评分只看「谁放了哪一格、谁说了什么」的口径一致（不比较并发到达顺序）。
  const byJson = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  const agentPlaces = (snapshot.events ?? [])
    .filter((e) => e.type === "block.place" && e.actorType === "agent")
    .map((e) => ({ actor: e.actor, pos: e.pos, block: String(e.data?.block ?? "") }))
    .sort(byJson);
  const says = (snapshot.events ?? [])
    .filter((e) => e.type === "say")
    .map((e) => ({ actor: e.actor, text: String(e.data?.text ?? "") }))
    .sort(byJson);
  const blocks = {};
  for (const key of Object.keys(snapshot.blocks ?? {}).sort()) {
    if (key in (mockSnapshot.blocks ?? {})) blocks[key] = snapshot.blocks[key];
  }
  return { agentPlaces, says, blocks };
};

const diffDigest = (real, mock) => {
  const diffs = [];
  for (const field of ["agentPlaces", "says"]) {
    if (JSON.stringify(real[field]) !== JSON.stringify(mock[field])) diffs.push({ field, real: real[field], mock: mock[field] });
  }
  const blockDiffs = [];
  for (const key of Object.keys(mock.blocks)) {
    if (real.blocks[key] !== mock.blocks[key]) blockDiffs.push({ key, real: real.blocks[key], mock: mock.blocks[key] });
  }
  if (blockDiffs.length) diffs.push({ field: "blocks", count: blockDiffs.length, sample: blockDiffs.slice(0, 8) });
  return diffs;
};

async function runMock() {
  const port = new MockWorldPort();
  await port.prepare(L10Content);
  const sdk = createMultiAgentSdk(multiAgentConfigFromVars(port, L10.world.vars));
  await runStudentProgram(sdk, L10.code.referenceSolution, "explicit");
  await L10Content.playerBeat?.(port);
  const snapshot = await port.snapshot("L10");
  return { snapshot, report: grade(L10, snapshot) };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    level: "L10",
    startedAt: new Date().toISOString(),
    bots: { left: "LeftWeaver", right: "RightWeaver" },
    checks: {},
    reports: {},
    errors: [],
    actions: [],
  };
  const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
  const check = (id, ok, detail) => {
    evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
    log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail));
    if (!ok) evidence.errors.push(id);
    return !!ok;
  };

  const rpc = await WsJsonRpcClient.connect("ws://127.0.0.1:8765");
  const bots = {
    LeftWeaver: new GolemBot({ name: "LeftWeaver", log: (line) => log("[bot:left]", line) }),
    RightWeaver: new GolemBot({ name: "RightWeaver", log: (line) => log("[bot:right]", line) }),
    // 第三人「HumanLike」故意不登记进 bots.set：插件会把它当真人玩家，合龙石事件 actorType=player。
    // 它用真实 mineflayer 玩家实体走路+放方块，不是后台改世界；真正的人类键鼠复验仍留给 Lead。
    HumanLike: new GolemBot({ name: "HumanLike", log: (line) => log("[player]", line) }),
  };
  const port = new PaperWorldPort({
    rpc,
    bot: bots.LeftWeaver,
    agents: { [L10_BRIDGE.rightAgent]: bots.RightWeaver },
    def: L10,
    log: (line) => log("[port]", line),
    closeRpcOnDispose: true,
  });

  try {
    check("plugin.health", (await rpc.call("health")).ok === true);
    await bots.HumanLike.connect();
    const t0 = Date.now();
    await port.prepare(L10Content);
    evidence.prepareMs = Date.now() - t0;
    const status = await rpc.call("session.status", { sessionId: port.session.sessionId });
    evidence.plugin = {
      levelId: status.levelId,
      bots: status.bots,
      region: [status.regionFrom, status.regionTo],
      playerSpawn: status.playerSpawn,
      agentSpawn: status.agentSpawn,
    };
    check("both-bots-online", ["LeftWeaver", "RightWeaver"].every((n) => status.bots?.includes(n)), status.bots);
    check("session-level", status.levelId === "L10", status.levelId);

    // ---- stale-session probe -----------------------------------------------------
    const stale = await port.probeSession(`stale-${port.session.sessionId}`);
    check("stale-session-rejected", stale.staleRejected === true);

    // ---- 发材料：每只 bot 的份额（+2 备损），真实 place 从背包里消耗 ----
    const total = Number(L10.world.vars.materialsTotal);
    const leftShare = Math.ceil(total / 2);
    const rightShare = total - leftShare;
    for (const [name, share] of [["LeftWeaver", leftShare], ["RightWeaver", rightShare]]) {
      const res = await rpc.call("player.give", {
        sessionId: port.session.sessionId,
        name,
        item: "minecraft:oak_planks",
        count: share + 2,
      });
      check(`give.${name}`, res?.ok === true, res);
    }

    // ---- 参考解：两只真实 bot 通过邮箱握手 + 真实移动/放置 ---------------------------
    evidence.messages = [];
    const sdk = createMultiAgentSdk({
      ...multiAgentConfigFromVars(port, L10.world.vars),
      onMessage: (message) => evidence.messages.push(message),
    });
    const runT0 = Date.now();
    await runStudentProgram(sdk, L10.code.referenceSolution, "explicit");
    evidence.referenceRunMs = Date.now() - runT0;
    // wait for the last block updates to reach both clients
    await sleep(800);

    // ---- 玩家合龙：第三人真实玩家实体走到桥边，右键放 lodestone（不是 RPC 改世界）----
    const giveKeystone = await rpc.call("player.give", {
      sessionId: port.session.sessionId,
      name: "HumanLike",
      item: "minecraft:lodestone",
      count: 1,
    });
    check("give.HumanLike", giveKeystone?.ok === true, giveKeystone);
    // docs/46 §1.3：玩家节拍在「织偶部分完成」后才允许完成。这里是独立 e2e harness（没有引擎
    // 会话状态机），显式 activate 以模拟引擎在 playerBeatReady 时的行为；未激活前的右键会被插件拦下。
    const beatArmed = await rpc.call("playerBeat.arm", {
      sessionId: port.session.sessionId,
      beats: [{ pos: L10_BRIDGE.keystone, block: "minecraft:lodestone" }],
      items: ["minecraft:lodestone"],
      hint: "手持合龙石，对准中央基座按右键",
      effects: [],
    });
    check("playerBeat.armed", beatArmed?.ok === true, beatArmed);
    const beatActivate = await rpc.call("playerBeat.activate", { sessionId: port.session.sessionId });
    check("playerBeat.activate", beatActivate?.ok === true, beatActivate);
    // 玩家出生点由 content.world.playerSpawn=(14,65,6) 决定，离中央合龙石 6.9 格；
    // 真人玩家会自己走过去（4 格内可右键），这里先传送到桥边安全格再右键。
    await rpc.call("player.teleport", { sessionId: port.session.sessionId, name: "HumanLike", pos: [12, 65, 2], yaw: 180, pitch: 35 });
    await sleep(900);
    await bots.HumanLike.place("minecraft:lodestone", L10_BRIDGE.keystone[0], L10_BRIDGE.keystone[1], L10_BRIDGE.keystone[2]);
    await sleep(500);
    const snapshot = await port.snapshot("L10");
    const keystoneEvent = (snapshot.events ?? []).find(
      (e) => e.type === "block.place" && e.data?.block === "minecraft:lodestone" && e.actorType === "player",
    );
    check("keystone.human-player", keystoneEvent?.actor === "HumanLike", keystoneEvent ?? null);
    const report = grade(L10, snapshot);
    evidence.reports.reference = { real: reportShape(report) };
    evidence.snapshot = {
      agentPlaceCount: (snapshot.events ?? []).filter((e) => e.type === "block.place" && e.actorType === "agent").length,
      playerPlaceCount: (snapshot.events ?? []).filter((e) => e.type === "block.place" && e.actorType === "player").length,
      actors: [...new Set((snapshot.events ?? []).filter((e) => e.type === "block.place").map((e) => `${e.actor}:${e.actorType}`))],
      bridge: L10_BRIDGE,
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, `l10-real-snapshot-${RUN_TS}.json`), JSON.stringify(snapshot, null, 1));
    check("reference.passed", report.passed === true, reportShape(report));
    check("reference.stars-3", report.stars === 3, report.stars);
    check("reference.failures-empty", report.failures.length === 0, report.failures);
    const virtualActions = (port.actions ?? []).filter((a) => String(a.action ?? "").startsWith("virtualPlace"));
    check("no-virtual-fallback", virtualActions.length === 0, virtualActions);

    // ---- MockWorld 对照 -----------------------------------------------------------
    const mock = await runMock();
    evidence.reports.reference.mock = reportShape(mock.report);
    check("report-equals-mock", JSON.stringify(reportShape(report)) === JSON.stringify(reportShape(mock.report)), {
      real: reportShape(report),
      mock: reportShape(mock.report),
    });
    const diffs = diffDigest(digestOf(snapshot, mock.snapshot), digestOf(mock.snapshot, mock.snapshot));
    check("digest-equals-mock", diffs.length === 0, diffs.length ? diffs : { places: evidence.snapshot.agentPlaceCount });

    // ---- double reset -------------------------------------------------------------
    await port.reset(L10Content);
    const resetA = port.lastReset;
    await port.reset(L10Content);
    const resetB = port.lastReset;
    evidence.reset = { resetA, resetB };
    check("reset.under-2s", Number(resetA?.ms) < 2000 && Number(resetB?.ms) < 2000, evidence.reset);
    check("reset.hash-stable", resetA?.hash != null && resetA.hash === resetB.hash, evidence.reset);
    const afterReset = await port.snapshot("L10");
    check("reset.clears-events", (afterReset.events ?? []).length === 0, { events: (afterReset.events ?? []).length });
  } catch (error) {
    log("FATAL", error?.stack ?? String(error));
    evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
  } finally {
    try {
      await bots.LeftWeaver.disconnect();
      await bots.RightWeaver.disconnect();
      await bots.HumanLike.disconnect();
    } catch {
      /* ignore */
    }
    try {
      port.dispose?.();
      rpc.close();
    } catch {
      /* ignore */
    }
  }

  const failed = Object.entries(evidence.checks).filter(([, v]) => !v.ok);
  evidence.finishedAt = new Date().toISOString();
  evidence.actions = port.actions.slice(0, 500);
  evidence.ok = failed.length === 0 && evidence.errors.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, `l10-real-${RUN_TS}.json`), JSON.stringify(evidence, null, 1));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "l10-real-latest.json"), JSON.stringify(evidence, null, 1));
  log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ") || evidence.errors.join(", ")})`);
  process.exit(evidence.ok ? 0 : 1);
}

await main();
