#!/bin/sh
# 假 job：崩溃（SIGSEGV），进程组应被回收。
set -eu
sleep "${FAKE_JOB_SLEEP:-0.2}"
kill -SEGV $$
sleep 5
