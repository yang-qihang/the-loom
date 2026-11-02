#!/bin/sh
# 假 job：大量输出（验证 tail_log 截断与不 OOM）。
set -eu
i=0
while [ "$i" -lt "${FAKE_JOB_LINES:-20000}" ]; do
  echo "line $i 0123456789012345678901234567890123456789"
  i=$((i+1))
done
echo "SPAM_LAST_LINE"
exit 0
