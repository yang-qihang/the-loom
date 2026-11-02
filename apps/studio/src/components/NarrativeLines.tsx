import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * 叙事正文组（序章/幕开场的若干段）。
 *
 * 规则：
 * - 只要有一段在当前渲染宽度下换行（或任一行实际占满容器），保持正常排版：
 *   非末行两端对齐、末行左起；
 * - 如果所有段落都只有一行、且没有任何一段占满容器宽度，则把整个段落组
 *   作为整体居中：以最宽的一段为块宽，段组整体水平居中，较短的段仍左对齐。
 *
 * 这是按实际渲染尺寸（Range 行盒宽度）检测，不是按字数/固定宽度猜；窗口
 * resize 后会重新计算，并在居中与普通两端对齐之间切换。
 */
export function NarrativeLines({ className, children }: { className?: string; children: ReactNode }) {
  const groupRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const update = () => {
      const width = group.getBoundingClientRect().width;
      const paragraphs = [...group.querySelectorAll<HTMLElement>("p")];
      if (width <= 0 || paragraphs.length === 0) return;

      let allSingleLine = true;
      let maxParagraphWidth = 0;
      for (const paragraph of paragraphs) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const lineRects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        const lineTops = new Set(lineRects.map((rect) => Math.round(rect.top)));
        if (lineTops.size !== 1) {
          allSingleLine = false;
          break;
        }
        maxParagraphWidth = Math.max(...lineRects.map((rect) => rect.width));
      }

      const shouldCenter = allSingleLine && maxParagraphWidth > 0 && maxParagraphWidth < width - 2;
      group.classList.toggle("is-centered-block", shouldCenter);
      if (!shouldCenter) {
        group.style.paddingLeft = "";
        group.style.paddingRight = "";
        return;
      }

      // 用左右 padding 把段组整体推到容器中线；块宽由最宽一段决定。
      // 取 floor 保证内容宽度不小于 maxParagraphWidth，避免取整后重新换行抖动。
      const offset = Math.max(0, Math.floor((width - maxParagraphWidth) / 2));
      group.style.paddingLeft = `${offset}px`;
      group.style.paddingRight = `${offset}px`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(group);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className={className} ref={groupRef}>
      {children}
    </div>
  );
}
