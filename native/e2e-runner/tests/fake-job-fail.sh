#!/bin/sh
# 假 job：失败（exit 3），并把错误写 stderr。
set -eu
sleep "${FAKE_JOB_SLEEP:-0.3}"
echo "simulated assertion failure for ${FAKE_LEVEL:-?}" >&2
exit 3
