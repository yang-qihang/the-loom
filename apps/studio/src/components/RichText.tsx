import type { ReactNode } from "react";

/** 把文案里的反引号片段渲染成等宽代码引用；其余保持叙述文字。 */
export function RichText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(`[^`]*`)/g).filter((part) => part.length > 0);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
          return (
            <code className="inline-code" key={index}>
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
