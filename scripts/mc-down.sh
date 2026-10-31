#!/usr/bin/env bash
# Stop the LoomCraft Paper server started by scripts/mc-up.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${MC_DATA_DIR:-$ROOT/it/.mc-server}"

if [ ! -f "$DATA/mc.pid" ]; then
  echo "mc: no pidfile at $DATA/mc.pid (already stopped?)"
  exit 0
fi
PID="$(cat "$DATA/mc.pid")"
if kill -0 "$PID" 2>/dev/null; then
  echo "mc: stopping pid $PID"
  kill "$PID"
  for _ in $(seq 1 30); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$PID" 2>/dev/null || true
else
  echo "mc: pid $PID not running"
fi
if [ -f "$DATA/mc.stdin.pid" ]; then
  kill "$(cat "$DATA/mc.stdin.pid")" 2>/dev/null || true
  rm -f "$DATA/mc.stdin.pid"
fi
rm -f "$DATA/mc.pid" "$DATA/console.in"
echo "mc: stopped"
