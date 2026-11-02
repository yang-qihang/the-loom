#!/bin/sh
# 假 Paper：模拟 StackProvisioner 期望的 ready 行为。
# 以 `<java_bin> -Xms1G -Xmx2G -jar paper.jar --nogui` 调用，cwd = worker 目录。
# 1) 从 plugins/LoomCraft/config.yml 读 ws.port；起一个 TCP listener（python3）
# 2) 打印插件启动行 + "Done (fake ...)"，随后阻塞读 stdin；收到 "stop" 退出 0。
set -eu
CONFIG="plugins/LoomCraft/config.yml"
RPC_PORT=8765
if [ -f "$CONFIG" ]; then
  RPC_PORT=$(sed -n 's/^[[:space:]]*port:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$CONFIG" | head -1)
  [ -n "$RPC_PORT" ] || RPC_PORT=8765
fi
MC_PORT=$(sed -n 's/^server-port=\([0-9][0-9]*\).*/\1/p' server.properties 2>/dev/null | head -1)
echo "[LoomCraft] LoomCraft MC plugin enabled | mc=26.1.2 | rpc=127.0.0.1:${RPC_PORT}"
echo "[LoomCraft] RPC listening on ws://127.0.0.1:${RPC_PORT}"
STARTUP_DELAY=$(cat .fake-ready-delay 2>/dev/null || echo 0)
[ "$STARTUP_DELAY" = "0" ] || sleep "$STARTUP_DELAY"
python3 - "$RPC_PORT" <<'PY' &
import socket, sys, time
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port))
s.listen(8)
while True:
    try:
        conn, _ = s.accept()
        conn.close()
    except OSError:
        break
PY
LISTENER_PID=$!
trap 'kill "$LISTENER_PID" 2>/dev/null || true' EXIT INT TERM
MCPORT=${MC_PORT:-25565}
echo "[Server thread/INFO]: Preparing level \"world\" (mc-port=${MCPORT})"
echo "[Server thread/INFO]: Done (fake 0.05s)! For help, type \"help\""
echo "FAKE_JAVA_READY rpc=${RPC_PORT} mc=${MCPORT} pid=$$"
# 等 stdin 的 stop；stdin 关闭也退出
while IFS= read -r line; do
  case "$line" in
    stop|stop*) echo "[Server thread/INFO]: Stopping server"; exit 0 ;;
  esac
done
exit 0
