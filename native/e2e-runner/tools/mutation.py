#!/usr/bin/env python3
"""native-test：C++ 变异测试驱动（docs/58 §4.5）。

在 tmp 下复制 native/e2e-runner 的 isolate copy，逐个应用 curated mutation，
重新 cmake+build+ctest；mutant 被测试杀死记为 killed，存活记为 survived。
输出 JSON（默认 evidence/native-e2e/mutation.json），kill rate < --min-kill-rate 时非 0 退出。

用法：
  python3 native/e2e-runner/tools/mutation.py \
    --build-dir tmp/native-mutation \
    --out evidence/native-e2e/mutation.json \
    --min-kill-rate 0.8 \
    [--filter keyword] [--jobs N] [--list]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNNER_DIR = REPO_ROOT / "native" / "e2e-runner"
# 本机 g++ 是 ccache wrapper，~/.cache/ccache 只读：所有子进程统一指到工作区 tmp/ccache。
CCACHE_DIR = REPO_ROOT / "tmp" / "ccache"
CCACHE_DIR.mkdir(parents=True, exist_ok=True)
SAN_LIBS = REPO_ROOT / "tmp" / "native-sanitizer-libs"
BASE_ENV = {**os.environ, "CCACHE_DIR": str(CCACHE_DIR), "CCACHE_BASEDIR": str(REPO_ROOT)}
if SAN_LIBS.is_dir():
    for key in ("LIBRARY_PATH", "LD_LIBRARY_PATH"):
        current = BASE_ENV.get(key, "")
        BASE_ENV[key] = f"{SAN_LIBS}{os.pathsep}{current}" if current else str(SAN_LIBS)


@dataclass
class Mutant:
    id: str
    category: str
    description: str
    file: str
    find: str
    replace: str
    skip_reason: str | None = None
    extra: dict = field(default_factory=dict)


# curated mutants：必须针对关键逻辑（worker 数/超时比较/状态映射/端口边界/失败继续/结果排序/超时单位）。
# 注：find 为唯一子串；若源码变化导致匹配失败，本工具会报 stale 而不是静默跳过。
MUTANTS: list[Mutant] = []


def load_mutants(path: Path | None) -> list[Mutant]:
    """curated mutants 默认在 tools/mutants.json（与源码解耦，便于评审/扩展）。"""
    default = RUNNER_DIR / "tools" / "mutants.json"
    target = Path(path) if path else default
    if not target.exists():
        return MUTANTS
    data = json.loads(target.read_text(encoding="utf-8"))
    return [Mutant(**item) for item in data]


def run(cmd: list[str], cwd: Path, timeout: int, env: dict | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
            env={**BASE_ENV, **(env or {})},
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        return 124, out + "\n[timeout]"


def make_copy(dest: Path) -> None:
    # 复用 build-dir 时旧副本可能残留（之前 FileExistsError 的根因）：先容错删除再复制。
    if dest.exists() or dest.is_symlink():
        shutil.rmtree(dest, ignore_errors=True)
    if dest.exists():
        raise RuntimeError(f"无法清理旧副本目录：{dest}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    def ignore(dir_path: str, names: list[str]) -> set[str]:
        # 只排除构建产物与 .git；tests/tools 必须复制（mutation 需要真实跑 ctest）
        drop = {"build", ".git", "__pycache__"} if Path(dir_path) == RUNNER_DIR else {"build", ".git", "__pycache__"}
        return {n for n in names if n in drop or n.startswith("build-")}
    shutil.copytree(RUNNER_DIR, dest, ignore=ignore)


def patch_source(root: Path, mutant: Mutant) -> bool:
    target = root / mutant.file
    if not target.exists():
        return False
    text = target.read_text(encoding="utf-8")
    if mutant.find not in text:
        return False
    target.write_text(text.replace(mutant.find, mutant.replace, 1), encoding="utf-8")
    return True


def configure_build(source_root: Path, build_dir: Path, extra_args: list[str]) -> tuple[int, str]:
    # mutant 不跑 sanitizer（速度优先；sanitizer 由主测试矩阵负责）
    return run(["cmake", "-S", str(source_root), "-B", str(build_dir), "-DCMAKE_BUILD_TYPE=Debug", *extra_args], REPO_ROOT, 180)


def build(build_dir: Path, jobs: int) -> tuple[int, str]:
    return run(["cmake", "--build", str(build_dir), "-j", str(jobs)], REPO_ROOT, 300)


def test(build_dir: Path) -> tuple[int, str]:
    return run(["ctest", "--test-dir", str(build_dir), "--output-on-failure", "-j", "2"], REPO_ROOT, 300)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", default="tmp/native-mutation")
    parser.add_argument("--out", default="evidence/native-e2e/mutation.json")
    parser.add_argument("--min-kill-rate", type=float, default=0.8)
    parser.add_argument("--filter", default=None)
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) // 2))
    parser.add_argument("--mutants-json", default=None, help="可选：外部 mutants 定义（源码落盘后补全）")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--keep-copies", action="store_true")
    parser.add_argument("--time-budget", type=float, default=900.0, help="总预算秒数，超出后剩余标 skipped")
    args = parser.parse_args()

    mutants = load_mutants(Path(args.mutants_json) if args.mutants_json else None)
    if args.filter:
        mutants = [m for m in mutants if args.filter in m.id or args.filter in m.category]
    if args.list or not mutants:
        print(json.dumps([m.__dict__ for m in mutants], ensure_ascii=False, indent=2))
        if not mutants:
            print("[mutation] 没有 mutants（源码/清单尚未就绪）", file=sys.stderr)
            return 2
        return 0

    work_root = (REPO_ROOT / args.build_dir).resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    started = time.time()
    baseline_source = work_root / "baseline-src"
    baseline_build = work_root / "baseline-build"
    make_copy(baseline_source)
    rc, log = configure_build(baseline_source, baseline_build, [])
    if rc != 0:
        result = {"ok": False, "stage": "baseline-configure", "log": log[-4000:]}
        _write(args.out, result)
        print("[mutation] 基线 cmake 失败", file=sys.stderr)
        return 1
    rc, log = build(baseline_build, args.jobs)
    if rc != 0:
        result = {"ok": False, "stage": "baseline-build", "log": log[-4000:]}
        _write(args.out, result)
        print("[mutation] 基线编译失败（测试/实现当前不绿，先修主链路再跑变异）", file=sys.stderr)
        return 1
    rc, log = test(baseline_build)
    if rc != 0:
        result = {"ok": False, "stage": "baseline-test", "log": log[-6000:]}
        _write(args.out, result)
        print("[mutation] 基线 ctest 失败；变异 kill rate 无意义", file=sys.stderr)
        return 1

    results = []
    for mutant in mutants:
        entry = {
            "id": mutant.id,
            "category": mutant.category,
            "description": mutant.description,
            "file": mutant.file,
            "skip_reason": mutant.skip_reason,
        }
        if mutant.skip_reason:
            entry["status"] = "skipped-equivalent"
            results.append(entry)
            continue
        if time.time() - started > args.time_budget:
            entry["status"] = "skipped-budget"
            results.append(entry)
            continue
        safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", mutant.id)
        copy_dir = work_root / f"mut-{safe_id}"
        build_dir = work_root / f"build-{safe_id}"
        make_copy(copy_dir)
        if not patch_source(copy_dir, mutant):
            entry["status"] = "stale"
            entry["error"] = "mutant find 字符串在源码中未找到（源码已变化，需更新清单）"
            results.append(entry)
            continue
        rc_cfg, out_cfg = configure_build(copy_dir, build_dir, [])
        if rc_cfg != 0:
            # mutant 造成 configure/编译失败 = invalid（不能算「测试杀死」，否则会掩盖坏 mutant/坏构建）
            entry["status"] = "invalid"
            entry["invalid_by"] = "configure"
            entry["log"] = out_cfg[-2000:]
            results.append(entry)
            _cleanup(copy_dir, build_dir, args.keep_copies)
            continue
        rc_build, out_build = build(build_dir, args.jobs)
        if rc_build != 0:
            entry["status"] = "invalid"
            entry["invalid_by"] = "compile"
            entry["log"] = out_build[-2000:]
            results.append(entry)
            _cleanup(copy_dir, build_dir, args.keep_copies)
            continue
        rc_test, out_test = test(build_dir)
        if rc_test != 0:
            entry["status"] = "killed"
            entry["killed_by"] = "ctest"
            entry["log"] = out_test[-3000:]
            results.append(entry)
        else:
            entry["status"] = "survived"
            entry["log"] = out_test[-1000:]
            results.append(entry)
        _cleanup(copy_dir, build_dir, args.keep_copies)

    executed = [r for r in results if r["status"] in ("killed", "survived")]
    killed = [r for r in executed if r["status"] == "killed"]
    survived = [r for r in executed if r["status"] == "survived"]
    skipped = [r for r in results if r["status"].startswith("skipped")]
    invalid = [r for r in results if r["status"] == "invalid"]
    stale = [r for r in results if r["status"] == "stale"]
    # kill rate 分母只含「实际执行并判定」的非等价 mutant；skipped/invalid/stale 不进入分母。
    kill_rate = (len(killed) / len(executed)) if executed else 0.0
    not_executed = [r for r in results if r["status"] in ("skipped-budget",)] 
    report = {
        # 红队 P2：configure/compile 失败不得当 killed；预算跳过不得把 kill rate 抬到 100%；
        # 只有「非等价 mutant 全部实际执行 + 无 invalid/stale」时才算 ok。
        "ok": (kill_rate >= args.min_kill_rate and not invalid and not stale
               and not not_executed and len(executed) > 0),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runnerDir": str(RUNNER_DIR.relative_to(REPO_ROOT)),
        "buildDir": str(Path(args.build_dir)),
        "minKillRate": args.min_kill_rate,
        "killRate": round(kill_rate, 4),
        "counts": {"total": len(results), "executed": len(executed), "killed": len(killed),
                   "survived": len(survived), "skipped": len(skipped),
                   "skippedBudget": len(not_executed), "invalid": len(invalid), "stale": len(stale)},
        "mutants": results,
        "commands": {
            "configure": f"cmake -S {RUNNER_DIR.relative_to(REPO_ROOT)} -B {args.build_dir} -DCMAKE_BUILD_TYPE=Debug",
            "build": f"cmake --build {args.build_dir} -j {args.jobs}",
            "ctest": f"ctest --test-dir {args.build_dir} --output-on-failure",
        },
    }
    _write(args.out, report)
    print(json.dumps({k: report[k] for k in ("ok", "killRate", "counts")}, ensure_ascii=False))
    for r in results:
        print(f"  {r['id']:<28} {r['status']}{(' by ' + r['killed_by']) if r.get('killed_by') else ''}")
    return 0 if report["ok"] else 1


def _cleanup(copy_dir: Path, build_dir: Path, keep: bool) -> None:
    if keep:
        return
    shutil.rmtree(copy_dir, ignore_errors=True)
    shutil.rmtree(build_dir, ignore_errors=True)


def _write(out: str, payload: dict) -> None:
    path = (REPO_ROOT / out).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
