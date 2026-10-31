import type { WorldSnapshot, WorldEvent } from "../../protocol/src/index";
import type { GraderApi, LevelDef, Check } from "../../level-spec/src/index";

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

const key = (p: number[]): string => p.join(",");
const dist = (a: { pos: number[] }, b: { pos: number[] }): number =>
  Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);

export function makeGraderApi(snapshot: WorldSnapshot): GraderApi {
  return {
    var: name => snapshot.vars[name],
    block: pos => ({ id: snapshot.blocks[key(pos)] ?? "minecraft:air" }),
    events: type => snapshot.events.filter(e => e.type === type),
    agent: id => {
      const a = snapshot.agents[id];
      if (!a) throw new Error(`未知 agent: ${id}`);
      return { pos: a.pos };
    },
    npc: name => {
      const n = snapshot.npcs?.[name];
      if (!n) throw new Error(`未知 npc: ${name}`);
      return { pos: n.pos };
    },
    withinRadius: (a, b, radius) => dist(a, b) <= radius,
  };
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

export type { WorldEvent };
