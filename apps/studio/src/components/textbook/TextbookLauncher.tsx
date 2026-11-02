import { isTextbookRead } from "../../textbook";
import "./textbook-launcher.css";

/**
 * 工作台里的「教材」常驻入口（用户任务 6「随时有不懂的地方都可以点回去再看」）。
 * 非模态：打开后背景照常可操作；是否已读的标记由 App 在关闭时写 localStorage。
 */
export function TextbookLauncher({
  levelId,
  onOpen,
}: {
  levelId: string;
  onOpen: (levelId: string) => void;
}) {
  const read = isTextbookRead(levelId);
  const label = read ? "回看教材" : "读本关教材";
  return (
    <button
      type="button"
      className="btn btn-quiet tb-launcher"
      data-testid="btn-textbook"
      title="打开与这一关配套的教材长文（可拖动、可置顶，随时回看）"
      aria-label={label}
      onClick={() => onOpen(levelId)}
    >
      <span className="tb-launcher-rune" aria-hidden="true">
        书
      </span>
      <span className="tb-launcher-label">{label}</span>
    </button>
  );
}

export default TextbookLauncher;
