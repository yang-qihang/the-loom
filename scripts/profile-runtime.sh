#!/usr/bin/env bash
# 织界运行时采样：壳 / 内置 Java(Paper) / Node(引擎) / Minecraft 的 RSS+CPU。
# 用法：bash scripts/profile-runtime.sh [次数] [间隔秒]
set -uo pipefail
N="${1:-3}"; GAP="${2:-2}"
echo "时间: $(date -Is)  （RSS 单位 KiB，CPU 为采样瞬间 %）"
for i in $(seq 1 "$N"); do
  echo "--- sample $i/$N ---"
  ps -eo pid,rss,pcpu,etime,comm,args --sort=-rss \
    | grep -E 'loomcraft-desktop|Loomcraft.*AppImage|runtime/real/(java|node)|paper\.jar|minecraft|PrismLauncher' \
    | grep -v grep | head -12
  free -h | awk 'NR==1||/^Mem:/'
  sleep "$GAP"
done
