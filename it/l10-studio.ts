// @ts-nocheck
// Studio/Engine 会话层（GameSession + 沙箱）跑 L10 双织者：
// createSession → run 参考解（沙箱内 agent()/邮箱/supply）→ playerBeat → 3 星。
// 不走后端 RPC 伪造学生代码结果；沙箱执行的每个动作都经 GameSession 的 capability 校验回 MockWorldPort。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MockWorldPort } from "../packages/worldport/src/mock-port";
import { GameSession, type ResultEvent } from "../packages/session/src/index";
import { L10, L10Content } from "../content/levels/L10.content";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");

function waitForResult(session, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待 result 事件超时"));
    }, timeoutMs);
    const off = session.subscribe((event) => {
      if (event.type !== "result") return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

/** 第二阶段：走 Engine HTTP（Studio 实际调用的 createSession/run/player-beat）。 */
async function engineHttpFlow(evidence, check) {
  process.env.LOOM_WORLD = "mock";
  const { createEngineServer } = await import("../apps/engine/src/server");
  const server = createEngineServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const json = async (path, init) => {
    const res = await fetch(base + path, init);
    return res.json();
  };
  const post = (path, body) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const levels = await json("/api/levels");
    check("engine.levels-include-L10", levels.levels.some((level) => level.id === "L10"), levels.levels.map((l) => l.id));

    const created = await post("/api/session", { levelId: "L10" });
    check("engine.session-created", typeof created.sessionId === "string", created.sessionId);
    evidence.engineSession = { sessionId: created.sessionId, state: created.state, port: created.port };

    // 订阅 SSE，等 run 的 result 事件（Studio 同款事件流）。
    const resultEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待 engine run result 超时")), 12000);
      const controller = new AbortController();
      fetch(`${base}/api/events?sessionId=${encodeURIComponent(created.sessionId)}`, {
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
      })
        .then(async (res) => {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let index = buffer.indexOf("\n\n");
            while (index >= 0) {
              const chunk = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              index = buffer.indexOf("\n\n");
              for (const line of chunk.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const event = JSON.parse(line.slice(6));
                if (event.type === "log" && /(左织|右织)\./.test(event.line)) evidence.engineSandboxLogs.push(event.line);
                if (event.type === "result") {
                  clearTimeout(timer);
                  controller.abort();
                  resolve(event);
                  return;
                }
              }
            }
          }
          clearTimeout(timer);
          reject(new Error("SSE 结束但没收到 result"));
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
    await post("/api/run", { sessionId: created.sessionId, source: L10.code.referenceSolution });
    const runResult = await resultEvent;
    check("engine.run-runs-in-sandbox", runResult.passed === false, runResult.stars);
    check("engine.sandbox-agent-logs", evidence.engineSandboxLogs.length >= 2, evidence.engineSandboxLogs.slice(0, 4));

    const beat = await post("/api/player-beat", { sessionId: created.sessionId });
    check("engine.player-beat-3-stars", beat.result?.passed === true && beat.result?.stars === 3, beat.result?.stars);
    evidence.engineResult = {
      afterRun: { passed: runResult.passed, stars: runResult.stars },
      afterPlayerBeat: { passed: beat.result?.passed, stars: beat.result?.stars },
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    level: "L10",
    layer: "studio-session",
    startedAt: new Date().toISOString(),
    checks: {},
    result: {},
    events: [],
    engineSandboxLogs: [],
    errors: [],
  };
  const check = (id, ok, detail) => {
    evidence.checks[id] = { ok: !!ok, detail: detail ?? null };
    console.log(`CHECK ${id} ${ok ? "PASS" : "FAIL"}`, detail === undefined ? "" : JSON.stringify(detail));
    if (!ok) evidence.errors.push(id);
  };
  let session;
  try {
    session = await GameSession.create(L10Content, new MockWorldPort());
    check("session.runMode-explicit", session.runMode === "explicit", session.runMode);
    const logs = [];
    session.subscribe((event) => {
      if (event.type === "log") logs.push(event.line);
      evidence.events.push(event.type);
    });

    const firstResult = waitForResult(session);
    await session.run(L10.code.referenceSolution);
    const afterRun = await firstResult;
    evidence.result.afterRun = {
      passed: afterRun.passed,
      stars: afterRun.stars,
      failures: afterRun.failures,
      criteria: afterRun.criteria.map((c) => ({ id: c.id, passed: c.passed })),
      hidden: afterRun.hidden.map((c) => ({ id: c.id, passed: c.passed })),
    };
    check("run.not-passed-before-player-beat", afterRun.passed === false, afterRun.stars);
    check("run.no-runtime-error", afterRun.failures.every((text) => !/ReferenceError|setTimeout|TypeError/.test(text)), afterRun.failures);
    check("run.sandbox-agent-log", logs.some((line) => line.startsWith("左织.")) && logs.some((line) => line.startsWith("右织.")), logs.slice(0, 6));

    const secondResult = waitForResult(session);
    await session.playerBeat();
    const final = await secondResult;
    evidence.result.final = {
      passed: final.passed,
      stars: final.stars,
      failures: final.failures,
      source: final.source,
    };
    check("player-beat-3-stars", final.passed === true && final.stars === 3, final.stars);
    check("result-source-player-beat", final.source === "player-beat", final.source);
    evidence.logs = logs.slice(0, 80);
    session.dispose();

    await engineHttpFlow(evidence, check);
  } catch (error) {
    evidence.errors.push(`fatal: ${error?.stack ?? String(error)}`);
    check("session.flow", false, error?.message ?? String(error));
    try {
      session?.dispose();
    } catch {
      /* ignore */
    }
  }
  const failed = Object.entries(evidence.checks).filter(([, v]) => !v.ok);
  evidence.finishedAt = new Date().toISOString();
  evidence.ok = failed.length === 0 && evidence.errors.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, `l10-studio-${RUN_TS}.json`), JSON.stringify(evidence, null, 1));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "l10-studio-latest.json"), JSON.stringify(evidence, null, 1));
  console.log("RESULT", evidence.ok ? "PASS" : `FAIL (${failed.map(([id]) => id).join(", ")})`);
  process.exit(evidence.ok ? 0 : 1);
}

await main();
