/**
 * 世界方位示意图：天空 / 云 / 雨全部是像素块，按关卡时段与天气配置（scene-sky/index）绘制。
 * 规范见 docs/38-sky-art.md：
 * - 只用直角矩形与纯色块，不做渐变、圆角、荧光、彩虹或文字阴影；
 * - 60/30/10：天空与地面主色约 60%，云/山/构筑物约 30%，日月光与雨线等点缀 ≤10%；
 * - 云量、云高、云色、雨量全部来自 SkyProfile，不在组件里写死某关配色；
 * - 目标标注与「灰崽 / 你」的位置保持原坐标，不被云雨遮挡。
 */
import type { ReactElement } from "react";
import { skyFor } from "./scene-sky";
import type { SkyCloud, SkyProfile } from "./scene-sky/types";

const VIEW_W = 360;
const VIEW_H = 210;
/** 地平线：上方是天空，下方是地面；目标物件都落在地平线附近及以下。 */
const HORIZON = 104;
/** 天空绘制带：顶部 40 以下留给标题，地平线留 4px 过渡；配置契约里的坐标系是 40–168，映射到这里。 */
const SKY_TOP = 40;
const SKY_BOTTOM = HORIZON - 4;
const SRC_TOP = 40;
const SRC_BOTTOM = 168;
const SKY_SCALE = (SKY_BOTTOM - SKY_TOP) / (SRC_BOTTOM - SRC_TOP);
function mapSkyY(y: number): number {
  const clamped = Math.max(SRC_TOP, Math.min(SRC_BOTTOM, y));
  return SKY_TOP + (clamped - SRC_TOP) * SKY_SCALE;
}

const LEVELS: Record<string, { title: string; caption: string; accent: string; x: number; y: number }> = {
  L01: { title: "小径与四盏灯", caption: "灰崽从村口出发，沿小径依次点亮 1–3 号灯。", accent: "#e8b45a", x: 160, y: 118 },
  L02: { title: "鸡舍与木桶", caption: "鸡舍、孵蛋窝和木桶都在村西；灰崽要把三样都照顾到。", accent: "#d9a441", x: 130, y: 140 },
  L03: { title: "北门与钟", caption: "三张剧本卡对应三种夜晚；钟、北门和井边各在一处。", accent: "#c98d3f", x: 170, y: 126 },
  L04: { title: "麦田与水渠", caption: "三块田被水渠隔开；先收残株，再把空地种满。", accent: "#b8a24a", x: 120, y: 150 },
  L05: { title: "空地与新屋", caption: "五块地位置各不相同；先看地块，再决定房子怎么盖。", accent: "#c98b52", x: 150, y: 150 },
  L06: { title: "商队与三只桶", caption: "货物、工具和杂物要分进不同的桶，账本要能对上。", accent: "#c29a5b", x: 200, y: 156 },
  L07: { title: "信风谷的货箱", caption: "悦灵只认你给的规矩；货箱沿风排开，最后要逐箱对账。", accent: "#8fae62", x: 300, y: 120 },
  L08: { title: "工坊与联动机", caption: "三台机器各有开关；先按顺序启动，停机时反序。", accent: "#c98d3f", x: 286, y: 150 },
  L09: { title: "营地与三座酿造台", caption: "天快黑了；材料、酿造台和钟都在营地附近。", accent: "#b98b6a", x: 222, y: 150 },
};

const R = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => (
  <rect key={`r-${x}-${y}`} x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
);
const Q = (x: number, y: number, r: number, fill: string, stroke?: string) => (
  <rect key={`q-${x}-${y}`} x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
);
const T = (x: number, y: number, text: string) => (
  <text key={`t-${x}-${y}-${text}`} x={x} y={y} textAnchor="middle" fontSize="8" fill="#d8c8a8">{text}</text>
);

