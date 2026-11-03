# 63 — Studio 卡顿逻辑审计与优化

> 状态：修复、验证与 Linux 打包完成｜负责人：Codex / 独立 Reviewer｜最后更新：2026-11-03
> 上游：用户要求检查并修复卡顿逻辑；AGENTS.md；docs/08；docs/57；docs/61。

## 1. Write scope

apps/desktop/src-tauri/src/main.rs；apps/desktop/shell/{shell.js,wizard.html}；apps/studio/src/{shell-env.ts,engine/httpEngine.ts,components/JustifiedText.tsx}；apps/engine/src/{server.ts,hud-performance.test.ts}；apps/studio/e2e/{desktop-shell.spec.ts,desktop-ui-regressions.spec.ts,auto-beat.spec.ts}；apps/desktop/scripts/release-audit.test.mjs（如需）；README.md、STATUS.md、docs/57-launcher-env-contract.md、本文件；evidence/perf-audit/*。

版本锁、冻结测试、评分与学生 API 不变。HUD 仅增加可选查询投影，默认完整快照及协议 schema 不变。

## 2. 已确认的热点（优化前）

- L0 每 8 秒重复 env_probe，同步主线程依次启动 Java/Node/Flatpak。Reviewer 本机实测合计约 80–90ms/轮；另有独立 2 秒 env_state 实时状态轮询，版本诊断不需重复。
- Rust 已忽略 updatedAt 去重，但壳的 2 秒快照兜底无条件下发 loom:env，Hook 每次创建新状态，静止 App 也有约 30 次/min 的无效顶层更新。
- 原生支持探针把缩放后的 DOMRect 与未缩放的 clientWidth 比较，默认 80% 缩放会把 Chromium 错判为不支持；每段不必要地走 WebKit 拆行。即使支持探针为真，原实现也先逐字符测量再判断能力。初始序章在受控 font loadingdone 回调里读取 Range 70 次，即使浏览器原生两端对齐可用。
- HUD 每秒下载完整快照的顶层及嵌套副本，包含不显示的 blocks/events。Mock 初始化场景 L01 96,091 B、L05 222,383 B、L10 31,263 B。
- 手动 start_paper 旧命令在主线程执行首次运行时复制，还绕过现有后台启动锁。

基线测量：evidence/perf-audit/snapshot-before.json、text-before.json。测量是局部开销，不代表整个应用的端到端速度。

自动结算 e2e 的快照拦截器需匹配可选 view 查询，并在改写嵌套进度时保留投影字段；只调整测试传输接线，不修改任何通关/结算断言。

验证中确认了 HTTP 确认与 SSE 终态的竞态：第二轮执行很快时，旧 activeRunId 会丢弃先到的正确结果，界面看起来一直未完成。新增延迟 HTTP 202 的确定性回归；修复范围仍在 HttpEngine。

## 3. 修复与实测

- `env_probe` / `env_refresh` 用 spawn_blocking，不在 WebView UI 线程运行子进程/进程扫描；启动页自动只读 env_state，安装诊断保留首次和手动入口，且防重入。
- 手动 start_paper 统一进入既有后台 worker 与启动锁，首次复制不占 UI 线程、不与自动启动重复复制。
- 壳与 useShellEnv 都忽略 updatedAt 做语义去重；真实状态变化继续通知，iframe 加载时强制补发一次当前状态。状态轮询增加在途守卫。
- 原生 justify 探针两边都使用渲染像素，修正 80% 缩放误判。Chromium 原生路径跳过逐字符拆行；单行居中仍按实际段落高度判断；WebKit fallback 保留。
- `GET /api/session/:id/snapshot?view=hud` 是可选轻量投影。HttpEngine.snapshot 用该投影；默认完整快照、评分真值与 WorldSnapshot schema 保持原契约。HUD 坐标/进度/自动结算字段逐项对照一致；实时数据仍每次重新读取，不缓存旧进度。
- 终态 SSE 先于 POST /api/run 的 HTTP 202 时，HttpEngine 先按会话+请求 token 缓冲 error/result，再绑定新 runId 并顺序过滤/投递。失败、重置、停止、离开订阅都会撤销对应 token，晚确认不恢复旧运行；state/log/objective 仍实时投递。未宣称消除所有网络竞态。

| 受控场景 | 优化前 | 优化后 |
|---|---:|---:|
| L01 初始化 HUD 响应 | 96,091 B | 1,673 B（减少 98.3%） |
| L05 初始化 HUD 响应 | 222,383 B | 2,137 B（减少 99.0%） |
| L10 初始化 HUD 响应 | 31,263 B | 1,822 B（减少 94.2%） |
| Chromium 80% 序章一次受控字体完成通知 | 70 次 Range 查询 | 0 次 |
| 仅 updatedAt 变化的 10 次状态刷新 | 反复下发/更新 App | 不重复下发；真实内容变化仍通知 |
| 启动页虚拟时钟推进 30 秒 | 原逻辑会重复安装诊断 | env_probe 仍只有首次 1 次；手动点击后变 2 次 |

响应大小来自同机 Mock 初始化世界。JSON.parse 500 次微基准也保留在 JSON 中，仅用于局部开销对照，不代表整局游戏快了某个倍数。诊断子命令测量为墙钟耗时，不能替代原生 GUI 掉帧/交互延迟测试。实测及脚本见 evidence/perf-audit/。

## 4. 验证

- 全部 Node/TS 单测：30 files / 263 PASS（含新增 4 个 HUD 投影/实时进度回归）。
- Rust：54 PASS / 4 ignored；桌面 Node 自检 5 PASS。
- 浏览器：27 项不同用例通过（按日志去重汇总于 test-summary.json），覆盖多缩放原生/WebKit fallback 排版、字体契约、真实壳源码的状态去重、真实 wizard 的定时器、自动结算、失败恢复、延迟 HTTP 与 reset 撤销。
- 首轮 24 项中，自动结算两个 fixture 未匹配新查询，及旧终态竞态导致的双击用例失败。保留原日志；适配 fixture 的 URL 和嵌套字段后全部断言不变；对应复跑通过。新增延迟 HTTP 的确定性用例也在修复前失败、修复后通过。
- 全量 verify：l0/l1/l2/l3 PASS，lg 保留既有 G-FRESH-READER tracked warning，exit 0；原始报告 `verify-reports/20261103T135121Z-perf-audit-final.log`，归档 `evidence/perf-audit/verify-final.log`。日志内 commit 是验证前的基线；本轮工作树为被验证对象。
- 独立 Reviewer 确认后台命令保持 Tauri 成功响应形状、HUD 字段和完整端点兼容、去重保留首次同步、缓冲撤销不会恢复旧 runId。
- 真实运行时重建与 Linux release 打包成功：AppImage 522.51 MiB、RPM 452.78 MiB；构建日志和 SHA-256 见 `evidence/perf-audit/{runtime-build.log,desktop-build.log,package-sha256.txt}`。保留现有 Rust/Java 编译警告；本轮未做原生 GUI 交互验收。

### 测量复现

在仓库根目录运行 `npx tsx evidence/perf-audit/snapshot-benchmark.ts /tmp/loom-hud-benchmark.json`。脚本显式注入 Mock runtime，比较完整端点与 HUD 投影；同一脚本在优化前的 HUD 查询会被忽略，返回完整响应。

文本微基准需先启动 `npm --prefix apps/studio run dev:mock -- --port 5193 --strictPort`，再运行 `node evidence/perf-audit/text-benchmark.mjs /tmp/loom-text-benchmark.json`。脚本使用 headless Chrome，记录 80% 缩放下受控字体完成通知触发的 Range 查询；不代表原生窗口帧时。

归档测试日志保留首轮失败、修复前失败及修复后通过记录，仅去除行尾空白以满足仓库 diff 检查。

## 5. 边界

本轮不是 Minecraft 渲染/FPS 优化，也没有升级版本锁、删减评分或减少必要的进度检测。Paper→Engine 的完整世界快照仍会生成；轻量投影减少的是 Engine→Studio 的传输与 JSON 解析。Windows 原生 WebView2 和 Linux 原生 UI 的端到端帧时未实测，WebKit UA 回归只证明 fallback 代码路径。已知盲测/原生动作取消等边界仍见 docs/62。

上一轮退出/窗口/教材修复继续保留；本轮没有纳入原有未跟踪 slides/。代码、文档和小证据提交 Git，安装包仍为本机构建产物。
