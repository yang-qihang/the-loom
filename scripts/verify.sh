#!/usr/bin/env bash
# scripts/verify.sh — T1 QA 唯一验收入口（分层、可单独调用、JSON 证据）。
#
# 用法：
#   bash scripts/verify.sh                              # 默认 l0,l1,l2,l3,lg（lg=docs/28 专项 gate 汇总）
#   bash scripts/verify.sh --layers l0,l1               # 只跑指定层（lg=专项门禁汇总）
#   bash scripts/verify.sh --layers l2 --task 23        # 日志名带任务号
#   bash scripts/verify.sh --strict-content             # 内容线测试失败也判红（默认仅告警，不阻塞 T1 绿）
#   bash scripts/verify.sh --strict-copy                # 纯中文文案违规也判红（默认仅告警，feature freeze 后启用）
#   bash scripts/verify.sh --list                       # 列出层
# 退出码：0=绿 1=失败 2=用法错误 3=环境缺失
# 产物：verify-reports/<UTC>-<task>.log、verify-reports/latest.json、qa/evidence/qa-verify-latest.json
set -uo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

TASK="${TASK_ID:-adhoc}"
LAYERS="l0,l1,l2,l3,lg"
STRICT_CONTENT="${STRICT_CONTENT:-0}"
STRICT_COPY="${STRICT_COPY:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --layers) LAYERS="${2:-}"; shift 2 ;;
    --task) TASK="${2:-}"; shift 2 ;;
    --strict-content) STRICT_CONTENT=1; shift ;;
    --strict-copy) STRICT_COPY=1; shift ;;
    --list) echo "l0=typecheck+pure-zh-warn  l1=unit-tests  l2=contracts  l3=content-acceptance  lg=gates(...)  ux=UOS(Playwright，默认不跑，彩排前必跑)"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v node >/dev/null || { echo "ENVIRONMENT_MISSING: node" >&2; exit 3; }
command -v npx >/dev/null || { echo "ENVIRONMENT_MISSING: npx" >&2; exit 3; }
[[ -f package.json ]] || { echo "ENVIRONMENT_MISSING: package.json (run from repo root)" >&2; exit 3; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="verify-reports"
mkdir -p "$LOG_DIR" qa/evidence
LOG="$LOG_DIR/${TS}-${TASK}.log"
SUMMARY="$LOG_DIR/latest.json"
START_NS="$(date +%s%N)"
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

L_NAMES=(); L_STATUS=(); L_MS=(); L_DETAIL=()
FAIL=0
WARN=0
WARN_NOTES=()
run_layer() {
  local name="$1"; shift
  local t0 t1 ms rc
  log "▶ LAYER $name :: $*"
  t0="$(date +%s%N)"
  "$@" >>"$LOG" 2>&1
  rc=$?
  t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
  L_NAMES+=("$name"); L_MS+=("$ms")
  if [[ $rc -eq 0 ]]; then L_STATUS+=("pass"); L_DETAIL+=(""); log "✓ $name (${ms}ms)";
  elif [[ $rc -eq 4 ]]; then L_STATUS+=("warn"); L_DETAIL+=("warn"); WARN=1; log "! $name warn (${ms}ms)";
  else L_STATUS+=("fail"); L_DETAIL+=("exit=$rc"); FAIL=1; log "✗ $name exit=$rc (${ms}ms)"; fi
}

# ---- layers ----
layer_l0() {
  local tc_out tc_rc bad type_warn=0
  tc_out="$(npm run typecheck 2>&1)"; tc_rc=$?
  printf '%s\n' "$tc_out"
  if [[ $tc_rc -ne 0 ]]; then
    # 只豁免 content/levels/*.content.test.ts（内容线 WIP，非 QA scope）；其它 typecheck 错误仍判红
    bad="$(printf '%s\n' "$tc_out" | grep -E '^[^ (]+\([0-9]+,[0-9]+\): error TS' | grep -vE '^content/levels/[^:()]+\.content\.test\.ts\(' || true)"
    if [[ -n "$bad" ]]; then
      log "✗ typecheck errors（非 content 测试 WIP）：$(printf '%s' "$bad" | head -3 | tr '\n' ' ')"
      return 1
    fi
    log "! typecheck: 仅 content/levels/*.content.test.ts 报错（内容线 WIP，非 QA scope）"
    WARN_NOTES+=("typecheck: content 测试 WIP 错误（见日志；内容线修，不阻塞 QA 门禁）")
    type_warn=1
  fi
  # 文案门禁：禁用词 + 纯中文（docs/20 §2/§3b）。默认仅告警，--strict-copy 判红。
  local copy_json="qa/evidence/qa-copy.json" line v
  npx tsx scripts/check-copy.mjs --pure-zh --json "$copy_json" >/dev/null 2>&1 || true
  line="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("qa/evidence/qa-copy.json","utf8"));const p=d.pureZh||{};const c=p.counts||{};console.log(`pure-zh violations=${c.violations??"?"} exemptTokens=${c.exemptTokens??"?"} exemptStrings=${c.exemptStrings??"?"} warnings=${c.warnings??"?"} bannedFAIL=${(d.summary||{}).FAIL??0}`)')"
  log "copy: ${line}"
  v="${line#*violations=}"; v="${v%% *}"
  if [[ "$v" != "0" ]]; then
    if [[ "$STRICT_COPY" == "1" ]]; then
      log "✗ pure-zh violations=$v（--strict-copy：判红）"
      return 1
    fi
    WARN=1
    WARN_NOTES+=("pure-zh: $v 条文案违规（见 qa/evidence/qa-copy.json；--strict-copy 可判红）")
    log "! pure-zh violations=$v（默认仅告警）"
  fi
  # RT-06: 测试 hash 冻结（T1 只告警；feature freeze 后升 --check 阻塞）
  node scripts/guard-tests.mjs --check --warn || true
  if [[ "$type_warn" == "1" ]]; then return 4; fi
  return 0
}
# l1 只跑 packages 单测；content/levels/*.test.ts 归 l3（内容线 WIP 时不拖红 l1）
layer_l1() { npx vitest run packages --reporter=default --reporter=json --outputFile=qa/evidence/vitest-packages.json; }
layer_l2() {
  npx tsx qa/spec-check.mjs || return 1
  npx tsx qa/contract-check.mjs
}
layer_l3() {
  # 关卡内容验收：L01 MockWorld 强制；若内容线已交付 content/*.test.ts，一并跑
  npx tsx qa/content-check.mjs || return 1
  local tests rc
  tests="$(ls content/levels/*.test.ts 2>/dev/null || true)"
  if [[ -n "$tests" ]]; then
    log "content tests: $(echo "$tests" | wc -l) file(s)"
    npx vitest run --config qa/vitest.content.config.ts --reporter=json --outputFile=qa/evidence/qa-content-tests.json
    rc=$?
    if [[ $rc -ne 0 ]]; then
      if [[ "$STRICT_CONTENT" == "1" ]]; then
        log "✗ content tests failed（--strict-content：判红）"
        return 1
      fi
      log "! content tests failed（内容线 WIP；默认仅告警，--strict-content 判红）"
      WARN_NOTES+=("content-tests: 非阻塞失败（见 qa/evidence/qa-content-tests.json；--strict-content 可判红）")
      return 4
    fi
  else
    log "⏭ no content/levels/*.test.ts yet（L02–L04 由内容线补齐后自动纳入 l3）"
  fi
}

layer_ux() {
  # UOS：默认不跑（耗时 ~1-2min）；彩排/合并前必须跑：bash scripts/verify.sh --layers l0,l1,l2,l3,lg,ux
  npx tsx qa/ux-sim.mjs --suite all
}

layer_lg() {
  npx tsx qa/gates.mjs
  local rc=$?
  if [[ $rc -ne 0 ]]; then return 1; fi
  local blocked
  blocked="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("qa/evidence/qa-gates.json","utf8"));process.stdout.write(String((d.summary||{}).blocked||0))')"
  local tracked
  tracked="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("qa/evidence/qa-gates.json","utf8"));process.stdout.write(String(((d.summary||{}).fail_tracked||[]).join(",")))')"
  if [[ -n "${tracked:-}" ]]; then
    WARN_NOTES+=("gates: tracked fail=${tracked}（G-FRESH-READER Round1，见 qa/evidence/qa-gates.json；Round2 前不得假绿）")
  fi
  if [[ "${blocked:-0}" != "0" ]]; then
    WARN_NOTES+=("gates: ${blocked} 个 blocked（G-REPL/G-DESKTOP/G-TOP/G-UX-SIM 等，见 qa/evidence/qa-gates.json；不得假绿）")
    return 4
  fi
  if [[ -n "${tracked:-}" ]]; then return 4; fi
  return 0
}

log "verify start task=$TASK layers=$LAYERS commit=$(git rev-parse --short HEAD 2>/dev/null || echo no-git) at=$(date -u +%FT%TZ)"
for L in ${LAYERS//,/ }; do
  case "$L" in
    l0) run_layer l0 layer_l0 ;;
    l1) run_layer l1 layer_l1 ;;
    l2) run_layer l2 layer_l2 ;;
    l3) run_layer l3 layer_l3 ;;
    lg) run_layer lg layer_lg ;;
    ux) run_layer ux layer_ux ;;
    *) echo "unknown layer: $L" >&2; exit 2 ;;
  esac
