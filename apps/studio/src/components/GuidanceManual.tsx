import { useEffect, useMemo, useState } from "react";
import { chrome, fill, levelCopy } from "../copy";
import type { LevelView, StudioEngine } from "../types";
import { RichText } from "./RichText";
import { API_KIND_LABEL, apiDocsFor, pointRows, posText, type PointRow } from "./guidance-data";
import type { ApiDocPoint } from "../../../../packages/sdk/src/api-registry";
import type { ApiManualEntry, NamedPointView } from "../types";

interface GuidanceManualProps {
  levelId: string;
  level?: LevelView | null;
  engine?: StudioEngine;
  onClose: () => void;
  onOpenRepl?: () => void;
}

const LEVEL_CN: Record<string, string> = {
  L01: "一",
  L02: "二",
  L03: "三",
  L04: "四",
  L05: "五",
  L06: "六",
  L07: "七",
  L08: "八",
  L09: "九",
  L10: "十",
};

/**
 * 指令手册（docs/48 §1.5）：本关可用 API + 命名点 + 坐标从哪来。
 * 内容来自本地 api-registry（引擎 /api/api-reference 可作为运行时远端覆盖）。
 */
export function GuidanceManual({ levelId, level, engine, onClose, onOpenRepl }: GuidanceManualProps) {
  const [query, setQuery] = useState("");
  const [remoteDocs, setRemoteDocs] = useState<ApiManualEntry[] | null>(null);
  const [remotePoints, setRemotePoints] = useState<Record<string, NamedPointView> | null>(null);
  const [selfLevel, setSelfLevel] = useState<LevelView | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const copy = chrome.manual;
  // App 可能还没来得及取关卡视图（从按钮点开是异步的）：手册自己兜底取一次，避免坐标表闪空。
  useEffect(() => {
    if (level || !engine) return;
    let disposed = false;
    void engine
      .loadLevel(levelId)
      .then((loaded) => {
        if (!disposed) setSelfLevel(loaded);
      })
      .catch(() => {
        /* 本地 registry 仍可渲染 API 列表。 */
      });
    return () => {
      disposed = true;
    };
  }, [engine, level, levelId]);
  const effectiveLevel = level ?? selfLevel;
  const levelTitle = effectiveLevel?.title ?? levelCopy(levelId)?.title ?? levelId;

  useEffect(() => {
    let disposed = false;
    const fetchReference = engine?.apiReference?.bind(engine);
    if (!fetchReference) return;
    void fetchReference(levelId)
      .then((reference) => {
        if (disposed || !reference) return;
        if (Array.isArray(reference.api) && reference.api.length > 0) setRemoteDocs(reference.api);
        if (reference.points && Object.keys(reference.points).length > 0) setRemotePoints(reference.points);
      })
      .catch(() => {
        /* 引擎端点缺失/不可用：本地 registry 兜底。 */
      });
    return () => {
      disposed = true;
    };
  }, [engine, levelId]);

  const docs = useMemo(() => apiDocsFor(levelId, remoteDocs), [levelId, remoteDocs]);
  const points: PointRow[] = useMemo(() => pointRows(effectiveLevel ?? null, remotePoints), [effectiveLevel, remotePoints]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return docs;
    return docs.filter((entry) =>
      [entry.signature, entry.summary, entry.details ?? "", entry.example, API_KIND_LABEL[entry.kind] ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [docs, query]);

  const copyExample = (entry: ApiDocPoint, index: number): void => {
    try {
      void navigator.clipboard?.writeText(entry.example);
    } catch {
      /* 没有剪贴板权限时仍可手动选中复制。 */
    }
    setCopied(index);
    window.setTimeout(() => setCopied((current) => (current === index ? null : current)), 1200);
  };

  return (
    <div className="gd-overlay" role="dialog" aria-modal="true" data-testid="api-manual" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gd-card" role="document">
        <header className="gd-head">
          <div className="gd-title-block">
            <h2>{copy.title}</h2>
            <p className="gd-subtitle">{copy.subtitle}</p>
            <p className="gd-level" data-testid="manual-level">{levelTitle}</p>
          </div>
          <button type="button" className="btn btn-quiet gd-close" onClick={onClose} data-testid="btn-manual-close" aria-label={copy.close}>
            {copy.close} ×
          </button>
        </header>

        <div className="gd-search-row">
          <label className="gd-search-label" htmlFor="manual-search">{copy.searchLabel}</label>
          <input
            id="manual-search"
            className="gd-search"
            value={query}
            placeholder={copy.searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            data-testid="manual-search"
          />
        </div>

        <div className="gd-body">
          <section className="gd-section" aria-label={copy.apiTitle}>
            <h3 className="gd-section-title">{copy.apiTitle}</h3>
            {filtered.length === 0 ? <p className="gd-empty" data-testid="manual-empty">{copy.empty}</p> : null}
            <ul className="gd-list" data-testid="manual-api-list">
              {filtered.map((entry, index) => (
                <li className="gd-item" key={entry.signature} data-testid={`manual-api-${index}`}>
                  <div className="gd-item-head">
                    <code className="gd-signature">{entry.signature}</code>
                    <span className="gd-badge">{API_KIND_LABEL[entry.kind] ?? entry.kind}</span>
                    <span className="gd-since">{fill(copy.sinceLabel, { 关: LEVEL_CN[entry.sinceLevel] ?? entry.sinceLevel })}</span>
                  </div>
                  <p className="gd-summary"><RichText text={entry.summary} /></p>
                  {entry.details ? <p className="gd-details"><RichText text={entry.details} /></p> : null}
                  <div className="gd-example-row">
                    <span className="gd-example-label">{copy.exampleLabel}</span>
                    <pre className="gd-example"><code>{entry.example}</code></pre>
                    <button type="button" className="btn btn-quiet gd-copy" onClick={() => copyExample(entry, index)} data-testid={`manual-copy-${index}`}>
                      {copied === index ? "已复制" : "复制"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="gd-section" aria-label={copy.pointsTitle}>
            <h3 className="gd-section-title">{copy.pointsTitle}</h3>
            {points.length === 0 ? (
              <p className="gd-empty" data-testid="manual-no-points">{copy.noPoints}</p>
            ) : (
              <table className="gd-points" data-testid="manual-points">
                <thead>
                  <tr>
                    <th scope="col">{copy.pointName}</th>
                    <th scope="col">{copy.pointPos}</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.key} data-testid={`manual-point-${point.key}`}>
                      <td>{point.name}</td>
                      <td><code className="gd-pos">{posText(point.pos)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="gd-section" aria-label={copy.coordTitle}>
            <h3 className="gd-section-title">{copy.coordTitle}</h3>
            <ul className="gd-coord-list">
              <li><RichText text={copy.coordNamed} /></li>
              <li><RichText text={copy.coordPos} /></li>
              <li><RichText text={copy.coordHud} /></li>
            </ul>
          </section>
        </div>

        <footer className="gd-foot">
          <span className="gd-foot-hint">{copy.footHint}</span>
          {onOpenRepl ? (
            <button type="button" className="btn" onClick={onOpenRepl} data-testid="btn-manual-repl">
              {copy.replGo}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose} data-testid="btn-manual-done">
            {copy.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
