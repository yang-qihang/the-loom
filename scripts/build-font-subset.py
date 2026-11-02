#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构造随包 Noto Sans SC 子集（woff2）并写出覆盖率清单。

背景：Studio 正文要从像素字体换成可读中文字体（用户反馈「像素字看长文太累」）。
选 Noto Sans SC（OFL-1.1，可随包再分发），但完整 OTF 每个字重 8MB+，必须子集化：

    子集字符 = GB2312 全部字符（含 6763 个汉字）
             ∪ ASCII 可打印字符
             ∪ 仓库文本实际用到的所有字符（UI 文案 / 关卡内容 / 文档）

产物（提交进仓库，字体随 Vite 打包进 dist/assets）：

    apps/studio/src/assets/fonts/noto-sans-sc-400.woff2   （Regular）
    apps/studio/src/assets/fonts/noto-sans-sc-700.woff2   （Bold）
    apps/studio/src/assets/fonts/NotoSansSC-OFL.txt      （OFL-1.1 许可证）
    apps/studio/src/assets/fonts/noto-sans-sc-coverage.json（字符集清单 + 哈希）

依赖：Python 3.10+、fonttools、brotli（`python -m pip install fonttools brotli`）。
源字体不入库（每个 8MB+），脚本在缺失时自动从上游下载（走 HTTPS_PROXY 环境变量）。

用法（在仓库根目录）：

    python scripts/build-font-subset.py                 # 缺源字体则自动下载
    python scripts/build-font-subset.py --force-download
    python scripts/build-font-subset.py --skip-scan     # 只用 GB2312+ASCII（排查用）

统计与体积预算：每个字重 ≤ 4MB，总计 ≤ 8MB，超了脚本 exit 1。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_OUT_DIR = REPO_ROOT / "apps" / "studio" / "src" / "assets" / "fonts"
SOURCE_DIR = REPO_ROOT / ".tools" / "fonts-src"
COVERAGE_JSON = FONT_OUT_DIR / "noto-sans-sc-coverage.json"
LICENSE_OUT = FONT_OUT_DIR / "NotoSansSC-OFL.txt"

UPSTREAM_RAW = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC"
LICENSE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt"

WEIGHTS = {
    400: {
        "source": "NotoSansSC-Regular.otf",
        "url": f"{UPSTREAM_RAW}/NotoSansSC-Regular.otf",
        "output": "noto-sans-sc-400.woff2",
    },
    700: {
        "source": "NotoSansSC-Bold.otf",
        "url": f"{UPSTREAM_RAW}/NotoSansSC-Bold.otf",
        "output": "noto-sans-sc-700.woff2",
    },
}

# 仓库文本扫描范围：UI 渲染的文案都来自这些目录，写进字体避免缺字回退。
SCAN_ROOTS = [
    "apps/studio/src",
    "apps/studio/index.html",
    "content",
    "packages",
    "apps/engine/src",
    "bot",
    "plugin/src",
    "docs",
    "BRIEF.md",
    "STATUS.md",
    "AGENTS.md",
    "README.md",
    "HANDOFF.md",
]
SKIP_DIRS = {
    ".git",
    "node_modules",
    ".tools",
    ".minecraft",
    "it",
    "tmp",
    "evidence",
    "dist",
    "build",
    "target",
    ".pw-out",
    ".gradle",
    "spikes",
    ".vscode",
    ".dsh",
    "coverage",
    "report",
}
TEXT_EXTS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
    ".py",
    ".sh",
    ".yml",
    ".yaml",
    ".txt",
    ".toml",
    ".java",
    ".kt",
    ".rs",
    ".go",
    ".c",
    ".h",
    ".cpp",
}
MAX_SCAN_FILE_BYTES = 4_000_000

