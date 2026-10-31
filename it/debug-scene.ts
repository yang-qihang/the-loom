// @ts-nocheck
// Debug helper for the real L01 scene (movement/pathfinder diagnostics).
import { L01 } from "../packages/level-spec/src/index";
import { L01Content } from "../content/levels/L01.content";
import { GolemBot } from "../bot/manager.mjs";

const RPC_PORT = Number(process.env.MC_RPC_PORT ?? 8765);

class Rpc {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.seq = 0;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
  }
  static connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${RPC_PORT}`);
      ws.onopen = () => resolve(new Rpc(ws));
      ws.onerror = reject;
    });
  }
  call(method, params = {}) {
    const id = `${method}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }
}

const layout = {
  levelId: "L01",
  seed: 1,
  vars: L01.world.vars,
  arena: { from: [-20, 8, -10], to: [8, 18, 28], floorY: 10, groundY: 11 },
  lamps: L01.world.vars.lamps,
  optionalLamp: L01.world.vars.optionalLamp ?? [],
  tracked: [...L01.world.vars.lamps, ...(L01.world.vars.optionalLamp ?? [])],
  timeTicks: 12000,
  gamerules: { doDaylightCycle: false, doMobSpawning: false, doFireTick: false, keepInventory: true },
  bots: ["Golem"],
  agentSpawn: [0, 11, 0],
  playerSpawn: [2, 11, 4],
};

const rpc = await Rpc.connect();
const bot = new GolemBot({ name: "Golem", log: (l) => console.log("[bot]", l) });
await bot.connect();
await rpc.call("bots.set", { names: ["Golem"] });
await rpc.call("session.prepare", { levelId: "L01", layout });
// content-equivalent scene declarations
await rpc.call("world.setBlocks", { entries: layout.lamps.map((pos) => ({ pos, block: "minecraft:air" })) });
await rpc.call("entity.spawn", { type: "villager", id: "eira", name: "艾拉", pos: [0, 65, 6] });
await rpc.call("entity.spawn", { type: "golem", id: "golem", name: "灰崽", pos: [0, 65, 0] });
console.log("prepared; bot pos", bot.pos, "groundY", bot.groundY);

bot.bot.on("path_update", (r) => {
  if (r.status !== "partial") console.log("path_update", r.status, "nodes", r.path?.length ?? "?");
});
bot.bot.on("goal_reached", () => console.log("goal_reached"));

const targets = [[-12, 10], [-12, -2], [2, -2], [2, 16], [0, 6], [2, 24]];
for (const [x, z] of targets) {
  const cell = bot.findStandCells(x, z)[0];
  console.log(`target (${x},${z}) -> stand cell`, cell, "bot at", bot.pos);
  const t = Date.now();
  try {
    const pos = await bot.moveTo(x, z, 15000);
    console.log(`moveTo (${x},${z}) OK`, pos, `${Date.now() - t}ms`);
  } catch (err) {
    console.log(`moveTo (${x},${z}) FAIL ${err.code} ${err.message} pos=${bot.pos} ${Date.now() - t}ms`);
    // diagnostics: what blocks around?
    const p = bot.bot.entity.position;
    for (let dx = -2; dx <= 2; dx++) {
      const row = [];
      for (let dz = -2; dz <= 2; dz++) {
        const b = bot.bot.blockAt(p.offset(dx, -1, dz));
        row.push(b ? b.name.slice(0, 10) : "null");
      }
      console.log("floor", dx, row.join(","));
    }
    bot.bot.pathfinder.stop();
    break;
  }
}
await bot.disconnect();
try { rpc.ws.close(); } catch {}
process.exit(0);
