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

const L01_MAP: Record<string, number> = { "four-lamps-lit": 0, "player-lit-fourth": 1, "golem-home": 2 };

/** 只显示来自文案规范的三条目标；引擎的判定文本不直接进界面。 */
function goalRows(levelId: string, result: RunResult, goals: GoalState[]) {
  if (levelId === "L01") {
    const rows: Array<{ id: string; text: string; passed: boolean }> = [];
    for (const [id, index] of Object.entries(L01_MAP).sort((a, b) => a[1] - b[1])) {
      const criterion = result.criteria.find((item) => item.id === id);
      if (!criterion) continue;
      rows.push({ id, text: goals[index]?.text ?? "", passed: criterion.passed });
    }
    return rows;
  }
  return goals.map((goal, index) => {
    const criterion = result.criteria[index];
    return { id: goal.id, text: goal.text, passed: criterion?.passed ?? false };
  });
}

export function ResultCard({ levelId, phase, stateLabel, result, waitingForPlayer, goals }: ResultCardProps) {
  const copy = levelCopy(levelId);
  const rows = result ? goalRows(levelId, result, goals) : [];

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
            {waitingForPlayer ? <p className="awaiting-line">{copy?.playerBeatUI}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
