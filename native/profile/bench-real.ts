// @ts-nocheck
// Real Paper profiling: snapshot RPC cost, prepare/reset cost, pathfinder planning time.
import fs from "node:fs";
import { WsJsonRpcClient, PaperWorldPort } from "../../packages/worldport/src/paper-port";
import { pointsView } from "../../packages/level-spec/src/index";
import { PAPER_SCENE_HINTS } from "../../apps/engine/src/world";
import { GolemBot, goals } from "../../bot/manager.mjs";
import { L01Content } from "../../content/levels/L01.content";
import { L05Content } from "../../content/levels/L05.content";
import { L06Content } from "../../content/levels/L06.content";
import { L09Content } from "../../content/levels/L09.content";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t = () => performance.now();
const levels = [L01Content, L05Content, L06Content, L09Content];
const out = { startedAt: new Date().toISOString(), levels: {}, pathfinding: {}, movement: {} };

const rpc = await WsJsonRpcClient.connect("ws://127.0.0.1:8765");
const bot = new GolemBot({ name: `Bench${String(process.pid).slice(-4)}`, log: (l) => console.log("[bot]", l) });
await bot.connect();
console.log("bot online at", bot.pos);

for (const content of levels) {
  const def = content.def;
  const port = new PaperWorldPort({ rpc, bot, def, scene: PAPER_SCENE_HINTS[def.id], log: () => {}, closeRpcOnDispose: false });
  try {
    const p0 = t(); await port.prepare(content); const prepareMs = t() - p0;
    const snap0 = await port.snapshot(def.id);
    const bytes = Buffer.byteLength(JSON.stringify(snap0));
    const blocks = Object.keys(snap0.blocks ?? {}).length;
    const events = (snap0.events ?? []).length;
    // snapshot RPC roundtrip 10x
    const snapTimes = [];
    for (let i = 0; i < 10; i++) { const s = t(); await port.snapshot(def.id); snapTimes.push(t() - s); }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    // reset 2x
    const resets = [];
    for (let i = 0; i < 2; i++) { await port.reset(content); resets.push(port.lastReset ?? null); }
    out.levels[def.id] = { prepareMs: +prepareMs.toFixed(0), snapshotBytes: bytes, snapshotKB: +(bytes/1024).toFixed(1), blocks, events, snapshotRpcMsAvg: +avg(snapTimes).toFixed(2), snapshotRpcMsMax: +Math.max(...snapTimes).toFixed(2), reset: resets.map(r => r ? { ms: r.ms, hash: r.hash?.slice(0,20), checkpointSize: r.checkpointSize, restoredBlocks: r.restoredBlocks } : null) };
    console.log(def.id, JSON.stringify(out.levels[def.id]));
    // Pathfinding on L06/L09-ish scenes: bot should be at agent spawn after prepare/reset.
    if (def.id === "L06" || def.id === "L09") {
      await bot.ensureChunks?.();
      const pf = bot.bot.pathfinder;
      const pts = Object.values(pointsView(def)).map(p => p.pos);
      const far = pts.filter(p => Math.hypot(p[0]-bot.pos[0], p[2]-bot.pos[2]) > 10).slice(0, 4);
      const results = [];
      for (const p of far) {
        const s = t();
        const path = pf.getPathTo(pf.movements, new goals.GoalNear(p[0], p[1], p[2], 1));
        const ms = t() - s;
        results.push({ target: p.slice(0,3), ms: +ms.toFixed(2), status: path?.status, steps: path?.path?.length ?? null, cost: path?.cost ?? null });
      }
      out.pathfinding[def.id] = results;
      console.log("pathfinding", def.id, JSON.stringify(results));
    }
  } finally {
    await port.dispose().catch(() => {});
    await sleep(300);
  }
}

// Movement vs planning: on last scene, ask bot to actually walk a short path and measure.
try {
  const content = L09Content;
  const port = new PaperWorldPort({ rpc, bot, def: content.def, scene: PAPER_SCENE_HINTS["L09"], log: () => {}, closeRpcOnDispose: false });
  await port.prepare(content);
  const pf = bot.bot.pathfinder;
  const s = t(); const path = pf.getPathTo(pf.movements, new goals.GoalNear(0, 65, 10, 1)); const planMs = t() - s;
  const m0 = t(); await bot.moveTo(0, 10, 60_000); const moveMs = t() - m0;
  out.movement = { planMs: +planMs.toFixed(2), moveMs: +moveMs.toFixed(0), pathSteps: path?.path?.length ?? null };
  console.log("movement", JSON.stringify(out.movement));
  await port.dispose().catch(() => {});
} catch (e) {
  out.movement = { error: String(e?.message ?? e) };
}

fs.writeFileSync("tmp/cpp-profile/real-profile.json", JSON.stringify(out, null, 2));
console.log("WROTE tmp/cpp-profile/real-profile.json");
bot.bot?.quit();
await rpc.close?.();
process.exit(0);
