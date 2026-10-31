// 真实 Engine 验收脚本：L01–L04 逐关跑参考解 → 玩家节拍 → 3 星 → 重置。
// 用法：node apps/studio/scripts/verify-engine.mjs [--base http://127.0.0.1:4317] [--out evidence/engine-verify.json]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = opt("base", process.env.VITE_ENGINE_URL ?? "http://127.0.0.1:4317");
const OUT = opt("out", resolve(process.cwd(), "evidence/engine-verify.json"));

const post = async (path, body) => {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json;
};

/** 订阅 SSE 并按类型收集事件；返回 wait(predicate, timeoutMs)。 */
function openEvents(sessionId) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const push = (event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        waiter.resolve(event);
        waiters.splice(waiters.indexOf(waiter), 1);
      }
    }
  };
  const loop = (async () => {
    const response = await fetch(`${BASE}/api/events?sessionId=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            push(JSON.parse(line.slice(6)));
          } catch {
            /* 忽略心跳/注释 */
          }
        }
      }
    }
  })().catch((error) => {
    if (error.name !== "AbortError") events.push({ type: "sse-error", message: error.message });
  });
  return {
    events,
    wait: (predicate, timeoutMs = 15000) =>
      new Promise((resolvePromise, reject) => {
        const hit = events.find(predicate);
        if (hit) return resolvePromise(hit);
        const waiter = { predicate, resolve: resolvePromise };
        waiters.push(waiter);
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`等待事件超时：${timeoutMs}ms`));
        }, timeoutMs);
        const original = waiter.resolve;
        waiter.resolve = (event) => {
          clearTimeout(timer);
          original(event);
        };
      }),
    close: async () => {
      controller.abort();
      await loop;
    },
  };
}

const levels = await (await fetch(`${BASE}/api/levels`)).json();
const results = [];
for (const summary of levels.levels ?? []) {
  const detail = await (await fetch(`${BASE}/api/levels/${summary.id}`)).json();
  const source = detail.def?.code?.referenceSolution;
  if (!source) throw new Error(`${summary.id} 没有参考解`);
  const session = await post("/api/session", { levelId: summary.id });
  const sse = openEvents(session.sessionId);
  const run = await post("/api/run", { sessionId: session.sessionId, source });
  const runResult = await sse.wait((event) => event.type === "result");
  const beat = await post("/api/player-beat", { sessionId: session.sessionId });
  const beatResult =
    (beat.result ? null : await sse.wait((event) => event.type === "result" && event.source === "player-beat")) ?? beat.result;
  const stars = beatResult?.stars ?? beat.result?.stars ?? 0;
  const passed = beatResult?.passed ?? beat.result?.passed ?? false;
  const reset = await post("/api/reset", { sessionId: session.sessionId });
  await sse.close();
  results.push({
    id: summary.id,
    runId: run.runId,
    runStars: runResult.stars,
    runPassed: runResult.passed,
    beatStars: stars,
    beatPassed: passed,
    resetState: reset.state,
    events: sse.events.map((event) => event.type),
  });
  console.log(`${summary.id}: 运行 ${runResult.stars} 星 / 节拍后 ${stars} 星 / ${passed ? "通过" : "未通过"} / 重置 ${reset.state}`);
}

const failed = results.filter((item) => !item.beatPassed || item.beatStars !== 3);
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(
  resolve(OUT),
  `${JSON.stringify({ ts: new Date().toISOString(), base: BASE, passed: failed.length === 0, levels: results }, null, 2)}\n`,
  "utf8",
);
if (failed.length > 0) {
  console.error("未通过：", failed.map((item) => item.id).join(", "));
  process.exit(1);
}
console.log(`真实 Engine 验收通过：${results.length} 关，证据 ${OUT}`);
