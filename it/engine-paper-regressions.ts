// @ts-nocheck
// P0 修复回归（真实 Paper）：会话创建串行化、L10 双织偶、引擎 bot 跨会话复用、Studio 超时余量。
//
// 背景（2026-11-01 环境报告 §2.E/F/G）：
//   E) Studio 5s 超时 → Paper 切关常超过 5s，Studio 误判离线（改 30s 可配置）。
//   F) dispose 旧会话和 create 新会话没有串行化 → 换关/重进必 503 STALE_SESSION。
//   G) 浏览器 Studio 走的世界运行时只创建一只 Golem → agent("左织")/agent("右织") 回退同一只，
//      L10 桥面铺不满；it/l10-real.ts 自带 bot 所以 headless 能过、Studio 不能过。
//
// 本脚本覆盖修复后的引擎路径（Studio 实际调用的 HTTP/SSE）：
//   1) 同一引擎顺序重进 L01→L01→L02→L01：每次都必须 201（旧缺陷：第二次必 503），且只保留一个会话。
//   2) 并发两个 POST /api/session：都必须 201，最终只剩一个会话（串行队列的下界验证）。
//   3) L10：插件登记 LeftWeaver+RightWeaver 两只真实 bot → 参考解铺桥 → playerBeatReady=true
//      → 模拟玩家节拍 → 3 星（旧缺陷：两只 agent 都落到 Golem，桥面缺格）。
//   4) L10 → L01：额外 bot 回收、主 bot 不重连（修复 session 复用 bot 后的 "logged in from another location"）。
//
// 前置：Paper 已在跑（Windows 无 bash，不能像 it/engine-paper.ts 那样自动 mc-up）：
//   Windows: node .tools/win/paper-host.mjs "it/.mc-server" "<jdk>/bin/java.exe" 25567
//   然后设置 LOOM_MC_PORT / LOOM_RPC_URL 与之一致。
//
// 运行：$env:LOOM_MC_PORT='25567'; $env:MC_RPC_PORT='8765'; npx tsx it/engine-paper-regressions.ts
// 证据：evidence/engine-paper-regressions-<UTC>.json + evidence/engine-paper-regressions-latest.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEngine } from "../apps/engine/src/server";
import { createWorldRuntime } from "../apps/engine/src/world";
import { WsJsonRpcClient } from "../packages/worldport/src/paper-port";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");

const MC_PORT = process.env.LOOM_MC_PORT ?? "25567";
const MC_HOST = process.env.LOOM_MC_HOST ?? "127.0.0.1";
const RPC_PORT = process.env.MC_RPC_PORT ?? "8765";
const RPC_URL = process.env.LOOM_RPC_URL ?? `ws://127.0.0.1:${RPC_PORT}`;

const evidence = {
  task: "2026-11-01 P0 fixes — engine paper regression",
  startedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    mc: `${MC_HOST}:${MC_PORT}`,
    rpc: RPC_URL,
    engine: "in-process (paper)",
  },
  checks: {},
  sessions: [],
  l10: {},
  botReuse: {},
  engineLog: [],
  errors: [],
  ok: false,
};

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(id, ok, detail) {
  evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
  log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  if (!ok) evidence.errors.push(id);
  return !!ok;
}

