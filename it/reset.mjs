// Reset the prepared scene to its checkpoint via the plugin RPC (used by scripts/mc-reset.sh).
// Usage: node it/reset.mjs [rpcPort]
const port = Number(process.argv[2] ?? process.env.MC_RPC_PORT ?? 8765);

function call(method, params = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      reject(new Error(`rpc timeout: ${method}`));
      try { ws.close(); } catch {}
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }));
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`rpc unavailable on 127.0.0.1:${port}`));
    };
    ws.onmessage = (event) => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(String(event.data));
        ws.close();
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      } catch (err) {
        reject(err);
      }
    };
  });
}

try {
  const result = await call("world.reset", {});
  console.log(JSON.stringify(result));
  process.exit(result && result.ok ? 0 : 1);
} catch (err) {
  console.error(`reset failed: ${err.message}`);
  process.exit(1);
}
