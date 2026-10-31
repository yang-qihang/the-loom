import type { SkyProfile } from "./types";

/**
 * Act II（L04–L06）天空。
 *
 * 构图上：viewBox 360×210，顶部 0–64 留给标题/说明，云与太阳都压在 64 以下；
 * 云按「高层薄云 → 中层云团 → 贴地低云」分层，透明度由高到低递增，靠高度和遮挡关系拉开层次。
 * 云色不在 SkyProfile 契约里单列，渲染层由天空渐变（越靠近地平线越暖）着色；
 * 这里的 skyTop/skyBottom 与 orb 颜色只取自然天色，不用荧光色与粉紫。
 */
export const ACT2_SKY: Record<string, SkyProfile> = {
  // L04 麦田的咒语：午后干热，太阳偏西，远云薄、近云低。
  L04: {
    levelId: "L04",
    periodLabel: "午后",
    weatherLabel: "晴",
    skyTop: "#3d5a6c",
    skyBottom: "#b39369",
    clouds: [
      { x: 36, y: 72, w: 74, h: 12, opacity: 0.16, kind: "pixel" },
      { x: 142, y: 68, w: 108, h: 14, opacity: 0.22, kind: "pixel" },
      { x: 272, y: 94, w: 64, h: 10, opacity: 0.3, kind: "pixel" },
      { x: 56, y: 134, w: 58, h: 10, opacity: 0.2, kind: "pixel" },
    ],
    orb: { x: 302, y: 106, color: "#efd2a0", r: 9 },
    note: "午后没有风，田埂上的土晒得发白。",
  },

  // L05 一百座房子：正午直射、天光最亮，云最少最薄，日头压住新墙的影子。
  L05: {
    levelId: "L05",
    periodLabel: "正午",
    weatherLabel: "晴",
    skyTop: "#3a5f75",
    skyBottom: "#a8a487",
    clouds: [
      { x: 24, y: 74, w: 58, h: 10, opacity: 0.12, kind: "pixel" },
      { x: 168, y: 68, w: 96, h: 12, opacity: 0.15, kind: "pixel" },
      { x: 300, y: 84, w: 44, h: 10, opacity: 0.1, kind: "pixel" },
    ],
    orb: { x: 284, y: 92, color: "#f6ebc7", r: 12 },
    note: "正午的太阳把新墙照得发白，木料还带着潮气。",
  },

  // L06 商队的账本：黄昏薄云压得低，日头掉到云下，营地开始点灯。
  L06: {
    levelId: "L06",
    periodLabel: "黄昏",
    weatherLabel: "薄云",
    skyTop: "#2f3746",
    skyBottom: "#9c6f4e",
    clouds: [
      { x: 20, y: 86, w: 92, h: 12, opacity: 0.26, kind: "pixel" },
      { x: 138, y: 104, w: 124, h: 14, opacity: 0.32, kind: "pixel" },
      { x: 284, y: 132, w: 58, h: 10, opacity: 0.22, kind: "pixel" },
      { x: 58, y: 156, w: 84, h: 12, opacity: 0.3, kind: "pixel" },
    ],
    orb: { x: 238, y: 168, color: "#d99a63", r: 10 },
    note: "日头落进薄云里，商队的灯一盏盏挂起来。",
  },
};
