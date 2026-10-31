#!/usr/bin/env bash
# Reset the prepared level scene to its checkpoint (plugin world.reset, ≤2s).
# Prints the plugin JSON result; exits non-zero on RPC failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_PORT="${MC_RPC_PORT:-8765}"
node "$ROOT/it/reset.mjs" "$RPC_PORT"
