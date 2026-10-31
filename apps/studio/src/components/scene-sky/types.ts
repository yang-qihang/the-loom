export type SkyCloud = {
  /** 0..360, 0..210 viewBox 坐标 */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** pixel = 块状云；rain = 雨帘/雨云 */
  kind: "pixel" | "rain";
};

export type SkyProfile = {
  levelId: string;
  /** 显示给玩家的中文时段，如「黎明」「午后」「黄昏」 */
  periodLabel: string;
  /** 显示给玩家的中文天气，如「晴」「薄云」「雨」 */
  weatherLabel: string;
  /** 高层天空色，自然材质色，禁止荧光/粉紫 */
  skyTop: string;
  skyBottom: string;
  clouds: SkyCloud[];
  /** 可选太阳/月亮：x/y 为 viewBox 坐标，hue 只用于自然暖色 */
  orb?: { x: number; y: number; color: string; r: number };
  /** 湿度/雨线数量，0 表示没有雨 */
  rain?: number;
  /** 一句中文天气说明，禁止空泛 AI 词 */
  note: string;
};

export const DEFAULT_SKY: SkyProfile = {
  levelId: "L01",
  periodLabel: "黄昏",
  weatherLabel: "晴",
  skyTop: "#2a3442",
  skyBottom: "#8a6a48",
  clouds: [
    { x: 46, y: 34, w: 58, h: 12, opacity: 0.32, kind: "pixel" },
    { x: 186, y: 24, w: 72, h: 14, opacity: 0.26, kind: "pixel" },
  ],
  note: "天边还留着一点光，灯要先亮起来。",
};
