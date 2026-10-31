// @ts-nocheck
// Shared real-MC e2e harness for L01–L04 (T2).
//
// Per level: connect golem bot → session.begin → content.prepare(port) → session.finalize (derived
// layout) → run the SAME reference solution through the same runner transform → testMode playerBeat
// → world.snapshot → production grader (3 stars expected) → compare with MockWorldPort report/digest
// → REQ-EPOCH stale-session probe + epoch increment → REQ-RESET-01 double reset → evidence JSON.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "../packages/grading/src/index";
import { MockWorldPort } from "../packages/worldport/src/mock-port";
import { PaperWorldPort, WsJsonRpcClient, collectVec3 } from "../packages/worldport/src/paper-port";
import { runStudentProgram } from "../packages/runner/src/run";
import { GolemBot } from "../bot/manager.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function reportShape(report) {
  return {
    passed: report.passed,
    stars: report.stars,
    criteria: report.criteria.map((c) => ({ id: c.id, passed: c.passed })),
    hidden: report.hidden.map((c) => ({ id: c.id, passed: c.passed })),
    failures: report.failures.slice().sort(),
  };
}

const blockId = (snapshot, key) => snapshot.blocks?.[key] ?? "minecraft:air";

/** Grading-relevant projection: report + agent placements + say lines + blocks at Mock-known keys. */
export function digestOf(def, snapshot, mockSnapshot) {
  const agentPlaces = (snapshot.events ?? [])
    .filter((e) => e.type === "block.place" && e.actorType === "agent")
    .map((e) => ({ pos: e.pos, block: String(e.data?.block ?? "") }));
  const says = (snapshot.events ?? [])
    .filter((e) => e.type === "say")
    .map((e) => String(e.data?.text ?? ""));
  // 真实 PaperWorldPort 的快照只包含「被追踪/被改动」的方块；MockWorld 会记录场景装饰。
  // WorldDigest 对比取两者交集（评分真值仍由 grade() 用完整快照判断），避免把纯装饰
  // 方块当成玩家/织偶行为差异。
  const blocks = {};
  const realBlocks = snapshot.blocks ?? {};
  // 逻辑平面方块在真实 Paper 里物理落成地板材质（farmland→dirt），
  // digest 只比较可玩行为，因此把这类“同一逻辑格的物理表示”归一化。
  const normalize = (id: string): string => {
    if (id === "minecraft:farmland") return "minecraft:dirt";
    if (id === "minecraft:wheat" || id === "minecraft:wheat_sprout" || id === "minecraft:wheat_seeds") return "minecraft:dirt";
    if (id === "minecraft:water") return "minecraft:dirt";
    return id;
  };
  for (const key of Object.keys(realBlocks).sort()) {
    if (key in (mockSnapshot.blocks ?? {})) blocks[key] = normalize(blockId(snapshot, key));
  }
  const mockBlocks = {};
  for (const key of Object.keys(mockSnapshot.blocks ?? {})) mockBlocks[key] = normalize(blockId(mockSnapshot, key));
  return { agentPlaces, says, blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v])) , mockBlocks };
}

function normalizeBlockForDigest(id) {
  if (id === "minecraft:farmland") return "minecraft:dirt";
  if (id === "minecraft:wheat" || id === "minecraft:wheat_sprout" || id === "minecraft:wheat_seeds") return "minecraft:dirt";
  if (id === "minecraft:water") return "minecraft:dirt";
  return id;
}

export function diffDigest(realDigest, mockDigest) {
  const diffs = [];
  if (JSON.stringify(realDigest.agentPlaces) !== JSON.stringify(mockDigest.agentPlaces)) {
    diffs.push({
      field: "agentPlaces",
      real: realDigest.agentPlaces.slice(0, 8),
      mock: mockDigest.agentPlaces.slice(0, 8),
      realCount: realDigest.agentPlaces.length,
      mockCount: mockDigest.agentPlaces.length,
    });
  }
  if (JSON.stringify(realDigest.says) !== JSON.stringify(mockDigest.says)) {
    diffs.push({ field: "says", real: realDigest.says, mock: mockDigest.says });
  }
  const blockDiffs = [];
  for (const key of Object.keys(mockDigest.blocks)) {
    if (realDigest.blocks[key] !== normalizeBlockForDigest(mockDigest.blocks[key])) {
      blockDiffs.push({ key, real: realDigest.blocks[key], mock: mockDigest.blocks[key] });
    }
  }
  if (blockDiffs.length) diffs.push({ field: "blocks", count: blockDiffs.length, sample: blockDiffs.slice(0, 8) });
  return diffs;
}

