import { chrome, labels, levelCopy, states } from "../copy";
import type { RunResult, SessionPhase } from "../types";
import { RichText } from "./RichText";
import { Stars } from "./Stars";
import type { GoalState } from "./GoalList";

interface ResultCardProps {
  levelId: string;
  phase: SessionPhase;
  stateLabel: string;
  result: RunResult | null;
  waitingForPlayer: boolean;
  goals: GoalState[];
}

/**
 * 结果行：优先用引擎 progress 真值（docs/46 §1.1；id/text/passed 与目标面板同源）。
 * 旧引擎没有 progress 时回退「copy 目标文案 + 按位置对齐 criteria」的兼容展示。
 */
function goalRows(result: RunResult, goals: GoalState[]) {
  const progress = (result.progress ?? []).filter((item) => !!item && typeof item.id === "string");
  if (progress.length > 0) {
    return progress.map((item) => ({ id: item.id, text: item.text, passed: item.passed }));
  }
  return goals.map((goal, index) => {
    const criterion = result.criteria[index];
    return { id: goal.id, text: goal.text, passed: criterion?.passed ?? false };
  });
}

export function ResultCard({ levelId, phase, stateLabel, result, waitingForPlayer, goals }: ResultCardProps) {
  const copy = levelCopy(levelId);
  const rows = result ? goalRows(result, goals) : [];

  return (
    <section className="card result" aria-label={chrome.aria.result} data-testid="result-card">
      <header className="card-head">
        <h3 data-ui-panel-title>运行结果</h3>
        {waitingForPlayer ? <span className="card-tag">等你完成</span> : result?.passed ? <Stars stars={result.stars} /> : <span className="card-tag">{result ? "未通过" : stateLabel}</span>}
      </header>
      <div className="card-body">
        {!result && phase === "ready" ? (
          <p className="muted" data-testid="result-placeholder">
            {chrome.workbench.resultPlaceholder}
          </p>
        ) : null}

        {!result && (phase === "running" || phase === "loading") ? <p className="muted">{chrome.workbench.resultRunning}</p> : null}

        {!result && phase === "awaiting-player-beat" ? <p className="awaiting-line">{copy?.playerBeatUI}</p> : null}

        {waitingForPlayer ? (
          <p className="awaiting-line" data-testid="result-headline">
            {copy?.playerBeatUI ?? "轮到你完成最后一步。"}
          </p>
        ) : result ? (
          <>
            <p className={result.passed ? "result-headline is-pass" : "result-headline"} data-testid="result-headline">
              {result.passed ? copy?.settle.stars : copy?.fail}
            </p>
            <ul className="criteria-list">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={row.passed ? "criterion is-pass" : "criterion is-fail"}
                  data-testid={`criterion-${row.id}`}
                >
                  <span className="criterion-mark" aria-hidden="true">
                    {row.passed ? "✓" : "✗"}
                  </span>
                  <span>
                    <RichText text={row.text} />
                  </span>
                  <span className="criterion-state">{row.passed ? chrome.workbench.goalDone : chrome.workbench.goalTodo}</span>
                </li>
              ))}
            </ul>
            {result.codeCriteria && result.codeCriteria.length > 0 ? (
              <div className="code-req" data-testid="code-req">
                <p className="code-req-title">这一关真的用到的写法</p>
                <ul className="code-req-list">
                  {result.codeCriteria.map((item) => (
                    <li key={item.id} className={item.passed ? "code-req-item is-pass" : "code-req-item"} data-testid={`code-req-${item.id}`}>
                      <span className="code-req-mark" aria-hidden="true">{item.passed ? "✓" : "○"}</span>
                      <span><RichText text={item.text} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {waitingForPlayer ? <p className="awaiting-line">{copy?.playerBeatUI}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
