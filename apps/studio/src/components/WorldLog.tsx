import { chrome } from "../copy";
import { RichText } from "./RichText";

export function WorldLog({ lines }: { lines: string[] }) {
  return (
    <section className="card log" aria-label={chrome.aria.log}>
      <header className="card-head">
        <h3 data-ui-panel-title>{chrome.workbench.logTitle}</h3>
        <span className="card-tag">{lines.length}</span>
      </header>
      <div className="card-body">
      {lines.length === 0 ? (
        <p className="muted small">{chrome.workbench.logEmpty}</p>
      ) : (
        <ol className="log-lines" data-testid="world-log" aria-live="polite">
          {lines.slice(-16).map((line, index) => (
            <li key={`${index}-${line}`}>
              <RichText text={line} />
            </li>
          ))}
        </ol>
      )}
      </div>
    </section>
  );
}
