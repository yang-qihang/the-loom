#!/usr/bin/env node
// 按当前 session 的真实 region/spawn 取景，避免拍到旧竞技场。
import { execFileSync } from "node:child_process";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const level = arg("level", "L01");
const out = arg("out", `evidence/scene-shots/${level}-real.png`);
const port = arg("port", "4320");
const time = Number(arg("time", "12000"));
const yOff = Number(arg("y", "4"));
const zOff = Number(arg("z", "14"));
const created = await (await fetch(`http://127.0.0.1:${port}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ levelId: level }) })).json();
await new Promise(r => setTimeout(r, 2400));
const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
const sid = health.mc.sessionId;
const ws = new WebSocket("ws://127.0.0.1:8765"); let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const call = (m, p) => new Promise((resolve, reject) => { const id = `${++seq}`; pend.set(id, { resolve, reject }); ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p })); });
const st = await call("session.status", { sessionId: sid });
const base = st.playerSpawn ?? st.center;
const cam = [Math.round(base[0]), Math.round(st.groundY) + yOff, Math.round(base[2]) + zOff];
await call("world.setTime", { sessionId: sid, ticks: time });
await call("player.teleport", { sessionId: sid, name: "yqh0919", pos: cam, yaw: 180, pitch: 10 });
ws.close();
await new Promise(r => setTimeout(r, 1500));
execFileSync("import", ["-window", "root", out], { env: { ...process.env, DISPLAY: ":99" } });
console.log(JSON.stringify({ level, created: created.sessionId, region: [st.regionFrom, st.regionTo], camera: cam, out }));
