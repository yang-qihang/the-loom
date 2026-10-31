import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const guardScript = join(repoRoot, "scripts", "guard-tests.mjs");

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "loom-guard-"));
  mkdirSync(join(root, "packages", "demo"), { recursive: true });
  mkdirSync(join(root, "content", "levels"), { recursive: true });
  mkdirSync(join(root, "qa"), { recursive: true });
  writeFileSync(join(root, "packages", "demo", "a.test.ts"), "// a\n");
  writeFileSync(join(root, "content", "levels", "b.test.ts"), "// b\n");
  writeFileSync(join(root, "qa", "red-team.mjs"), "// red\n");
  return root;
}

function runGuard(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [guardScript, "--root", root, ...args], { encoding: "utf8" });
}

describe("RT-06 guard-tests hash manifest", () => {
  it("生成 manifest 后 --check 通过；改测试文件后 exit 1 并打印 diff；--warn 不阻塞", () => {
    const root = makeFixtureRoot();
    const update = runGuard(root);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("GUARD_TESTS UPDATED");

    const clean = runGuard(root, "--check");
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("GUARD_TESTS OK (3 files)");

    writeFileSync(join(root, "packages", "demo", "a.test.ts"), "// a changed\n");
    const drift = runGuard(root, "--check");
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain("GUARD_TESTS DRIFT");
    expect(drift.stderr).toContain("a.test.ts");

    const warn = runGuard(root, "--check", "--warn");
    expect(warn.status).toBe(0);
    expect(warn.stderr).toContain("GUARD_TESTS WARN");
  });

  it("新增测试文件也会被检测", () => {
    const root = makeFixtureRoot();
    expect(runGuard(root).status).toBe(0);
    writeFileSync(join(root, "packages", "demo", "new.test.ts"), "// new\n");
    const drift = runGuard(root, "--check");
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain("+ packages/demo/new.test.ts");
  });

  it("manifest 缺失时 --check 明确报错", () => {
    const root = makeFixtureRoot();
    const check = runGuard(root, "--check");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("manifest 不存在");
  });
});
