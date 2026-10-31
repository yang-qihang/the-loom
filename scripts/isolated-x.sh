#!/usr/bin/env bash
# 为自动化测试准备隔离的 X display。绝不使用用户真实桌面 :0。
set -euo pipefail
DISPLAY_NUM="${LOOM_TEST_DISPLAY:-:98}"
case "$DISPLAY_NUM" in
  :0|:0.*) echo "拒绝在真实桌面 $DISPLAY_NUM 上运行自动化；请用 :98/:99" >&2; exit 2;;
esac
export DISPLAY="$DISPLAY_NUM"
if ! xdpyinfo >/dev/null 2>&1; then
  /tmp/usr/bin/Xvfb "$DISPLAY_NUM" -screen 0 1600x1000x24 -nolisten tcp >/tmp/loom-xvfb.log 2>&1 &
  sleep 1
fi
# 自绘标题栏需要 WM；Xvfb 默认没有。没有 openbox 时至少保证窗口可显示。
if command -v openbox >/dev/null 2>&1 && ! pgrep -f "openbox.*${DISPLAY_NUM#:}" >/dev/null 2>&1; then
  openbox >/tmp/loom-openbox.log 2>&1 &
fi
echo "$DISPLAY"
