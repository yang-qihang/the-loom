import { useEffect, useMemo, useRef, useState } from "react";
import { chrome } from "../copy";
import type { LevelView, SnapshotView, StudioEngine } from "../types";
import { pointRows, xzText, type PointRow } from "./guidance-data";
import { RichText } from "./RichText";

interface PositionHudProps {
  engine: StudioEngine;
  sessionId: string | null;
  level: LevelView | null;
  onOpenManual?: () => void;
  /**
   * 每次轮询拿到快照时回调（docs/49 §2.3）：Workbench 用它实时同步目标面板、自动确认玩家节拍。
   * 用 ref 保存回调，轮询 effect 的依赖保持不变（不会因父组件重渲染重建 EventSource/定时器）。
   */
  onSnapshot?: (snapshot: SnapshotView) => void;
}

/** 位置 HUD（docs/48 §1.6）：每秒轮询引擎快照显示灰崽/关键点坐标；页面隐藏时暂停。 */
export function PositionHud({ engine, sessionId, level, onOpenManual, onSnapshot }: PositionHudProps) {
  const copy = chrome.hud;
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [paused, setPaused] = useState(false);
  /**
   * 展开/收起：窄窗（≤1100px，编辑器+右栏上下排列）默认收起，把高度让给代码编辑器；
   * 宽屏默认展开。用户可随时一键切换。
   */
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return !window.matchMedia("(max-width: 1100px)").matches;
  });
  const points: PointRow[] = useMemo(() => pointRows(level, snapshot?.points), [level, snapshot?.points]);
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    if (!sessionId) return;
    const fetchSnapshot = engine.snapshot?.bind(engine);
    if (!fetchSnapshot) {
      setSnapshot(null);
      return;
    }
    let disposed = false;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (disposed || polling) return;
      if (typeof document !== "undefined" && document.hidden) {
        setPaused(true);
        return;
      }
      polling = true;
      try {
        const next = await fetchSnapshot(sessionId);
        if (!disposed) {
          setSnapshot(next);
          setPaused(false);
          if (next) onSnapshotRef.current?.(next);
        }
      } catch {
        /* 引擎暂时不可用：保留上一次读数，不打断游戏。 */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    const onVisibility = (): void => {
      setPaused(typeof document !== "undefined" && document.hidden);
      if (typeof document !== "undefined" && !document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [engine, sessionId]);

  const golemPos = snapshot?.agents?.golem?.pos;
  const container = snapshot?.containers?.barrel ?? null;
  const containerEntries = container ? Object.entries(container) : [];

  return (
    <section className={expanded ? "card hud" : "card hud is-collapsed"} aria-label={copy.title} data-testid="position-hud">
      <header className="card-head">
        <h3 data-ui-panel-title>{copy.title}</h3>
        <div className="hud-actions">
          {!expanded ? (
            <span className="card-tag hud-pos-tag" data-testid="hud-collapsed-pos">
              {golemPos ? `(${xzText(golemPos)})` : copy.unknown}
            </span>
          ) : null}
          {onOpenManual ? (
            <button type="button" className="btn btn-quiet card-collapse" onClick={onOpenManual} data-testid="btn-hud-manual">
              {copy.manualLink}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet card-collapse"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            data-testid="btn-hud-toggle"
          >
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </header>
      {expanded ? (
        <div className="card-body">
          <p className="hud-row" data-testid="hud-golem">
            <span className="hud-label">{copy.golem}</span>
            <code className="hud-value" data-testid="hud-golem-pos">{golemPos ? `(${xzText(golemPos)})` : copy.unknown}</code>
          </p>
          {points.length > 0 ? (
            <ul className="hud-points" data-testid="hud-points">
              {points.map((point) => (
                <li className="hud-point" key={point.key} data-testid={`hud-point-${point.key}`}>
                  <span className="hud-label">{point.name}</span>
                  <code className="hud-value">({xzText(point.pos)})</code>
                </li>
              ))}
            </ul>
          ) : null}
          {containerEntries.length > 0 ? (
            <p className="hud-row hud-container" data-testid="hud-container">
              <span className="hud-label">{copy.container}</span>
              <span className="hud-value">{fillCount(copy.count, containerEntries)}</span>
            </p>
          ) : null}
          <p className="hud-note"><RichText text={paused ? copy.paused : copy.coordHint} /></p>
        </div>
      ) : null}
    </section>
  );
}

/** 「木桶里已倒 N 件」：把容器各项数量合成一行。 */
function fillCount(template: string, entries: Array<[string, number]>): string {
  const total = entries.reduce((sum, entry) => sum + Number(entry[1] ?? 0), 0);
  return template.replace("{数}", String(total));
}
