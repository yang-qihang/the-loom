# 62 — 展示前代码审计、修复与交付记录

> 状态：已修复并完成本轮自动化验收；原生 GUI 边界见 §5｜负责人：Codex / 独立 Reviewer / Red-Team｜最后更新：2026-11-03（Asia/Shanghai）
> 上游：本次用户要求「仔细检查项目代码、更新文档、最后传上去」；AGENTS.md；docs/08；docs/57；docs/61。
> 基线：`cd56cc5`（桌面窗口/叙事/教材修复），远端 `main` 在本轮开始时为 `593989c`。

## 1. 范围与结论口径

本轮审查关键运行路径、桌面壳、构建/交接脚本，并运行全套现有自动化与两关真实 Paper 验收。发现并修复下表问题。审查和自动化不能证明项目不存在任何 bug；Windows 原生 GUI、真人学习效果等未覆盖部分单列。

任务 write scope：packages/session/src/{session.ts,state.ts,recovery.test.ts}；packages/runner/src/{sandbox.ts,sandbox.test.ts}；apps/desktop/{package.json,scripts/build-assets.mjs,scripts/release-audit.test.mjs,shell/index.html,shell/shell.css,shell/shell.js,shell/shell-policy.js,shell/wizard.html,src-tauri/src/main.rs}；apps/studio/{playwright.config.ts,e2e/desktop-shell.spec.ts,src/main.tsx,src/desktop.ts,src/components/Workbench.tsx}；scripts/{mc-up.sh,package-desktop.sh,prepare-github-handoff.sh}；it/l10-real.ts（只修改隔离端口接线）；README.md、STATUS.md、docs/{36,42,43,57,61} 对应文档、本文件、evidence/release-audit/*、evidence/l1-real-latest.json、evidence/l10-real-latest.json。

版本锁、学生关卡源码、生产评分与冻结测试均未改动。原有未跟踪 slides/ 不纳入本轮提交。

## 2. 已确认并修复的问题

| 编号 | 问题 / 触发 | 修复 / 验证 |
|---|---|---|
| R01 | L02 已收蛋后 throw/SDK 错误，catch 先清 activeRun，导致 dirty 标记丢失；再跑参考解仍缺蛋 | 保留运行身份至 finally 记录写世界状态；异常重试 epoch+1、参考解和玩家节拍通过 |
| R02 | 旧运行错误在等待快照时 reset，晚到 catch 把失败结果写进新 epoch | await 后复核 run/ticket；延迟快照回归验证 lastResult 与新历史不受污染 |
| R03 | 评分等待 actionbar/玩家节拍激活期间 reset，旧评分重新进入新历史 | side effect 后复核身份，READY 在提示处理完成后发布；延迟 actionbar 回归验证无旧 result |
| R04 | reset/replReset 的端口临时失败后停在 PREPARING，无法再次 reset | 故障转 STOPPED，只允许重新恢复；并发准备时拒绝第二次 reset；两种模式均有回归 |
| R05 | Stop 只撤销能力，死循环 worker 仍执行到原超时；Paper 可达 240 秒 | 宿主 AbortSignal + worker terminate；stop/reset/dispose 取消关卡 worker。独立复验 Stop 后不再持续占满 CPU |
| R06 | iframe 消息桥没有 source/origin/command 校验，可代调用强制关闭命令 | shell-policy 校验当前 iframe + 壳/本机引擎 origin + 白名单；桥接设置清理危险字符；回包绑定来源；Red-Team 探针与浏览器回归 |
| R07 | 实际 shell 缺少 EnvState/会话/退出事件转发，Studio 收不到掉线状态，Rust 不知道关卡已开始 | 环境事件+2s 快照兜底；同步 session；Workbench 卸载清理且校验 previousSessionId；掉线覆盖层和重连入口 |
| R08 | X/Alt+F4 没有确认界面，只等 Rust watchdog；教材窗开着时主窗消失但应用可能还活着 | 退出确认+ack/cancel+异步 quit_game；取消撤销二次关闭捷径和旧 watchdog，二次关闭/超时兜底退出整个应用。壳事件注册失败仍继续初始化 |
| R09 | 跨源 iframe 的 contentDocument 不可写，设置缩放不即时生效；Ctrl+Shift+F 只放大窗口不换页面 | loom:scale + Studio 父消息接收，不刷新页面；补 restore-companion 监听。真实 shell 与跨源 Studio 回归 |
| R10 | 多次并发创建同 label 教材窗会失败并触发额外 DOM 回退 | Rust 异步 Mutex 串行创建/复用；cargo 编译/测试验证，原生并发 GUI 未实测 |
| R11 | 构建冒烟固定 4399；新 child 退出时仍可能借旧健康服务判绿 | PORT=0；只读取本次 child 的 ready 地址，校验 child 存活并清理；坏产物拒绝、好产物通过测试 |
| R12 | desktop self-test 指向已不存在的脚本 | 接到现有 Node 审计测试，npm run self-test 实际通过 |
| R13 | handoff 输出参数直接递归删除，可误删仓库/已有数据 | 规范化路径，拒绝仓库/上级/仓库内路径和非空目录；保留 sentinel 的回归 |
| R14 | mc-up 请求 latest，但 SHA 固定 build 74，后续 latest 变化会破坏锁定构建 | 改为 /builds/74；本轮实际查询该端点返回 id=74，保留原 SHA |
| R15 | AppImage 扫描包内 Java 时找不到 libjvm.so | 一键打包入口加入包内 Java lib/server 与 lib，保留无 FUSE 兼容路径 |
| R16 | L10 验收脚本写死 RPC 8765，C++ 隔离执行器使用 8865 时失败 | 只修 LOOM_RPC_URL / MC_HOST / MC_RPC_PORT 接线；评分断言不变。隔离 L10 真实验收重新通过 |

新增 recovery 回归最初 5 项全部失败，修复后通过；之后补了 actionbar 竞态及两个取消测试。原失败日志与最终日志均保留。所有表中日志文件均位于 evidence/release-audit/；verify 的原路径同时保留。

## 3. 验证记录

所有原始日志与汇总在 `evidence/release-audit/`。

| 层 | 本轮结果 | 证据 |
|---|---|---|
| 根目录单测 | 29 files / 259 tests PASS | unit-final.log |
| desktop Node / self-test | 5 PASS | desktop-self-test.log |
| Rust | 54 PASS / 4 ignored | rust-final.log |
| C++ | 2 个 CTest suite PASS | native-baseline.log |
| Studio 主配置 | 55 PASS；最后的退出取消补丁后壳定向另 4 PASS | studio-final.log、shell-e2e-final.log |
| Studio Mock | 7 PASS | studio-mock.log |
| 真实 Paper L01 | PASS；3 星、生产评分/快照与 Mock 一致、reset 哈希稳定 | real-paper.json 的 L01 job、paper.log、l1-real-latest.json |
| 真实 Paper L10 | PASS；双 bot、真人类型玩家实体放合龙石、3 星、评分/快照对照与 reset | real-paper-l10.json、paper-l10.log、l10-real-latest.json |
| 全量 verify | l0/l1/l2/l3 PASS，lg 保留 G-FRESH-READER warning；exit 0 | verify-reports/20261103T100126Z-release-audit-final.log |
| 运行时与安装包 | 真实 runtime、Linux release、AppImage（522.51 MiB）/RPM（452.78 MiB）全部构建成功 | runtime-build.log、desktop-build.log、package-sha256.txt |

主配置是生产 Node Engine + MockWorld，不能称为真实 Minecraft GUI 验收。shell 用真实源码、stub Tauri API；WebKit 路径用 UA 触发 fallback。Paper 验收在隔离 MC 25615 / RPC 8865 上执行，不触碰 canonical 服务或真实桌面鼠标。

L10 首次隔离运行因脚本写死 8765 失败，保留失败汇总；修正接线后的独立复跑为 PASS，未删除失败断言或放宽门槛。跨源缩放测试最初因 IPv4-only 静态服务器的 localhost 请求失败，增加网络代理到同一 IPv4 服务器；浏览器依然保持不同 origin，断言不变。

## 4. 独立审查

- Engine Reviewer：独立复现异常重试、错误快照、reset 故障和死循环 Stop；修复后独立复跑 30 项，并确认 Stop 后 CPU 不再持续占满。
- Desktop Reviewer：独立发现 shell 缺失接线、来源校验、即时缩放、恢复伴玩、教材并发创建和构建假绿。
- Red-Team：拒绝外部 origin/错误 source/不允许的命令，校验 localhost 地址与设置过滤；独立发现 actionbar 晚到评分，并在修复后确认新历史无旧 result；定向 runtime 15 项与 Node 5 项通过。

## 5. 仍需明确的边界

1. 本轮新增壳交互尚未进行 Linux 原生 GUI 验收；上一轮原生验证仅确认启动窗口几何。Windows WebView2 的启动/拖动/关闭/并发教材窗口 GUI 未在本机实测；应在 Windows 重建包后彩排，不能用 Linux Chrome 或 UA 模拟代替。
2. 关卡 worker 支持取消；已发给原生 bot/端口的在途动作不保证立即硬取消。REPL 仍依赖自身约 3 秒超时，不声称所有 worker 都已接 stop。
3. DOM 教材模式记忆几何；原生独立教材窗关闭后尚不恢复位置/尺寸。置顶状态与章内阅读不受此边界影响。
4. `G-FRESH-READER` 真人学习效果/盲测尚未清零；挑战层仍为说明卡。
5. L01 h1 的旧位置采样偶发边界此前已有记录，本轮真实参考解与负向对照均通过，未改冻结评分真值。
6. Linux 安装包为本机构建产物，不提交 Git；GitHub 推送的是源码、锁文件、文档和可复核小证据。当前源代码没有执行上传二进制 Release 的操作。

## 6. 展示建议

使用新构建的安装包，提前启动并完整跑一次 L01→L10；L10 提前准备参考代码，留出玩家亲放合龙石的时间。保留一份真实运行录屏作为现场故障替代。该建议不等于已经完成人类彩排。
