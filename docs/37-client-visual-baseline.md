# 37 — Minecraft 客户端视觉基线（让中文和天空更好看）

> 状态：可用｜最后更新：2026-10-31

游戏本身不启动 Minecraft 客户端，所以提供一次性/可重复的客户端基线脚本：

```bash
bash scripts/mc-client-baseline.sh
# 或指定实例：
MC_OPTIONS="/path/to/minecraft/options.txt" bash scripts/mc-client-baseline.sh
```

它会先备份 `options.txt.loom-backup.<时间戳>`，然后设置：

- 渲染距离 12 / 模拟距离 8
- 云开启，云范围 96；Mipmap 4；抗锯齿/实体阴影开启
- 生物群系混合 4；粒子正常
- **语言 `zh_cn`**、GUI 缩放 3（中文界面和世界内文字更清楚）
- 亮度 0.6、屏幕效果 1.0

关卡内的时间/天气由 `content.prepare` 控制：L02 黎明、L08 正午雨天、L01 夕阳、L03/L09 黄昏夜、L04/L07 午后。云层颜色/厚度随时间和天气变化。
