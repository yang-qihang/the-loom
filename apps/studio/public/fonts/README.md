# 字体资产（Studio / 桌面壳共用）

> Round 2（2026-11-01）：全站代码与提示类 UI 统一为 **Maple Mono（CN 变体）**；Zpix 仅保留给装饰性大标题。

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
- **引用位置**：
  - `apps/studio/src/styles.css` 的 `@font-face` 与 `--mono/--sans/--serif`（url `/fonts/…`，vite 按 base 重写为相对路径）；
  - `apps/desktop/shell/shell.css`、`wizard.html`、`companion.html`（url `./studio/fonts/…`，由 `apps/desktop/scripts/build-assets.mjs` 从 public/fonts 复制到 `dist/studio/fonts`）；
  - Monaco：`apps/studio/src/monaco/setup.ts` 的 `EDITOR_FONT_FAMILY`（CodeEditor `fontFamily` + `fontLigatures: true`）。

## Zpix（最像素）——只允许装饰性大标题

- **保留范围**：关卡墙主标题 `.map-head h1`、关于页织界字标 `.about-hero h1`、系统页大标题 `.system-title`、
  桌面启动遮罩 `.boot-mark`、首启向导 `.loom-wordmark`（均通过 `--font-display` 或显式规则）。
- **禁止**：代码、提示、说明、按钮、菜单、日志、按键、状态、表单等任何文本；Round 2 字体审计（Playwright）
  会断言全站除上述选择器外不存在 Zpix 计算样式，也不存在 Iosevka / Departure Mono。
- 文件 `zpix.woff2` sha256 `1d6b356bba81ac3746889be39853042833ecebfc16afa8584ac462dafc162610`。
- 来源：https://github.com/SolidZORO/zpix-pixel-font ，作者 SolidZORO；分发范围按上游仓库。
