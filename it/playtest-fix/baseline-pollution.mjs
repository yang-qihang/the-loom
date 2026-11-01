// @ts-nocheck
/**
 * A-2/A-3/A-4 基线复现（修复前 HEAD f1e40eb 快照 + 旧插件 jar）：
 *  - A-3 背包污染：玩家离线时开 L02（queue cake）再开 L01（queue lantern，pending 不清）→ 玩家进服同时收到
 *    两关道具，并收到「第 4 盏灯在村道尽头…」的提前提示；玩家在线时反复切关，道具只 add 不清空，越叠越多。
 *  - A-2 世界/实体污染：L02 场景方块残留在 L01 会话；多次 begin 后 NPC 实体累积。
 *  - A-4 reset 不彻底：挖路面会被还原（旧插件 baseBlocks 覆盖范围内），但玩家背包/掉落物/L02 残留不清，
 *    连 reset 两次 hash 是否稳定也一并记录。
 *
 * 用法：ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
 *        npx tsx it/playtest-fix/baseline-pollution.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE,
  Engine,
  WsRpc,
  attachPlayerChatCapture,
  connectPlayer,
  createPlayer,
  ensureDir,
  fmtPos,
  gitHead,
  inventoryOf,
  loadVec3,
  sleep,
  waitSpawn,
  writeJson,
} from "./lib.mjs";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:4321";
const MC_RPC_URL = process.env.MC_RPC_URL ?? "ws://127.0.0.1:8766";
const PLAYER_NAME = process.env.PLAYER_NAME ?? `BaseH${String(process.pid).slice(-3)}`;
const PAPER_LOG = path.join(process.cwd(), "tmp", "verify", "paper", "console.log");
const OUT = path.join(EVIDENCE, "baseline");

const evidence = {
  task: "verifier A-2/A-3/A-4 基线：背包污染 / 世界实体污染 / reset 不彻底",
  phase: "baseline",
  head: gitHead(),
  startedAt: new Date().toISOString(),
  environment: { engine: ENGINE_URL, rpc: MC_RPC_URL, paper: `${process.env.MC_HOST ?? "127.0.0.1"}:${process.env.MC_PORT ?? 25566}`, player: PLAYER_NAME },
  steps: {},
  checks: {},
  errors: [],
};
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const check = (id, ok, detail) => {
  evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
  log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
  if (!ok) evidence.errors.push(id);
  return !!ok;
};

const engine = new Engine(ENGINE_URL);
const L02_SIGNATURES = [
  [4, 65, -6], // cakeTower 底座 stone_bricks
  [0, 64, -7], // 谷仓地板 oak_planks
  [-20, 65, -1], // 干草垛 hay_block
  [3, 64, 8], // 水槽 water
];
const L01_SIGNATURES = [
  [0, 10, 14], // 小径（gravel，z=14）
  [2, 14, -2], // 3 号灯位（空气）
  [2, 11, 16], // 4 号灯柱石柱
];
const L02_ENTITIES = [
  [0, 65, 0], // 灰崽 NPC（织偶角色实体）
  [-11, 65, 13], // 母鸡
];

let player = null;
let playerMessages = [];
let playerActionBars = [];
let rpc = null;

const readBlocks = (bot, positions) => {
  const Vec3 = bot.entity.position.constructor;
  const out = {};
  for (const [x, y, z] of positions) {
    const block = bot.blockAt(new Vec3(x, y, z));
    out[`${x},${y},${z}`] = block ? block.name : null;
  }
  return out;
};
const nearbyEntities = (bot, radius = 16) => {
  const me = bot.entity.position;
  const list = [];
  for (const entity of Object.values(bot.entities ?? {})) {
    if (!entity.position) continue;
    if (entity.position.distanceTo(me) > radius) continue;
    list.push({
      type: entity.type,
      name: entity.name ?? entity.username ?? "",
      pos: [Math.round(entity.position.x), Math.round(entity.position.y), Math.round(entity.position.z)],
    });
  }
  return list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const itemEntities = (bot, radius = 24) => {
  const me = bot.entity.position;
  return Object.values(bot.entities ?? {}).filter(
    (entity) => (entity.name === "item" || entity.type === "object") && entity.position && entity.position.distanceTo(me) <= radius,
  ).length;
};
const consoleHits = (needle) => {
  try {
    const text = fs.readFileSync(PAPER_LOG, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    return text.split("\n").filter((line) => line.includes(needle)).slice(-8);
  } catch {
    return [];
  }
};

try {
  const health = await engine.health();
  const plugin = health?.mc ?? {};
  evidence.steps.pluginHealth = plugin;
  check("baseline.plugin.no-inventory-rpc", plugin.playerKit === undefined && plugin.checkpointSize === undefined, Object.keys(plugin));

  // ================= P：玩家离线时 prepare L02 → L01（pendingPlayerItems 污染） =================
  const l02a = await engine.createSession("L02");
  check("session.l02a.created", l02a.status === 201, { createMs: l02a.createMs, state: l02a.json?.state });
  const l01a = await engine.createSession("L01");
  check("session.l01a.created", l01a.status === 201, { createMs: l01a.createMs, state: l01a.json?.state });

  // 玩家进服：旧插件 onPlayerJoin 会把两关 pending 道具一起塞进来 + 发提前提示。
  // 采集必须赶在 spawn 前挂：进服瞬间的聊天消息会早于 spawn 事件到达。
  player = await createPlayer({ name: PLAYER_NAME, log: (line) => log(line) });
  const capture = attachPlayerChatCapture(player);
  await waitSpawn(player, { log: (line) => log(line) });
  await sleep(1800);
  const inventoryOnJoin = inventoryOf(player);
  evidence.steps.pendingItems = {
    l02CreateMs: l02a.createMs,
    l01CreateMs: l01a.createMs,
    inventoryOnJoin,
    messagesOnJoin: [...capture.messages],
    actionBarsOnJoin: [...capture.actionBars],
  };
  const joinNames = inventoryOnJoin.items.map((item) => item.name);
  check(
    "baseline.pending.bag-polluted-on-join",
    joinNames.includes("cake") && joinNames.includes("lantern"),
    inventoryOnJoin.items,
  );
  check(
    "baseline.pending.premature-join-hint",
    capture.messages.some((entry) => entry.text.includes("第 4 盏灯")),
    capture.messages.slice(-4),
  );

  // ================= E：L02 场景残留 + 多次 begin 的 NPC 累积 =================
  await sleep(800);
  const l01Session = l01a.json.sessionId;
  const census01 = nearbyEntities(player);
  evidence.steps.l02ResidualInL01 = {
    l02Blocks: readBlocks(player, L02_SIGNATURES),
    l02EntitySpots: readBlocks(player, []),
    l01Blocks: readBlocks(player, L01_SIGNATURES),
    census: census01,
  };
  const residualBlocks = evidence.steps.l02ResidualInL01.l02Blocks;
  check(
    "baseline.world.l02-blocks-remain-in-l01",
    ["stone_bricks", "oak_planks", "hay_block", "water"].filter((_, index) => Object.values(residualBlocks)[index] === ["stone_bricks", "oak_planks", "hay_block", "water"][index]).length >= 3,
    residualBlocks,
  );

  // 玩家在线反复切关：道具只 add 不清 → 叠加；NPC 每次 begin 都再生成一批。
  const sessions = [{ level: "L02", createMs: l02a.createMs, inventory: inventoryOnJoin, census: census01 }];
  let current = l01a.json.sessionId;
  for (const level of ["L02", "L01", "L01"]) {
    const created = await engine.createSession(level);
    await sleep(1200);
    current = created.json.sessionId;
    sessions.push({
      level,
      createMs: created.createMs,
      state: created.json?.state,
      inventory: inventoryOf(player),
      playerPos: fmtPos(player.entity.position),
      census: nearbyEntities(player),
      l02Residual: readBlocks(player, L02_SIGNATURES),
    });
    log(`after create ${level}: inventory=${JSON.stringify(inventoryOf(player).items)} census=${nearbyEntities(player).length}`);
  }
  evidence.steps.sessionChurn = sessions;
  const lastInventory = sessions.at(-1).inventory.items;
  const cakeStacks = lastInventory.filter((item) => item.name === "cake").reduce((sum, item) => sum + item.count, 0);
  const lanternStacks = lastInventory.filter((item) => item.name === "lantern").reduce((sum, item) => sum + item.count, 0);
  check("baseline.inventory.stacks-up-across-levels", cakeStacks >= 8 && lanternStacks >= 8, {
    cakeStacks,
    lanternStacks,
    inventory: lastInventory,
    note: "每关 afterPrepare 只 addItem + setItem(0)，从不 clear；旧插件 giveBotsKit 只清 bot 背包",
  });
  const l01CensusCounts = sessions.filter((entry) => entry.level === "L01").map((entry) => entry.census.length);
  check(
    "baseline.entities.accumulate-per-begin",
    l01CensusCounts.length >= 2 && l01CensusCounts.at(-1) > l01CensusCounts[0],
    { l01CensusCounts, latestCensus: sessions.at(-1).census },
  );
  check(
    "baseline.world.l02-residual-after-l01-recreate",
    Object.values(readBlocks(player, L02_SIGNATURES))[0] === "stone_bricks",
    readBlocks(player, L02_SIGNATURES),
  );

  // ================= R：reset 不彻底 =================
  evidence.steps.reset = {};
  rpc = await WsRpc.connect(MC_RPC_URL);
  const pluginHealth = await rpc.call("health");
  const pluginSessionId = pluginHealth.sessionId;
  evidence.steps.resetPlugin = { pluginSessionId, pluginHealthKeys: Object.keys(pluginHealth) };
  const Vec3 = (await loadVec3());
  const tp = async (pos) => {
    await rpc.call("player.teleport", { sessionId: pluginSessionId, pos, yaw: 0, pitch: 20 });
    await sleep(900);
  };

  // 挖掉一段路面（(0,10,14) 是小径方块，属于旧插件 baseBlocks 覆盖范围 → 预期能还原）。
  await tp([0, 11, 14]);
  const dugTarget = new Vec3(0, 10, 14);
  const beforeDig = player.blockAt(dugTarget)?.name ?? null;
  let digOk = false;
  try {
    const block = player.blockAt(dugTarget);
    await player.dig(block);
    digOk = true;
  } catch (error) {
    log("dig failed:", error.message);
  }
  await sleep(800);
  const afterDig = player.blockAt(dugTarget)?.name ?? null;

  // 在场景里乱放一个灯笼（旧插件 onBlockPlace 会登记 placedPositions → 预期被清掉）。
  // 选 (4,11,14)：在 L01 「走廊净空」过滤范围之外，有苔藓地面承托；玩家站相邻格 (4,11,15)。
  await tp([4, 11, 15]);
  const placeTarget = [4, 11, 14];
  const placedBlock = new Vec3(...placeTarget);
  let placeOk = false;
  for (let attempt = 0; attempt < 3 && !placeOk; attempt += 1) {
    const lanternItem = player.inventory.items().find((item) => item.name === "lantern");
    if (!lanternItem) break;
    await player.equip(lanternItem, "hand");
    const ref = player.blockAt(new Vec3(4, 10, 14));
    if (!ref) break;
    await player.lookAt(ref.position.offset(0.5, 0.5, 0.5), true);
    try {
      await player.placeBlock(ref, new Vec3(0, 1, 0));
      await sleep(400);
      if (player.blockAt(placedBlock)?.name === "lantern") placeOk = true;
    } catch (error) {
      log(`place attempt ${attempt + 1} failed:`, error.message);
      await sleep(600);
    }
  }
  await sleep(500);
  const afterPlace = player.blockAt(placedBlock)?.name ?? null;

  // 丢几个物品（旧 reset 不清理掉落物实体）；丢完立刻传送离开，避免 0.5s 拾取延迟内被捡回。
  let tossed = 0;
  const item = player.inventory.items().find((entry) => entry.name === "lantern");
  if (item) {
    try {
      await player.toss(item.type, null, 2);
      tossed = 2;
    } catch (error) {
      log("toss failed:", error.message);
    }
  }
  // 玩家走到场景远处（不额外 sleep，抢在拾取前离开）。
  await tp([0, 11, 24]);
  await sleep(500);
  const beforeReset = {
    playerPos: fmtPos(player.entity.position),
    inventory: inventoryOf(player),
    blocks: readBlocks(player, [[0, 10, 14], placeTarget, ...L02_SIGNATURES]),
    census: nearbyEntities(player, 24),
    itemEntities: itemEntities(player, 32),
    tossed,
  };
  evidence.steps.reset.before = beforeReset;

  const resetRes = await engine.reset(current);
  await sleep(1500);
  const afterReset = {
    resetHttpStatus: resetRes.status,
    resetBody: resetRes.json,
    playerPos: fmtPos(player.entity.position),
    inventory: inventoryOf(player),
    blocks: readBlocks(player, [[0, 10, 14], placeTarget, ...L02_SIGNATURES]),
    nearbyCensus: nearbyEntities(player, 24),
    itemEntities: itemEntities(player, 32),
    eventsInSnapshot: (resetRes.json?.snapshot?.events ?? []).length,
    npcCountInSnapshot: Object.keys(resetRes.json?.snapshot?.npcs ?? {}).length,
  };
  evidence.steps.reset.after = afterReset;
  evidence.steps.reset.digPlace = { beforeDig, afterDig, digOk, placeOk, afterPlace };

  check("baseline.reset.tracked-block-restored", afterReset.blocks["0,10,14"] !== "air", { beforeDig, afterDig, after: afterReset.blocks["0,10,14"] });
  check(
    "baseline.reset.placed-block-cleared",
    placeOk ? afterReset.blocks[placeTarget.join(",")] === "air" : false,
    { placeOk, afterPlace, after: afterReset.blocks[placeTarget.join(",")] },
  );
  check(
    "baseline.reset.player-back-to-spawn",
    Math.hypot(player.entity.position.x - 2.5, player.entity.position.z - 4.5) <= 1 && Math.abs(player.entity.position.y - 11) <= 1,
    { pos: afterReset.playerPos, expected: "playerSpawn (2.5, 11, 4.5)" },
  );
  check(
    "baseline.reset.inventory-NOT-reset",
    (afterReset.inventory.items.filter((item) => item.name === "cake").length > 0) ||
      afterReset.inventory.items.filter((item) => item.name === "lantern").reduce((sum, item) => sum + item.count, 0) > 8,
    { before: beforeReset.inventory.items, after: afterReset.inventory.items },
  );
  check("baseline.reset.dropped-items-remain", afterReset.itemEntities > 0, { tossed, before: beforeReset.itemEntities, after: afterReset.itemEntities });
  check(
    "baseline.reset.l02-residual-blocks-remain",
    afterReset.blocks["4,65,-6"] === "stone_bricks",
    afterReset.blocks,
  );
  check("baseline.reset.events-cleared", afterReset.eventsInSnapshot === 0, { events: afterReset.eventsInSnapshot });

  // 连续两次 world.reset 的 checkpoint hash 是否稳定（旧插件只对 baseBlocks 做 hash）。
  const hashA = await rpc.call("world.reset", { sessionId: pluginSessionId });
  await sleep(600);
  const hashB = await rpc.call("world.reset", { sessionId: pluginSessionId });
  await sleep(600);
  evidence.steps.reset.hashes = { a: hashA?.hash, b: hashB?.hash, aMs: hashA?.ms, bMs: hashB?.ms };
  check("baseline.reset.hash-stable", hashA?.hash != null && hashA.hash === hashB?.hash, evidence.steps.reset.hashes);

  evidence.playerMessages = capture.messages;
  evidence.playerActionBars = capture.actionBars;
  evidence.paperLog = {
    squishedLines: consoleHits("squished"),
    lostConnectionLines: consoleHits("lost connection").slice(-4),
  };
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
const file = writeJson(path.join(OUT, "pollution-reset.json"), evidence);
log(`evidence written: ${path.relative(process.cwd(), file)}`);
log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
process.exit(evidence.ok ? 0 : 1);
