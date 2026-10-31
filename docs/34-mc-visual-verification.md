# 34 — 真实 MC 视觉验收（自动化，不靠人眼盲看）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 目的：把「MC 场景是否精致」从口头判断变成可复现的自动化证据链：真实客户端进服 → 固定机位/时间 → 截图 → 与场景数据核对。
> 背景：此前只有协议级 e2e，没有客户端画面；Fresh Reader 因此无法判断「世界长什么样」。本流程已在本机跑通。

## 1. 环境

- 虚拟显示：`Xvfb :99 -screen 0 1600x1000x24`（已有；或 `Xvfb :99 ... &`）
- Prism Launcher（flatpak）+ 实例 `Village Development`（MC 26.1.2，已登录 MSA 账号）
- Paper 服务端：`npm run mc:up`（25565 / RPC 8765）
- Engine paper 模式：`PORT=4320 npm run dev:engine:paper`
- 自动化输入：`python-xlib`（`XTestFakeRelativeMotionEvent` / `FakeInput`），截图用 ImageMagick `import`

## 2. 一次性启动客户端

```bash
DISPLAY=:99 nohup flatpak run org.prismlauncher.PrismLauncher \
  --launch "Village Development" > /tmp/mc-launch.log 2>&1 &
# 等标题画面
DISPLAY=:99 import -window root evidence/mc-shots/mc-root.png
```

进入多人：Main Menu → Multiplayer → Proceed（第三方提示）→ Direct Connection → 输入 `127.0.0.1` → Join Server。

## 3. 准备场景并固定机位

```bash
curl -s -X POST 127.0.0.1:4320/api/session -H 'content-type: application/json' -d '{"levelId":"L01"}'
# 用插件 RPC 设白天 + 传送玩家（避免依赖玩家操作）
node /tmp/mc-rpc.mjs   # world.setTime + player.teleport
# 相对鼠标旋转（XTest）拍 8 个方向，montage 成 contact sheet
python3 /tmp/lookseq.py
montage evidence/mc-shots/art-{0..7}.png -tile 4x2 -geometry 480x300+3+3 evidence/mc-shots/art-sheet.png
```

- 机位：L01 玩家在 `[0,12,24]`，看向小径/灯柱/村舍；时间 6000–1000。
- 截图规范化：裁掉黑边与 HUD（`-crop 854x390+373+250`），保存 `evidence/mc-shots/L01-real-hero.png` 与 `report/evidence/mc-l01.png`。

## 4. 判定（必须同时满足）

1. **协议**：`npm run it:engine-paper` 34/34；`npm run it:real` / L2–L4 全绿。
2. **画面**：真实客户端截图里能辨认 4 个灯柱、小径、村舍、树木、灯笼、灰崽/村民；无黑屏/无「只有虚空」；时间/天气与关卡一致。
3. **数据**：截图中可见的方块/实体与 `world.snapshot` / 内容 `prepare` 的清单一致（至少抽 5 个：灯柱、灯笼、小径、村舍、树）。
4. **Fresh Reader**：把真实截图加入材料包，重跑 `docs/30`；若仍说「看不到世界」，记录具体缺口并修。
5. **回归**：`npm test` 185+、`bash scripts/verify.sh` exit 0、Studio Playwright 5/5。

## 5. 已知限制

- Xvfb 下软件渲染偏暗；正式演示用真实显示器/提高 gamma（客户端 options `gamma:1.0`）再拍一组。
- 本轮只拍了 L01；L02–L09 的真实场景截图需逐关按同一流程补。
- 截图是辅助证据，**评分真值仍以服务端快照/事件为准**（docs/07）。

## 0. 隔离显示（硬规则）

- 所有 Tauri / Prism / xdotool / XTest / `import` 自动化**只能**在独立 Xvfb 上跑：默认 `:98`，Minecraft 客户端可用 `:99`。
- **禁止 `DISPLAY=:0`**：那会移动用户真实桌面的鼠标、抢焦点、污染实验。曾发生过一次 desktop agent 在 `:0` 启动测试 App 的泄漏；已 kill 并加入本规则。
- `models` 测试脚本统一先跑 `source scripts/isolated-x.sh`（会拒绝 :0）；`tools-xclick.py` 读取 `LOOM_TEST_DISPLAY`，拒绝 :0。
- 在真机上验证时也要先确认 `ps -ef | grep DISPLAY=:0` 为空。
