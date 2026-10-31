#!/usr/bin/env bash
# 组装桌面包内置真实运行时：Node + Java + Paper + 插件 + 世界 + 真实引擎 + 织偶依赖。
# 构建机需要：Node 22、Java 25（默认 Prism runtime）、可用 Paper server + 插件、bot/node_modules。
# 产物：apps/desktop/src-tauri/runtime/real/（被 .gitignore 忽略，由安装包携带）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri/runtime/real"
PAPER_SRC="${LOOM_PAPER_DIR:-$ROOT/it/.mc-server}"
JAVA_HOME_SRC="${LOOM_JAVA_HOME:-$HOME/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/java/java-runtime-epsilon}"
NODE_BIN="${LOOM_NODE_BIN:-$(command -v node)}"

[ -f "$PAPER_SRC/paper.jar" ] || { echo "缺少 $PAPER_SRC/paper.jar" >&2; exit 2; }
[ -x "$JAVA_HOME_SRC/bin/java" ] || { echo "缺少 Java runtime：$JAVA_HOME_SRC（用 LOOM_JAVA_HOME 覆盖）" >&2; exit 2; }
[ -d "$ROOT/bot/node_modules" ] || { echo "缺少 bot/node_modules" >&2; exit 2; }

rm -rf "$DEST"; mkdir -p "$DEST"/{bot,node/bin,node/lib,node_modules,paper,java}
# 1) 真实引擎（Paper 适配器真实打包；bot 外部化，运行时从 ./bot/manager.mjs 加载）
cat > "$ROOT/.build-real-engine.mjs" <<'NODE'
import { build } from "esbuild";
import { statSync } from "node:fs";
const out = process.argv[2];
await build({
  entryPoints: ["apps/engine/src/server.ts"], bundle: true, platform: "node", format: "esm",
  target: "node22", outfile: out, external: ["esbuild", "typescript"],
  plugins: [{ name: "bot-external", setup(b) { b.onResolve({ filter: /bot[/\\]manager\.mjs$/ }, () => ({ path: "./bot/manager.mjs", external: true })); } }],
  logLevel: "warning",
});
console.log("engine", statSync(out).size);
NODE
node "$ROOT/.build-real-engine.mjs" "$DEST/engine.mjs"; rm -f "$ROOT/.build-real-engine.mjs"
# 2) 织偶 + 依赖
cp "$ROOT/bot/manager.mjs" "$ROOT/bot/package.json" "$DEST/bot/"
cp -a "$ROOT/bot/node_modules" "$DEST/bot/node_modules"
# 3) engine 外置依赖
cp -a "$ROOT/node_modules/esbuild" "$ROOT/node_modules/typescript" "$DEST/node_modules/"
# 4) Node + 共享库
cp -L "$NODE_BIN" "$DEST/node/bin/node"
for lib in $(ldd "$NODE_BIN" | awk '/=> \//{print $3} /^\//{print $1}'); do cp -L "$lib" "$DEST/node/lib/" 2>/dev/null || true; done
# 5) Java
cp -a "$JAVA_HOME_SRC/." "$DEST/java/"
# 6) Paper / 插件 / 世界（日志与运行时输入输出不打包）
rsync -a --exclude logs --exclude 'console.*' --exclude '*.log' "$PAPER_SRC/" "$DEST/paper/"
# 7) eula
printf 'eula=true\n' > "$DEST/paper/eula.txt"
du -sh "$DEST"
