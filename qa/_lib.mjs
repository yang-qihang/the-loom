// QA 共享工具（T1）：只读导入产品包，不改任何产品代码。
// 运行方式：npx tsx qa/<script>.mjs（tsx 负责 TS 模块解析）
import fs from "node:fs";
import path from "node:path";
import { L01, validateLevel } from "../packages/level-spec/src/index.ts";
import { L01Content } from "../content/levels/L01.content.ts";
import { MockWorldPort } from "../packages/worldport/src/mock-port.ts";
import { runStudentProgram } from "../packages/runner/src/run.ts";
import { grade } from "../packages/grading/src/index.ts";
import {
  LevelMetaSchema,
  WorldEventSchema,
  WorldSnapshotSchema,
} from "../packages/protocol/src/index.ts";

export const ROOT = process.cwd();
export const EVIDENCE_DIR = path.join(ROOT, "qa/evidence");
export { L01, L01Content, MockWorldPort, runStudentProgram, grade, validateLevel };
export { LevelMetaSchema, WorldEventSchema, WorldSnapshotSchema };

export function writeEvidence(name, data) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

export function nowIso() {
  return new Date().toISOString();
}

/** 跑一关学生程序 → 可选玩家节拍 → 插件/Mock 快照 → 评分。 */
export async function gradeRun({ source, def = L01Content.def, content = L01Content, playerBeat = true, levelId = "L01" }) {
  const port = new MockWorldPort();
  await port.prepare(content);
  let runError = null;
  try {
    await runStudentProgram({ golem: port.agent("golem"), world: port.world }, source);
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }
  if (playerBeat && content.playerBeat) await content.playerBeat(port);
  const snapshot = await port.snapshot(levelId);
  const report = grade(def, snapshot);
  await port.dispose();
  return { report, snapshot, runError };
}

/** 断言式检查：收集 pass/fail，不抛异常（便于统一输出 JSON）。 */
export function makeChecker() {
  const checks = [];
  return {
    checks,
    async check(id, name, fn) {
      try {
        const detail = await fn();
        checks.push({ id, name, status: "pass", detail: detail ?? null });
      } catch (err) {
        checks.push({ id, name, status: "fail", detail: err instanceof Error ? err.message : String(err) });
      }
      return this;
    },
    assert(cond, message) {
      if (!cond) throw new Error(message);
      return true;
    },
    summary() {
      const failed = checks.filter(c => c.status === "fail");
      return { total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
    },
  };
}
