# 字体资产（Studio / 桌面壳共用）

> 2026-11-01 第四轮修正：字体范围按用户要求扩展——**所有【代码】渲染点**统一本目录的 **Maple Mono（CN 变体）**（不只是编辑器：参考解/手册/织典/试符台/结算/日志/inline-code/教材代码块）；**长段正文**用随包 **Noto Sans SC**（`src/assets/fonts/noto-sans-sc-*.woff2`，OFL-1.1，子集）；**短标题/按钮/标签**保留中文像素字体 **Zpix + Departure Mono**。实现与验收见 `docs/20` §3b4、`apps/studio/src/typography.css`、`apps/studio/e2e/typography.spec.ts`。

## Maple Mono（CN 变体）

- **版本**：v7.9（release 发布 2025-12-05）
- **来源**：https://github.com/subframe7536/maple-font/releases/tag/v7.9
- **下载资产**：`MapleMono-CN.zip`（官方 CN 变体；该压缩包内官方只提供 TTF）。
  本仓库用 FontTools 4.66.1（`fonttools.ttLib.woff2`，brotli 1.2.1）把 Regular / Italic / SemiBold
  三个字重从 TTF 转成 woff2 以减小包体（**只做容器格式转换，未改动字形与字体名**）；原始 TTF 不随包分发。
- **许可**：SIL Open Font License 1.1，见同目录 `MapleMono-LICENSE.txt`（随包分发）。
- **TTF → woff2** 记录：`fonttools ttLib.woff2 compress MapleMono-CN-<Weight>.ttf -o MapleMono-CN-<Weight>.woff2`。
- **文件与 sha256**：
  | 文件 | 字重/样式 | sha256 |
  |---|---|---|
  | `MapleMono-CN-Regular.woff2` | 400 normal | `259bfeebf3f79707ee91c06f675fc4dfa6f9d0766d2834c52ea18afe0816dff7` |
  | `MapleMono-CN-Italic.woff2` | 400 italic | `7e4b63282729172971797297428d68e6142026d593d232f32adfd201eb61ed46` |
  | `MapleMono-CN-SemiBold.woff2` | 600/700 normal | `1731e8346ace70c0c28797c4d661b70dcf8e0b5ef2704f28f3c1296b1ed60d1f` |
- **源 zip sha256**：`cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d`
- **中文字形覆盖**（woff2 cmap 实测）：`织界艾拉灰崽代码右键复制粘贴全选` 等均命中，中文由该字体渲染。
- **引用位置（仅编辑器）**：
  - `apps/studio/src/styles.css` 的 `@font-face` + `--editor-font`（url `/fonts/…`，vite 按 base 重写为相对路径）；
  - Monaco：`apps/studio/src/monaco/setup.ts` 的 `EDITOR_FONT_FAMILY`（CodeEditor `fontFamily` + `fontLigatures: true`）；
  - 编辑器右键菜单 / suggest / hover / find / 参数提示的字体栈（styles.css 中 `--editor-font`，清晰普通字体，不用像素字）。
- **禁止**：把 Maple Mono 用到编辑器之外的 Studio/桌面壳 UI（用户第三轮明确要求回退）。

## Zpix（最像素）与 Departure Mono——UI 保留字体

- **保留范围**：Studio 与桌面壳的标题、正文、按钮、说明、日志、HUD、手册等 UI 文本；`--serif: Zpix …`、`--sans/--mono: Departure Mono, Zpix …`（与上一版一致）。
- **编辑器例外**：代码编辑器及其浮层用 Maple Mono / 清晰普通字体（见上）。
- 构建时 `src/assets/fonts` 的 Departure/Zpix 会被 vite 打进 `dist/assets`；桌面壳用 `public/fonts` 下的同名副本（由 build-assets 复制到 `dist/studio/fonts`）。
- 源文件与许可：Departure Mono（`DepartureMono-LICENSE.txt`，OFL 1.1）；Zpix 见上方文件与上游仓库。
- 文件 `zpix.woff2` sha256 `1d6b356bba81ac3746889be39853042833ecebfc16afa8584ac462dafc162610`。
- 来源：https://github.com/SolidZORO/zpix-pixel-font ，作者 SolidZORO；分发范围按上游仓库。
