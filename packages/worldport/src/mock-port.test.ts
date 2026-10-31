import { describe, expect, it } from "vitest";
import { L01Content } from "../../../content/levels/L01.content";
import { grade } from "../../grading/src/index";
import { runStudentProgram } from "../../runner/src/run";
import { MockWorldPort } from "./mock-port";

describe("MockWorldPort + L01 content", () => {
  it("prepare -> run reference -> playerBeat -> 3 星", async () => {
    const port = new MockWorldPort();
    await port.prepare(L01Content);
    await runStudentProgram({ golem: port.agent("golem") as never, world: port.world }, L01Content.def.code.referenceSolution);
    await L01Content.playerBeat!(port);
    const report = grade(L01Content.def, await port.snapshot("L01"));
    expect(report.passed).toBe(true);
    expect(report.stars).toBe(3);
  });
});