async function api(base, method, apiPath, body) {
  const response = await fetch(`${base}${apiPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, body: json };
}

/** 打开 SSE，先订阅再触发 run，等到 source=run 的 result 事件。 */
async function runAndWaitResult(base, sessionId, source, timeoutMs = 240_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${base}/api/events?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status !== 200 || !response.body) {
    clearTimeout(timer);
    throw new Error(`SSE 订阅失败 status=${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const resultPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        // SSE 帧可能包含 `id:`/`retry:`/注释行；标准 EventSource 会忽略，这里同样只取 data 行。
        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n").trim();
        if (!payload) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.type === "result" && event.source === "run") return event;
      }
    }
  })();

  const run = await api(base, "POST", "/api/run", { sessionId, source });
  if (run.status !== 202) {
    clearTimeout(timer);
    controller.abort();
    throw new Error(`POST /api/run 失败 status=${run.status}: ${JSON.stringify(run.body).slice(0, 300)}`);
  }
  try {
    return await resultPromise;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  process.env.LOOM_WORLD = "paper";
  process.env.LOOM_MC_PORT = MC_PORT;
  process.env.LOOM_RPC_URL = RPC_URL;

  // ---- 0) Paper/插件自检（本脚本不自行 mc-up）--------------------------------
  let probe;
  try {
    probe = await WsJsonRpcClient.connect(RPC_URL, 3000);
    const health = await probe.call("health", {}, 3000);
    evidence.environment.plugin = health;
    check("paper.plugin-ready", health?.ok === true && health?.mc === "26.1.2", { mc: health?.mc, version: health?.version });
    probe.close();
  } catch (error) {
    check("paper.plugin-ready", false, { error: error instanceof Error ? error.message : String(error) });
    log("Paper/插件不可用，先启动 Paper 再重跑（见文件头注释）。");
    writeEvidence();
    process.exit(1);
  }

  // ---- 1) 起 paper 引擎（in-process，捕获日志）-------------------------------
  const engineLines = [];
  const capture = (line) => {
    engineLines.push(String(line));
    log("[engine]", line);
  };
  const runtime = createWorldRuntime(
    { ...process.env, LOOM_WORLD: "paper", LOOM_MC_PORT: MC_PORT, LOOM_MC_HOST: MC_HOST, LOOM_RPC_URL: RPC_URL },
    capture,
  );
  let started;
  const t0 = Date.now();
  try {
    started = await startEngine({ port: 0, world: runtime });
    check("engine.started-paper", started.worldMode === "paper", { url: started.url, ms: Date.now() - t0 });
  } catch (error) {
    check("engine.started-paper", false, { error: error instanceof Error ? error.message : String(error) });
    writeEvidence();
    process.exit(1);
  }
  const base = started.url;

  try {
    const health = await api(base, "GET", "/api/health");
    check(
      "engine.health-paper",
      health.status === 200 && health.body?.port === "paper" && health.body?.mc?.connected === true && health.body?.bot?.connected === true,
      { port: health.body?.port, mc: health.body?.mc?.connected, bot: health.body?.bot },
    );

    // ---- 2) 顺序重进：旧缺陷第二次必 503 STALE_SESSION ----------------------
    const sequence = ["L01", "L01", "L02", "L01"];
    for (const [index, levelId] of sequence.entries()) {
      const begun = Date.now();
      const created = await api(base, "POST", "/api/session", { levelId });
      const record = {
        order: index + 1,
        levelId,
        status: created.status,
        ms: Date.now() - begun,
        sessionId: created.body?.sessionId ?? null,
        epoch: created.body?.epoch ?? null,
      };
      evidence.sessions.push(record);
      check(`reentry.${index + 1}.${levelId}.created`, created.status === 201, record);
      await sleep(200);
    }
    check(
      "reentry.no-503",
      evidence.sessions.every((record) => record.status === 201),
      evidence.sessions.map((record) => `${record.levelId}:${record.status}`),
    );
    const afterReentry = await api(base, "GET", "/api/health");
    check("reentry.single-live-session", afterReentry.body?.sessions === 1, { sessions: afterReentry.body?.sessions });
    evidence.prepareMs = { max: Math.max(...evidence.sessions.map((record) => record.ms)), samples: evidence.sessions.map((record) => record.ms) };

    // ---- 3) 并发创建：串行队列下界（两个都必须 201）-------------------------
    const concurrentT0 = Date.now();
    const [first, second] = await Promise.all([
      api(base, "POST", "/api/session", { levelId: "L01" }),
      api(base, "POST", "/api/session", { levelId: "L02" }),
    ]);
    evidence.concurrent = {
      ms: Date.now() - concurrentT0,
      statuses: [first.status, second.status],
      sessionIds: [first.body?.sessionId ?? null, second.body?.sessionId ?? null],
    };
    check("concurrent.both-created", first.status === 201 && second.status === 201, evidence.concurrent);
    const afterConcurrent = await api(base, "GET", "/api/health");
    check("concurrent.single-live-session", afterConcurrent.body?.sessions === 1, { sessions: afterConcurrent.body?.sessions });

    // ---- 4) L10 双织偶（引擎路径，浏览器 Studio 同款）----------------------
    const l10Begin = Date.now();
    const l10Session = await api(base, "POST", "/api/session", { levelId: "L10" });
    evidence.l10.createMs = Date.now() - l10Begin;
    check("l10.session-created", l10Session.status === 201, { status: l10Session.status, ms: evidence.l10.createMs, epoch: l10Session.body?.epoch });
    const l10SessionId = l10Session.body?.sessionId;
    if (l10SessionId) {
      const l10Health = await api(base, "GET", "/api/health");
      const pluginSessionId = l10Health.body?.mc?.sessionId ?? null;
      evidence.l10.pluginSessionId = pluginSessionId;

      // 4.1 插件侧登记的两只 agent 必须是真实 bot（旧缺陷：只有 Golem）。
      if (pluginSessionId) {
        const rpc = await WsJsonRpcClient.connect(RPC_URL, 3000);
        try {
          const status = await rpc.call("session.status", { sessionId: pluginSessionId });
          evidence.l10.pluginBots = status?.bots ?? null;
          check(
            "l10.both-agents-registered",
            Array.isArray(status?.bots) && status.bots.includes("LeftWeaver") && status.bots.includes("RightWeaver"),
            status?.bots,
          );
        } finally {
          rpc.close();
        }
      } else {
        check("l10.both-agents-registered", false, { error: "health 里没有插件 sessionId" });
      }

      // 4.2 参考解：沙箱里 agent("左织")/agent("右织") 驱动两只真实 bot 铺桥。
      const detail = await api(base, "GET", "/api/levels/L10");
      const source = detail.body?.def?.code?.referenceSolution;
      check("l10.reference-solution-exists", typeof source === "string" && source.length > 0, { chars: source?.length ?? 0 });
      const runT0 = Date.now();
      const runResult = await runAndWaitResult(base, l10SessionId, source);
      evidence.l10.runMs = Date.now() - runT0;
      evidence.l10.afterRun = runResult
        ? {
            passed: runResult.passed,
            stars: runResult.stars,
            playerBeatReady: runResult.playerBeatReady,
            failures: runResult.failures,
            criteria: (runResult.criteria ?? []).map((criterion) => ({ id: criterion.id, passed: criterion.passed })),
            hidden: (runResult.hidden ?? []).map((criterion) => ({ id: criterion.id, passed: criterion.passed })),
          }
        : null;
      // run 之后 passed=false、失败项应当只落在「玩家还没完成合龙」上（不是织偶/桥面逻辑错）：
      // 旧缺陷下两只 agent 都回退到 Golem，criteria.deck-full / both-weavers 会先失败。
      const runCriteria = Object.fromEntries((runResult?.criteria ?? []).map((criterion) => [criterion.id, criterion.passed]));
      check("l10.run-waits-for-player", runResult?.playerBeatReady === true && runResult?.passed === false, evidence.l10.afterRun);
      check(
        "l10.run-weaver-criteria-pass",
        runCriteria["both-weavers"] === true && runCriteria["materials-exact"] === true,
        { "both-weavers": runCriteria["both-weavers"], "materials-exact": runCriteria["materials-exact"], "deck-full": runCriteria["deck-full"] },
      );

      // 4.3 模拟玩家节拍（真实客户端交互的等价物；paper 模式默认 confirm-only，这里显式 simulate）→ 3 星。
      const beat = await api(base, "POST", "/api/player-beat", { sessionId: l10SessionId, simulate: true });
      evidence.l10.afterBeat = beat.body?.result
        ? { passed: beat.body.result.passed, stars: beat.body.result.stars, failures: beat.body.result.failures }
        : beat.body;
      check(
        "l10.player-beat-3stars",
        beat.status === 200 && beat.body?.result?.passed === true && beat.body?.result?.stars === 3,
        evidence.l10.afterBeat,
      );
      check("l10.engine-extra-bots-online", engineLines.some((line) => /\[bot:LeftWeaver\] online/.test(line)) && engineLines.some((line) => /\[bot:RightWeaver\] online/.test(line)), {
        left: engineLines.filter((line) => /\[bot:LeftWeaver\]/.test(line)).slice(0, 3),
        right: engineLines.filter((line) => /\[bot:RightWeaver\]/.test(line)).slice(0, 3),
      });
    }

    // ---- 5) L10 → L01：额外 bot 回收、主 bot 不重连 -------------------------
    const back = await api(base, "POST", "/api/session", { levelId: "L01" });
    check("leave-l10.back-to-l01", back.status === 201, { status: back.status, ms: evidence.l10.createMs });
    const backHealth = await api(base, "GET", "/api/health");
    if (backHealth.body?.mc?.sessionId) {
      const rpc = await WsJsonRpcClient.connect(RPC_URL, 3000);
      try {
        const status = await rpc.call("session.status", { sessionId: backHealth.body.mc.sessionId });
        evidence.l10.botsAfterLeave = status?.bots ?? null;
        check(
          "leave-l10.named-bots-cleared",
          Array.isArray(status?.bots) && !status.bots.includes("LeftWeaver") && !status.bots.includes("RightWeaver"),
          status?.bots,
        );
      } finally {
        rpc.close();
      }
    }

    // 修复 disposeBot=false 后：整个回归过程里主 bot 只应登录一次（跨会话复用，不重连/不顶号）。
    const golemOnline = engineLines.filter((line) => /\[bot:Golem\] online/.test(line)).length;
    const kicked = engineLines.filter((line) => /logged in from another location|You logged in from another location/i.test(line)).length;
    const stale = engineLines.filter((line) => /STALE_SESSION|stale session/i.test(line)).length;
    evidence.botReuse = { golemOnlineLines: golemOnline, kickedLines: kicked, staleLines: stale };
    check("bot-reuse.single-login", golemOnline === 1, { golemOnline });
    check("bot-reuse.no-duplicate-login-kick", kicked === 0, { kicked });
    check("bot-reuse.no-stale-session", stale === 0, { stale });
    check("prepare.max-ms-recorded", typeof evidence.prepareMs?.max === "number", evidence.prepareMs);
  } catch (error) {
    log("FATAL", error?.stack ?? String(error));
    evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
    check("run.completed", false, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    try {
      await started?.close?.();
    } catch {
      /* ignore */
    }
  }

  evidence.engineLog = engineLines.slice(0, 400);
  writeEvidence();
  const failed = Object.entries(evidence.checks).filter(([, value]) => !value.ok);
  log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
  process.exit(evidence.ok ? 0 : 1);
}

function writeEvidence() {
  evidence.finishedAt = new Date().toISOString();
  evidence.ok =
    evidence.errors.length === 0 &&
    Object.values(evidence.checks).length > 0 &&
    Object.values(evidence.checks).every((value) => value.ok);
  fs.writeFileSync(path.join(EVIDENCE_DIR, `engine-paper-regressions-${RUN_TS}.json`), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "engine-paper-regressions-latest.json"), JSON.stringify(evidence, null, 2));
  log("evidence written: evidence/engine-paper-regressions-latest.json");
}

main().catch((error) => {
  log("FATAL unhandled", error?.stack ?? String(error));
  evidence.errors.push(`unhandled: ${error?.message ?? String(error)}`);
  try {
    writeEvidence();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
