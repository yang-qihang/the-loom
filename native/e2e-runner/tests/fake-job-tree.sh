#!/bin/sh
# 假 job：进程树。父进程与 2 个子进程都 sleep；被 kill 时整组必须消失。
set -eu
sleep 120 &
echo "$!" > "${FAKE_JOB_CHILD_FILE:-/tmp/loom-tree-child1.pid}"
sleep 120 &
echo "$!" > "${FAKE_JOB_CHILD_FILE:-/tmp/loom-tree-child1.pid}.2"
echo "TREE_READY pid=$$"
wait
