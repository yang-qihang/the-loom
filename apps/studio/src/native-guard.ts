/**
 * Tauri 桌面壳的原生行为收口：
 * - 禁止浏览器式右键菜单（编辑器/输入框/代码块除外，保留复制粘贴）；
 * - 禁止 F12 / Ctrl+Shift+I/J/C / Ctrl+U 打开开发者工具或源码；
 * - 禁止 Ctrl+R / F5 刷新、Ctrl+Shift+R 强刷；
 * - 禁止把文件拖进窗口导致 WebView 导航。
 * 这些只在 isDesktopShell() 为真时安装，不改变浏览器开发/测试行为。
 */
import { isDesktopShell } from "./desktop";

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "[contenteditable='true']",
  ".monaco-editor",
  ".codex-code",
  "pre",
  "code",
].join(",");

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(EDITABLE_SELECTOR);
}

export function installNativeGuard(): () => void {
  if (!isDesktopShell()) return () => {};

  const onContextMenu = (event: MouseEvent) => {
    if (!isEditable(event.target)) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const blocked =
      event.key === "F5" ||
      event.key === "F12" ||
      (mod && (key === "r" || key === "u" || (event.shiftKey && key === "i") || (event.shiftKey && key === "j") || (event.shiftKey && key === "c")));
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onDragOver = (event: DragEvent) => event.preventDefault();
  const onDrop = (event: DragEvent) => event.preventDefault();
  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1 && !isEditable(event.target)) event.preventDefault();
  };

  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("auxclick", onAuxClick, true);
  return () => {
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("auxclick", onAuxClick, true);
  };
}
