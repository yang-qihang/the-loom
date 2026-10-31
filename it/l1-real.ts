// @ts-nocheck
// T2 real-MC e2e for L01 (第一缕光) — thin wrapper on the shared harness.
//
// Main flow: derived scene (L01 lamps are elevated → scene hint groundY=11) → reference solution
// through the same runner transform → testMode playerBeat → 3 stars → MockWorld report/digest
// comparison → REQ-EPOCH + REQ-RESET-01 → evidence `evidence/l1-real-*.json`.
//
// Extra legacy T1 controls (still part of the acceptance): starter code must fail; reference without
// the player beat must fail; both compared against MockWorld.
import { L01Content } from "../content/levels/L01.content";
import { runStudentProgram } from "../packages/runner/src/run";
import { runRealLevel, reportShape, digestOf, diffDigest } from "./real-harness";

const def = L01Content.def;

await runRealLevel({
  name: "l1",
  content: L01Content,
  scene: { groundY: 11, floorY: 10, playerSpawn: [2, 11, 4] },
  afterMain: async (ctx) => {
    const { port, content, grade, runMockScenario, check, sleep } = ctx;
    const scenarios = [
      { id: "starter", label: "starter 未修改", code: def.code.starterCode, playerBeat: true, expectPassed: false },
      { id: "no-beat", label: "缺玩家节拍", code: def.code.referenceSolution, playerBeat: false, expectPassed: false },
    ];
    for (const scenario of scenarios) {
      await port.reset(content);
      await runStudentProgram({ golem: port.agent("golem"), world: port.world }, scenario.code);
      if (scenario.playerBeat && content.playerBeat) await content.playerBeat(port);
      await sleep(500);
      const snapshot = await port.snapshot(def.id);
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.writeFileSync(path.join("evidence", `l1-scenario-${scenario.id}-snapshot.json`), JSON.stringify(snapshot, null, 1));
      const report = grade(def, snapshot);
      const mock = await runMockScenario(content, scenario.code, scenario.playerBeat);
      check(`l1.${scenario.id}.not-passed`, report.passed === false, reportShape(report));
      check(
        `l1.${scenario.id}.report-equals-mock`,
        JSON.stringify(reportShape(report)) === JSON.stringify(reportShape(mock.report)),
        { real: reportShape(report), mock: reportShape(mock.report) },
      );
      const diffs = diffDigest(digestOf(def, snapshot, mock.snapshot), digestOf(def, mock.snapshot, mock.snapshot));
      check(`l1.${scenario.id}.digest-equals-mock`, diffs.length === 0, diffs.length ? diffs : null);
      if (scenario.id === "starter") {
        check("l1.starter.has-failures", report.failures.length > 0, report.failures);
      }
      if (scenario.id === "no-beat") {
        check(
          "l1.no-beat.player-lit-fourth-fails",
          report.criteria.find((c) => c.id === "player-lit-fourth")?.passed === false,
        );
      }
    }
  },
});
