// @ts-nocheck
/**
 * A-1 基线复现：L01 目标真值与「提示过早」（修复前 HEAD f1e40eb 快照 + 旧插件 jar）
 *
 * 复现用户反馈 1：
 *  - starter 只点亮 1 盏 → 旧 Studio 目标 0 永远不打勾；result 一失败就判 waitingForPlayer
 *    → 「轮到你」卡片 + 第 4 盏灯 guide + 游戏内 actionbar 提前弹出。
 *  - 参考解（灰崽点 3 盏、走到 4 号灯下、回艾拉身边）→ 目标 0 仍不打勾（它映射到 four-lamps-lit，
 *    要求 4 盏全亮）；引擎没有 progress / playerBeatReady 字段。
 *
 * 用法：ENGINE_URL=http://127.0.0.1:4321 npx tsx it/playtest-fix/baseline-l01-progress.mjs
 */
import path from "node:path";
import {
  EVIDENCE,
  Engine,
  EventStream,
  attachPlayerChatCapture,
  connectPlayer,
  ensureDir,
  eventSummary,
  fmtPos,
  gitHead,
  inventoryOf,
  now,
  oldStudioGoalPanel,
  oldStudioWaitingForPlayer,
  resultProjection,
  sleep,
  writeJson,
} from "./lib.mjs";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:4321";
const PLAYER_NAME = process.env.PLAYER_NAME ?? `BaseP${String(process.pid).slice(-3)}`;
const OUT = path.join(EVIDENCE, "baseline");

const evidence = {
  task: "verifier A-1 基线：L01 目标不更新 + 提示过早",
  phase: "baseline",
  head: gitHead(),
  startedAt: new Date().toISOString(),
  environment: { engine: ENGINE_URL, paper: `${process.env.MC_HOST ?? "127.0.0.1"}:${process.env.MC_PORT ?? 25566}`, player: PLAYER_NAME },
  steps: {},
  checks: {},
  events: {},
  errors: [],
};
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const check = (id, ok, detail) => {
  evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
  log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail));
  if (!ok) evidence.errors.push(id);
  return !!ok;
};

const engine = new Engine(ENGINE_URL);
let player = null;
let stream = null;

