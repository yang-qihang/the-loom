#!/bin/sh
# 假 job：成功。env FAKE_JOB_SLEEP 控制时长（秒，默认 0.6）；FAKE_JOB_MARKER 写入完成时间戳。
set -eu
if [ -n "${FAKE_JOB_START_MARKER:-}" ]; then
  date +%s%N > "$FAKE_JOB_START_MARKER"
fi
sleep "${FAKE_JOB_SLEEP:-0.6}"
echo "FAKE_JOB_OK level=${FAKE_LEVEL:-unknown} port=${MC_PORT:-?} bot=${BOT_NAME:-?}"
if [ -n "${FAKE_JOB_MARKER:-}" ]; then
  date +%s%N > "$FAKE_JOB_MARKER"
fi
exit 0
