#!/usr/bin/env bash
# 生成一个干净的新仓库目录，用于 GitHub 交接；不包含构建产物/大证据/旧 git 历史。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../loom-handoff}"
# 交接输出必须是仓库之外的新目录，绝不递归删除调用方传入的路径。
OUT="$(python3 - "$OUT" <<'PY_PATH'
import os, sys
print(os.path.realpath(os.path.abspath(sys.argv[1])))
PY_PATH
)"
case "$ROOT/" in "$OUT/"*) echo "拒绝覆盖仓库或其上级目录" >&2; exit 2;; esac
case "$OUT" in "$ROOT"|"$ROOT"/*) echo "拒绝输出到当前仓库内" >&2; exit 2;; esac
if [ -e "$OUT" ]; then
  if [ ! -d "$OUT" ] || [ -n "$(find "$OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "交接输出已存在且非空，请使用一个新目录：$OUT" >&2
    exit 2
  fi
fi
mkdir -p "$OUT"
cd "$ROOT"
# 用 git archive 取已跟踪文件；再剔除构建/大证据。
git archive HEAD | tar -x -C "$OUT"
rm -rf "$OUT/apps/desktop/dist" "$OUT/apps/desktop/src-tauri/target" "$OUT/node_modules" "$OUT/apps/studio/node_modules"
find "$OUT/evidence" -type f \( -name '*-sheet.png' -o -name 'annc*.png' -o -name 'L0*label*.png' \) -delete 2>/dev/null || true
cd "$OUT"
git init -q
git add -A
git -c user.name="Loom Handoff" -c user.email="loom@example.invalid" commit -qm "Loom handoff snapshot"
echo "handoff repo: $OUT"
echo "next: git remote add origin <your-github-url> && git push -u origin HEAD"
