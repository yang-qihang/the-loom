/**
 * 引导数据的单点工具（指令手册 / 位置 HUD / 概念揭晓共用）。
 *
 * 数据来源优先级：
 * - API 列表：引擎 `/api/api-reference`（运行时可远端覆盖）→ 本地 `packages/sdk/src/api-registry.ts`。
 * - 命名点：引擎 `/api/levels/:id` 的 points（LevelView.points）→ 空表降级。
 * - 概念：`apps/studio/src/copy/levels.json` 的 conceptReveal → 织典页（content/codex/codex.json）。
 */
import { API_REGISTRY, registryForLevel, type ApiDocPoint } from "../../../../packages/sdk/src/api-registry";
import codexData from "../../../../content/codex/codex.json";
import { levelCopy, type ConceptReveal } from "../copy";
import type { ApiManualEntry, LevelView, NamedPointView } from "../types";

/** 关卡编号：L01 → 1；缺省 0（任何 entry 都不可用）。 */
export function levelOrder(levelId: string | undefined | null): number {
  const digits = String(levelId ?? "").replace(/[^0-9]/g, "");
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 中文分类（手册条目按 kind 标注）。 */
export const API_KIND_LABEL: Record<string, string> = {
  move: "移动",
  block: "方块",
  item: "物品",
  say: "说话",
  world: "世界",
  use: "交互",
};

/** 本关可用的 API 列表（远端数据优先；远端缺失/为空时用本地 registry）。 */
export function apiDocsFor(levelId: string, remote?: ApiManualEntry[] | null): ApiDocPoint[] {
  if (remote && remote.length > 0) {
    return remote.map((entry) => ({ ...entry, kind: entry.kind as ApiDocPoint["kind"] }));
  }
  return registryForLevel(levelId, levelOrder);
}

/** registry 全量（检索用；仍未超过本关的条目也允许搜索引擎按关键字找到，避免「手册搜不到」）。 */
export function searchApiDocs(levelId: string, query: string): ApiDocPoint[] {
  const docs = apiDocsFor(levelId);
  const keyword = query.trim().toLowerCase();
  if (!keyword) return docs;
  return docs.filter((entry) => {
    const haystack = [entry.signature, entry.summary, entry.details ?? "", entry.example, API_KIND_LABEL[entry.kind] ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

/** 命名点行（远端 points 优先，其次关卡自带的 points；保持声明顺序）。 */
export interface PointRow {
  key: string;
  name: string;
  pos: [number, number, number];
}

export function pointRows(level: LevelView | null, points?: Record<string, NamedPointView> | null): PointRow[] {
  const source = points && Object.keys(points).length > 0 ? points : level?.points;
  if (!source) return [];
  return Object.entries(source)
    .filter((entry): entry is [string, NamedPointView] => {
      const value = entry[1];
      return !!value && Array.isArray(value.pos) && value.pos.length >= 3;
    })
    .map(([key, value]) => ({
      key,
      name: value.name || key,
      pos: [Number(value.pos[0]), Number(value.pos[1]), Number(value.pos[2])],
    }));
}

/** 坐标显示（横、高、前）。 */
export function posText(pos: readonly number[] | undefined | null): string {
  if (!pos || pos.length < 3) return "";
  return `${Math.round(Number(pos[0]))}，${Math.round(Number(pos[1]))}，${Math.round(Number(pos[2]))}`;
}

/** 平面坐标（横、前）——HUD 紧凑显示用。 */
export function xzText(pos: readonly number[] | undefined | null): string {
  if (!pos || pos.length < 3) return "";
  return `${Math.round(Number(pos[0]))}，${Math.round(Number(pos[2]))}`;
}

interface CodexPage {
  id: string;
  title: string;
  subtitle: string;
  solve: string;
  mechanism: string;
  inGame: string;
  unlock: string;
}

/** 概念揭晓：levels.json 的 conceptReveal 优先；缺失时用织典对应页兜底（不编造英文名）。 */
export interface ConceptFound {
  concept: ConceptReveal;
  source: "copy" | "codex";
}

export function conceptFor(levelId: string, level?: LevelView | null): ConceptFound | null {
  const fromCopy = level?.conceptReveal ?? levelCopy(levelId)?.conceptReveal;
  if (fromCopy && fromCopy.term && fromCopy.what) return { concept: fromCopy, source: "copy" };
  const pages = codexData.pages as CodexPage[];
  const page = pages.find((entry) => entry.unlock === levelId);
  if (!page) return null;
  return {
    concept: {
      term: page.title,
      what: page.mechanism,
      why: page.solve,
      mapping: page.inGame,
    },
    source: "codex",
  };
}

/** 织典入口用：按关卡找对应 page id（没有则 undefined）。 */
export function codexPageFor(levelId: string): string | undefined {
  const pages = codexData.pages as CodexPage[];
  return pages.find((entry) => entry.unlock === levelId)?.id;
}

export { API_REGISTRY };
