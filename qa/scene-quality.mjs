#!/usr/bin/env node
// 场景截图质量检查：亮度、对比度、暗部占比；用于防止「一片黑/一片灰/荒原」。
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "evidence/scene-shots";
const files = readdirSync(dir).filter(f => f.endsWith(".png") && !f.includes("-sheet")).sort();
if (files.length === 0) { console.error(`no png in ${dir}`); process.exit(2); }
const bin = (() => { try { execFileSync("magick", ["-version"], { stdio: "ignore" }); return "magick"; } catch { return "convert"; } })();
const metric = (file, args) => Number(execFileSync(bin, [file, ...args, "-format", "%[fx:0]", "info:"], { encoding: "utf8" }).trim());
const stats = (file) => {
  // 截图是 1600x1000 的外框，游戏画面在中间；裁掉黑边，避免把边框算成暗部。
  const size = execFileSync(bin, [file, "-format", "%wx%h", "info:"], { encoding: "utf8" }).trim();
  const crop = size === "1600x1000" ? ["-crop", "854x390+373+250", "+repage"] : [];
  const out = execFileSync(bin, [file, ...crop, "-colorspace", "Gray", "-format", "%[fx:mean] %[fx:standard_deviation]", "info:"], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  const dark = Number(execFileSync(bin, [file, ...crop, "-colorspace", "Gray", "-threshold", "12%", "-format", "%[fx:1-mean]", "info:"], { encoding: "utf8" }).trim());
  const sat = Number(execFileSync(bin, [file, ...crop, "-colorspace", "HSL", "-channel", "G", "-separate", "-format", "%[fx:mean]", "info:"], { encoding: "utf8" }).trim());
  return { mean: out[0], std: out[1], dark, sat };
};
let failed = 0;
for (const f of files) {
  const p = join(dir, f); const s = stats(p);
  const ok = s.mean >= 0.22 && s.mean <= 0.82 && s.std >= 0.10 && s.dark <= 0.72 && s.sat >= 0.08;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${f.padEnd(28)} mean=${s.mean.toFixed(3)} std=${s.std.toFixed(3)} dark=${s.dark.toFixed(3)} sat=${s.sat.toFixed(3)}`);
}
console.log(`scene-quality: ${files.length - failed}/${files.length} pass (${dir})`);
process.exit(failed ? 1 : 0);
