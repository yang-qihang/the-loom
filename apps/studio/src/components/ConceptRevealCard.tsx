import { chrome } from "../copy";
import type { LevelView } from "../types";
import { RichText } from "./RichText";
import { conceptFor } from "./guidance-data";

interface ConceptRevealCardProps {
  levelId: string;
  level?: LevelView | null;
  /** settle = 结算浮层；journal = 旅途手记；codex = 织典页内。 */
  variant?: "settle" | "journal" | "codex";
  onOpenCodex?: () => void;
}

/**
 * 概念揭晓（docs/48 §1.6，用户要求不回避专业术语）：
 * 显示「你刚才学的概念：<中文>（<英文>）」+ 是什么 / 为什么 / 对应你刚才做的事。
 * 数据来自 levels.json 的 conceptReveal；缺失时回退织典页（不编造英文名）。
 */
export function ConceptRevealCard({ levelId, level, variant = "settle", onOpenCodex }: ConceptRevealCardProps) {
  const copy = chrome.concept;
  const found = conceptFor(levelId, level);
  if (!found) return null;
  const { concept, source } = found;
  const title = variant === "journal" ? copy.journalTitle : variant === "codex" ? copy.codexTitle : copy.title;

  return (
    <section className={`concept-card is-${variant}`} data-testid="concept-card" aria-label={title}>
      <header className="concept-head">
        <h3 className="concept-title">{title}</h3>
      </header>
      <p className="concept-term-line">
        <span className="concept-label">{copy.termTitle}</span>
        <strong className="concept-term" data-testid="concept-term">{concept.term}</strong>
        {concept.en ? <span className="concept-en">（{concept.en}）</span> : null}
      </p>
      <dl className="concept-rows">
        <div className="concept-row">
          <dt className="concept-label">{copy.what}</dt>
          <dd className="concept-text"><RichText text={concept.what} /></dd>
        </div>
        <div className="concept-row">
          <dt className="concept-label">{copy.why}</dt>
          <dd className="concept-text"><RichText text={concept.why} /></dd>
        </div>
        <div className="concept-row">
          <dt className="concept-label">{copy.mapping}</dt>
          <dd className="concept-text"><RichText text={concept.mapping} /></dd>
        </div>
      </dl>
      {source === "codex" ? <p className="concept-fallback">{copy.fallbackHint}</p> : null}
      {onOpenCodex ? (
        <button type="button" className="btn btn-quiet concept-codex" onClick={onOpenCodex} data-testid="btn-concept-codex">
          {copy.openCodex}
        </button>
      ) : null}
    </section>
  );
}
