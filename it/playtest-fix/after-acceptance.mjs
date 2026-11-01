// @ts-nocheck
/**
 * B-1/B-2/B-3/B-4 修复后验收（新插件 + 新引擎，真实 Paper）：
 *  B-1 L01 全流程：starter → progress 目标 0=false、playerBeatReady=false、无等待/无提前提示；
 *      参考解 → 目标 0=true、playerBeatReady=true、「轮到你」信号出现；
 *      玩家站地面（不看不看顶面）右键柱子 → 第 4 盏灯亮、目标 1=true、事件 actorType=player；
 *      确认 → 3 星。
 *  B-2 线性：未 ready 时玩家提前右键目标 → 被插件拦截（方块不变 + actionbar「先让灰崽完成它那部分」）。
 *  B-3 纯净：玩家在线 L02→L01→L03→L01 三次切关：L01 背包只有 lantern（无 cake）、
 *      L02 场景方块在 L01 会话为空、NPC 数不累积。
 *  B-4 重置：挖路面 + 乱放方块 + 丢物品 + 玩家走远 → reset → 方块还原、乱放清除、玩家回 playerSpawn、
 *      背包回基准、事件清零、掉落物清除、连续两次 reset hash 相同。
 *
 * 用法：ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
 *        npx tsx it/playtest-fix/after-acceptance.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE,
  Engine,
  EventStream,
  WsRpc,
  attachPlayerChatCapture,
  connectPlayer,
  createPlayer,
  ensureDir,
  fmtPos,
  gitHead,
  loadVec3,
  resultProjection,
  sleep,
  waitSpawn,
  writeJson,
} from "./lib.mjs";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:4321";
const MC_RPC_URL = process.env.MC_RPC_URL ?? "ws://127.0.0.1:8766";
const MC_PORT = Number(process.env.MC_PORT ?? 25566);
const PLAYER_NAME = process.env.PLAYER_NAME ?? `AfterP${String(process.pid).slice(-3)}`;
const OUT = path.join(EVIDENCE, "after");
const PAPER_LOG = path.join(process.cwd(), "tmp", "verify", "paper", "console.log");

const evidence = {
  task: "verifier B-1..B-4 修复后验收（L01 进度/线性/纯净/重置）",
  phase: "after",
  head: gitHead(),
  startedAt: new Date().toISOString(),
  environment: { engine: ENGINE_URL, rpc: MC_RPC_URL, paperPort: MC_PORT, player: PLAYER_NAME },
  checks: {},
  steps: {},
  errors: [],
};
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const check = (id, ok, detail) => {
  evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
  log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 500));
  if (!ok) evidence.errors.push(id);
  return !!ok;
};

const engine = new Engine(ENGINE_URL);
let rpc = null;
let player = null;
let capture = null;
let Vec3 = null;

// ---------------------------------------------------------------- helpers
const pluginSession = async () => {
  const health = await engine.health();
  return { health, pluginSessionId: health?.mc?.sessionId, plugin: health?.mc ?? {} };
};
/** 每次 RPC 前都重新取插件会话 id（引擎 reset/重建后插件 sessionId 可能变化）。 */
const rpcSession = async () => {
  const health = await engine.health();
  const sessionId = health?.mc?.sessionId;
  if (!sessionId) throw new Error("插件 sessionId 为空：会话尚未 prepare");
  return sessionId;
};
const rpcWorldBlocks = async (engineSessionId, positions) => {
  const health = await engine.health();
  const res = await rpc.call("world.blocks", { sessionId: health.mc.sessionId, positions });
  return res?.blocks ?? {};
};
const rpcInventory = async () => {
  const res = await rpc.call("player.inventory", {});
  return res;
};
const inventoryItemsOf = (inventory, name = PLAYER_NAME) => {
  const entry = (inventory?.players ?? []).find((playerEntry) => playerEntry.name === name);
  return entry?.items ?? [];
};
const inventoryCount = (items, itemName) =>
  items.filter((item) => item.item === `minecraft:${itemName}`).reduce((sum, item) => sum + item.count, 0);
