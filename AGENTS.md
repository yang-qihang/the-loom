# AGENTS.md — 实施阶段入口（所有实现 agent 必读）

> 本文件面向 T1 起的实现团队（AI agents）。设计阶段文档在 `docs/`，本文件只讲「怎么开工、红线在哪」。
> 最后更新：2026-11-01（Round 2）｜维护者：Lead

## 1. 开工前必读（按顺序，≤30 分钟）

0. `STATUS.md` 顶部「2026-11-01 试玩反馈修复」+ `docs/46-playtest-fix-plan.md` — 上一轮实现事实源（任务进度/玩家节拍/sandbox/reset）；`docs/48-round2-guidance-api-visual-plan.md` — Round 2 契约（语义 API/命名点/引导/字体/截图）；`docs/47-docs-audit-2026-11-01.md` — 文档审计表
1. `BRIEF.md` — 项目愿景、不可违背的 invariants、决策快照、写作规范
2. `docs/11-decisions-and-open-questions.md` — D1–D12（不得静默改变）
3. `docs/07-architecture.md` — 组件、协议、沙箱、WorldDigest（你写的代码属于哪一块）
4. `docs/06-level-spec-system.md` — 关卡 spec/评分/门禁（做内容时）
5. `docs/08-ai-workflow.md` + `docs/08-appendix-templates.md` — 角色、门禁、证据协议、脚本
6. 你的任务卡（DSH 任务板）+ 任务涉及的 spec

## 2. 红线（违反 = 打回 + 当日产出降级重审）

1. **不改版本锁**：MC/Paper 26.1.2 build 74、Java 25、mineflayer 4.39.0、minecraft-protocol 1.68.0、mineflayer-pathfinder 2.4.5、TypeScript 6.0.3、esbuild 0.28.2、Monaco 0.57.0。升级 = ADR + Lead 签字。
2. **不改测试/断言来变绿**：`test/**`、`qa/**`、`packages/grading/src/assertions/**` 受 hash 冻结（`scripts/guard-tests.mjs`）。
3. **不越 write scope**：每个任务只改任务声明的文件；跨文件改动先找 Lead 重划 scope。
4. **不引入未教 API**：关卡学生可见代码只能使用 `docs/12-sdk-api-registry.md` 中该关及之前的符号；validator 会拦。
5. **不把评分真值放在学生进程**：断言/隐藏测试/随机种子只在 engine/plugin 侧。
6. **不编造事实**：版本/API/链接必须可核实（URL + 日期）；不确定写「未验证」。
7. **不用 `/reload` 热重载插件**：改插件 → 重启服务端（冷启动约 12s，脚本见 docs/02）。
8. **不把 Mojang 资产打包进产物**：资源包只用自制资产；内部演示引用官方资源需注明。

## 3. 完成标准（四行证据，缺一不可）

```
done: <commit sha>
verify: verify-reports/<UTC 时间戳>-<task-id>.log  (exit 0)
evidence: <worlddigest-<level>.json sha256 / test report path / screenshot path>
scope: <改动文件列表，必须 ⊆ task.write_scopes>
```

## 4. 常用命令（Day 1 会建立；以脚本为准）

```bash
npm run dev            # Studio + Runner
bash scripts/verify.sh # 全部质量门（或 --layers l0,l1，见 docs/08 附录）
bash scripts/mc-up.sh  # 起 Paper（锁定版本）
bash scripts/mc-down.sh
node bot/bot.js        # 单个织偶连接
```

## 5. 遇到阻塞

按 `docs/08-ai-workflow.md` §10 的升级格式发给 Lead：**问题一句话 + 2 选项 + 推荐 + 影响 + 需要多少分钟**。同一失败 3 次、任务超时 2×、发现决策冲突时必须升级，不得自行绕过。

## 6. 文档

- 每个 docs 文件保留头：状态/负责人/最后更新/上游。
- 事实/判断分开；中文正文 + 英文术语；「AI 味低」清单见 docs/08 §9。
- 决策变更写 `docs/11` 的新 ADR 或在任务评论里引用 Lead 的书面确认。
