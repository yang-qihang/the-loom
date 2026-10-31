#!/usr/bin/env bash
# 一键启动织界桌面版：先清理旧实例/残留 Paper/引擎，再启动最新自包含 AppImage。
# 用法：
#   bash scripts/launch-desktop.sh
#   bash scripts/launch-desktop.sh --reset-settings   # 同时重置窗口/伴玩坏状态
#   bash scripts/launch-desktop.sh --dry-run          # 只看会做什么
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${LOOM_APPIMAGE:-$ROOT/apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage}"
LOG_DIR="$HOME/.loomcraft/logs"
LOG="$LOG_DIR/desktop-launch.log"
RESET_SETTINGS=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --reset-settings) RESET_SETTINGS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

[ -f "$APP" ] || { echo "找不到安装包：$APP" >&2; exit 2; }
mkdir -p "$LOG_DIR"

# 只匹配织界自己的进程，绝不碰 Minecraft / Prism / 系统 Java。
patterns=(
  "$APP"
  "Loomcraft.*\.AppImage"
  "loomcraft-desktop"
  "/appimage_extracted_.*/usr/lib/Loomcraft/runtime/real/"
  "$ROOT/apps/desktop/src-tauri/runtime/real/"
)
collect_pids() {
  local pat pids=""
  for pat in "${patterns[@]}"; do
    pids+=$(pgrep -f "$pat" 2>/dev/null || true)$'\n'
  done
  printf '%s\n' "$pids" | awk 'NF' | sort -un | while read -r pid; do
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "${PPID:-0}" ] && continue
    # 排除脚本自身及其父 shell
    if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'launch-desktop.sh'; then continue; fi
    echo "$pid"
  done
}

PIDS="$(collect_pids)"
if [ -n "$PIDS" ]; then
  echo "[launch] 关闭旧织界实例与后端：$(echo $PIDS | tr '\n' ' ')"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[launch] dry-run：跳过 kill/启动"
    exit 0
  fi
  for pid in $PIDS; do kill -TERM "$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.3
    PIDS="$(collect_pids)"
    [ -z "$PIDS" ] && break
  done
  if [ -n "$PIDS" ]; then
    echo "[launch] 强制结束残留：$(echo $PIDS | tr '\n' ' ')"
    for pid in $PIDS; do kill -KILL "$pid" 2>/dev/null || true; done
    sleep 0.5
  fi
else
  echo "[launch] 没有发现旧实例"
  [ "$DRY_RUN" = "1" ] && { echo "[launch] dry-run 完成"; exit 0; }
fi

if [ "$RESET_SETTINGS" = "1" ]; then
  cp "$HOME/.loomcraft/settings.json" "$HOME/.loomcraft/settings.json.bak" 2>/dev/null || true
  cat > "$HOME/.loomcraft/settings.json" <<'JSON'
{"alwaysOnTop":false,"mode":"workbench","page":"wizard","prismCommand":null,"window":{"x":100,"y":60,"width":1280,"height":840}}
JSON
  echo "[launch] 已重置窗口/模式设置"
fi

export DISPLAY="${DISPLAY:-:0}"
export GDK_BACKEND=x11
echo "[launch] 启动：$APP"
nohup "$APP" >"$LOG" 2>&1 &
APP_PID=$!
echo "[launch] PID=$APP_PID，日志：$LOG"

# 等后端真实可用（首次启动会复制 Paper 世界，可能要 30–60 秒）。
for i in $(seq 1 60); do
  if curl -fsS --max-time 1 http://127.0.0.1:4317/api/health >/tmp/loom-health.json 2>/dev/null; then
    if grep -q '"connected":true' /tmp/loom-health.json 2>/dev/null; then
      echo "[launch] 织界已就绪（引擎 + Paper + 织偶在线）"
      echo "[launch] Minecraft 直连 localhost:25565"
      exit 0
    fi
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[launch] 桌面进程已退出，最后日志：" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  sleep 1
done

echo "[launch] 已启动，但 60 秒内未等到后端就绪。请查看：$LOG" >&2
tail -20 "$LOG" 2>/dev/null >&2
exit 1