export function sdkOf(port) {
  return { golem: port.agent("golem"), world: port.world };
}

/** Run a student program + optional player beat on MockWorldPort and return {snapshot, report}. */
export async function runMockScenario(content, source, withPlayerBeat) {
  const mock = new MockWorldPort();
  await mock.prepare(content);
  await runStudentProgram(sdkOf(mock), source);
  if (withPlayerBeat && content.playerBeat) await content.playerBeat(mock);
  const snapshot = await mock.snapshot(content.def.id);
  return { snapshot, report: grade(content.def, snapshot) };
}

/**
 * @param {object} opts
 * @param {string} opts.name            evidence prefix / bot suffix (e.g. "l2")
 * @param {import("../content/levels/L02.content").LevelContent} opts.content
 * @param {object} [opts.scene]         scene hints for the port (only when mock coords ≠ MC geometry)
 * @param {(ctx:any)=>Promise<void>} [opts.afterMain]  extra checks (L01 legacy failure scenarios)
 */
export async function runRealLevel(opts) {
  const { name, content } = opts;
  const def = content.def;
  const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");
  const rpcPort = Number(process.env.MC_RPC_PORT ?? 8765);
  const mcPort = Number(process.env.MC_PORT ?? 25565);
  const host = process.env.MC_HOST ?? "127.0.0.1";
  const botName = process.env.BOT_NAME ?? `Golem${String(process.pid).slice(-4)}`;

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    task: `task-30 / T2-MC real ${def.id} e2e`,
    level: def.id,
    startedAt: new Date().toISOString(),
    environment: { node: process.version, host, mcPort, rpcPort, botName },
    checks: {},
    reports: {},
    sessions: {},
    reset: {},
    actions: [],
    errors: [],
  };
  const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
  const check = (id, ok, detail) => {
    evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
    log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail));
    if (!ok) evidence.errors.push(id);
    return !!ok;
  };

  const rpc = await WsJsonRpcClient.connect(`ws://127.0.0.1:${rpcPort}`);
  const bot = new GolemBot({ name: botName, host, port: mcPort, log: (line) => log("[bot]", line) });
  const port = new PaperWorldPort({
    rpc,
    bot,
    def,
    scene: opts.scene,
    log: (line) => log("[port]", line),
    closeRpcOnDispose: true,
  });

  try {
    const health = await rpc.call("health");
    evidence.environment.plugin = health;
    check("plugin.health", health.ok === true && health.mc === "26.1.2", {
      plugin: health.plugin,
      mc: health.mc,
      version: health.version,
    });

    // ---- prepare via derived scene ------------------------------------------------
    const prepareT0 = Date.now();
    await port.prepare(content);
    evidence.prepareMs = Date.now() - prepareT0;
    const prepared = await port.snapshot(def.id);
    evidence.scene = {
      groundY: port.layout?.groundY,
      arena: port.layout?.arena,
      trackedCount: port.layout?.tracked?.length,
      kit: port.layout?.kit,
      agent: prepared.agents?.golem,
      npcs: Object.keys(prepared.npcs ?? {}),
    };
    check(
      `${def.id}.scene-ready`,
      prepared.agents?.golem != null && Object.keys(prepared.npcs ?? {}).length > 0,
      { prepareMs: evidence.prepareMs, scene: evidence.scene },
    );

    // ---- REQ-EPOCH: stale session rejected + epoch increments ----------------------
    const session1 = port.session;
    const stale = await port.probeSession(`stale-${session1.sessionId}`);
    check(`${def.id}.stale-session-rejected`, stale.staleRejected === true, session1);
    await port.prepare(content); // second prepare on the same live server → epoch must advance
    const session2 = port.session;
    evidence.sessions = { first: session1, second: session2 };
    check(`${def.id}.epoch-incremented`, session2.epoch === session1.epoch + 1, evidence.sessions);

    // ---- reference solution through the same runner ------------------------------
    const runT0 = Date.now();
    await runStudentProgram(sdkOf(port), def.code.referenceSolution);
    evidence.referenceRunMs = Date.now() - runT0;
    if (content.playerBeat) await content.playerBeat(port);
    await sleep(700);
    const snapshot = await port.snapshot(def.id);
    const report = grade(def, snapshot);
    evidence.reports.reference = { real: reportShape(report) };
    evidence.snapshot = {
      blocks: snapshot.blocks,
      agents: snapshot.agents,
      npcs: snapshot.npcs,
      sayCount: (snapshot.events ?? []).filter((e) => e.type === "say").length,
      agentPlaceCount: (snapshot.events ?? []).filter((e) => e.type === "block.place" && e.actorType === "agent").length,
      playerPlaceCount: (snapshot.events ?? []).filter((e) => e.type === "block.place" && e.actorType === "player").length,
      eventTypes: [...new Set((snapshot.events ?? []).map((e) => `${e.type}:${e.actorType}`))],
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-real-snapshot-${RUN_TS}.json`), JSON.stringify(snapshot, null, 1));
    check(`${def.id}.passed`, report.passed === true, reportShape(report));
    check(`${def.id}.stars-3`, report.stars === 3, report.stars);
    check(`${def.id}.failures-empty`, report.failures.length === 0, report.failures);
    check(`${def.id}.actions`, evidence.referenceRunMs > 0, { referenceRunMs: evidence.referenceRunMs });

    // ---- MockWorld comparison -----------------------------------------------------
    const mock = await runMockScenario(content, def.code.referenceSolution, true);
    evidence.reports.reference.mock = reportShape(mock.report);
    const realShape = reportShape(report);
    check(`${def.id}.report-equals-mock`, JSON.stringify(realShape) === JSON.stringify(reportShape(mock.report)), {
      real: realShape,
      mock: reportShape(mock.report),
    });
    const realDigest = digestOf(def, snapshot, mock.snapshot);
    const mockDigest = digestOf(def, mock.snapshot, mock.snapshot);
    const diffs = diffDigest(realDigest, mockDigest);
    check(`${def.id}.digest-equals-mock`, diffs.length === 0, diffs.length ? diffs : { agentPlaces: realDigest.agentPlaces.length, says: realDigest.says.length, blocks: Object.keys(realDigest.blocks).length });

    // ---- REQ-RESET-01: double reset on the same checkpoint -------------------------
    await port.reset(content);
    const resetA = port.lastReset;
    await port.reset(content);
    const resetB = port.lastReset;
    evidence.reset = { resetA, resetB };
    check(`${def.id}.reset-under-2s`, Number(resetA?.ms ?? 9999) < 2000 && Number(resetB?.ms ?? 9999) < 2000, {
      a: resetA?.ms,
      b: resetB?.ms,
    });
    check(`${def.id}.reset-hash-stable`, resetA?.hash != null && resetA.hash === resetB.hash, {
      a: resetA?.hash,
      b: resetB?.hash,
    });
    const afterReset = await port.snapshot(def.id);
    const emptyEvents = (afterReset.events ?? []).length;
    check(`${def.id}.reset-clears-events`, emptyEvents === 0, { events: emptyEvents });

    // ---- extra level-specific checks (L01 legacy failure scenarios) ----------------
    if (opts.afterMain) await opts.afterMain({ port, content, def, rpc, evidence, check, log, runMockScenario, digestOf, diffDigest, grade, sdkOf, sleep });

    // leave the scene at its checkpoint
    await port.reset(content);
  } catch (error) {
    log("FATAL", error?.stack ?? String(error));
    evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
    check("run.completed", false, { error: error?.message ?? String(error) });
  } finally {
    try {
      await port.dispose();
    } catch {
      /* ignore */
    }
    try {
      rpc.close();
    } catch {
      /* ignore */
    }
  }

  const failed = Object.entries(evidence.checks).filter(([, value]) => !value.ok);
  evidence.finishedAt = new Date().toISOString();
  evidence.actions = port.actions.slice(0, 2000);
  evidence.ok = failed.length === 0 && evidence.errors.length === 0;
  const outfile = path.join(EVIDENCE_DIR, `${name}-real-${RUN_TS}.json`);
  fs.writeFileSync(outfile, JSON.stringify(evidence, null, 1));
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-real-latest.json`), JSON.stringify(evidence, null, 1));
  log(`evidence written: ${path.relative(ROOT, outfile)}`);
  log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
  process.exit(evidence.ok ? 0 : 1);
}

export { collectVec3 };