const blocksAir = (blocks) => Object.values(blocks).every((id) => id === "minecraft:air");
const readBotBlocks = (positions) => {
  const out = {};
  for (const [x, y, z] of positions) {
    const block = player.blockAt(new Vec3(x, y, z));
    out[`${x},${y},${z}`] = block ? block.name : null;
  }
  return out;
};
const consoleHits = (needle, limit = 6) => {
  try {
    const text = fs.readFileSync(PAPER_LOG, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    return text.split("\n").filter((line) => line.includes(needle)).slice(-limit);
  } catch {
    return [];
  }
};
const teleportPlayer = async (feet) => {
  const health = await engine.health();
  const res = await rpc.call("player.teleport", { sessionId: health.mc.sessionId, name: PLAYER_NAME, pos: feet, yaw: 0, pitch: 0 });
  await sleep(1200);
  return res;
};
const waitResultFor = async (stream, runId, timeoutMs = 360_000) => {
  const entry = await stream.waitFor((item) => item.e.type === "result" && item.e.runId === runId, timeoutMs, `result ${runId}`);
  return entry.e;
};
const runWithRetry = async ({ stream, sessionId, source, label, attempts = 3 }) => {
  const tried = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const run = await engine.run(sessionId, source);
    const runId = run.json?.runId;
    const result = await waitResultFor(stream, runId);
    const projection = resultProjection(result);
    tried.push({ attempt, runId, criteriaCount: projection?.criteria?.length ?? 0, failures: projection?.failures, hasProgress: projection?.hasProgressField });
    const hasRealProgress = (projection?.progress?.length ?? 0) > 0;
    if (hasRealProgress || (projection?.criteria?.length ?? 0) > 0) return { result, projection, tried };
    log(`${label} attempt ${attempt} 环境抖动（no progress/criteria）`);
    await engine.reset(sessionId);
    await sleep(2500);
  }
  throw new Error(`${label} 重试 ${attempts} 次仍未拿到真实评分`);
};

// L01 的第四盏灯：柱体 (2,11..13,16)，目标空位 (2,14,16)，柱顶面 y=14.0。
const LAMP4_TARGET = [2, 14, 16];
const L02_SIGNATURES = [
  [4, 65, -6],
  [0, 64, -7],
  [-20, 65, -1],
  [3, 64, 8],
  [-11, 65, 13],
];

