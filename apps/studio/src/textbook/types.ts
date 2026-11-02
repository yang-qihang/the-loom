/**
 * 配套教材（Textbook）内容模型。
 *
 * 教材是每关一章的长文，从直觉到抽象讲清本关引入的程序语言概念；
 * 与游戏剧情互补，但不依赖剧情细节。UI 在独立的可拖动/缩放窗口中渲染。
 *
 * 约束：
 * - 本文件是纯数据模型（不含 React），可被 vitest 直接导入做内容校验。
 * - 文案里的行内代码用反引号包裹（`let`），由 RichText / 教材渲染器处理。
 * - 代码示例只允许使用本关及之前引入的 API（docs/12 / packages/sdk api-registry），
 *   由 content/textbook.test.ts 校验。
 */

/** 一个教材内容块。 */
export type TextbookBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "code"; code: string; caption?: string }
  | { kind: "list"; ordered?: boolean; items: string[] }
  | { kind: "terms"; items: TextbookTerm[] }
  | { kind: "callout"; tone: "tip" | "warn" | "aside"; title?: string; text: string }
  | { kind: "rule" };

export interface TextbookTerm {
  /** 中文名，首次出现时附英文 */
  zh: string;
  /** English term */
  en: string;
  /** 一句话定义/解释（可含反引号行内代码） */
  def: string;
  /** 可照抄的示例（可选） */
  example?: string;
}

export interface TextbookChapter {
  /** 关卡 id：L01–L10（一章 = 一幕/一关的配套教材） */
  levelId: string;
  /** 所属幕：1–3 */
  act: 1 | 2 | 3;
  /** 阅读顺序（1 起） */
  order: number;
  /** 章标题，例如「变量：给会变的东西起个名字」 */
  title: string;
  /** 一句话副标题：本关会让读者获得什么 */
  subtitle: string;
  /** 预计精读分钟数（按 400 字/分钟 + 代码块估算） */
  minutes: number;
  /** 先修概念（中文名） */
  prereq: string[];
  /** 读完能做到的事（3–5 条，具体、可检验） */
  goals: string[];
  /** 本章内容块（顺序渲染） */
  blocks: TextbookBlock[];
}

export type TextbookLibrary = Record<string, TextbookChapter>;