MAX_WEIGHT_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def gb2312_chars() -> set[str]:
    """GB2312 一级+二级汉字 + 符号区：遍历双字节编码解码。"""
    chars: set[str] = set()
    for lead in range(0xA1, 0xF8):
        for trail in range(0xA1, 0xFF):
            try:
                chars.add(bytes([lead, trail]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return chars


def scan_repo_chars() -> tuple[set[str], int]:
    """扫描仓库文本文件，收集 UI/内容/文档里实际出现过的字符。"""
    chars: set[str] = set()
    files = 0
    for relative in SCAN_ROOTS:
        root = REPO_ROOT / relative
        if not root.exists():
            continue
        candidates = [root] if root.is_file() else root.rglob("*")
        for path in candidates:
            if path.is_dir():
                continue
            if any(part in SKIP_DIRS for part in path.relative_to(REPO_ROOT).parts[:-1]):
                continue
            if path.suffix.lower() not in TEXT_EXTS:
                continue
            try:
                if path.stat().st_size > MAX_SCAN_FILE_BYTES:
                    continue
                chars.update(path.read_text(encoding="utf-8", errors="ignore"))
                files += 1
            except OSError:
                continue
    return chars, files


def codepoint_ranges(codepoints: list[int]) -> list[list[int]]:
    """把排好序的码点压成 [start, end] 区间，便于 JSON 阅读/校验脚本展开。"""
    ranges: list[list[int]] = []
    for codepoint in codepoints:
        if ranges and codepoint == ranges[-1][1] + 1:
            ranges[-1][1] = codepoint
        else:
            ranges.append([codepoint, codepoint])
    return ranges


def expand_ranges(ranges: list[list[int]]) -> list[int]:
    codepoints: list[int] = []
    for start, end in ranges:
        codepoints.extend(range(start, end + 1))
    return codepoints


def charset_hash(codepoints: list[int]) -> str:
    joined = ",".join(str(codepoint) for codepoint in codepoints)
    return sha256_bytes(joined.encode("ascii"))


def ensure_download(cache_dir: Path, filename: str, url: str, force: bool = False) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / filename
    if target.exists() and target.stat().st_size > 1024 * 1024 and not force:
        return target
    print(f"[font] 下载 {filename} ← {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "the-loom-font-subset/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = response.read()
    if len(data) < 1024 * 1024:
        raise SystemExit(f"下载的字体文件过小（{len(data)} bytes），疑似 404/代理错误：{url}")
    target.write_bytes(data)
    return target


def ensure_license(force: bool = False) -> str:
    FONT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not LICENSE_OUT.exists() or force:
        print(f"[font] 下载 OFL 许可证 ← {LICENSE_URL}")
        request = urllib.request.Request(LICENSE_URL, headers={"User-Agent": "the-loom-font-subset/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        if b"SIL OPEN FONT LICENSE" not in data.upper():
            raise SystemExit("下载到的许可证不像 OFL 文本，终止")
        LICENSE_OUT.write_bytes(data)
    return LICENSE_OUT.name


def renderable(charset: set[str]) -> tuple[set[str], list[str]]:
    """过滤掉控制/格式字符（换行、制表、BOM、变体选择符等），字体里不该有它们的字形。"""
    import unicodedata

    kept: set[str] = set()
    skipped: list[str] = []
    for char in charset:
        codepoint = ord(char)
        # 变体选择符（emoji 的 U+FE0F 等）不是可渲染字形，字体里不该有。
        if 0xFE00 <= codepoint <= 0xFE0F or 0xE0100 <= codepoint <= 0xE01EF:
            skipped.append(char)
            continue
        category = unicodedata.category(char)
        if category[0] == "C":  # Cc/Cf/Cs/Co/Cn
            skipped.append(char)
            continue
        kept.add(char)
    return kept, sorted({f"U+{ord(char):04X}" for char in skipped})


def subset_font(source: Path, destination: Path, codepoints: list[int]) -> tuple[dict, list[int]]:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    started = time.time()
    # recalcTimestamp=False：不把「构建时间」写进 head 表，保证同输入产物 sha256 可复现。
    font = TTFont(str(source), recalcTimestamp=False)

    options = subset.Options()
    options.flavor = "woff2"
    options.with_zopfli = False
    options.desubroutinize = True
    options.hinting = False
    options.glyph_names = False
    options.notdef_outline = True
    options.recalc_timestamp = False  # 保持源字体时间戳，产物可复现（sha256 稳定）
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.layout_features = ["*"]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    # 子集完成后用实际 cmap 复核：源字体不支持的字符明确列出来（不静默），由调用方决定。
    font_cmap = set(font.getBestCmap().keys())
    missing = sorted(set(codepoints) - font_cmap)

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".woff2.tmp")
    font.flavor = "woff2"
    font.save(str(temporary))
    if destination.exists():
        destination.unlink()
    temporary.replace(destination)

    data = destination.read_bytes()
    print(
        f"[font] {destination.name}: {len(data) / 1024 / 1024:.2f} MB, "
        f"cmap {len(font_cmap)} 码点, {time.time() - started:.1f}s"
    )
    return (
        {
            "file": destination.name,
            "weight": None,  # 由调用方填
            "bytes": len(data),
            "sha256": sha256_bytes(data),
            "cmapCodepoints": len(font_cmap),
        },
        missing,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="构造随包 Noto Sans SC 子集（woff2）+ 覆盖率清单")
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR, help="源 OTF 缓存目录（默认 .tools/fonts-src）")
    parser.add_argument("--out-dir", type=Path, default=FONT_OUT_DIR, help="产物目录（默认 apps/studio/src/assets/fonts）")
    parser.add_argument("--force-download", action="store_true", help="忽略缓存重新下载源字体/许可证")
    parser.add_argument("--skip-scan", action="store_true", help="不扫描仓库文本（只用 GB2312 + ASCII）")
    args = parser.parse_args()

    charset: set[str] = {chr(code) for code in range(0x20, 0x7F)}
    gb2312 = gb2312_chars()
    charset |= gb2312
    scanned_files = 0
    scanned_chars: set[str] = set()
    if not args.skip_scan:
        scanned_chars, scanned_files = scan_repo_chars()
        charset |= scanned_chars
    charset, skipped_codepoints = renderable(charset)

    codepoints = sorted(ord(char) for char in charset)
    outside_gb2312 = sorted(char for char in scanned_chars if char not in gb2312 and ord(char) > 0x7F)
    print(
        f"[font] 字符集：请求 {len(codepoints)} 码点（GB2312 {len(gb2312)} + 扫描补充 {len(scanned_chars - gb2312)}），"
        f"扫描 {scanned_files} 个文件，GB2312 外 {len(outside_gb2312)} 字"
    )

    license_name = ensure_license(force=args.force_download)

    files: list[dict] = []
    sources: list[dict] = []
    unsupported: list[str] = []
    total_bytes = 0
    for weight, spec in WEIGHTS.items():
        source = ensure_download(args.source_dir, spec["source"], spec["url"], force=args.force_download)
        sources.append(
            {
                "weight": weight,
                "file": source.name,
                "url": spec["url"],
                "bytes": source.stat().st_size,
                "sha256": sha256_file(source),
            }
        )
        info, missing = subset_font(source, args.out_dir / spec["output"], codepoints)
        info["weight"] = weight
        files.append(info)
        total_bytes += info["bytes"]
        if missing:
            print(
                f"[font] 警告：源字体不支持 {len(missing)} 个码点（按源字体实际 cmap 跳过）: "
                + ", ".join(f"U+{codepoint:04X}" for codepoint in missing[:20]),
                file=sys.stderr,
            )
            unsupported.extend(f"U+{codepoint:04X}" for codepoint in missing)

    # 覆盖率清单只记录字体实际支持的码点（= 子集 cmap），校验脚本据此展开比对。
    unsupported_set = set(unsupported)
    supported = [codepoint for codepoint in codepoints if f"U+{codepoint:04X}" not in unsupported_set]
    ranges = codepoint_ranges(supported)
    digest = charset_hash(supported)

    # 体积预算：超限直接失败（本次实测远低于预算，留作回归保护）。
    problems: list[str] = []
    for info in files:
        if info["bytes"] > MAX_WEIGHT_BYTES:
            problems.append(f"{info['file']} 超过单字重预算 {MAX_WEIGHT_BYTES / 1024 / 1024:.0f}MB: {info['bytes']} bytes")
    if total_bytes > MAX_TOTAL_BYTES:
        problems.append(f"字体总计 {total_bytes} bytes 超过 {MAX_TOTAL_BYTES / 1024 / 1024:.0f}MB 预算")
    if problems:
        for problem in problems:
            print(f"[font] 体积超预算：{problem}", file=sys.stderr)
        return 1

    coverage = {
        "family": "Noto Sans SC",
        "license": "SIL Open Font License 1.1",
        "licenseFile": license_name,
        "generatedBy": "scripts/build-font-subset.py",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "usage": "apps/studio/src/typography.css 的 @font-face；$FONT_OUT_DIR 随 Vite 打包进 dist/assets",
        "source": sources,
        "charset": {
            "requestedCodepoints": len(codepoints),
            "codepoints": len(supported),
            "ranges": ranges,
            "sha256": digest,
            "gb2312": len(gb2312),
            "scannedFiles": scanned_files,
            "scannedExtraOutsideGb2312": len(outside_gb2312),
            "ignoredControlCodepoints": skipped_codepoints,
            "unsupportedCodepoints": sorted(unsupported_set),
        },
        "files": files,
        "totalBytes": total_bytes,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    COVERAGE_JSON.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[font] 覆盖率清单：{COVERAGE_JSON.relative_to(REPO_ROOT)}（charset sha256 {digest[:16]}…）")
    print(f"[font] 总计 {total_bytes / 1024 / 1024:.2f} MB（预算 8MB），每字重预算 4MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
