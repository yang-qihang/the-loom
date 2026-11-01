# 28 — 变更控制与质量门 v2（新功能不得绕过保证体系）

> 状态：v1 冻结｜负责人：Lead｜最后更新：2026-10-31
> 背景：用户连续加入 REPL、引导/序章、桌面封装（Tauri）、总在最前/伴玩、纯中文 UI、反「秀气」挑战层等需求。
> 底线：**任何新功能都必须同时带来规格、测试、证据与门禁；不允许以「先做出来再说」绕过 QA；不允许降低既有覆盖率或改动测试过关。**
> 现行文件（2026-11-01 复核）：变更控制/FAP 仍有效；当前 gate 状态见 `qa/README.md` §6。
> 上游：docs/20-quality-bar.md、docs/29、docs/30

---

## 1. 新增功能协议（FAP，五步）

1. **规格先行**：新增功能必须先写进 `docs/`（ADR/规格），写清用户可见行为、边界、失败态、文案；无 spec 不开工。
2. **测试先行**：先加测试（契约 / 单元 / E2E / 静态检查），再写实现；测试目录受 `scripts/guard-tests.mjs` 冻结，改动需 Reviewer 签字。
3. **独立评审**：实现者与 Reviewer 不同 agent；Reviewer 必须复跑该功能的 gate 命令（不是看代码猜）。
4. **证据落盘**：命令 + exit code + 产物（JSON/截图/日志）写入 `evidence/` 或 `qa/evidence/`，格式见 docs/08。
5. **门禁通过**：`bash scripts/verify.sh` 全绿 + 对应专项 gate 绿；Lead 抽检 1 条复跑；不通过不合并。

**禁止**：为了功能通过而改断言/删测试/放宽阈值；新增功能导致既有 gate 变红时，先修功能，不修门禁。

## 2. 新功能对应的专项门禁

| 功能 | Gate | 命令/证据 | 通过标准 |
|---|---|---|---|
| 反「秀气」挑战层/体量 | **G-SCALE** | `level:validate`（LOC/阶段/挑战/隐藏测试）；每关 content 测试含 challenge 三态（挑战解过 / 偷懒失败 / 写死失败） | 所有已实现关卡达标；未达标 spec 不允许进入实现 |
| 纯中文 UI | **G-PURE-ZH** | `npx tsx scripts/check-copy.mjs --pure-zh --strict`；人工按 docs/20 §3b 复核 | 0 违规叙述；合法代码引用允许 |
| 标题中线对齐/视觉细节 | **G-UI-ALIGN** | Studio Playwright：标题 bbox 中心与视口中心差 ≤2px；标题不换行；无横向滚动；图标/文字中线对齐抽样 | 3 屏全过 + 截图 |
| 引导/背景/序章 | **G-ONBOARD** | 5 个 fresh agent 只看「序章+当前关开场+目标面板」回答五问；检查手记可回看 | ≥4/5 全答对；缺口补文案 |
| Fresh Reader（没玩过 MC 的文学读者） | **G-FRESH-READER** | fresh subagent 只看截图/界面文字；输出困惑 JSON + 改写建议 | blocker=0、major=0；无翻译腔/AI 味/中英混排；自然度≥4；五问≥4（docs/30） |
| 用户操作模拟（前端 E2E/Fresh 用户） | **G-UX-SIM** | `qa/ux-sim.mjs`：U1 契约/U2 happy/U3 错误恢复/U4 Fresh 盲操作/U5 桌面/U6 截图 | 全场景绿、五问 ≥4/5、无 console error、无 flaky（docs/29） |
| REPL 试符台 | **G-REPL** | session/HTTP 测试：四种示例、表达式返回值、错误中文、死循环超时、重置、不影响关卡；沙箱探针（process/require/globalThis 不可见） | 全绿；世界真实反应；不计星 |
| 桌面封装（Tauri） | **G-DESKTOP** | `tauri build`；Xvfb 启动 App 截图（无浏览器）；sidecar 退出清理；首启向导中文；rpm/AppImage 存在 | 干净机器可启动；无残留进程 |
| 总在最前/伴玩 | **G-TOP** | Tauri 窗口 API 测试（X11 与 Wayland 各一次）；快捷键；重启记忆；伴玩布局截图 | MC 最大化时可操作；Wayland 失败有兜底 |
| 新关卡内容 | **G-LEVEL** | prepare→reference→playerBeat→grade 3 星；starter 失败；challenge 三态；与 Mock/真实 MC digest 一致 | 同 T1 门禁 |

