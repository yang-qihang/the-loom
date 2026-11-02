#!/bin/sh
# 假 job：挂起不退出（测超时 kill）。FAKE_JOB_TREE=1 时再挂一个子进程，验证进程组整棵被杀。
set -eu
if [ "${FAKE_JOB_TREE:-0}" = "1" ]; then
  sleep 120 &
  echo "child_pid=$!" > "${FAKE_JOB_CHILD_PID_FILE:-/tmp/loom-fake-child.pid}"
fi
sleep 120
