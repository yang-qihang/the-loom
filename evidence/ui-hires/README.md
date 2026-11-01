# Studio 高清 UI 截图（Round 2 视觉验收）

> 负责人：verifier（visual-ui）｜日期：2026-11-01
> 环境：最新 `apps/studio` 构建（`npm --prefix apps/studio run build`，2026-11-01 13:51）+
> 真实 HTTP 引擎 **mock 世界**（`LOOM_WORLD=mock`，127.0.0.1:4317，无 Paper，不占内存）；
> Playwright Chromium，`deviceScaleFactor=2`、viewport 1440×960（输出 2880×1920）。
> 原始截图尺寸均为 2880×1920（2× DPR）；页面内容为 L01（第一缕光）。

| 文件 | 内容 |
|---|---|
| `map-wall.png` | 地图墙：10 关卡片 + 新版真实客户端 L01 hero 条带（2560×990 素材） |
| `workbench.png` | 工作台：代码编辑器（Maple Mono）、本关目标 0/3、位置 HUD、教练卡、真实世界条 |
| `manual-open.png` | 指令手册打开态：本关可用 API（签名/人话/可照抄）、命名点坐标表、Esc/关闭 |
| `repl.png` | 试符台：标题显示「当前关卡：第一缕光」，命名点 eira/lamp1–5 可读 |
| `workbench-after-starter.png` | 只点亮 1 盏的 starter 跑完：目标 0/3、教练「还没完成：灰崽按顺序点亮…」、无「轮到你」 |
| `workbench-ready.png` | 参考解后：「轮到你」卡 + 织者之印引导 + 目标 2/3 |
| `settle-concept.png` | 结算：3 星 + 概念揭晓卡「函数调用（function call）」+ 下一步 |
| `monaco-context-menu.png` | Monaco 右键菜单（不透明，验证 CI） |
| `ui-verify.json` | 机读验证：字体 computed、右键菜单背景 alpha、手册/REPL/HUD/概念卡文本、404 列表等 |

## 机读验证结论（`ui-verify.json`）

- 字体：`body` / 教练行 / 编辑器 computed `font-family` 均含 **"Maple Mono"**（body 另含 Noto Sans SC 中文回退）；`document.fonts.check('16px "Maple Mono"')=true`，Maple Mono 字体资源 loaded。
- Monaco 右键菜单：`backgroundColor: rgb(23,18,13)`、`opacity: 1`、`z-index: 10000` → **不透明，不再与代码重叠**。
- 指令手册：`manual-level=第一缕光`、API 6 条、命名点表（艾拉/1–4 号灯/桥边小灯）齐全。
- 位置 HUD：灰崽 + 艾拉/1–4 号灯/桥边小灯坐标；提示「写 `golem.pos` 也能看到坐标」。
- REPL：`repl-current-level=当前关卡：第一缕光`，命名点 eira/lamp1–5。
- 结算概念卡：`concept-term=函数调用`，含「是什么 / 为什么要用 / 你刚才做的事」。
- 无破图（report 页 8/8 img naturalWidth>0）；Studio 页唯一的 404 是 CSS `.stage-photo` 背景
  `assets/world/L01.png`（Vite 把 CSS 相对 url 解析到 /assets/world/；不影响场景条与功能，
  建议后续把该 CSS 引用改成 `url("/world/L01.png")` 或改用 import——记录给 Lead）。

## 复现

```bash
npm --prefix apps/studio run build
LOOM_WORLD=mock PORT=4317 LOOM_STUDIO_DIR="$PWD/apps/studio/dist" npx tsx tmp/shots/run-engine-mock.ts &
python3 -m http.server 8091 -d apps/studio/dist --bind 127.0.0.1 &
npx tsx tmp/shots/ui-shots.mjs          # -> evidence/ui-hires/
python3 -m http.server 8092 -d report --bind 127.0.0.1 &
npx tsx tmp/shots/report-shots.mjs      # -> report/evidence/report*.png
```
