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
 * 这是按实际字体的自然宽度检测，不是按字数/固定宽度猜；窗口
 * resize 后会重新计算，并在居中与普通两端对齐之间切换。
 */
export function NarrativeLines({ className, children }: { className?: string; children: ReactNode }) {
  const groupRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const container = group.parentElement;
    if (!container) return;

    const measureNaturalWidth = (paragraph: HTMLElement): number => {
      // 测原始内容，不克隆 WebKit 补齐后的行宽/letter-spacing，否则下一次测量
      // 会把上一次的排版结果当作输入。scrollWidth 与 clientWidth 都是未 zoom 的 CSS px。
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;width:max-content;";
      const clone = paragraph.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".justified-text-block").forEach((block) => {
        block.replaceWith(document.createTextNode(block.textContent ?? ""));
      });
      clone.style.cssText = "width:max-content;max-width:none;margin:0;padding:0;white-space:nowrap;text-align:left;letter-spacing:normal;";
      wrapper.appendChild(clone);
      group.appendChild(wrapper);
      const width = clone.scrollWidth;
      wrapper.remove();
      return width;
    };

    const update = () => {
      // clientWidth 包含居中 padding，保持完整盒宽；不混用 zoom 后的 DOMRect。
      const available = group.clientWidth;
      const paragraphs = [...group.querySelectorAll<HTMLElement>("p")];
      if (available <= 0 || paragraphs.length === 0) return;

      let allFitOneLine = true;
      let maxParagraphWidth = 0;
      for (const paragraph of paragraphs) {
        const naturalWidth = measureNaturalWidth(paragraph);
        if (naturalWidth <= 0) continue;
        if (naturalWidth > available - 2) {
          allFitOneLine = false;
          break;
        }
        maxParagraphWidth = Math.max(maxParagraphWidth, naturalWidth);
      }

      const shouldCenter = allFitOneLine && maxParagraphWidth > 0;
      group.classList.toggle("is-centered-block", shouldCenter);
      if (!shouldCenter) {
        group.style.paddingLeft = "";
        group.style.paddingRight = "";
        return;
      }

      // floor 为小数像素和字体取整留出空间，避免居中后反而换行。
      const offset = Math.max(0, Math.floor((available - maxParagraphWidth) / 2));
      group.style.paddingLeft = `${offset}px`;
      group.style.paddingRight = `${offset}px`;
    };

    update();
    // 只响应父容器宽度变化；段落高度变化不能触发下一轮收窄。
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === lastWidth) return;
      lastWidth = container.clientWidth;
      update();
    });
    observer.observe(container);
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [children]);

  return (
    <div className={className} ref={groupRef}>
      {children}
    </div>
  );
}
