import type { WorldSnapshot, WorldEvent } from "../../protocol/src/index";
import { makeGraderApi, type GraderApi, type LevelDef, type Check } from "../../level-spec/src/index";

export interface CriterionResult {
  id: string;
  text: string;
  passed: boolean;
}

export interface GradeReport {
  levelId: string;
  passed: boolean;
  stars: number;
  criteria: CriterionResult[];
  hidden: CriterionResult[];
  failures: string[];
}

function runChecks(checks: Check[], g: GraderApi): CriterionResult[] {
  return checks.map(c => {
    let passed = false;
    try {
      passed = c.check(g) === true;
    } catch {
      passed = false;
    }
    return { id: c.id, text: c.text, passed };
  });
}

export function grade(level: LevelDef, snapshot: WorldSnapshot): GradeReport {
  const g = makeGraderApi(snapshot);
  const criteria = runChecks(level.task.successCriteria, g);
  const hidden: CriterionResult[] = [];
  for (const trial of level.task.hiddenTests) hidden.push(...runChecks(trial.assertions, g));

  const visiblePassed = criteria.every(c => c.passed);
  const hiddenPassed = hidden.length > 0 && hidden.every(c => c.passed);
  const playerBeatDone = snapshot.events.some(e => e.type === "block.place" && e.actorType === "player");
  const stars = (visiblePassed ? 1 : 0) + (hiddenPassed ? 1 : 0) + (playerBeatDone ? 1 : 0);
  const failures = [...criteria, ...hidden].filter(c => !c.passed).map(c => c.text);
  return {
    levelId: level.id,
    passed: visiblePassed && hiddenPassed && playerBeatDone,
    stars,
    criteria,
    hidden,
    failures,
  };
}

export { makeGraderApi };
export type { WorldEvent };
