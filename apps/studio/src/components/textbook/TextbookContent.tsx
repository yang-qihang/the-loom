import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RichText } from "../RichText";
import type { TextbookBlock, TextbookChapter, TextbookTerm } from "../../textbook/types";

/**
 * 配套教材正文渲染器（task-6 / docs/49 §2.5）。
 *
 * 只负责把 TextbookChapter.blocks 渲染成可读长文，不含窗口逻辑、不读全局状态：
 * - 正文用可读字体（--font-reading，回退 Noto Sans SC），代码用等宽字体（--font-code，回退 Maple Mono）；
 * - 行内反引号复用 RichText（输出 .inline-code）；
 * - 代码块带标题/说明 + 右上「复制」按钮（navigator.clipboard，失败时降级提示手动选择）；
 * - callout 三色 + 文字标签；terms 用定义列表；rule 为分隔线。
 */

export interface TextbookContentProps {
  chapter: TextbookChapter;
  className?: string;
}

export interface TextbookSection {
  /** 该 h2 在 chapter.blocks 里的下标，作为锚点的一部分，保证稳定唯一。 */
  blockIndex: number;
  /** DOM id，供窗口目录滚动定位。 */
  id: string;
  text: string;
}

export type CalloutTone = "tip" | "warn" | "aside";

/** h2 的稳定锚点 id（levelId + 块下标；不使用中文标题，避免 URL/选择器转义问题）。 */
export function textbookSectionAnchorId(levelId: string, blockIndex: number): string {
  const safeLevel = levelId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `tb-${safeLevel}-s${blockIndex}`;
}

/** 章节内目录（h2 列表）。窗口的可选目录与正文锚点共用这一份计算，避免错位。 */
export function textbookSections(chapter: TextbookChapter): TextbookSection[] {
  return chapter.blocks.flatMap((block, blockIndex) =>
    block.kind === "h2" ? [{ blockIndex, id: textbookSectionAnchorId(chapter.levelId, blockIndex), text: block.text }] : [],
  );
}

const CALLOUT_LABEL: Record<CalloutTone, string> = {
  tip: "提示",
  warn: "注意",
  aside: "旁注",
};

type CopyState = "idle" | "copied" | "failed";

function CodeBlock({ code, caption, blockIndex }: { code: string; caption?: string; blockIndex: number }): ReactNode {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const scheduleReset = (): void => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null;
      setCopyState("idle");
    }, 2400);
  };

  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      // 无剪贴板权限（非安全上下文 / 桌面壳未授权）时降级：提示手动选中。
      setCopyState("failed");
    }
    scheduleReset();
  };

  const label = copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败，请手动选择" : "复制";

  return (
    <figure className="tb-code" data-testid={`textbook-code-${blockIndex}`}>
      <div className="tb-code-bar">
        <span className="tb-code-lang" aria-hidden="true">
          ts
        </span>
        {caption ? <figcaption className="tb-code-caption">{caption}</figcaption> : <span className="tb-code-caption" />}
        <button
          type="button"
          className="tb-code-copy"
          data-testid={`btn-textbook-copy-${blockIndex}`}
          data-copy-state={copyState}
          onClick={() => void copy()}
          aria-label={copyState === "copied" ? "已复制代码" : "复制代码"}
        >
          {label}
        </button>
      </div>
      <pre className="tb-code-pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function TermsBlock({ items }: { items: TextbookTerm[] }): ReactNode {
  return (
    <dl className="tb-terms">
      {items.map((term, index) => (
        <div className="tb-term" key={`${term.zh}-${index}`}>
          <dt className="tb-term-head">
            <span className="tb-term-zh">{term.zh}</span>
            <span className="tb-term-en">{term.en}</span>
          </dt>
          <dd className="tb-term-def">
            <RichText text={term.def} />
          </dd>
          {term.example ? (
            <dd className="tb-term-example">
              <span className="tb-term-example-label">例</span>
              <span>
                <RichText text={term.example} />
              </span>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function CalloutBlock({ tone, title, text }: { tone: CalloutTone; title?: string; text: string }): ReactNode {
  return (
    <aside className={`tb-callout tb-callout-${tone}`} data-testid={`textbook-callout-${tone}`} role="note">
      <span className="tb-callout-label">{CALLOUT_LABEL[tone]}</span>
      {title ? <p className="tb-callout-title">{title}</p> : null}
      <p className="tb-callout-text">
        <RichText text={text} />
      </p>
    </aside>
  );
}

function BlockView({
  block,
  blockIndex,
  sectionId,
}: {
  block: TextbookBlock;
  blockIndex: number;
  sectionId?: string;
}): ReactNode {
  switch (block.kind) {
    case "p":
      return (
        <p className="tb-p">
          <RichText text={block.text} />
        </p>
      );
    case "h2":
      return (
        <h2 className="tb-h2" id={sectionId} data-testid={`textbook-section-${blockIndex}`}>
          {block.text}
        </h2>
      );
    case "h3":
      return <h3 className="tb-h3">{block.text}</h3>;
    case "code":
      return <CodeBlock code={block.code} caption={block.caption} blockIndex={blockIndex} />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <RichText text={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="tb-list tb-list-ordered">{items}</ol>
      ) : (
        <ul className="tb-list tb-list-unordered">{items}</ul>
      );
    }
    case "terms":
      return <TermsBlock items={block.items} />;
    case "callout":
      return <CalloutBlock tone={block.tone} title={block.title} text={block.text} />;
    case "rule":
      return <hr className="tb-rule" />;
    default:
      return null;
  }
}

export function TextbookContent({ chapter, className }: TextbookContentProps): ReactNode {
  const sections = useMemo(() => textbookSections(chapter), [chapter]);
  const sectionIdByBlock = useMemo(
    () => new Map(sections.map((section) => [section.blockIndex, section.id] as const)),
    [sections],
  );

  return (
    <article
      className={["tb-page", className].filter(Boolean).join(" ")}
      data-testid="textbook-content"
      data-level={chapter.levelId}
      aria-label={`${chapter.title} · 配套教材正文`}
    >
      <section className="tb-intro" aria-label="本章导读">
        <p className="tb-intro-meta">
          第 {chapter.order} 章 · 预计精读 {chapter.minutes} 分钟
          {chapter.prereq.length > 0 ? ` · 先修：${chapter.prereq.join("、")}` : " · 无先修要求"}
        </p>
        {chapter.goals.length > 0 ? (
          <>
            <p className="tb-intro-title">读完本章，你能：</p>
            <ul className="tb-intro-goals">
              {chapter.goals.map((goal, index) => (
                <li key={index}>{goal}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      {chapter.blocks.map((block, blockIndex) => (
        <BlockView
          key={`${chapter.levelId}-${blockIndex}`}
          block={block}
          blockIndex={blockIndex}
          sectionId={sectionIdByBlock.get(blockIndex)}
        />
      ))}
    </article>
  );
}

export default TextbookContent;
