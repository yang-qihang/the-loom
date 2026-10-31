#!/usr/bin/env bash
# 一次性验收（Lead 用）：静态门禁 + Studio E2E + 真实 MC（可选）+ 用户操作模拟（可选）+ 桌面 smoke（可选）。
# 用法：bash scripts/acceptance.sh [--real] [--ux] [--desktop]
set -uo pipefail
cd "$(dirname "$0")/.."
REAL=0; UX=0; DESKTOP=0
for a in "$@"; do case "$a" in --real) REAL=1;; --ux) UX=1;; --desktop) DESKTOP=1;; esac; done
TS="$(date -u +%Y%m%dT%H%M%SZ)"; OUT="evidence/acceptance-$TS.json"; mkdir -p evidence
pass=0; fail=0; blocked=0; declare -a items
step() { # name cmd
  local name="$1"; shift
  echo "── $name"
  if "$@" >/tmp/acc-step.log 2>&1; then
    echo "  PASS"; pass=$((pass+1)); items+=("$name:PASS")
  else
    echo "  FAIL"; tail -15 /tmp/acc-step.log; fail=$((fail+1)); items+=("$name:FAIL")
  fi
}
step "verify(l0-l3,lg)" bash scripts/verify.sh
step "studio:build" bash -c 'npm --prefix apps/studio run build'
step "studio:e2e" bash -c 'npm --prefix apps/studio run test:e2e'
if [[ $REAL == 1 ]]; then
  step "real:L1" bash -c 'npm run it:real'
  for n in 2 3 4; do
    if [[ -f "it/l${n}-real.ts" ]]; then step "real:L$n" bash -c "npx tsx it/l${n}-real.ts"; fi
  done
else
  items+=("real:L1-L4:SKIPPED(--real)"); blocked=$((blocked+1))
fi
if [[ $UX == 1 ]]; then step "ux:all" bash -c 'node qa/ux-sim.mjs --suite all'; else items+=("ux:all:SKIPPED(--ux)"); blocked=$((blocked+1)); fi
if [[ $DESKTOP == 1 ]]; then
  if [[ -f qa/desktop-smoke.sh ]]; then step "desktop:smoke" bash qa/desktop-smoke.sh; else items+=("desktop:smoke:BLOCKED"); blocked=$((blocked+1)); fi
else
  items+=("desktop:smoke:SKIPPED(--desktop)"); blocked=$((blocked+1))
fi
printf '{"ts":"%s","pass":%d,"fail":%d,"blocked":%d,"items":[' "$TS" "$pass" "$fail" "$blocked" > "$OUT"
first=1; for i in "${items[@]}"; do [[ $first == 1 ]] || printf ',' >> "$OUT"; first=0; printf '"%s"' "$i" >> "$OUT"; done
printf ']}\n' >> "$OUT"
echo "── RESULT pass=$pass fail=$fail blocked=$blocked  evidence=$OUT"
[[ $fail -eq 0 ]]
