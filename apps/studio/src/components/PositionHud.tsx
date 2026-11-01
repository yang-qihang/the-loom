import { useEffect, useMemo, useState } from "react";
import { chrome } from "../copy";
import type { LevelView, SnapshotView, StudioEngine } from "../types";
import { pointRows, xzText, type PointRow } from "./guidance-data";

interface PositionHudProps {
  engine: StudioEngine;
  sessionId: string | null;
  level: LevelView | null;
  onOpenManual?: () => void;
}

/** 位置 HUD（docs/48 §1.6）：每秒轮询引擎快照显示灰崽/关键点坐标；页面隐藏时暂停。 */
export function PositionHud({ engine, sessionId, level, onOpenManual }: PositionHudProps) {
  const copy = chrome.hud;
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [paused, setPaused] = useState(false);
  const points: PointRow[] = useMemo(() => pointRows(level, snapshot?.points), [level, snapshot?.points]);

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
    <section className="card hud" aria-label={copy.title} data-testid="position-hud">
      <header className="card-head">
        <h3 data-ui-panel-title>{copy.title}</h3>
        {onOpenManual ? (
          <button type="button" className="btn btn-quiet card-collapse" onClick={onOpenManual} data-testid="btn-hud-manual">
            {copy.manualLink}
          </button>
        ) : null}
      </header>
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
        <p className="hud-note">{paused ? copy.paused : copy.coordHint}</p>
      </div>
    </section>
  );
}

/** 「木桶里已倒 N 件」：把容器各项数量合成一行。 */
function fillCount(template: string, entries: Array<[string, number]>): string {
  const total = entries.reduce((sum, entry) => sum + Number(entry[1] ?? 0), 0);
  return template.replace("{数}", String(total));
}
