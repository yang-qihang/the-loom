#!/usr/bin/env bash
# Start the LoomCraft Paper server (locked stack: Paper 26.1.2 build 74 / Java 25).
# One command from an empty data dir: downloads+verifies Paper, writes config, installs
# the plugin jar, starts the server, waits for "Done (" + RPC port.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${MC_DATA_DIR:-$ROOT/it/.mc-server}"
PORT="${MC_PORT:-25565}"
RPC_PORT="${MC_RPC_PORT:-8765}"
VERSION="26.1.2"
BUILD="74"
JAR_SHA256="1d70b1dab9cf4a6de615209a536f3a45a2186240253c428213ce2188ab95e5f7"
PLUGIN_JAR="$ROOT/plugin/build/libs/loomcraft-plugin.jar"

mkdir -p "$DATA/plugins" "$DATA/logs"

# --- pid guard -----------------------------------------------------------------
if [ -f "$DATA/mc.pid" ] && kill -0 "$(cat "$DATA/mc.pid")" 2>/dev/null; then
  echo "mc: already running (pid $(cat "$DATA/mc.pid"))"
  exit 0
fi

# --- paper jar (download once, verify sha256) ----------------------------------
if [ ! -f "$DATA/paper.jar" ]; then
  echo "mc: downloading Paper $VERSION build $BUILD ..."
  META=$(curl -fsSL "https://fill.papermc.io/v3/projects/paper/versions/$VERSION/builds/latest")
  URL=$(printf '%s' "$META" | python3 -c 'import json,sys; print(json.load(sys.stdin)["downloads"]["server:default"]["url"])')
  curl -fsSL "$URL" -o "$DATA/paper.jar"
fi
echo "$JAR_SHA256  $DATA/paper.jar" | sha256sum -c - >/dev/null

# --- plugin jar ----------------------------------------------------------------
if [ ! -f "$PLUGIN_JAR" ]; then
  echo "mc: building plugin ..."
  (cd "$ROOT/plugin" && ./gradlew build --no-daemon -q)
fi
cp -f "$PLUGIN_JAR" "$DATA/plugins/loomcraft-plugin.jar"

# --- configs -------------------------------------------------------------------
[ -f "$DATA/eula.txt" ] || echo "eula=true" > "$DATA/eula.txt"
cat > "$DATA/server.properties" <<EOF
online-mode=false
enforce-secure-profile=false
level-type=minecraft\:flat
level-seed=1042
generate-structures=false
gamemode=survival
difficulty=peaceful
spawn-protection=0
max-players=20
view-distance=8
simulation-distance=8
server-port=$PORT
motd=LoomCraft T1
allow-nether=false
sync-chunk-writes=false
EOF

# --- start ---------------------------------------------------------------------
# NOTE: stdin must stay OPEN. With </dev/null Paper's console reader hits EOF and spins
# printing "> " (observed ~150% CPU + multi-MB console.log). Use a FIFO held open by tail.
cd "$DATA"
rm -f console.in
mkfifo console.in
nohup tail -f /dev/null >console.in 2>/dev/null &
echo $! > mc.stdin.pid
nohup java -Xms1G -Xmx2G -jar paper.jar --nogui \
  <console.in >console.log 2>&1 &
echo $! > mc.pid
echo "mc: starting Paper (pid $(cat mc.pid), log $DATA/console.log)"

# --- health check --------------------------------------------------------------
for _ in $(seq 1 120); do
  if grep -q 'Done (' console.log 2>/dev/null; then break; fi
  if ! kill -0 "$(cat mc.pid)" 2>/dev/null; then
    echo "mc: server process died; tail:" >&2
    tail -40 console.log >&2
    exit 1
  fi
  sleep 1
done
grep -q 'Done (' console.log || { echo "mc: server not ready in 120s" >&2; tail -40 console.log >&2; exit 1; }

# RPC port up?
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$RPC_PORT") 2>/dev/null; then break; fi
  sleep 1
done
(exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null || { echo "mc: game port $PORT closed" >&2; exit 1; }
(exec 3<>"/dev/tcp/127.0.0.1/$RPC_PORT") 2>/dev/null || { echo "mc: rpc port $RPC_PORT closed" >&2; exit 1; }

echo "mc: ready | game=127.0.0.1:$PORT rpc=127.0.0.1:$RPC_PORT log=$DATA/console.log"
