# MiSans VF（随包非像素正文 / 普通 UI 字体）

- **字体**：MiSans VF（小米 MiSans，Normal 版，可变字重 150–700），官方子集切片（web 用）。
- **版本**：npm `misans@5.0.0`（字体版本 4.009），https://www.npmjs.com/package/misans ；上游 https://hyperos.mi.com/font/ 与 https://github.com/dsrkafuu/misans
- **许可证**：Apache License 2.0（见同目录 `MiSans-LICENSE.txt`，来自 npm 包 LICENSE；字体商标/名称归小米所有，不得单独售卖字体）。
- **文件**：`MiSansVF.min.css` + 56 个按 unicode-range 切片的 woff2；CSS 中 `@font-face` 家族名为 **MiSans VF**，`font-weight: 150 700`。
- **用途**：非像素正文/普通 UI 文本（序章叙述、手记、教练长句、说明文字、教材正文、伴玩/向导正文等）用 MiSans；Noto Sans SC 只作 fallback；代码仍用 Maple Mono，短标题/按钮/标签/角色名等像素装饰仍用 Zpix + Departure Mono（2026-11-02 最终口径）。
- **引用**：`apps/studio/src/typography.css` 顶部 `@import`；`apps/studio/public/fonts/misans` 是桌面壳（companion/wizard/shell）共用副本。