try {
  ensureDir(OUT);
  Vec3 = await loadVec3();
  const health0 = await engine.health();
  evidence.environment.engineHealth = health0;
  check("engine.paper-mode", health0?.ok === true && health0?.port === "paper", { ok: health0?.ok, port: health0?.port });
  evidence.environment.plugin = health0?.mc ?? {};

  rpc = await WsRpc.connect(MC_RPC_URL);
  const pluginHealth0 = await rpc.call("health");
  evidence.environment.pluginHealth = pluginHealth0;
  check(
    "plugin.new-debug-rpcs",
    pluginHealth0?.checkpointSize !== undefined &&
      pluginHealth0?.playerKit !== undefined &&
      pluginHealth0?.playerBeat !== undefined,
    Object.keys(pluginHealth0 ?? {}),
  );

  // 玩家先进服（等在 prepare 之前，让 playerKit 直接发到人身上）。
  player = await createPlayer({ name: PLAYER_NAME, port: MC_PORT, log: (line) => log(line) });
  capture = attachPlayerChatCapture(player);
  await waitSpawn(player, { log: (line) => log(line) });
  await sleep(600);

  // =========================================================== B-1 L01 全流程
  const levelRes = await engine.levelDef("L01");
  const def = levelRes.json?.def;
  evidence.steps.levelApi = {
    status: levelRes.status,
    progress: def?.progress ?? null,
    playerBeatHint: def?.task?.playerBeatHint ?? null,
  };
  check(
    "b1.level-api.progress-3",
    Array.isArray(def?.progress) && def.progress.length === 3 && def.progress.every((step) => step.id && step.text),
    def?.progress,
  );
  check(
    "b1.level-api.progress-player-flag",
    (def?.progress ?? []).filter((step) => step.player === true).length === 1,
    def?.progress?.map((step) => ({ id: step.id, player: !!step.player })),
  );
  evidence.steps.levelApi.progressSerialized = JSON.stringify(def?.progress);

  const created = await engine.createSession("L01");
  if (created.status !== 201) throw new Error(`创建 L01 会话失败：HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 400)}`);
  const l01Session = created.json.sessionId;
  evidence.steps.createL01 = { createMs: created.createMs, sessionId: l01Session, state: created.json?.state, scene: { agents: created.json?.snapshot?.agents, npcs: Object.keys(created.json?.snapshot?.npcs ?? {}) } };
  const stream = new EventStream(engine, l01Session).start();
  // 场景 finalize 会把织偶/玩家传送进场景，客户端区块流式加载完再跑，否则 pathfinder 首跑会失败。
  await sleep(6000);

  const starter = await runWithRetry({ stream, sessionId: l01Session, source: levelRes.json?.starterCode, label: "starter" });
  const starterProgress = starter.projection?.progress ?? [];
  const starterReady = starter.projection?.playerBeatReady;
  evidence.steps.starter = {
    result: starter.projection,
    progress: starterProgress.map((step) => ({ id: step.id, passed: step.passed, player: step.player })),
    playerBeatReady: starterReady,
    attempts: starter.tried,
  };
  check("b1.starter.progress0-false", starterProgress[0]?.passed === false, starterProgress.map((step) => ({ id: step.id, passed: step.passed })));
  check("b1.starter.playerBeatReady-false", starterReady === false, { playerBeatReady: starterReady });
  check(
    "b1.starter.no-waiting-ui",
    (starterReady === true) === false,
    { waitingForPlayer: starterReady === true && starter.projection?.passed === false },
  );
  const starterActionBars = [...capture.actionBars];
  check(
    "b1.starter.no-premature-in-game-hint",
    !starterActionBars.some((entry) => /灯笼|灯柱|织者之印|轮到|第 4 盏/.test(entry.text)),
    starterActionBars,
  );

  // 未 ready 时调用 player-beat（端点保持可调用，不要求 409）：只记录，不作用于世界。
  const preBeatHttp = await engine.playerBeat(l01Session, false);
  evidence.steps.preReadyPlayerBeat = {
    status: preBeatHttp.status,
    body: preBeatHttp.json,
    note: "Lead 2026-11-01 口径：端点保持可调用不返回 409；线性由 Studio UI 门控 + 插件提前右键拦截保证",
  };
  const preBeatBlocks = await rpcWorldBlocks(l01Session, [LAMP4_TARGET]);
  check("b1.pre-ready-playerBeat-no-op", preBeatBlocks[LAMP4_TARGET.join(",")] !== "minecraft:lantern", preBeatBlocks);

  // =========================================================== B-2 线性：提前右键被拦截
  await teleportPlayer([2, 11, 14]);
  const lanternStack = player.inventory.items().find((item) => item.name.includes("lantern"));
  if (lanternStack) await player.equip(lanternStack, "hand");
  const columnBlock = player.blockAt(new Vec3(2, 13, 16));
  await player.lookAt(new Vec3(2.5, 13.5, 16.5), true); // 看向柱子不是顶面
  await sleep(400);
  const barsBeforeEarly = capture.actionBars.length;
  await player.activateItem();
  await sleep(900);
  const earlyBars = capture.actionBars.slice(barsBeforeEarly);
  const earlyBlocks = await rpcWorldBlocks(l01Session, [LAMP4_TARGET]);
  const earlyStatus = await rpc.call("playerBeat.status", { sessionId: await rpcSession() });
  evidence.steps.earlyRightClick = {
    actionBars: earlyBars,
    blockAtTarget: earlyBlocks,
    playerBeatStatus: earlyStatus,
    columnBlock: columnBlock?.name,
  };
  check("b2.early-rightclick.block-unchanged", earlyBlocks[LAMP4_TARGET.join(",")] === "minecraft:air", earlyBlocks);
  check(
    "b2.early-rightclick.intercepted-actionbar",
    earlyBars.some((entry) => entry.text.includes("先让灰崽")),
    earlyBars,
  );
  check("b2.early-rightclick.beat-not-done", earlyStatus?.done === false || earlyStatus?.beats?.every((beat) => beat.done === false), earlyStatus);

  // =========================================================== B-1 参考解 → ready
  await engine.reset(l01Session);
  await sleep(4000);
  const reference = await runWithRetry({ stream, sessionId: l01Session, source: def?.code?.referenceSolution, label: "reference" });
  const refProgress = reference.projection?.progress ?? [];
  const refReady = reference.projection?.playerBeatReady;
  evidence.steps.reference = {
    result: reference.projection,
    progress: refProgress.map((step) => ({ id: step.id, passed: step.passed, player: step.player })),
    playerBeatReady: refReady,
    attempts: reference.tried,
    actionBars: [...capture.actionBars],
  };
  check("b1.reference.progress0-true", refProgress[0]?.passed === true, refProgress.map((step) => ({ id: step.id, passed: step.passed })));
  check("b1.reference.progress2-true", refProgress[2]?.passed === true, refProgress.map((step) => ({ id: step.id, passed: step.passed })));
  const playerStepId = (def?.progress ?? []).find((step) => step.player === true)?.id;
  check(
    "b1.reference.progress1-player-not-done",
    refProgress[1]?.passed === false && refProgress[1]?.id === playerStepId,
    refProgress.map((step) => ({ id: step.id, passed: step.passed })),
  );
  check("b1.reference.playerBeatReady-true", refReady === true, { playerBeatReady: refReady, passed: reference.projection?.passed });
  const statusAfterReady = await rpc.call("playerBeat.status", { sessionId: await rpcSession() });
  evidence.steps.reference.playerBeatStatus = statusAfterReady;
  check("b1.reference.plugin-activated", statusAfterReady?.active === true, { active: statusAfterReady?.active, armed: statusAfterReady?.armed });
  check(
    "b1.reference.activaction-actionbar-hint",
    capture.actionBars.slice(-8).some((entry) => entry.text.includes("灯笼") || entry.text.includes("灯柱") || entry.text.includes("右键")),
    capture.actionBars.slice(-8),
  );

  // =========================================================== B-1 ready 后玩家右键柱子（不看不看顶面）
  await teleportPlayer([2, 11, 14]);
  const lanternNow = player.inventory.items().find((item) => item.name.includes("lantern"));
  if (lanternNow) await player.equip(lanternNow, "hand");
  await player.lookAt(new Vec3(2.5, 14.5, 16.5), true);
  await sleep(500);
  const eye = player.entity.position.offset(0, player.entity.eyeHeight ?? 1.62, 0);
  const cursor = (() => {
    try {
      const hit = player.blockAtCursor(8);
      return hit ? { block: hit.name, pos: [hit.position.x, hit.position.y, hit.position.z], face: hit.face } : null;
    } catch {
      return null;
    }
  })();
  evidence.steps.readyRightClick = { eye: [eye.x, eye.y, eye.z], topFaceY: 14.0, topFaceVisibleGeometrically: eye.y > 14.0, cursorRaycast: cursor };
  await player.activateItem();
  await sleep(1200);
  const afterBeatBlocks = await rpcWorldBlocks(l01Session, [LAMP4_TARGET]);
  const statusAfterBeat = await rpc.call("playerBeat.status", { sessionId: await rpcSession() });
  evidence.steps.readyRightClick.blockAtTarget = afterBeatBlocks;
  evidence.steps.readyRightClick.playerBeatStatus = statusAfterBeat;
  evidence.steps.readyRightClick.actionBars = [...capture.actionBars].slice(-6);
  check("b1.player.rightclick-lamp-placed", afterBeatBlocks[LAMP4_TARGET.join(",")] === "minecraft:lantern", afterBeatBlocks);
  check("b1.player.beat-done", statusAfterBeat?.done === true, { done: statusAfterBeat?.done, beats: statusAfterBeat?.beats });
  const snapshotAfterBeat = await rpc.call("world.snapshot", { levelId: "L01", sessionId: await rpcSession() });
  const playerPlaceEvent = (snapshotAfterBeat?.events ?? []).find(
    (event) => event.type === "block.place" && event.actorType === "player" && JSON.stringify(event.pos) === JSON.stringify(LAMP4_TARGET),
  );
  evidence.steps.readyRightClick.playerPlaceEvent = playerPlaceEvent ?? null;
  check("b1.player.event-actorType-player", !!playerPlaceEvent, playerPlaceEvent);

  // 确认（simulate=false，按真实世界评分）→ 3 星
  const confirm = await engine.playerBeat(l01Session, false);
  const confirmResult = resultProjection(confirm.json?.result);
  evidence.steps.confirm = { status: confirm.status, state: confirm.json?.state, result: confirmResult };
  check("b1.confirm.passed", confirmResult?.passed === true, { passed: confirmResult?.passed, failures: confirmResult?.failures });
  check("b1.confirm.stars-3", confirmResult?.stars === 3, confirmResult?.stars);
  check(
    "b1.confirm.progress-all-true",
    (confirmResult?.progress ?? []).length >= 3 && (confirmResult?.progress ?? []).every((step) => step.passed === true),
    confirmResult?.progress,
  );

  // =========================================================== B-3 纯净：L02→L01→L03→L01
  const cycles = [];
  for (const levelId of ["L02", "L01", "L03", "L01"]) {
    const cycleCreated = await engine.createSession(levelId);
    await sleep(1500);
    const health = await engine.health();
    const inventory = await rpcInventory();
    const items = inventoryItemsOf(inventory);
    const l02Blocks = await rpcWorldBlocks(cycleCreated.json.sessionId, L02_SIGNATURES);
    const pluginHealthCycle = await rpc.call("health");
    const npcCount = Array.isArray(pluginHealthCycle?.npcs) ? pluginHealthCycle.npcs.length : null;
    const cycle = {
      levelId,
      createMs: cycleCreated.createMs,
      pluginSessionId: health?.mc?.sessionId,
      inventoryItems: items,
      lantern: inventoryCount(items, "lantern"),
      cake: inventoryCount(items, "cake"),
      playerKit: inventory?.playerKit ?? null,
      l02Blocks,
      l02BlocksAir: blocksAir(l02Blocks),
      npcCount,
      botEntities: (() => {
        const byName = {};
        for (const entity of Object.values(player.entities ?? {})) {
          const key = entity.name ?? entity.type ?? "?";
          byName[key] = (byName[key] ?? 0) + 1;
        }
        return byName;
      })(),
      playerPos: fmtPos(player.entity.position),
    };
    cycles.push(cycle);
    log(`cycle ${levelId}: lantern=${cycle.lantern} cake=${cycle.cake} l02Air=${cycle.l02BlocksAir} npc=${cycle.npcCount}`);
  }
  evidence.steps.purityCycles = cycles;
  const l01Cycles = cycles.filter((cycle) => cycle.levelId === "L01");
  check(
    "b3.l01-inventory-only-lantern",
    l01Cycles.length >= 1 && l01Cycles.every((cycle) => cycle.cake === 0 && cycle.lantern >= 1),
    l01Cycles.map((cycle) => ({ level: cycle.levelId, cake: cycle.cake, lantern: cycle.lantern })),
  );
  check(
    "b3.l02-blocks-gone-in-l01",
    l01Cycles.every((cycle) => cycle.l02BlocksAir === true),
    l01Cycles.map((cycle) => ({ level: cycle.levelId, blocks: cycle.l02Blocks })),
  );
  const l01NpcCounts = l01Cycles.map((cycle) => cycle.npcCount);
  check(
    "b3.npc-count-not-accumulating",
    l01NpcCounts.length >= 2 && new Set(l01NpcCounts).size === 1,
    { l01NpcCounts, allNpcCounts: cycles.map((cycle) => [cycle.levelId, cycle.npcCount]) },
  );

  // =========================================================== B-4 重置彻底
  const healthBeforeReset = await engine.health();
  const pluginSessionId = healthBeforeReset.mc.sessionId;
  const pluginStatusBeforeReset = await rpc.call("health");
  const playerSpawn = pluginStatusBeforeReset?.playerSpawn;
  const engineSessionId = cycles.at(-1).pluginSessionId;
  evidence.steps.reset = { playerSpawn, pluginSessionId };
  // 找到当前 engine session id（最后一次 createSession 的响应）
  const currentEngineSessionId = (await engine.health()) && null;
  // 上面的 health 只给插件 session id；引擎 session id 用最后一次 createSession 记录。
  // 这里从最近一次 create 的响应里取（cycles 循环中没保存 engine id，重新查 SSE 不必要：用 health.mc.sessionId 做 RPC，HTTP 重置用最后一次 createSession id）
  void engineSessionId;
  void currentEngineSessionId;

  // 用 RPC 直接改世界/读世界；HTTP reset 需要一个 engine session id，所以最后再建一次 L01 并记下 id 做重置验收。
  const resetCreated = await engine.createSession("L01");
  const resetSession = resetCreated.json.sessionId;
  await sleep(2500);
  const resetHealth = await engine.health();
  const resetPluginSession = resetHealth.mc.sessionId;
  evidence.steps.reset.engineSession = resetSession;
  evidence.steps.reset.pluginSession = resetPluginSession;
  evidence.steps.reset.playerSpawn = (await rpc.call("health"))?.playerSpawn;

  await teleportPlayer([4, 11, 14]);
  // 挖掉小径 (0,10,14)
  const digTarget = new Vec3(0, 10, 14);
  const beforeDig = player.blockAt(digTarget)?.name ?? null;
  try {
    await player.dig(player.blockAt(digTarget));
  } catch (error) {
    log("dig failed:", error.message);
  }
  await sleep(700);
  const afterDig = player.blockAt(digTarget)?.name ?? null;
  // 乱放灯笼：先站到相邻格 (4,11,15)，否则玩家自己占着目标格，服务端会拒绝放置。
  await teleportPlayer([4, 11, 15]);
  let placed = false;
  for (let attempt = 0; attempt < 3 && !placed; attempt += 1) {
    const item = player.inventory.items().find((entry) => entry.name.includes("lantern"));
    if (!item) break;
    await player.equip(item, "hand");
    const ref = player.blockAt(new Vec3(4, 10, 14));
    if (!ref) break;
    await player.lookAt(ref.position.offset(0.5, 0.5, 0.5), true);
    try {
      await player.placeBlock(ref, new Vec3(0, 1, 0));
      await sleep(400);
      if (player.blockAt(new Vec3(4, 11, 14))?.name.includes("lantern")) placed = true;
    } catch (error) {
      log(`place attempt ${attempt + 1} failed:`, error.message);
      await sleep(500);
    }
  }
  // 丢 2 个物品
  let tossed = 0;
  for (let i = 0; i < 2; i += 1) {
    const item = player.inventory.items().find((entry) => entry.name.includes("lantern"));
    if (!item) break;
    try {
      await player.toss(item.type, null, 1);
      tossed += 1;
      await sleep(250);
    } catch {
      break;
    }
  }
  await teleportPlayer([0, 11, 24]); // 走到远处
  await sleep(600);
  const trackedPositions = [[0, 10, 14], [4, 11, 14], ...L02_SIGNATURES];
  const beforeReset = {
    playerPos: fmtPos(player.entity.position),
    inventory: inventoryItemsOf(await rpcInventory()),
    blocks: await rpcWorldBlocks(resetSession, trackedPositions),
    itemEntities: Object.values(player.entities ?? {}).filter((entity) => entity.name === "item").length,
    npcCount: (await rpc.call("health"))?.npcs?.length ?? null,
    tossed,
    placed,
    dig: { beforeDig, afterDig },
  };
  evidence.steps.reset.before = beforeReset;

  const resetRes = await engine.reset(resetSession);
  await sleep(1800);
  const afterReset = {
    resetHttpStatus: resetRes.status,
    resetBody: { ok: resetRes.json?.ok, state: resetRes.json?.state, epoch: resetRes.json?.epoch },
    playerPos: fmtPos(player.entity.position),
    inventory: inventoryItemsOf(await rpcInventory()),
    blocks: await rpcWorldBlocks(resetSession, trackedPositions),
    itemEntities: Object.values(player.entities ?? {}).filter((entity) => entity.name === "item").length,
    npcCount: (await rpc.call("health"))?.npcs?.length ?? null,
    snapshotEvents: (resetRes.json?.snapshot?.events ?? []).length,
  };
  evidence.steps.reset.after = afterReset;
  check("b4.dig-restored", afterReset.blocks["0,10,14"] !== "minecraft:air", { beforeDig, afterDig, after: afterReset.blocks["0,10,14"] });
  check("b4.misplaced-cleared", placed ? afterReset.blocks["4,11,14"] === "minecraft:air" : false, { placed, after: afterReset.blocks["4,11,14"] });
  // 位置断言（真实比较）
  const spawn = evidence.steps.reset.playerSpawn;
  if (Array.isArray(spawn)) {
    const dx = player.entity.position.x - (spawn[0] + 0.5);
    const dz = player.entity.position.z - (spawn[2] + 0.5);
    const dy = player.entity.position.y - spawn[1];
    check("b4.player-within-1-of-spawn", Math.hypot(dx, dz) <= 1.2 && Math.abs(dy) <= 1.2, { pos: afterReset.playerPos, spawn });
  } else {
    check("b4.player-within-1-of-spawn", false, { reason: "playerSpawn 缺失", spawn });
  }
  check("b4.inventory-back-to-kit", afterReset.inventory.every((item) => item.item === "minecraft:lantern") && inventoryCount(afterReset.inventory, "lantern") >= 1, { before: beforeReset.inventory, after: afterReset.inventory });
  check("b4.dropped-items-removed", afterReset.itemEntities === 0, { tossed, before: beforeReset.itemEntities, after: afterReset.itemEntities });
  check("b4.events-cleared", afterReset.snapshotEvents === 0, { events: afterReset.snapshotEvents });
  check("b4.npc-count-stable", afterReset.npcCount === beforeReset.npcCount, { before: beforeReset.npcCount, after: afterReset.npcCount });
  const hashA = await rpc.call("world.reset", { sessionId: resetPluginSession });
  await sleep(600);
  const hashB = await rpc.call("world.reset", { sessionId: resetPluginSession });
  evidence.steps.reset.hashes = { a: hashA?.hash, b: hashB?.hash };
  check("b4.double-reset-hash-stable", hashA?.hash != null && hashA.hash === hashB?.hash, evidence.steps.reset.hashes);

  // =========================================================== 日志佐证
  evidence.paperLog = {
    beatActivated: await consoleHits("player beat activated", 4),
    beatComplete: await consoleHits("player beat complete", 4),
    earlyBlocked: await consoleHits("先让灰崽", 4),
    squished: await consoleHits("squished", 4),
  };
  evidence.playerMessages = capture.messages;
  evidence.playerActionBars = capture.actionBars;

  await stream.close();
} catch (error) {
  log("FATAL", error?.stack ?? String(error));
  evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
  check("run.completed", false, { error: error?.message ?? String(error) });
} finally {
  try {
    rpc?.close();
  } catch {
    /* ignore */
  }
  try {
    player?.quit();
  } catch {
    /* ignore */
  }
}

const failed = Object.entries(evidence.checks).filter(([, value]) => !value.ok);
evidence.finishedAt = new Date().toISOString();
evidence.ok = failed.length === 0 && evidence.errors.length === 0;
ensureDir(OUT);
const file = writeJson(path.join(OUT, "l01-acceptance.json"), evidence);
log(`evidence written: ${path.relative(process.cwd(), file)}`);
log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
process.exit(evidence.ok ? 0 : 1);
