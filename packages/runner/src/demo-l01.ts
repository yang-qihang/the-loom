import { MockWorld } from "../../mockworld/src/index";
import { L01 } from "../../level-spec/src/index";
import { grade } from "../../grading/src/index";
import { runStudentProgram } from "./run";

const lamps = L01.world.vars.lamps as [number, number, number][];

async function play(label: string, source: string, playerLightsFourth: boolean): Promise<void> {
  const world = new MockWorld({ ...L01.world.vars });
  try {
    await runStudentProgram({ golem: world.golem, world: world.world }, source);
  } catch (error) {
    console.log(`[${label}] 运行错误：`, error instanceof Error ? error.message : error);
  }
  if (playerLightsFourth) world.playerPlace("lantern", lamps[3]);
  const report = grade(L01, world.snapshot());
  console.log(`\n== ${label} ==`);
  for (const c of report.criteria) console.log(`  ${c.passed ? "✅" : "❌"} ${c.text}`);
  for (const c of report.hidden) console.log(`  ${c.passed ? "✅" : "❌"} [隐藏] ${c.text}`);
  console.log(`  通关：${report.passed ? "是" : "否"}  星级：${report.stars}/3  事件：${world.events.length}`);
}

await play("参考解（玩家补第 4 盏）", L01.code.referenceSolution, true);
await play("starter（未修改）", L01.code.starterCode, true);
await play("参考解（玩家未参与）", L01.code.referenceSolution, false);
