#!/usr/bin/env bash
# Start the Engine in real-Minecraft mode (LOOM_WORLD=paper).
# 1) ensure Paper is up (idempotent), 2) wait for plugin RPC + bot readiness, 3) start engine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4317}"
HOST="${HOST:-127.0.0.1}"

echo "[engine-paper] 1/3 确保 Paper 26.1.2 已启动（scripts/mc-up.sh 可重复执行）…"
bash "$ROOT/scripts/mc-up.sh"

echo "[engine-paper] 2/3 等待插件 RPC 就绪（ws://127.0.0.1:8765）…"
node "$ROOT/it/mc-ready.mjs" --timeout "${LOOM_MC_WAIT_SEC:-60}" >/dev/null || {
  echo "[engine-paper] 真实 MC 未就绪：插件 RPC 连不上。先看 it/.mc-server/console.log 是否有 LoomCraft 插件加载错误。" >&2
  exit 1
}

if (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null; then
  echo "[engine-paper] 端口 ${HOST}:${PORT} 已被占用（可能有另一个 engine 在跑）。" >&2
  echo "            换端口：PORT=4318 npm run dev:engine:paper；或先停掉旧 engine。" >&2
  exit 1
fi

echo "[engine-paper] 3/3 启动 Engine（LOOM_WORLD=paper，${HOST}:${PORT}）…"
export LOOM_WORLD=paper
export HOST PORT
exec npx tsx "$ROOT/apps/engine/src/server.ts"
