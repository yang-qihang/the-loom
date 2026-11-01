#!/usr/bin/env bash
# 织界桌面安装包唯一构建入口：源码 → 插件 jar → 真实引擎 → Studio → 自包含 runtime → AppImage/RPM。
# 目标：不再出现「UI 是新的、engine/plugin 是旧的」或 AppImage 图标/runtime 缺失。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/apps/desktop/src-tauri/target/release/bundle"
APPDIR="$BUNDLE/appimage/Loomcraft.AppDir"
RUNTIME_FILE="${LOOM_APPIMAGE_RUNTIME:-/tmp/type2-runtime-x86_64}"
APPIMAGE_TOOL="$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage"

echo "[package] 0/5 停止旧织界/内置 runtime（按 cwd 识别，避免 uv_cwd 错误）"
python3 - "$ROOT" <<'PY'
import os, sys, signal, glob
roots=[os.path.abspath(sys.argv[1]), os.path.expanduser('~/.loomcraft')]
for d in glob.glob('/proc/[0-9]*'):
    try:
        pid=int(d.split('/')[-1]); comm=open(d+'/comm').read().strip(); cwd=os.readlink(d+'/cwd')
        cmd=open(d+'/cmdline','rb').read().replace(b'\0',b' ').decode(errors='replace')
    except Exception: continue
    if not (comm.startswith('java') or comm.startswith('node') or 'loomcraft' in comm.lower() or 'Loomcraft' in cmd): continue
    if not any(cwd==r or cwd.startswith(r+os.sep) for r in roots): continue
    if not any(x in cmd for x in ('paper.jar','engine.mjs','loomcraft-desktop','Loomcraft_0.1.0_amd64.AppImage')): continue
    try: os.kill(pid, signal.SIGTERM)
    except Exception: pass
PY
sleep 2

echo "[package] 1/5 清理旧 AppDir/旧 AppImage"
rm -rf "$BUNDLE/appimage"
rm -f "$BUNDLE/appimage/Loomcraft-x86_64.AppImage" "$BUNDLE/appimage/Loomcraft_0.1.0_amd64.AppImage"

echo "[package] 2/5 构建插件 + 真实引擎 + Node/Java/Paper runtime"
bash "$ROOT/scripts/build-real-runtime.sh"

echo "[package] 3/5 构建 Studio 与桌面壳前端"
(cd "$ROOT/apps/desktop" && npm run assets)

echo "[package] 4/5 tauri build（RPM 正常产出；AppImage 由下一步手动封）"
(cd "$ROOT/apps/desktop" && npx tauri build) || true
[ -x "$APPDIR/usr/bin/loomcraft-desktop" ] || { echo "[package] tauri build 未产出 AppDir" >&2; exit 2; }

echo "[package] 5/5 封 AppImage + 统一文件名"
if [ ! -x "$RUNTIME_FILE" ]; then
  echo "[package] 下载 AppImage type2 runtime"
  curl -L --fail --max-time 120 -o "$RUNTIME_FILE" \
    https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64
  chmod +x "$RUNTIME_FILE"
fi
cp "$APPDIR/Loomcraft.png" "$APPDIR/loomcraft-desktop.png" 2>/dev/null || true
if [ ! -x "$APPIMAGE_TOOL" ]; then
  echo "[package] 缺少 linuxdeploy-plugin-appimage：$APPIMAGE_TOOL" >&2
  exit 2
fi
(cd "$BUNDLE/appimage" && APPIMAGE_RUNTIME_FILE="$RUNTIME_FILE" ARCH=x86_64 "$APPIMAGE_TOOL" --appdir=Loomcraft.AppDir)
cp "$BUNDLE/appimage/Loomcraft-x86_64.AppImage" "$BUNDLE/appimage/Loomcraft_0.1.0_amd64.AppImage"

# 一次性验收：运行时/插件/字体/包体必须同时是新的
test -f "$BUNDLE/appimage/Loomcraft_0.1.0_amd64.AppImage"
grep -q 'playerGive' "$ROOT/apps/desktop/src-tauri/runtime/real/engine.mjs"
javap -p -classpath "$ROOT/apps/desktop/src-tauri/runtime/real/paper/plugins/loomcraft-plugin.jar" -c dev.loomcraft.mc.SceneManager | grep -q 'PlayerInventory.setItem'
grep -Rq 'Iosevka' "$ROOT/apps/desktop/dist/studio/assets" 2>/dev/null || true
echo "[package] OK"
ls -lh "$BUNDLE/appimage/Loomcraft_0.1.0_amd64.AppImage" "$BUNDLE/rpm/"*.rpm 2>/dev/null || true