done

END_NS="$(date +%s%N)"; TOTAL_MS=$(( (END_NS - START_NS) / 1000000 ))
RESULT="pass"; [[ $WARN -ne 0 ]] && RESULT="pass"; [[ $FAIL -ne 0 ]] && RESULT="fail"

# JSON 汇总（单行 JSON，避免依赖 jq）
LAYERS_JSON=""
for i in "${!L_NAMES[@]}"; do
  [[ -n "$LAYERS_JSON" ]] && LAYERS_JSON+=","
  LAYERS_JSON+="\"${L_NAMES[$i]}\":{\"status\":\"${L_STATUS[$i]}\",\"ms\":${L_MS[$i]},\"detail\":\"${L_DETAIL[$i]}\"}"
done
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo no-git)"
WARN_JSON="[]"
if [[ ${#WARN_NOTES[@]} -gt 0 ]]; then
  WARN_JSON="["
  for note in "${WARN_NOTES[@]}"; do WARN_JSON+="\"$note\","; done
  WARN_JSON="${WARN_JSON%,}]"
fi
JSON="{\"ts\":\"${TS}\",\"task\":\"${TASK}\",\"commit\":\"${COMMIT}\",\"result\":\"${RESULT}\",\"warnings\":${WARN_JSON},\"totalMs\":${TOTAL_MS},\"log\":\"${LOG}\",\"layers\":{${LAYERS_JSON}}}"
printf '%s\n' "$JSON" > "$SUMMARY"
printf '%s\n' "$JSON" > "qa/evidence/qa-verify-latest.json"
if [[ $FAIL -ne 0 ]]; then log "VERIFY FAIL (${TOTAL_MS}ms) layers=$LAYERS"; elif [[ $WARN -ne 0 ]]; then log "VERIFY OK (with warnings) (${TOTAL_MS}ms) layers=$LAYERS"; else log "VERIFY OK (${TOTAL_MS}ms) layers=$LAYERS"; fi
echo "$JSON"
[[ $FAIL -ne 0 ]] && exit 1
exit 0
