interface RuneGlyphProps {
  id: string;
  className?: string;
  size?: number;
  /** 自定义字形（如教练用「艾」）；默认取关卡序号的汉字数字。 */
  label?: string;
}

/** 关卡的纹章：汉字数字 + 织纹环，不出现拉丁字母。 */
const CHINESE_NUMERALS = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾"];

export function RuneGlyph({ id, className, size = 48, label }: RuneGlyphProps) {
  const order = Number(id.replace(/\D/g, ""));
  const numeral =
    label ?? (Number.isInteger(order) && order >= 1 && order <= CHINESE_NUMERALS.length ? CHINESE_NUMERALS[order - 1] : CHINESE_NUMERALS[0]);
  return (
    <span className={className ? `rune-seal ${className}` : "rune-seal"} style={{ width: size, height: size }} aria-hidden="true">
      <svg className="rune-seal-ring" viewBox="0 0 56 56" fill="none" focusable="false" aria-hidden="true">
        <circle cx="28" cy="28" r="25" stroke="currentColor" strokeOpacity="0.34" strokeWidth="1.5" />
        <path
          d="M28 3v6M28 47v6M3 28h6M47 28h6M11 11l4 4M45 45l-4-4M45 11l-4 4M11 45l4-4"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="rune-seal-text" style={{ fontSize: Math.max(10, Math.round(size * 0.44)) }}>
        {numeral}
      </span>
    </span>
  );
}
