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

    const measureNaturalWidth = (paragraph: HTMLElement): number => {
      // 用隐藏克隆测“不换行时的自然宽度”，不受当前左右 padding 影响；
      // 否则居中后内容变窄 → 段落换行 → 退出居中 → 恢复变宽 → 再次居中，形成鬼畜循环。
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;width:max-content;";
      const clone = paragraph.cloneNode(true) as HTMLElement;
      wrapper.appendChild(clone);
      group.appendChild(wrapper);
      const width = wrapper.getBoundingClientRect().width;
      wrapper.remove();
      return width;
    };

    const update = () => {
      // group.clientWidth 是完整内容宽度（含 padding），即使当前处于居中状态也保持不变。
      const width = group.clientWidth;
      const paragraphs = [...group.querySelectorAll<HTMLElement>("p")];
      if (width <= 0 || paragraphs.length === 0) return;

      let allFitOneLine = true;
      let maxParagraphWidth = 0;
      for (const paragraph of paragraphs) {
        const naturalWidth = measureNaturalWidth(paragraph);
        if (naturalWidth <= 0) continue;
        if (naturalWidth > width - 2) {
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

      // 用左右 padding 把段组整体推到容器中线；块宽由最宽一段决定。
      // floor 保证内容宽度不小于 maxParagraphWidth，避免取整后重新换行。
      const offset = Math.max(0, Math.floor((width - maxParagraphWidth) / 2));
      group.style.paddingLeft = `${offset}px`;
      group.style.paddingRight = `${offset}px`;
    };

    update();
    // ResizeObserver 的首次通知发生在本轮布局之后；此时 initial update 已经算过，
    // 跳过它可以避免在首帧已绘制后再改一次 padding/宽度，造成肉眼可见的抖动。
    let firstObservation = true;
    const observer = new ResizeObserver(() => {
      if (firstObservation) {
        firstObservation = false;
        return;
      }
      update();
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className={className} ref={groupRef}>
      {children}
    </div>
  );
}
