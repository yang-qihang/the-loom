# 55 — 16 commits 扁平化接手审计报告

> 状态：本地扁平化 commit 已生成，构建验证进行中；**未 push**
> 日期：2026-11-02
> 基线：`4b1d81c`
> 扁平化范围：`4b1d81c..47dab8e`，共 16 个 commit
> 远程旧 main：`ccf23e8`（10 个 commit 将随 force push 被替换）
> 本地备份：`backup/pre-flatten-20261102`（保留完整 16 段历史）

## 1. 接手前项目状况

- 已有 10 关内容、教材、Studio、engine、Paper 插件、mineflayer bot。
- Linux 桌面壳/AppImage/RPM 有历史构建。
- 已有 `npm test` 251、`verify.sh` l0–l3、L01/L10 真 Paper e2e 记录。
- 遗留问题：
  - L01 hidden h1 真实 bot 到达抖动；
  - Windows 无原生构建/运行；
  - 多轮 UI/知识入口重复；
  - 打包 world 含测试数据/备份；
  - 质量门禁在 Windows 不可用。

## 2. 本批 16 个 commit 做的工作

- Windows 跨平台 Tauri 构建/NSIS/runtime（Node/Java/Paper/插件/世界/engine/bot）；
- Windows 运行时路径、USERPROFILE、verbatim path、单实例、子进程生命周期；
- 修掉每 8 秒 PowerShell 进程扫描导致的 2–5 秒卡顿；
- 无控制台窗口、优雅 Paper stop、退出清理；
- Windows QA gate、headless installed-runtime e2e、GUI 证据；
- 旧 C icon-gen 完全移除，恢复纯 JS 图标生成；
- UI/流程/启动器审计与设计文档。

## 3. 本地扁平化 commit

一个基于 `4b1d81c` 的本地 commit，包含 16 个 commit 的全部源码/文档变化，并删除 C 模块。  
实际 hash 以 `git log -1` 为准；本报告也包含在该 commit 内。

## 4. 验证矩阵

已在扁平化 commit 上执行：

```text
npm run desktop:assets        PASS（JS 图标路径）
npm run typecheck             PASS
npm test                      251/251 PASS
verify.ps1 l0–l3              PASS
```

构建验证：

```text
build-real-runtime.ps1        PASS（1154 MB，含包内 Paper cache）
package-desktop.ps1 NSIS      PASS（407.5 MB）
NSIS sha256                   6D13DE7DF0C5E4F09FFFD5A52A7ACDDCF1B220ED1B0F5258A68B11926D497D7B
/S 静默安装                   PASS（exit=0）
installed-runtime e2e         PASS（42/42；attempt1 即 3 星，本轮无 h1 flake）
GUI/Alt+Z/退出清理             沿用同一 UI 代码的上一轮证据；最终安装包待用户亲测
```

本报告随扁平化 commit 一起提交；当前本地历史只有一个扁平化 commit，远程尚未改写。

## 5. 已知遗留（不能假绿）

1. **L01 hidden h1**：真实 bot 落点 2.83 格 vs 判据 ≤2；建议修 `bot/manager.mjs` 后做 L01–L10 真 Paper 回归。
2. **UI**：嵌套标题栏、底部空白、窄窗遮挡、默认滚动条、顶栏冗余、REPL help/开场文本、教材 iframe 限制、伴玩数据流。
3. **启动器/L0 流程**：客户端自动启动、多启动器适配、四灯门控、L1 退出确认、L2 客户端丢失重连尚未实现。
4. **world 污染**：74 同名文件 47 hash 不同、29 测试玩家数据、12MB world 备份进包；需清理后重建。
5. **原生 Linux**：AppImage/RPM 仍未由同学原生验证（issue #2）。
6. **G-DESKTOP-WIN D10**：产物新鲜度仅 warn；扁平化重建后需重新核对。

## 6. 最终审阅清单（给用户，极简）

1. 从桌面安装包启动，确认首启向导、地图墙、工作台、教材独立窗、伴玩；
2. 连续点击，确认不再出现每 8 秒 2–5 秒卡顿；
3. Alt+Z：Minecraft → 织界 → Minecraft；
4. 关闭：右上角 X 和 L1「退出游戏」都应有确认（本轮尚未实现确认框，当前为已实现部分的验收）；
5. `git log --oneline -1` 应为一个扁平化 commit；
6. 确认后我执行 `git push --force-with-lease origin main`。

## 7. 推送与协调

- issue #3 已创建：main 将 force rewrite；
- 旧远程 10 个 commit hash 将从 main 消失；
- 同学已有 clone 需要 `git fetch origin && git reset --hard origin/main`；
- push 前如果远端有新提交，abort 并重新验证；
- 最终 push 必须等用户审阅本报告和安装包。
