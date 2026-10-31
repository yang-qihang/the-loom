#!/usr/bin/env bash
# 兼容入口：qa/desktop-smoke.mjs --gate desktop|top
set -uo pipefail
cd "$(dirname "$0")/.."
exec node qa/desktop-smoke.mjs "$@"