// ---------------------------------------------------------------- 颜色工具
function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const value = full.length === 6 ? Number.parseInt(full, 16) : 0x888888;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
const toHex = (rgb: [number, number, number]): string =>
  `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};
const luma = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
/** 固定种子的伪随机：同一关每次渲染的云块/雨线完全一致。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const seedOf = (text: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

// ---------------------------------------------------------------- 天空构件
const isRainy = (sky: SkyProfile): boolean => (sky.rain ?? 0) > 0;

/** 像素云：一个 SkyCloud 会被拆成阶梯状方块（不再是一整条扁矩形）。 */
function PixelCloud({ cloud, sky, index }: { cloud: SkyCloud; sky: SkyProfile; index: number }): ReactElement {
  const rainy = cloud.kind === "rain";
  const rnd = seeded(seedOf(sky.levelId) ^ Math.imul(index + 3, 2654435761) ^ Math.round(cloud.x * 13 + cloud.y * 7));
  const base = rainy ? mix(sky.skyTop, "#5a6369", 0.55) : mix(sky.skyBottom, "#f4ecd8", 0.72);
  const lit = rainy ? mix(base, "#8b9599", 0.42) : mix(base, "#fff8ea", 0.62);
  const shade = rainy ? mix(base, "#343b40", 0.45) : mix(base, "#7d766a", 0.5);
  const w = Math.max(10, Math.min(cloud.w, VIEW_W - cloud.x - 2));
  const rawY = Math.max(SRC_TOP, Math.min(SRC_BOTTOM, cloud.y));
  const h = Math.max(2, Math.min(cloud.h, SRC_BOTTOM - rawY + 4) * SKY_SCALE);
  const x = Math.max(2, Math.min(cloud.x, VIEW_W - w - 2));
  const y = mapSkyY(rawY);
  const blocks: Array<[number, number, number, number, string]> = [
    [x, y + h * 0.52, w, h * 0.48, shade],
    [x + w * 0.06, y + h * 0.3, w * 0.88, h * 0.34, base],
    [x + w * 0.14, y + h * 0.1, w * 0.26, h * 0.34, lit],
    [x + w * 0.4, y + h * 0.02, w * 0.3, h * 0.44, lit],
    [x + w * 0.7, y + h * 0.16, w * 0.22, h * 0.3, base],
  ];
  for (let i = 0; i < 3; i += 1) {
    const bw = 3 + Math.round(rnd() * 4);
    blocks.push([x + w * (0.2 + rnd() * 0.55), y + h * (0.28 - rnd() * 0.24), bw, 3, base]);
  }
  if (rainy) {
    blocks.push([x - w * 0.02, y + h * 0.9, w * 1.04, 3, mix(shade, "#2b3236", 0.5)]);
    blocks.push([x + w * 0.12, y + h * 0.98, w * 0.14, 6, shade]);
    blocks.push([x + w * 0.56, y + h * 0.96, w * 0.1, 8, shade]);
  }
  return (
    <g opacity={Math.max(0.16, Math.min(0.88, cloud.opacity * 1.35 + 0.04))}>
      {blocks.map(([bx, by, bw, bh, fill], i) => (
        <rect key={`cloud-${index}-${i}`} x={bx} y={by} width={bw} height={bh} fill={fill} />
      ))}
    </g>
  );
}

/** 远山：两层阶梯剪影，让地平线有纵深，仍只用石灰/苔绿/土褐。 */
function PixelHills({ sky }: { sky: SkyProfile }): ReactElement {
  const rnd = seeded(seedOf(sky.levelId) + 31);
  const far = mix(sky.skyBottom, "#47513f", 0.62);
  const near = mix(sky.skyTop, "#39432f", 0.55);
  const farBlocks: Array<[number, number, number]> = [];
  const nearBlocks: Array<[number, number, number]> = [];
  let x = -6;
  while (x < VIEW_W) {
    const width = 16 + Math.round(rnd() * 14);
    const farH = 7 + Math.round(rnd() * 8);
    farBlocks.push([x, HORIZON - farH, width + 1]);
    x += width - 1;
  }
  x = -10;
  while (x < VIEW_W) {
    const width = 22 + Math.round(rnd() * 18);
    const nearH = 4 + Math.round(rnd() * 6);
    nearBlocks.push([x, HORIZON - nearH, width + 1]);
    x += width - 1;
  }
  return (
    <g>
      {farBlocks.map(([bx, by, bw], i) => (
        <rect key={`hill-far-${i}`} x={bx} y={by} width={bw} height={HORIZON - by} fill={far} />
      ))}
      {nearBlocks.map(([bx, by, bw], i) => (
        <rect key={`hill-near-${i}`} x={bx} y={by} width={bw} height={HORIZON - by} fill={near} />
      ))}
    </g>
  );
}

/** 像素日/月：阶梯方块拼出的圆盘，不用圆形和渐变。 */
function PixelOrb({ sky }: { sky: SkyProfile }): ReactElement | null {
  if (isRainy(sky)) return null;
  const darkSky = luma(sky.skyTop) < 0.16;
  const orb = sky.orb ?? (luma(sky.skyBottom) > 0.3 ? { x: 292, y: 148, color: "#e9c88d", r: 9 } : null);
  const orbRgb = orb ? hexToRgb(orb.color) : null;
  const orbSpread = orbRgb ? Math.max(...orbRgb) - Math.min(...orbRgb) : 0;
  const isMoon = !!orb && orbSpread < 30;
  const cx = orb?.x ?? 300;
  const cy = orb ? mapSkyY(orb.y) : 44;
  const r = orb?.r ?? 9;
  const color = isMoon ? orb?.color ?? "#d6cdb4" : orb?.color ?? "#e6b76a";
  const rim = isMoon ? mix(sky.skyTop, color, 0.45) : mix(color, "#4a3520", 0.55);
  const rows = [0.32, 0.66, 0.9, 1.02, 0.9, 0.66, 0.32];
  const rowH = Math.max(2, (r * 2) / rows.length);
  const disc = rows.map((factor, i) => {
    const rw = Math.max(3, r * 2 * factor);
    const shift = isMoon ? (i < 2 ? 0 : i === 2 ? 1 : 2) : 0;
    return { x: cx - rw / 2 + shift, y: cy - r + i * rowH, w: rw, h: rowH + 0.5 };
  });
  return (
    <g opacity={0.96}>
      {disc.map((row, i) => (
        <rect key={`orb-rim-${i}`} x={row.x - 1} y={row.y} width={row.w + 2} height={row.h} fill={rim} />
      ))}
      {disc.map((row, i) => (
        <rect key={`orb-${i}`} x={row.x} y={row.y} width={row.w} height={row.h} fill={color} />
      ))}
      {!isMoon
        ? [0, 1, 2, 3].map((i) => {
            const ray = [
              [cx - 2, cy - r - 7, 4, 5],
              [cx - 2, cy + r + 2, 4, 5],
              [cx - r - 7, cy - 2, 5, 4],
              [cx + r + 2, cy - 2, 5, 4],
            ][i];
            return <rect key={`ray-${i}`} x={ray[0]} y={ray[1]} width={ray[2]} height={ray[3]} fill={mix(color, "#f4e7c8", 0.35)} />;
          })
        : null}
    </g>
  );
}

/** 黄昏/夜里的星点：只在深色天空出现，小面积点缀。 */
function PixelStars({ sky }: { sky: SkyProfile }): ReactElement | null {
  if (isRainy(sky)) return null;
  if (luma(sky.skyTop) > 0.18) return null;
  const rnd = seeded(seedOf(sky.levelId) + 7);
  const stars: Array<{ x: number; y: number; size: number }> = [];
  while (stars.length < 30) {
    const x = Math.round(4 + rnd() * (VIEW_W - 8));
    const y = Math.round(4 + rnd() * 62);
    if (x > 90 && x < 270 && y > 13 && y < 35) continue;
    stars.push({ x, y, size: rnd() > 0.75 ? 2 : 1 });
  }
  return (
    <g opacity={0.68}>
      {stars.map((star, i) => (
        <rect key={`star-${i}`} x={star.x} y={star.y} width={star.size} height={star.size} fill="#d8cfb6" />
      ))}
    </g>
  );
}

/** 雨线：远/中/近三层，长度与颜色不同，形成雨幕层次；绘制在目标标注之前，不挡字。 */
function PixelRain({ sky }: { sky: SkyProfile }): ReactElement | null {
  const count = sky.rain ?? 0;
  if (count <= 0) return null;
  const rnd = seeded(seedOf(sky.levelId) + 57);
  const layers = [
    { color: mix(sky.skyBottom, "#aab3b7", 0.5), len: 4 },
    { color: mix(sky.skyBottom, "#c2c9ca", 0.35), len: 7 },
    { color: "#c9d0d0", len: 11 },
  ];
  const lines: Array<{ x: number; y: number; len: number; color: string }> = [];
  const total = count * 3;
  for (let i = 0; i < total; i += 1) {
    const layer = layers[i % layers.length];
    lines.push({
      x: Math.round(3 + rnd() * (VIEW_W - 6)),
      y: Math.round(18 + rnd() * (VIEW_H - 70)),
      len: layer.len + Math.round(rnd() * 3),
      color: layer.color,
    });
  }
  return (
    <g opacity={0.62}>
      {lines.map((line, i) => (
        <rect key={`rain-${i}`} x={line.x} y={line.y} width={1} height={line.len} fill={line.color} />
      ))}
    </g>
  );
}

function PixelSky({ sky }: { sky: SkyProfile }): ReactElement {
  const topH = 56;
  const horizonBand = mix(sky.skyBottom, "#2f2618", 0.42);
  return (
    <g>
      <rect x={0} y={0} width={VIEW_W} height={topH} fill={sky.skyTop} />
      <rect x={0} y={topH} width={VIEW_W} height={HORIZON - topH} fill={sky.skyBottom} />
      <rect x={0} y={HORIZON - 6} width={VIEW_W} height={6} fill={horizonBand} />
      <PixelStars sky={sky} />
      <PixelHills sky={sky} />
      <PixelOrb sky={sky} />
      {sky.clouds.map((cloud, index) => (
        <PixelCloud key={`cloud-${index}`} cloud={cloud} sky={sky} index={index} />
      ))}
    </g>
  );
}

function GroundBlocky({ sky }: { sky: SkyProfile }): ReactElement {
  const soil = mix(sky.skyBottom, "#221a11", 0.82);
  const soilTop = mix(sky.skyBottom, "#3a2c1c", 0.72);
  const soilDeep = mix(sky.skyTop, "#1b140d", 0.72);
  const path = mix(soilTop, "#6b6254", 0.42);
  const pathEdge = mix(path, "#3c362c", 0.42);
  const rnd = seeded(seedOf(sky.levelId) + 11);
  const steps: ReactElement[] = [];
  for (let y = VIEW_H - 6; y > HORIZON + 4; y -= 8) {
    const w = 30 + Math.round(rnd() * 6);
    const x = 180 - w / 2 + (y % 16 === 0 ? -3 : 3);
    steps.push(<rect key={`path-edge-l-${y}`} x={x - 2} y={y - 8} width={2} height={8} fill={pathEdge} />);
    steps.push(<rect key={`path-edge-r-${y}`} x={x + w} y={y - 8} width={2} height={8} fill={pathEdge} />);
    steps.push(<rect key={`path-${y}`} x={x} y={y - 8} width={w} height={8} fill={path} />);
  }
  return (
    <g>
      <rect x={0} y={HORIZON} width={VIEW_W} height={VIEW_H - HORIZON} fill={soil} />
      <rect x={0} y={HORIZON} width={VIEW_W} height={10} fill={soilTop} />
      {steps}
    </g>
  );
}

// ---------------------------------------------------------------- 关卡目标
function SceneGlyphs({ levelId, accent }: { levelId: string; accent: string }) {
  const dark = "#3a2d1d";
  switch (levelId) {
    case "L01":
      return <g>{[70, 130, 196, 262].map((x, i) => <g key={x}>{Q(x, 112 - (i % 2) * 12, 14, dark, accent)}{T(x, 140 - (i % 2) * 12, `${i + 1}号灯`)}</g>)}</g>;
    case "L02":
      return <g>{[70, 112, 154].map((x, i) => <g key={x}>{Q(x, 112, 13, dark, accent)}{T(x, 136, `${i + 1}号窝`)}</g>)}{R(236, 98, 28, 24, "#6b4f2d", accent)}{T(250, 136, "木桶")}</g>;
    case "L03":
      return <g>{Q(230, 104, 18, dark, accent)}{T(230, 134, "钟")}{R(44, 100, 26, 30, dark, accent)}{T(57, 144, "井")}{R(300, 88, 24, 42, dark, accent)}{T(312, 144, "北门")}</g>;
    case "L04":
      return <g>{[0, 1, 2].map((row) => <g key={row}>{R(56, 90 + row * 24, 116, 16, dark, accent)}{R(180, 90 + row * 24, 116, 16, dark, accent)}{T(70, 102 + row * 24, "田")}{T(194, 102 + row * 24, "渠")}</g>)}</g>;
    case "L05":
      return <g>{[[58, 94], [126, 88], [226, 92], [82, 128], [210, 130]].map(([x, y], i) => <g key={`${x}-${y}`}>{R(x, y, 26, 22, dark, accent)}{T(x + 13, y + 32, `${i + 1}号地`)}</g>)}</g>;
    case "L06":
      return <g>{[[74, 92], [148, 88]].map(([x, y], i) => <g key={`${x}-${y}`}><polygon points={`${x},${y + 26} ${x + 22},${y} ${x + 44},${y + 26}`} fill={dark} stroke={accent} strokeWidth="1.5" />{T(x + 22, y + 40, i === 0 ? "帐篷" : "货摊")}</g>)}{R(238, 96, 34, 24, "#6b4f2d", accent)}{T(255, 134, "木桶")}</g>;
    case "L07":
      return <g>{[[58, 96], [92, 96], [58, 122], [92, 122]].map(([x, y]) => <g key={`${x}-${y}`}>{R(x, y, 24, 20, "#6b4f2d", accent)}{T(x + 12, y + 30, "货箱")}</g>)}{Q(250, 104, 20, dark, accent)}{T(250, 138, "风车")}</g>;
    case "L08":
      return <g>{[[58, 100], [138, 100], [218, 100]].map(([x, y], i) => <g key={`${x}-${y}`}>{R(x, y, 36, 34, dark, accent)}{T(x + 18, y + 46, ["熔炉组", "红石门", "警钟"][i])}</g>)}</g>;
    case "L09":
      return <g>{[[58, 104], [116, 104], [174, 104]].map(([x, y], i) => <g key={`${x}-${y}`}>{R(x, y, 28, 26, dark, accent)}{T(x + 14, y + 38, `酿造台${i + 1}`)}</g>)}{Q(272, 104, 15, dark, accent)}{T(272, 132, "钟")}</g>;
    default:
      return <g>{Q(180, 112, 18, dark, accent)}{T(180, 138, "目标")}</g>;
  }
}

/** 主角与玩家：像素直角造型（不用圆形），名字仍写在脚下。 */
function Actors({ accent, x, y }: { accent: string; x: number; y: number }) {
  const skin = "#e7d6b3";
  const cloth = "#8a6b42";
  return (
    <g>
      <g transform={`translate(${x}, ${y})`}>
        <rect x="-7" y="-20" width="14" height="6" fill={accent} />
        <rect x="-6" y="-14" width="12" height="10" fill={skin} />
        <rect x="-8" y="-4" width="16" height="14" fill={cloth} />
        <rect x="-6" y="10" width="5" height="12" fill={skin} />
        <rect x="1" y="10" width="5" height="12" fill={skin} />
        <text x="0" y="36" textAnchor="middle" fontSize="9" fill="#d8c8a8">灰崽</text>
      </g>
      <g transform="translate(318, 170)">
        <rect x="-5" y="-18" width="10" height="10" fill={skin} />
        <rect x="-7" y="-8" width="14" height="16" fill={cloth} />
        <text x="0" y="28" textAnchor="middle" fontSize="9" fill="#d8c8a8">你</text>
      </g>
    </g>
  );
}

export function SceneIllustration({ levelId }: { levelId: string }) {
  const cfg = LEVELS[levelId] ?? LEVELS.L01;
  const sky = skyFor(levelId);
  const titleInk = "#f0e3c6";
  return (
    <details className="card scene">
      <summary>世界方位 · {cfg.title}（点开看）</summary>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={`${cfg.title}：${cfg.caption}（天空：${sky.periodLabel} · ${sky.weatherLabel}）`}>
        <PixelSky sky={sky} />
        <GroundBlocky sky={sky} />
        <PixelRain sky={sky} />
        <SceneGlyphs levelId={levelId} accent={cfg.accent} />
        <Actors accent={cfg.accent} x={cfg.x} y={cfg.y} />
        <text x={180} y={28} textAnchor="middle" fontSize="11" fill={titleInk}>{cfg.title}</text>
      </svg>
      <p className="scene-note">
        {sky.periodLabel} · {sky.weatherLabel}：{sky.note}真实世界在我的世界窗口里；这里只是这一关的方位示意。
      </p>
    </details>
  );
}
