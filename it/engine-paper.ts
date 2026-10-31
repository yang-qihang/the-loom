// @ts-nocheck
// T3 真实 MC Engine 集成测试：LOOM_WORLD=paper 下用 HTTP/SSE 跑通 L01–L04。
//
// 流程：确保 Paper 在跑（scripts/mc-up.sh 幂等）→ 起真实 Engine（注入 PaperWorldPort + GolemBot）→
//   GET /api/health（port=paper、mc 版本、bot connected）→
//   POST /api/session → GET /api/levels/:id（referenceSolution）→ POST /api/run → SSE result →
//   POST /api/player-beat（testMode，3 星）→ POST /api/reset → 下一关。
// 另验证：paper 模式启动失败时抛中文错误（不静默降级）。
// 证据：evidence/engine-paper-<UTC>.json + evidence/engine-paper-latest.json
//
// 运行：npm run it:engine-paper   （需要真实 Paper；脚本会先尝试 mc-up）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineServer, startEngine } from "../apps/engine/src/server";
import { createWorldRuntime, WorldUnavailableError } from "../apps/engine/src/world";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");
const LEVELS = (process.env.LOOM_LEVELS ?? "L01,L02,L03,L04").split(",").filter(Boolean);

process.env.LOOM_WORLD = "paper";
process.env.LOOM_MC_WAIT_MS = process.env.LOOM_MC_WAIT_MS ?? "45000";
process.env.LOOM_MC_WAIT_SEC = process.env.LOOM_MC_WAIT_SEC ?? "60";

