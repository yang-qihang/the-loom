// Wait until the Paper plugin service channel (ws://127.0.0.1:8765) is healthy.
// Usage: node it/mc-ready.mjs [--timeout 60] [--rpc ws://127.0.0.1:8765]
// Prints the plugin health JSON on success; on failure prints a Chinese hint and exits 1.

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

export async function waitMcReady({
  rpcUrl = process.env.LOOM_RPC_URL ?? "ws://127.0.0.1:8765",
  timeoutSec = Number(process.env.LOOM_MC_WAIT_SEC ?? 60),
} = {}) {
  const deadline = Date.now() + Math.max(1000, timeoutSec * 1000);
  let last = "未知错误";
  while (Date.now() < deadline) {
    try {
      const health = await new Promise((resolve, reject) => {
        const ws = new WebSocket(rpcUrl);
        const timer = setTimeout(() => {
          try { ws.close(); } catch {}
          reject(new Error("connect timeout"));
        }, 2000);
        ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: "health", method: "health", params: {} }));
        ws.onerror = () => { clearTimeout(timer); reject(new Error("connection refused")); };
        ws.onmessage = (event) => {
          clearTimeout(timer);
          try {
            const response = JSON.parse(String(event.data));
            try { ws.close(); } catch {}
            if (response.error) reject(new Error(response.error.message));
            else resolve(response.result);
          } catch (error) { reject(error); }
        };
      });
      if (health && health.ok === true) return health;
      last = `插件返回 ok=false：${JSON.stringify(health).slice(0, 200)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(
    `真实 MC 未就绪：${timeoutSec}s 内连不上插件服务通道 ${rpcUrl}（最近错误：${last}）。\n` +
    `排查：① 先跑 npm run mc:up，确认 it/.mc-server/console.log 出现 "Done (" 与 "RPC listening on ws://127.0.0.1:8765"；` +
    `② 若端口被旧进程占用先 npm run mc:down；③ 插件 jar 是否安装（plugin/build/libs/loomcraft-plugin.jar）。`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  try {
    const health = await waitMcReady({
      rpcUrl: arg("rpc", process.env.LOOM_RPC_URL ?? "ws://127.0.0.1:8765"),
      timeoutSec: Number(arg("timeout", process.env.LOOM_MC_WAIT_SEC ?? 60)),
    });
    console.log(JSON.stringify({ ok: true, health }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
