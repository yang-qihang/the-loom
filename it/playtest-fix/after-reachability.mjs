// @ts-nocheck
/**
 * B-5 全关卡玩家节拍可达性（插件级快速路径，真实 Paper）：
 * 对 L01–L10：新引擎建会话（prepare 时插件已 playerBeat.arm）→ RPC playerBeat.activate（模拟 ready）
 * → mineflayer 玩家站到目标 2–4 格内、手持本关道具、看向目标、右键 → 断言：
 *   ① playerBeat.status 对应 beat done=true
 *   ② placement 型目标方块变成目标 block，且下一 tick 仍稳定（不被弹出/掉落）
 *   ③ 事件 block.place actorType=player
 * 同时记录每关 GET /api/levels/:id 的 progress（id/text/player）。
 *
 * 用法：ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
 *        npx tsx it/playtest-fix/after-reachability.mjs
 */
import path from "node:path";
import {
  EVIDENCE,
  Engine,
  WsRpc,
  attachPlayerChatCapture,
  createPlayer,
  ensureDir,
  fmtPos,
  gitHead,
  loadVec3,
  sleep,
  waitSpawn,
  writeJson,
} from "./lib.mjs";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:4321";
const MC_RPC_URL = process.env.MC_RPC_URL ?? "ws://127.0.0.1:8766";
const MC_PORT = Number(process.env.MC_PORT ?? 25566);
const PLAYER_NAME = process.env.PLAYER_NAME ?? `ReachP${String(process.pid).slice(-3)}`;
const OUT = path.join(EVIDENCE, "after");
const LEVELS = ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10"];
// 有「玩家亲手完成」类目标的关卡 progress 里带 player:true；纯织偶/世界目标的关卡不带。
const LEVELS_WITH_PLAYER_STEP = new Set(["L01", "L03", "L05", "L08", "L10"]);

const evidence = {
  task: "verifier B-5 全关卡玩家节拍可达性 + 10 关 progress",
  phase: "after",
  head: gitHead(),
  startedAt: new Date().toISOString(),
  environment: { engine: ENGINE_URL, rpc: MC_RPC_URL, paperPort: MC_PORT, player: PLAYER_NAME },
  levels: {},
  checks: {},
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

const normalizeItem = (item) => String(item).replace(/^minecraft:/, "");
const inventoryOf = (inventory, name = PLAYER_NAME) => (inventory?.players ?? []).find((entry) => entry.name === name)?.items ?? [];
const findItem = (items, wanted) => {
  const normalized = normalizeItem(wanted);
  return items.find((item) => normalizeItem(item.item) === normalized);
};
const isSolidName = (name) => !!name && name !== "air" && !name.includes("water") && !name.includes("leaves") && name !== "torch" && name !== "sign";

/**
 * 在目标附近找「能站的脚位」候选列表（下方实心、脚/头空气），眼睛到目标中心 <=5.5 格。
 * 排序优先靠近本关地面高度（真实玩家能走到的地面），其次眼睛距离。
 */
const findStandCandidates = (target, groundY) => {
  const [tx, ty, tz] = target;
  const candidates = [];
  const radius = 8;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let y = ty + 8; y >= ty - 8; y -= 1) {
        if (dx === 0 && dz === 0 && y === ty) continue;
        const below = player.blockAt(new Vec3(tx + dx, y - 1, tz + dz));
        const feet = player.blockAt(new Vec3(tx + dx, y, tz + dz));
        const head = player.blockAt(new Vec3(tx + dx, y + 1, tz + dz));
        if (!below || !feet || !head) continue;
        if (!isSolidName(below.name) || feet.name !== "air" || head.name !== "air") continue;
        const eyeDistance = Math.hypot(tx + 0.5 - (tx + dx + 0.5), ty + 0.5 - (y + 1.62), tz + 0.5 - (tz + dz + 0.5));
        if (eyeDistance > 5.5 || eyeDistance < 1.0) continue;
        candidates.push({ feet: [tx + dx, y, tz + dz], eyeDistance, groundDelta: groundY == null ? 99 : Math.abs(y - groundY) });
      }
    }
  }
  candidates.sort((a, b) => a.groundDelta - b.groundDelta || a.eyeDistance - b.eyeDistance);
  return candidates;
};

/** 玩家出生点是否被实心方块围死（6 邻居都实心 → 真实玩家进得去出不来）。 */
const isEnclosedCell = (pos) => {
  if (!pos) return null;
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const solid = neighbors.map(([dx, dy, dz]) => {
    const block = player.blockAt(new Vec3(pos[0] + dx, pos[1] + dy, pos[2] + dz));
    return block ? isSolidName(block.name) : null;
  });
  return { solidNeighbors: solid, enclosed: solid.every((value) => value === true) };
};

