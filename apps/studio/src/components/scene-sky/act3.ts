import type { SkyProfile } from "./types";

/**
 * 第三幕 L07–L09 的天空：上午晴、正午雨、黄昏。
 * 云都在 360×210 viewBox 内，避开顶部中央的标题/说明区；
 * 只使用自然材质色（灰蓝/暖金/雨灰），不用荧光色与粉紫。
 */
export const ACT3_SKY: Record<string, SkyProfile> = {
  L07: {
    levelId: "L07",
    periodLabel: "上午",
    weatherLabel: "晴",
    skyTop: "#4a6f8c",
    skyBottom: "#c7c6b6",
    clouds: [
      { x: 22, y: 50, w: 74, h: 12, opacity: 0.38, kind: "pixel" },
      { x: 252, y: 58, w: 82, h: 14, opacity: 0.34, kind: "pixel" },
      { x: 60, y: 82, w: 52, h: 9, opacity: 0.26, kind: "pixel" },
    ],
    orb: { x: 304, y: 44, color: "#e8c07a", r: 13 },
    note: "上午的风从谷口穿过，货箱上的麻绳被吹得发紧。",
  },
  L08: {
    levelId: "L08",
    periodLabel: "正午",
    weatherLabel: "雨",
    skyTop: "#3b464e",
    skyBottom: "#7c8178",
    clouds: [
      { x: 10, y: 46, w: 88, h: 18, opacity: 0.55, kind: "rain" },
      { x: 248, y: 52, w: 102, h: 20, opacity: 0.46, kind: "rain" },
      { x: 96, y: 92, w: 150, h: 24, opacity: 0.34, kind: "rain" },
    ],
    rain: 42,
    note: "正午的雨压得很低，工坊屋檐连成一线水帘。",
  },
  L09: {
    levelId: "L09",
    periodLabel: "黄昏",
    weatherLabel: "晴",
    skyTop: "#2f3e52",
    skyBottom: "#b9784c",
    clouds: [
      { x: 18, y: 54, w: 80, h: 12, opacity: 0.4, kind: "pixel" },
      { x: 246, y: 46, w: 78, h: 12, opacity: 0.36, kind: "pixel" },
      { x: 64, y: 86, w: 58, h: 9, opacity: 0.28, kind: "pixel" },
    ],
    orb: { x: 298, y: 86, color: "#e0a468", r: 12 },
    note: "日头落到峡谷西边，营地先点起了灯。",
  },
};
