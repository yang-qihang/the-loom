# Studio 桌面修复验收

> 状态：实现完成；Windows 原生 GUI 待实机复验｜负责人：Codex｜更新：2026-11-03
> 上游：本次用户反馈；AGENTS.md；docs/49；docs/61。接手基线 593989c，保留并收口原有相关未提交修改。

## 结果与根因

1. **启动大窗**：配置和模式切换默认 1600×1000，启动时把旧小窗记录提升至该尺寸；小屏幕按可用区域缩小。伴玩页面仍有自己的小窗逻辑。
   Linux 原生启动首次实测仍缩成 1280×840。日志显示先恢复 1600×1000，随后把位置 480,266 读作尺寸 480×266，再 clamp 到下限并写坏设置。
   已核对本机 Tao 0.37.2 源码 `platform_impl/linux/window.rs`：首次 configure-event 前，outer_size 初值来自 root_origin；inner_size 初值来自 window.size。
   无边框 Linux 主窗改用 inner_size，Windows 继续用 outer_size；不升级依赖。
   **修复后 X11 实际窗口为 1600×1000，设置记录也为 1600×1000**（native-startup.json、native-window.log、linux-startup.png）。
2. **叙事持续收窄风险**：自然宽度与可用宽度统一为未 zoom 的 CSS px；测量前还原 WebKit 逐行补齐的输出，避免旧行宽/字距反馈；ResizeObserver 只响应宽度变化，字体加载完成后重算。
   0.65 / 0.8 / 1 / 1.25 四种缩放、1280 / 760 / 1440 三种视口，覆盖序章和第一幕全部页，并逐帧检查稳定与居中。两条代码路径都通过。
3. **教材完全失去响应**：独立教材 portal 的 z-index=0，被占满窗口的空 #root（z-index=1）遮住。修复前 elementFromPoint 命中 #root，修复后命中关闭按钮；教材层级改为 60。
   新窗创建命令改 async，避免 Windows 同步命令创建 WebView 的已知死锁；公共窗口 API 与 Rust 命令回退均有接线测试。
   Tauri 官方依据（2026-11-03 查询）：[WebviewWindowBuilder 已知问题](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)。

## 验证与边界

- Rust：54 passed / 4 ignored，含新增旧小窗迁移与小屏幕两项测试。见 cargo-final.log。
- 新增桌面回归：9 passed（含序章/幕开场缩放矩阵、教材真实点击/滚轮/翻章和 Rust 命令接线），公共窗口 API 接线另 1 passed。见 e2e-regressions.log、e2e-public-api.log。
- 字体/行内代码、排版、教材既有测试：6 项，见 e2e-existing.log。
- check:style、根目录与 Studio typecheck、verify l0/l1/l2 通过；最终 verify 日志见 verify-reports/ 中本任务记录。
- fresh reviewer 独立只读审查通过，已采纳幕开场全页、公共 API 分支和准确说明验证边界的建议。
- Linux 原生只实测了启动窗口；叙事/教材交互用 Linux Chrome 验证，WebKit 通过 UA 触发 fallback，Tauri 窗口 API 使用 stub。**未宣称 Windows WebView2 或原生教材拖动/置顶已实机验收。**
- Linux release、RPM、AppImage 已重新生成。首次普通 bundle 失败于 Java libjvm.so 依赖查找；最终加包内 Java lib/server 和 lib 到 LD_LIBRARY_PATH，并设置 APPIMAGE_EXTRACT_AND_RUN=1、NO_STRIP=1 后成功。见 bundle.log、package-sha256.txt。
- 首轮 RPM 打包时测试程序仍在运行，出现 bundler-type 写入警告；停止测试程序后已重新生成 RPM，无该警告（rpm-bundle.log）。两包均含最终 release 与已修复前端。

## 本任务 write scope / 提交文件

- apps/desktop/shell/shell.js
- apps/desktop/src-tauri/capabilities/default.json
- apps/desktop/src-tauri/gen/schemas/capabilities.json
- apps/desktop/src-tauri/src/main.rs
- apps/desktop/src-tauri/tauri.conf.json
- apps/studio/playwright.config.ts
- apps/studio/src/components/JustifiedText.tsx
- apps/studio/src/components/NarrativeLines.tsx
- apps/studio/src/components/textbook/TextbookStandalone.tsx
- apps/studio/src/components/textbook/TextbookWindow.tsx
- apps/studio/src/desktop.ts
- apps/studio/e2e/desktop-ui-regressions.spec.ts
- evidence/desktop-repair/*（本次日志、截图、报告及哈希）

冻结目录 test/、qa/、评分断言未改；slides/ 原有未跟踪目录未动。