const teleport = async (sessionId, feet, yaw = 0, pitch = 0) => {
  await rpc.call("player.teleport", { sessionId, name: PLAYER_NAME, pos: feet, yaw, pitch });
  await sleep(900);
};

const worldBlocks = async (sessionId, positions) => (await rpc.call("world.blocks", { sessionId, positions }))?.blocks ?? {};

try {
  ensureDir(OUT);
  Vec3 = await loadVec3();
  const health0 = await engine.health();
  evidence.environment.engineHealth = { ok: health0?.ok, port: health0?.port, mc: health0?.mc };
  check("engine.paper-mode", health0?.ok === true && health0?.port === "paper", { ok: health0?.ok, port: health0?.port });
  rpc = await WsRpc.connect(MC_RPC_URL);
  const pluginHealth = await rpc.call("health");
  evidence.environment.pluginHealth = pluginHealth;
  check("plugin.playerBeat-rpc", pluginHealth?.playerBeat !== undefined, Object.keys(pluginHealth ?? {}));

  player = await createPlayer({ name: PLAYER_NAME, port: MC_PORT, log: (line) => log(line) });
  capture = attachPlayerChatCapture(player);
  await waitSpawn(player, { log: (line) => log(line) });
  await sleep(600);

  // ---- 每关 progress 契约（/api/levels/:id） ----
  for (const levelId of LEVELS) {
    const res = await engine.levelDef(levelId);
    const def = res.json?.def;
    evidence.levels[levelId] = evidence.levels[levelId] ?? {};
    evidence.levels[levelId].progressApi = {
      status: res.status,
      progress: def?.progress ?? null,
      playerBeatHint: def?.task?.playerBeatHint ?? null,
    };
    const steps = def?.progress ?? [];
    check(
      `${levelId}.progress-shape`,
      Array.isArray(steps) &&
        steps.length >= 2 &&
        steps.length <= 3 &&
        steps.every((step) => step.id && step.text) &&
        steps.every((step) => (step.player === true) === LEVELS_WITH_PLAYER_STEP.has(levelId) || step.player === undefined || step.player === false) &&
        steps.some((step) => step.player === true) === LEVELS_WITH_PLAYER_STEP.has(levelId),
      { length: steps.length, ids: steps.map((step) => step.id), players: steps.map((step) => !!step.player) },
    );
    if (!def) evidence.errors.push(`${levelId}: 未知关卡`);
  }

  // ---- 逐关建会话 + 玩家节拍可达性 ----
  for (const levelId of LEVELS) {
    const levelEvidence = evidence.levels[levelId];
    const t0 = Date.now();
    try {
      const created = await engine.createSession(levelId);
      levelEvidence.create = { status: created.status, createMs: created.createMs, state: created.json?.state };
      if (created.status !== 201) throw new Error(`createSession HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`);
      await sleep(2800);
      const health = await engine.health();
      const pluginSessionId = health.mc.sessionId;
      const pluginStatus = await rpc.call("health");
      const spawn = pluginStatus?.playerSpawn;
      const spawnBlock = spawn ? player.blockAt(new Vec3(...spawn))?.name ?? null : null;
      const spawnAnalysis = spawn ? { pos: spawn, block: spawnBlock, ...isEnclosedCell(spawn) } : null;
      levelEvidence.pluginSession = {
        sessionId: pluginSessionId,
        groundY: pluginStatus?.groundY,
        playerSpawn: spawn,
        spawnBlock,
        spawnAnalysis,
        npcs: pluginStatus?.npcs,
        checkpointSize: pluginStatus?.checkpointSize,
      };
      check(`${levelId}.session-ready`, health?.mc?.prepared === true && !!pluginSessionId, { prepared: health?.mc?.prepared, sessionId: pluginSessionId });
      check(
        `${levelId}.player-spawn-usable`,
        spawnAnalysis ? spawnAnalysis.enclosed === false : false,
        spawnAnalysis,
      );

      const statusBefore = await rpc.call("playerBeat.status", { sessionId: pluginSessionId });
      const beats = statusBefore?.beats ?? [];
      levelEvidence.playerBeatArm = {
        armed: statusBefore?.armed,
        active: statusBefore?.active,
        hint: statusBefore?.hint,
        items: statusBefore?.items,
        beats,
      };
      check(`${levelId}.playerBeat-armed`, statusBefore?.armed === true && beats.length > 0 && statusBefore?.active === false, { armed: statusBefore?.armed, beats: beats.length, active: statusBefore?.active });

      // 插件级快速路径：绕过引擎门控直接 activate（模拟 ready 后）
      const activated = await rpc.call("playerBeat.activate", { sessionId: pluginSessionId });
      levelEvidence.activate = { ok: activated?.ok, active: activated?.active, hint: activated?.hint };
      check(`${levelId}.activate`, activated?.ok === true && activated?.active === true, { ok: activated?.ok, active: activated?.active, hint: activated?.hint });
      await sleep(400);

      const inventory = await rpc.call("player.inventory", {});
      const items = inventoryOf(inventory);
      levelEvidence.inventory = items;
      const beatResults = [];
      for (let index = 0; index < beats.length; index += 1) {
        const beat = beats[index];
        const target = beat.pos;
        const targetKey = target.join(",");
        const blockBefore = (await worldBlocks(pluginSessionId, [target]))[targetKey];
        const isPlace = blockBefore === "minecraft:air" || !blockBefore;
        // 虚拟物品（loom_thread / splash_potion / potion …）不是可放置方块：插件只发事件+特效，不动世界。
        const targetBlockName = normalizeItem(beat.block ?? "");
        const isVirtualBlock = !player.registry?.blocksByName?.[targetBlockName];
        const groundY = pluginStatus?.groundY;
        const standCandidates = findStandCandidates(target, groundY);
        const record = {
          index,
          target,
          block: beat.block,
          type: isPlace ? "place" : "interact",
          virtualBlock: isVirtualBlock,
          blockBefore,
          standCandidates: standCandidates.slice(0, 6).map((candidate) => candidate.feet),
        };
        if (standCandidates.length === 0) {
          record.error = "没有找到可站立的位置";
          beatResults.push(record);
          check(`${levelId}.beat${index}.stand-found`, false, { target });
          check(`${levelId}.beat${index}.done`, false, { target, error: record.error });
          continue;
        }
        check(`${levelId}.beat${index}.stand-found`, true, { target, candidates: record.standCandidates.slice(0, 4) });
        let stand = standCandidates[0];
        // 手持本关道具（place 型必需；interact 型直接敲目标方块，空手也行）
        let held = null;
        for (const wanted of statusBefore?.items ?? []) {
          const found = findItem(items, wanted);
          if (found) {
            const stack = player.inventory.items().find((entry) => `minecraft:${entry.name}` === wanted || entry.name === normalizeItem(wanted));
            if (stack) {
              await player.equip(stack, "hand");
              held = wanted;
              break;
            }
          }
        }
        if (!held && isPlace) {
          // 道具名对不上时退回任意道具（插件容错要求手持 beatItems 之一或目标 block）
          const fallback = player.inventory.items()[0];
          if (fallback) {
            await player.equip(fallback, "hand");
            held = `minecraft:${fallback.name}`;
          }
        }
        record.held = held;
        let done = false;
        for (let attempt = 1; attempt <= 4 && !done; attempt += 1) {
          const candidate = standCandidates[Math.min(attempt - 1, standCandidates.length - 1)] ?? stand;
          stand = candidate;
          await teleport(pluginSessionId, stand.feet);
          await player.lookAt(new Vec3(target[0] + 0.5, target[1] + 0.5, target[2] + 0.5), true);
          await sleep(350);
          const eye = player.entity.position.offset(0, player.entity.eyeHeight ?? 1.62, 0);
          const targetCenter = new Vec3(target[0] + 0.5, target[1] + 0.5, target[2] + 0.5);
          const distance = eye.distanceTo(targetCenter);
          record.attempt = { attempt, eye: [eye.x, eye.y, eye.z], distance, hand: player.heldItem?.name ?? null };
          try {
            if (!isPlace) {
              const targetBlock = player.blockAt(new Vec3(...target));
              if (targetBlock) await player.activateBlock(targetBlock);
              else await player.activateItem();
            } else {
              // 对着柱子/空气右键：插件容错路径（手持道具 + 6 格内 + 视线点积≥0.7）
              const nearby = player.blockAt(stand.feet ? new Vec3(stand.feet[0] + 2, stand.feet[1] + 1, stand.feet[2]) : new Vec3(...target));
              if (nearby && nearby.name !== "air" && Math.random() > 0.5) await player.activateBlock(nearby).catch(() => player.activateItem());
              else await player.activateItem();
            }
          } catch (error) {
            record.attempt.error = error?.message ?? String(error);
          }
          await sleep(700);
          const statusNow = await rpc.call("playerBeat.status", { sessionId: pluginSessionId });
          done = statusNow?.beats?.[index]?.done === true;
          record.attempt.done = done;
          if (!done) {
            // 换下一个候选站姿再试
            stand = standCandidates[Math.min(attempt, standCandidates.length - 1)] ?? stand;
          }
        }
        await sleep(300);
        const blockAfter = (await worldBlocks(pluginSessionId, [target]))[targetKey];
        const statusAfter = await rpc.call("playerBeat.status", { sessionId: pluginSessionId });
        await sleep(600);
        const blockNextTick = (await worldBlocks(pluginSessionId, [target]))[targetKey];
        let playerEvent = null;
        try {
          const snapshot = await rpc.call("world.snapshot", { levelId, sessionId: pluginSessionId });
          playerEvent = (snapshot?.events ?? []).find(
            (event) =>
              event.type === "block.place" && event.actorType === "player" && Array.isArray(event.pos) && event.pos.join(",") === targetKey,
          ) ?? null;
        } catch {
          /* snapshot 失败不致命 */
        }
        record.done = statusAfter?.beats?.[index]?.done === true;
        record.blockAfter = blockAfter;
        record.blockNextTick = blockNextTick;
        record.stableNextTick = blockNextTick === blockAfter;
        record.playerPlaceEvent = playerEvent;
        record.expectedBlock = beat.block;
        record.blockMatchesExpected = blockAfter === beat.block;
        record.statusAfter = statusAfter;
        beatResults.push(record);
        check(`${levelId}.beat${index}.done`, record.done === true, { target, block: beat.block, type: record.type, held: record.held, blockAfter, attempts: record.attempt });
        check(`${levelId}.beat${index}.stable`, record.stableNextTick === true, { blockAfter, blockNextTick });
        if (isPlace && !isVirtualBlock) {
          check(`${levelId}.beat${index}.block-placed`, record.blockMatchesExpected === true, { expected: beat.block, actual: blockAfter });
        } else if (isPlace && isVirtualBlock) {
          // 虚拟物品：世界方块应保持空气，只发事件
          check(`${levelId}.beat${index}.virtual-no-block`, blockAfter === "minecraft:air" || blockAfter == null, { block: beat.block, blockAfter });
        }
        check(`${levelId}.beat${index}.event-actorType-player`, !!playerEvent, playerEvent ? { pos: playerEvent.pos, block: playerEvent.data?.block } : null);
      }
      const statusFinal = await rpc.call("playerBeat.status", { sessionId: pluginSessionId });
      levelEvidence.beats = beatResults;
      levelEvidence.finalStatus = { done: statusFinal?.done, active: statusFinal?.active, hint: statusFinal?.hint };
      levelEvidence.actionBars = capture.actionBars.slice(-10);
      levelEvidence.totalMs = Date.now() - t0;
      log(`${levelId}: beats done=${beatResults.filter((beat) => beat.done).length}/${beatResults.length} (${levelEvidence.totalMs}ms)`);
    } catch (error) {
      levelEvidence.fatal = error?.message ?? String(error);
      log(`${levelId} FATAL`, levelEvidence.fatal);
      evidence.errors.push(`${levelId}: ${levelEvidence.fatal}`);
      check(`${levelId}.completed`, false, { error: levelEvidence.fatal });
    }
  }

  // ---- 汇总 ----
  const allBeats = LEVELS.flatMap((levelId) => evidence.levels[levelId]?.beats ?? []);
  evidence.summary = {
    levels: LEVELS.length,
    beats: allBeats.length,
    doneBeats: allBeats.filter((beat) => beat.done).length,
    unstableBeats: allBeats.filter((beat) => beat.done && beat.stableNextTick === false).map((beat) => ({ target: beat.target, after: beat.blockAfter, next: beat.blockNextTick })),
    playerEventMissing: allBeats.filter((beat) => beat.done && !beat.playerPlaceEvent).map((beat) => beat.target),
    failedLevels: LEVELS.filter((levelId) => !evidence.levels[levelId]?.beats || evidence.levels[levelId].beats.some((beat) => !beat.done)),
  };
  check(
    "b5.all-levels-player-beat-reachable",
    evidence.summary.failedLevels.length === 0 && evidence.summary.doneBeats === evidence.summary.beats && evidence.summary.beats > 0,
    evidence.summary,
  );
  evidence.playerActionBars = capture.actionBars;
  evidence.playerMessages = capture.messages;
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
const file = writeJson(path.join(OUT, "all-levels-reachability.json"), evidence);
log(`evidence written: ${path.relative(process.cwd(), file)}`);
log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
process.exit(evidence.ok ? 0 : 1);
