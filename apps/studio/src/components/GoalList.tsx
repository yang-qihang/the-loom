import { a11y, chrome } from "../copy";
import { RichText } from "./RichText";

export interface GoalState {
  id: string;
  text: string;
  done: boolean;
}

export function GoalList({ goals }: { goals: GoalState[] }) {
  return (
    <ul className="goal-list" aria-label={a11y.goal} data-testid="goal-list">
      {goals.map((goal) => (
        <li
          key={goal.id}
          className={goal.done ? "goal is-done" : "goal"}
          data-testid={`goal-${goal.id}`}
          data-done={goal.done ? "true" : "false"}
        >
          <span className="goal-mark" aria-hidden="true">
            {goal.done ? "✓" : "○"}
          </span>
          <span className="goal-text">
            <RichText text={goal.text} />
          </span>
          <span className="goal-state">{goal.done ? chrome.workbench.goalDone : chrome.workbench.goalTodo}</span>
        </li>
      ))}
    </ul>
  );
}