## 3. 质量阶梯更新（docs/08 增补）

在原有 L0–L8 上新增：
- **L0.5 G-PURE-ZH + G-SCALE**：文案与体量静态检查（warn→freeze 后 error）；
- **L2.5 G-REPL 契约**：session/HTTP/沙箱；
- **L6.5 G-UI-ALIGN + G-ONBOARD**：Playwright + agent 盲读；
- **L7.5 G-DESKTOP + G-TOP**：桌面壳 smoke（Xvfb/窗口 API）。

## 4. 合并纪律（并发开发下防止互相踩坏）

1. 每任务只改自己的 write scope；跨 scope 先找 Lead 重划。
2. 任何人不得 `git commit`（Lead 统一提交）；提交前 Lead 跑 `verify.sh`，红则只提交证据/回滚，不提交红状态。
3. 每一轮集成后：`verify.sh` + 受影响专项 gate 必须绿；不绿则暂停新功能，先修。
4. 测试/断言变更必须走 `guard-tests` manifest 更新 + 第二人签字；禁止用「让测试通过」的理由顺手改测试。
5. 功能开关：未完成的 Tauri/REPL/伴玩用显式开关隔离，默认关；不允许半成品默认开启。

## 5. 当前风险与对策（本轮新增功能）

| 风险 | 对策 |
|---|---|
| 新功能把 verify 拖红 | 功能分支/任务内先写测试；Lead 每轮跑 verify；红则不合并 |
| Studio/content 并发改同文件 | 严格 write scope；Content 只 L02–L04 的 content，不碰 Studio |
| Tauri 壳与 Studio/Tauri API 耦合 | Studio 检测 Tauri 环境才显示按钮；无 Tauri 时隐藏，不影响浏览器开发 |
| REPL 把沙箱打破 | 复用 worker+vm 沙箱；新增 process/require/globalThis 探针测试；死循环超时 |
| 引导文案变长导致 UI 溢出 | docs/20 §3b3 标题不换行 + 截图检查；文案 ≤60 字/屏 |
| 挑战层被写成硬编码 | 每关 challenge 必须有「偷懒/写死失败」测试 |

## 6. 执行清单（Lead 每轮）

- [ ] `git status` 无越 scope 的改动；
- [ ] `bash scripts/verify.sh` 绿（记录 commit + 时间）；
- [ ] 受影响专项 gate 绿（G-SCALE/G-PURE-ZH/G-REPL/G-DESKTOP/G-UI-ALIGN/G-ONBOARD）；
- [ ] 证据文件存在且可打开；
- [ ] 测试文件 hash 未未经批准变化；
- [ ] `HANDOFF.md` / `STATUS.md` 更新；
- [ ] 未完成功能默认关闭。

## G-REAL-PLAYER / G-ANNOT-READABLE / G-FUN（2026-10-31 新增）

- **G-REAL-PLAYER**：凡是玩家在关卡里要做的动作（走路、右键、敲钟、放合龙石、看聊天提示），验收必须走**真实客户端 / 玩家操作路径**（Prism 客户端 + 真实键鼠/命令，或至少 XTest 级输入）；engine RPC / 后台直接改世界只能用于准备场景或对照，不能充当「玩家能玩通」的证据。
- **G-ANNOT-READABLE**：世界内中文标注必须在**真实客户端默认 GUI 缩放/默认 FOV/实际游戏亮度**下截图验证：文字不被裁切、不被墙/灯柱遮挡、颜色对比度足够、远近距离都可读；实体数量/日志 `ok:true` 不算证据。看不清就改位置/字号/背景或改成更可靠的呈现方式。
- **G-FUN**：每关必须至少有两个不同的玩家动作/决策点，不能是「点一次运行然后干等」；若等待 >15 秒、场景空旷、目标不明显，视为不好玩并重做。返工报告要写「玩家实际玩什么、卡在哪里、怎么改」。