try {
  const health = await engine.health();
  evidence.environment.engineHealth = health;
  check("engine.paper-mode", health?.ok === true && health?.port === "paper", { ok: health?.ok, port: health?.port });

  // ---- 真实玩家先上线：afterPrepare 的 player.give 才会发到人身上 ----
  player = await connectPlayer({
    name: PLAYER_NAME,
    log: (line) => log(line),
  });
  const capture = attachPlayerChatCapture(player);
  await sleep(400);

  // ---- 创建 L01 会话（真实 Paper 场景准备） ----
  const created = await engine.createSession("L01");
  evidence.steps.create = {
    status: created.status,
    createMs: created.createMs,
    sessionId: created.json?.sessionId,
    state: created.json?.state,
    epoch: created.json?.epoch,
    port: created.json?.port,
    sceneAgents: created.json?.snapshot?.agents,
    sceneNpcs: Object.keys(created.json?.snapshot?.npcs ?? {}),
    playerInventoryAfterPrepare: inventoryOf(player),
  };
  if (created.status !== 201) throw new Error(`创建会话失败 HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 500)}`);
  const sessionId = created.json.sessionId;
  check("session.created", created.status === 201 && !!sessionId, { sessionId, createMs: created.createMs });

  stream = new EventStream(engine, sessionId).start();
  // 场景 finalize 会把织偶从世界出生点传送到场景台面；客户端区块要 2–4s 才流式加载完，
  // 否则 pathfinder 看不到地形会报 "Path was stopped before it could be completed"。
  await sleep(4000);
  evidence.steps.create.snapshotAgents = created.json?.snapshot?.agents ?? null;

  const levelRes = await engine.levelDef("L01");
  const def = levelRes.json?.def;
  const starterCode = levelRes.json?.starterCode;
  evidence.steps.levelApi = {
    status: levelRes.status,
    hasProgressField: Object.prototype.hasOwnProperty.call(def ?? {}, "progress"),
    progress: def?.progress ?? null,
    playerBeatHint: def?.task?.playerBeatHint ?? null,
    criteriaIds: (def?.task?.successCriteria ?? []).map((c) => c.id),
    hasStarter: typeof starterCode === "string" && starterCode.length > 0,
  };
  check("level-api.no-progress-field", evidence.steps.levelApi.hasProgressField === false, evidence.steps.levelApi.hasProgressField);

  // ---------- 场景 1：starter（只写第 1 盏灯） ----------
  // 真实 Paper 上织偶首跑偶尔会因传送后区块未加载完 pathfinder 失败（criteria=[]）；
  // 这是环境抖动不是被测缺陷，失败后 reset 重试，重试过程原样记入证据。
  const starterAttempts = [];
  let starterEvent = null;
  for (let attempt = 1; attempt <= 3 && !starterEvent; attempt += 1) {
    const run = await engine.run(sessionId, starterCode);
    const resultEvent = await stream.waitFor(
      (entry) => entry.e.type === "result" && entry.e.runId === run.json?.runId,
      240_000,
      "starter result",
    );
    const projection = resultProjection(resultEvent.e);
    starterAttempts.push({ attempt, runId: run.json?.runId, criteriaCount: projection?.criteria?.length ?? 0, failures: projection?.failures });
    if ((projection?.criteria?.length ?? 0) > 0) {
      starterEvent = resultEvent.e;
    } else {
      log(`starter attempt ${attempt} 环境抖动（criteria=[]），reset 后重试`);
      await engine.reset(sessionId);
      await sleep(2500);
    }
  }
  if (!starterEvent) throw new Error("starter 三次都没有跑到真实评分（织偶 pathfinder 持续失败）");
  const starterRunId = starterEvent.runId;
  const starterProj = resultProjection(starterEvent);
  const starterPanel = oldStudioGoalPanel(starterEvent);
  evidence.steps.starter = {
    attempts: starterAttempts,
    runId: starterRunId,
    result: starterProj,
    oldStudioPanel: starterPanel,
    oldStudioWaitingForPlayer: oldStudioWaitingForPlayer(starterEvent),
    playerInventoryAfterRun: inventoryOf(player),
    actionBarsSoFar: [...capture.actionBars],
    messagesSoFar: [...capture.messages],
  };
  check("baseline.starter.goal0-not-done", starterPanel?.goals?.[0]?.done === false, starterPanel?.goals);
  check(
    "baseline.starter.premature-waiting",
    starterPanel?.waitingForPlayer === true,
    { criteriaCount: starterProj?.criteria?.length, passed: starterProj?.passed },
  );
  check("baseline.starter.premature-guide", starterPanel?.playerBeatGuideVisible === true);
  check("baseline.starter.no-progress-field", starterProj?.hasProgressField === false);
  check("baseline.starter.no-playerBeatReady-field", starterProj?.hasPlayerBeatReadyField === false);

  // 旧 Studio 收到失败 result 会立刻发游戏内 actionbar（HEAD Workbench.tsx:179-183 分支）。
  // 这里按同一分支重放，采集玩家客户端真实收到的 actionbar 文本作为「提前提示」证据。
  await engine.inGame(sessionId, "织者之印 · 手持灯笼右键灯柱顶端", "actionbar");
  await sleep(600);
  evidence.steps.starter.emulatedStudioActionbar = {
    note: "HEAD apps/studio/src/components/Workbench.tsx 第 182 行：result.criteria.length>0 && !passed → engine.inGame(playerBeatUI, actionbar)",
    requested: "织者之印 · 手持灯笼右键灯柱顶端",
    receivedByPlayer: [...capture.actionBars],
  };
  check(
    "baseline.starter.premature-actionbar-received",
    capture.actionBars.some((entry) => entry.text.includes("灯笼")),
    capture.actionBars.at(-1),
  );

  // ---------- reset 后跑参考解 ----------
  const resetRes = await engine.reset(sessionId);
  evidence.steps.resetBeforeReference = { status: resetRes.status, body: resetRes.json };
  await sleep(800);

  const referenceAttempts = [];
  let referenceEvent = null;
  for (let attempt = 1; attempt <= 3 && !referenceEvent; attempt += 1) {
    const run = await engine.run(sessionId, def.code.referenceSolution);
    const resultEvent = await stream.waitFor(
      (entry) => entry.e.type === "result" && entry.e.runId === run.json?.runId,
      360_000,
      "reference result",
    );
    const projection = resultProjection(resultEvent.e);
    referenceAttempts.push({ attempt, runId: run.json?.runId, criteriaCount: projection?.criteria?.length ?? 0, failures: projection?.failures });
    if ((projection?.criteria?.length ?? 0) > 0) {
      referenceEvent = resultEvent.e;
    } else {
      log(`reference attempt ${attempt} 环境抖动（criteria=[]），reset 后重试`);
      await engine.reset(sessionId);
      await sleep(2500);
    }
  }
  if (!referenceEvent) throw new Error("reference 三次都没有跑到真实评分（织偶 pathfinder 持续失败）");
  const referenceRunId = referenceEvent.runId;
  const referenceProj = resultProjection(referenceEvent);
  const referencePanel = oldStudioGoalPanel(referenceEvent);
  evidence.steps.reference = {
    attempts: referenceAttempts,
    runId: referenceRunId,
    result: referenceProj,
    oldStudioPanel: referencePanel,
    oldStudioWaitingForPlayer: oldStudioWaitingForPlayer(referenceEvent),
    playerInventoryAfterRun: inventoryOf(player),
    actionBarsSoFar: [...capture.actionBars],
  };
  check(
    "baseline.reference.goal0-still-not-done",
    referencePanel?.goals?.[0]?.done === false,
    { criteria: referenceProj?.criteria, panel: referencePanel },
  );
  check(
    "baseline.reference.four-lamps-lit-false",
    referenceProj?.criteria?.find((criterion) => criterion.id === "four-lamps-lit")?.passed === false,
  );
  check(
    "baseline.reference.golem-home-true-but-hidden",
    referenceProj?.criteria?.find((criterion) => criterion.id === "golem-home")?.passed === true &&
      referencePanel?.goals?.[2]?.done === false,
    { criteria: referenceProj?.criteria, panel: referencePanel?.goals },
  );
  check("baseline.reference.no-progress-field", referenceProj?.hasProgressField === false);
  check("baseline.reference.no-playerBeatReady-field", referenceProj?.hasPlayerBeatReadyField === false);

  evidence.steps.stateSequence = eventSummary(stream);
  evidence.events.rawCount = stream.events.length;
  evidence.events.objectives = stream.filter(({ e }) => e.type === "objective").map(({ t, e }) => ({ t: new Date(t).toISOString(), ...e }));
  evidence.events.states = stream.filter(({ e }) => e.type === "state").map(({ t, e }) => ({ t: new Date(t).toISOString(), ...e }));
  evidence.playerActionBars = capture.actionBars;
  evidence.playerTitles = capture.titles;
  evidence.playerMessages = capture.messages;

  const playerPos = player.entity?.position;
  evidence.steps.playerPosition = fmtPos(playerPos);
} catch (error) {
  log("FATAL", error?.stack ?? String(error));
  evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
  check("run.completed", false, { error: error?.message ?? String(error) });
} finally {
  try {
    await stream?.close();
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
const file = writeJson(path.join(OUT, "l01-progress.json"), evidence);
writeJson(path.join(OUT, "l01-progress.raw-events.json"), { task: evidence.task, head: evidence.head, events: evidence.steps?.stateSequence ?? [] });
log(`evidence written: ${path.relative(process.cwd(), file)}`);
log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
process.exit(evidence.ok ? 0 : 1);
