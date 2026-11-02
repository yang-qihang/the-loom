#!/bin/sh
# 假 job：打印环境（验证 env 注入：MC_PORT/MC_RPC_PORT/MC_HOST/BOT_NAME/自定义）。
set -eu
echo "env MC_PORT=${MC_PORT:-unset}"
echo "env MC_RPC_PORT=${MC_RPC_PORT:-unset}"
echo "env MC_HOST=${MC_HOST:-unset}"
echo "env BOT_NAME=${BOT_NAME:-unset}"
echo "env CUSTOM=${LOOM_TEST_CUSTOM:-unset}"
echo "cwd=$(pwd)"
# 给父进程 reader 线程留出 drain 时间（避免 tail_log 读到时输出尚未被读取的时序抖动）
sleep 0.2
exit 0
