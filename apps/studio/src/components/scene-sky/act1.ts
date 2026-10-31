import type { SkyProfile } from "./types";

/**
 * 第一幕（L01–L03）天空配置。
 *
 * 画布是 360×210 的 viewBox，分三段用：
 *   - 顶部 0–40：关卡标题区，云和日/月都不能进来；
 *   - 中部 44–158：天空安全带，云、日、月只放在这里（x 也留在 16–344 内，避免被圆角裁掉）；
 *   - 底部 168–210：说明文字区，云不能压住说明。
 * 全部坐标按这个安全带写，像素块云用 2–3 块相邻矩形拼出一朵，远近两层 opacity 拉开层次。
 *
 * 配色按 60/30/10 取自然材质色（太阳/月亮与最亮的云边是 10% 点缀）：
 *   天空 60%（skyTop → skyBottom 两段渐变：天顶/近地平线）
 *   云层 30%（远层低透明度 + 近层稍实，像真云一样有前后）
 *   日/月 10%（只用暮光金、晨光米黄、月光灰白，不用荧光和粉紫）
 *
 * 第一幕三关的时间各不相同：
 *   L01 黄昏（太阳贴地平线，暖灰云）→ L02 黎明（东方日出、薄云透亮）→ L03 初夜（月亮、冷蓝天、暗云剪影）。
 */

export const ACT1_SKY: Record<string, SkyProfile> = {
  L01: {
    levelId: "L01",
    periodLabel: "黄昏",
    weatherLabel: "晴",
    // 天顶是压下来的深蓝，近地平线被落日烤成暖赭色
    skyTop: "#1f2c3c",
    skyBottom: "#b0764a",
    clouds: [
      // 远层：高空细长薄云，被夕阳压扁
      { x: 24, y: 44, w: 82, h: 6, opacity: 0.14, kind: "pixel" },
      { x: 196, y: 46, w: 104, h: 6, opacity: 0.12, kind: "pixel" },
      { x: 64, y: 50, w: 54, h: 6, opacity: 0.14, kind: "pixel" },
      // 中层：横向长云，暖灰，压住一半天空但不进标题区
      { x: 112, y: 66, w: 118, h: 9, opacity: 0.2, kind: "pixel" },
      { x: 40, y: 72, w: 58, h: 9, opacity: 0.18, kind: "pixel" },
      // 近层：低空块云，边被晚晖照亮
      { x: 52, y: 100, w: 68, h: 12, opacity: 0.26, kind: "pixel" },
      { x: 244, y: 104, w: 64, h: 11, opacity: 0.24, kind: "pixel" },
    ],
    // 落日贴着山脊：在右下角，不压标题和说明
    orb: { x: 296, y: 148, color: "#e6b366", r: 10 },
    note: "太阳落到山脊下，晚归的人得靠灯带路。",
  },
  L02: {
    levelId: "L02",
    periodLabel: "黎明",
    weatherLabel: "薄云",
    // 天顶还是夜末的冷蓝，地面先亮起来，所以下沿是晨光的沙金色
    skyTop: "#2c3f4f",
    skyBottom: "#c8a474",
    clouds: [
      // 远层：天亮前的薄云拉成丝，几乎透明
      { x: 28, y: 45, w: 76, h: 5, opacity: 0.12, kind: "pixel" },
      { x: 188, y: 44, w: 96, h: 5, opacity: 0.1, kind: "pixel" },
      // 中层：薄云成片，晨光从下面透上来
      { x: 88, y: 62, w: 96, h: 7, opacity: 0.16, kind: "pixel" },
      { x: 236, y: 70, w: 82, h: 8, opacity: 0.15, kind: "pixel" },
      // 近层：贴着田埂的低云，透明度稍高一点，暗示晴起来
      { x: 44, y: 96, w: 74, h: 9, opacity: 0.2, kind: "pixel" },
      { x: 208, y: 104, w: 88, h: 9, opacity: 0.19, kind: "pixel" },
    ],
    // 日出在左前：天刚亮，太阳还没完全离开田埂
    orb: { x: 62, y: 150, color: "#e9c88d", r: 9 },
    note: "麦穗节天亮得早，薄云下面已经有人在收蛋。",
  },
  L03: {
    levelId: "L03",
    periodLabel: "初夜",
    weatherLabel: "晴",
    // 深蓝压到接近墨色，但保留一点冷灰蓝，不能黑成一片
    skyTop: "#141d29",
    skyBottom: "#2f3b4a",
    clouds: [
      // 远层：夜里只剩云的轮廓，几乎只是比天空深一点
      { x: 32, y: 46, w: 92, h: 6, opacity: 0.1, kind: "pixel" },
      { x: 206, y: 48, w: 84, h: 6, opacity: 0.09, kind: "pixel" },
      // 中层：暗云拉长，压着村口的灯
      { x: 96, y: 64, w: 108, h: 8, opacity: 0.13, kind: "pixel" },
      { x: 16, y: 74, w: 62, h: 8, opacity: 0.12, kind: "pixel" },
      // 近层：村子上空最后一小片云，月光擦过边上
      { x: 240, y: 98, w: 70, h: 10, opacity: 0.17, kind: "pixel" },
      { x: 60, y: 108, w: 56, h: 9, opacity: 0.15, kind: "pixel" },
    ],
    // 月亮在右上：照亮钟楼和北门的方向
    orb: { x: 288, y: 54, color: "#d8dccf", r: 8 },
    note: "天刚沉下去，第一声钟要传过整条村路。",
  },
};
