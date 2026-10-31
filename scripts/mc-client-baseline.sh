#!/usr/bin/env bash
# 给 Prism / 原版客户端写一份「织界视觉基线」；只动视觉/语言键，先备份 options.txt。
set -euo pipefail
CANDIDATES=(
  "${MC_OPTIONS:-}"
  "$HOME/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances/Village Development/minecraft/options.txt"
  "$HOME/.minecraft/options.txt"
)
OPT=""
for c in "${CANDIDATES[@]}"; do [ -n "$c" ] && [ -f "$c" ] && { OPT="$c"; break; }; done
if [ -z "$OPT" ]; then
  echo "没有找到 options.txt；用法：MC_OPTIONS=/path/to/options.txt $0" >&2; exit 2
fi
cp "$OPT" "$OPT.loom-backup.$(date +%s)"
python3 - "$OPT" <<'PY'
import sys
p=sys.argv[1]
want={
 "graphicsMode":"1", "renderDistance":"12", "simulationDistance":"8",
 "clouds":"true", "cloudRange":"96", "biomeBlendRadius":"4",
 "mipmapLevels":"4", "entityShadows":"true", "ao":"true",
 "particles":"1", "lang":"zh_cn", "guiScale":"3", "gamma":"0.6",
 "pauseOnLostFocus":"false", "fullscreen":"false", "exclusiveFullscreen":"false",
 "fov":"0.0", "screenEffectScale":"1.0", "chatOpacity":"1.0",
}
lines=open(p,encoding='utf-8').read().splitlines()
seen=set(); out=[]
for line in lines:
 if ':' in line:
  k=line.split(':',1)[0]
  if k in want:
   out.append(f"{k}:{want[k]}"); seen.add(k); continue
 out.append(line)
for k,v in want.items():
 if k not in seen: out.append(f"{k}:{v}")
open(p,'w',encoding='utf-8').write('\n'.join(out)+'\n')
print('baseline written',p)
PY
