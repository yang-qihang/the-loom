/**
 * 配套教材入口：结构化内容（由 scripts/build-textbook.ts 从 content/*.md 生成）
 * + 阅读进度（localStorage）工具。
 *
 * 内容生成：`node node_modules/tsx/dist/cli.mjs scripts/build-textbook.ts --write`
 * 生成文件：`library.generated.ts`（提交入库，Studio/桌面打包不依赖构建脚本）。
 */
import { TEXTBOOK as GENERATED } from "./library.generated";
import type { TextbookChapter, TextbookLibrary } from "./types";

export type { TextbookBlock, TextbookChapter, TextbookLibrary } from "./types";

/** 全部章节（key = levelId，如 L01）。 */
export const TEXTBOOK: TextbookLibrary = GENERATED;

/** 按 order 排序的章节列表（窗口上一章/下一章用）。 */
export const TEXTBOOK_CHAPTERS: TextbookChapter[] = Object.values(TEXTBOOK).sort((a, b) => a.order - b.order);

export const TEXTBOOK_READ_KEY = "loom.textbook.read.v1";

/** 读取已读章节 id 列表（容错：localStorage 不可用时返回空）。 */
export function readTextbookIds(): string[] {
  try {
    const raw = localStorage.getItem(TEXTBOOK_READ_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 是否已读过该章。 */
export function isTextbookRead(levelId: string): boolean {
  return readTextbookIds().includes(levelId);
}

/** 标记该章已读（首次阅读流程：关闭窗口即视为读过）。 */
export function markTextbookRead(levelId: string): void {
  if (!TEXTBOOK[levelId]) return;
  try {
    const ids = readTextbookIds();
    if (ids.includes(levelId)) return;
    localStorage.setItem(TEXTBOOK_READ_KEY, JSON.stringify([...ids, levelId]));
  } catch {
    /* localStorage 不可用（隐私模式/测试环境）：不阻塞阅读。 */
  }
}

/** 根据关卡 id 找章节（不存在的关卡返回 null）。 */
export function textbookChapter(levelId: string): TextbookChapter | null {
  return TEXTBOOK[levelId] ?? null;
}