const evidence = {
  task: "task-49 / T3 Engine + PaperWorldPort",
  startedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    loWorld: process.env.LOOM_WORLD,
    rpcUrl: process.env.LOOM_RPC_URL ?? "ws://127.0.0.1:8765",
    mc: `${process.env.LOOM_MC_HOST ?? "127.0.0.1"}:${process.env.LOOM_MC_PORT ?? 25565}`,
  },
  checks: {},
  levels: {},
  failurePath: null,
  errors: [],
};

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
function check(name, condition, detail) {
  evidence.checks[name] = { ok: !!condition, detail: detail ?? null };
  log(`CHECK ${name} ${condition ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
  if (!condition) evidence.errors.push(name);
  return !!condition;
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
        const chunk = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 2);
        if (!chunk.startsWith("data:")) continue;
        const payload = chunk.slice(5).trim();
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

async function ensurePaperServer() {
  try {
    execFileSync("bash", [path.join("scripts", "mc-up.sh")], { cwd: ROOT, stdio: "pipe" });
  } catch (error) {
    throw new Error(
      `Paper 启动失败：${error instanceof Error ? error.message : String(error)}。检查 it/.mc-server/console.log。`,
    );
  }
  execFileSync("node", [path.join("it", "mc-ready.mjs"), "--timeout", process.env.LOOM_MC_WAIT_SEC], {
    cwd: ROOT,
    stdio: "pipe",
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // ---- 0) real server ready ---------------------------------------------------
  const serverT0 = Date.now();
  await ensurePaperServer();
  evidence.serverReadyMs = Date.now() - serverT0;
  check("server.ready", evidence.serverReadyMs > 0, { ms: evidence.serverReadyMs });

  // ---- 1) engine in paper mode ------------------------------------------------
  const t0 = Date.now();
  let started;
  try {
    started = await startEngine({ port: 0 });
  } catch (error) {
    evidence.errors.push(`engine.start: ${error instanceof Error ? error.message : String(error)}`);
    log("FATAL engine start", error);
    writeEvidence();
    process.exit(1);
  }
  const base = started.url;
  evidence.environment.engine = { url: base, worldMode: started.worldMode, startMs: Date.now() - t0 };
  check("engine.started", started.worldMode === "paper", evidence.environment.engine);

  try {
    // ---- 2) health -----------------------------------------------------------
    const health = await api(base, "GET", "/api/health");
    evidence.health = health.body;
    check("health.status-200", health.status === 200, health.status);
    check("health.port-paper", health.body?.port === "paper", health.body?.port);
    check("health.mc-connected", health.body?.mc?.kind === "paper" && health.body?.mc?.connected === true, health.body?.mc);
    check("health.mc-version", health.body?.mc?.version === "26.1.2", health.body?.mc?.version);
    check("health.bot-connected", health.body?.bot?.connected === true, health.body?.bot);

    // ---- 3) HTTP full flow per level ------------------------------------------
    for (const levelId of LEVELS) {
      const levelT0 = Date.now();
      const record = (evidence.levels[levelId] = { levelId, steps: {} });
      const session = await api(base, "POST", "/api/session", { levelId });
      record.steps.session = { status: session.status, port: session.body?.port, epoch: session.body?.epoch };
      const portKindOk = session.body?.port === "paper+bot" || session.body?.port === "paper";
      check(`${levelId}.session-created`, session.status === 201 && portKindOk, record.steps.session);
      const sessionId = session.body?.sessionId;
      if (!sessionId) throw new Error(`${levelId} 创建会话失败：${JSON.stringify(session.body).slice(0, 300)}`);

      const detail = await api(base, "GET", `/api/levels/${levelId}`);
      check(`${levelId}.level-detail`, detail.status === 200 && !!detail.body?.def?.code?.referenceSolution);
      const source = detail.body.def.code.referenceSolution;

      const runResult = await runAndWaitResult(base, sessionId, source);
      record.steps.run = runResult
        ? { stars: runResult.stars, passed: runResult.passed, failures: runResult.failures, digest: runResult.snapshotDigest }
        : null;
      check(`${levelId}.run-result`, !!runResult, record.steps.run);

      const beat = await api(base, "POST", "/api/player-beat", { sessionId });
      record.steps.beat = beat.body?.result
        ? { stars: beat.body.result.stars, passed: beat.body.result.passed, failures: beat.body.result.failures }
        : beat.body;
      check(
        `${levelId}.player-beat-3stars`,
        beat.status === 200 && beat.body?.result?.passed === true && beat.body?.result?.stars === 3,
        record.steps.beat,
      );
      check(
        `${levelId}.player-beat-no-failures`,
        Array.isArray(beat.body?.result?.failures) && beat.body.result.failures.length === 0,
        beat.body?.result?.failures,
      );

      const reset = await api(base, "POST", "/api/reset", { sessionId });
      record.steps.reset = { status: reset.status, state: reset.body?.state, epoch: reset.body?.epoch };
      check(`${levelId}.reset-ready`, reset.status === 200 && reset.body?.ok === true && reset.body?.state === "READY", record.steps.reset);
      record.durationMs = Date.now() - levelT0;
      log(`${levelId} flow done in ${record.durationMs}ms`, JSON.stringify({ run: record.steps.run, beat: record.steps.beat }));
    }

    // ---- 4) failure path: paper without MC must fail loudly in Chinese --------
    const badRuntime = createWorldRuntime({
      LOOM_WORLD: "paper",
      LOOM_RPC_URL: "ws://127.0.0.1:59999",
      LOOM_MC_WAIT_MS: "700",
    });
    let startError = null;
    try {
      await startEngine({ port: 0, world: badRuntime });
    } catch (error) {
      startError = error;
    }
    evidence.failurePath = {
      isWorldUnavailable: startError instanceof WorldUnavailableError,
      message: startError instanceof Error ? startError.message : String(startError),
      hint: startError instanceof WorldUnavailableError ? startError.hint : null,
    };
    check("failure-path.start-rejected", startError instanceof WorldUnavailableError, evidence.failurePath);
    check(
      "failure-path.chinese-message",
      typeof evidence.failurePath.message === "string" && /真实 MC 未就绪/.test(evidence.failurePath.message),
      evidence.failurePath.message,
    );
    // health of a paper runtime that cannot reach MC must report ok=false (不静默降级成 mock)
    const offlineServer = createEngineServer(badRuntime);
    await new Promise(resolve => offlineServer.listen(0, "127.0.0.1", resolve));
    const address = offlineServer.address();
    const offlineBase = `http://127.0.0.1:${address.port}`;
    const offlineHealth = await api(offlineBase, "GET", "/api/health");
    evidence.failurePath.offlineHealth = offlineHealth.body;
    check(
      "failure-path.health-not-mock",
      offlineHealth.body?.ok === false && offlineHealth.body?.port === "paper",
      { ok: offlineHealth.body?.ok, port: offlineHealth.body?.port, error: offlineHealth.body?.error },
    );
    await new Promise(resolve => offlineServer.close(resolve));
  } catch (error) {
    log("FATAL", error?.stack ?? String(error));
    evidence.errors.push(`fatal: ${error?.message ?? String(error)}`);
    check("run.completed", false, { error: error?.message ?? String(error) });
  } finally {
    try {
      await started.close();
    } catch {
      /* ignore */
    }
  }

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
    Object.values(evidence.checks).every(value => value.ok);
  fs.writeFileSync(path.join(EVIDENCE_DIR, `engine-paper-${RUN_TS}.json`), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "engine-paper-latest.json"), JSON.stringify(evidence, null, 2));
  log("evidence written: evidence/engine-paper-latest.json");
}

main().catch(error => {
  log("FATAL unhandled", error?.stack ?? String(error));
  evidence.errors.push(`unhandled: ${error?.message ?? String(error)}`);
  try {
    writeEvidence();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
