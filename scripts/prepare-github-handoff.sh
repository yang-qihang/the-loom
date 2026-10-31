#!/usr/bin/env bash
# 生成一个干净的新仓库目录，用于 GitHub 交接；不包含构建产物/大证据/旧 git 历史。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../loom-handoff}"
case "$OUT" in *"/.git"|*"/node_modules"|*"/apps/desktop/dist") echo "拒绝输出到构建目录" >&2; exit 2;; esac
rm -rf "$OUT"; mkdir -p "$OUT"
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
