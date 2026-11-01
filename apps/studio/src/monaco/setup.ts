import "monaco-editor/nls/lang/zh-cn";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import { SDK_DTS } from "../data/sdk";

interface WorkerGlobal {
  MonacoEnvironment?: monaco.Environment;
}

/** 代码编辑器与所有代码感 UI 共用的字体栈（Round 2：随包 Maple Mono CN，不依赖系统 fallback）。 */
export const EDITOR_FONT_FAMILY = '"Maple Mono", "Noto Sans Mono", ui-monospace, monospace';

/**
 * Monaco 主题：与页面暖黑/琥珀配色一致；所有浮层（右键菜单/建议/悬停/查找/参数提示）一律不透明。
 * 颜色集中在这里，styles.css 里的 !important 规则只做跨 Monaco 版本的兜底。
 */
export const MONACO_THEME = "loom-night";

const THEME_COLORS: Record<string, string> = {
  // 编辑区
  "editor.background": "#17120e",
  "editor.foreground": "#f0e6d2",
  "editor.lineHighlightBackground": "#221a12",
  "editor.lineHighlightBorder": "#00000000",
  "editorLineNumber.foreground": "#7b6a52",
  "editorLineNumber.activeForeground": "#e8b46a",
  "editorCursor.foreground": "#ffcf7d",
  "editor.selectionBackground": "#4a382699",
  "editor.inactiveSelectionBackground": "#3a2c1c66",
  "editor.selectionHighlightBackground": "#e8b46a33",
  "editor.wordHighlightBackground": "#3d2f1f88",
  "editor.wordHighlightStrongBackground": "#e8b46a44",
  "editor.findMatchBackground": "#e8b46a55",
  "editor.findMatchHighlightBackground": "#e8b46a2e",
  "editor.findRangeHighlightBackground": "#3d2f1f44",
  "editor.rangeHighlightBackground": "#3d2f1f33",
  "editor.hoverHighlightBackground": "#3d2f1f66",
  "editorLink.activeForeground": "#ffcf7d",
  "editorWhitespace.foreground": "#3c2d1e",
  "editorIndentGuide.background1": "#2c231a",
  "editorIndentGuide.activeBackground1": "#4a3826",
  "editorRuler.foreground": "#2c231a",
  "editorGutter.background": "#17120e",
  "editorGutter.modifiedBackground": "#e8b46a",
  "editorGutter.addedBackground": "#97c483",
  "editorGutter.deletedBackground": "#e08a6a",
  "editorOverviewRuler.border": "#4a3826",
  "editorOverviewRuler.findMatchForeground": "#e8b46a88",
  "editorError.foreground": "#e08a6a",
  "editorWarning.foreground": "#d9a441",
  "editorInfo.foreground": "#9fc4c9",
  // 括号配色（bracketPairColorization）
  "editorBracketHighlight.foreground1": "#e8b46a",
  "editorBracketHighlight.foreground2": "#97c483",
  "editorBracketHighlight.foreground3": "#9fc4c9",
  "editorBracketHighlight.foreground4": "#e08a6a",
  "editorBracketHighlight.foreground5": "#b9a3d0",
  "editorBracketHighlight.foreground6": "#f0d68a",
  "editorBracketHighlight.unexpectedBracket.foreground": "#ff6b5b",
  "editorBracketPairGuide.background1": "#2c231a",
  "editorBracketPairGuide.background2": "#2c231a",
  "editorBracketPairGuide.background3": "#2c231a",
  "editorBracketPairGuide.background4": "#2c231a",
  "editorBracketPairGuide.background5": "#2c231a",
  "editorBracketPairGuide.background6": "#2c231a",
  "editorBracketPairGuide.activeBackground1": "#4a3826",
  "editorBracketPairGuide.activeBackground2": "#4a3826",
  "editorBracketPairGuide.activeBackground3": "#4a3826",
  "editorBracketPairGuide.activeBackground4": "#4a3826",
  "editorBracketPairGuide.activeBackground5": "#4a3826",
  "editorBracketPairGuide.activeBackground6": "#4a3826",
  "editorBracketMatch.background": "#3a2c1c",
  "editorBracketMatch.border": "#e8b46a",
  // 右键菜单：必须是不透明实色（用户反馈菜单文字和代码叠在一起）
  "menu.background": "#17120d",
  "menu.foreground": "#f0ead2",
  "menu.border": "#5a452b",
  "menu.selectionBackground": "#2b2117",
  "menu.selectionForeground": "#ffcf7d",
  "menu.selectionBorder": "#00000000",
  "menu.separatorBackground": "#4a3826",
  "menu.shadowColor": "#00000099",
  "menubar.selectionBackground": "#2b2117",
  "menubar.selectionForeground": "#ffcf7d",
  // 通用浮层（suggest/hover/find/参数提示/重命名/命令面板）
  "editorWidget.background": "#1e1710",
  "editorWidget.foreground": "#f0e6d2",
  "editorWidget.border": "#4a3826",
  "editorWidget.shadow": "#00000080",
  "widget.shadow": "#00000080",
  "editorPane.background": "#17120e",
  "focusBorder": "#e8b46a",
  "input.background": "#120d09",
  "input.foreground": "#f0e6d2",
  "input.border": "#4a3826",
  "input.placeholderForeground": "#8f7d64",
  "inputOption.activeBackground": "#3d2f1f",
  "inputOption.activeForeground": "#ffcf7d",
  "inputOption.activeBorder": "#e8b46a",
  "inputValidation.infoBackground": "#1e1710",
  "inputValidation.warningBackground": "#1e1710",
  "inputValidation.errorBackground": "#3a1f19",
  "editorSuggestWidget.background": "#1e1710",
  "editorSuggestWidget.foreground": "#f0e6d2",
  "editorSuggestWidget.border": "#4a3826",
  "editorSuggestWidget.selectedBackground": "#2b2117",
  "editorSuggestWidget.selectedForeground": "#ffcf7d",
  "editorSuggestWidget.highlightForeground": "#ffcf7d",
  "editorSuggestWidget.focusHighlightForeground": "#ffcf7d",
  "editorSuggestWidgetStatus.foreground": "#8f7d64",
  "editorHoverWidget.background": "#1e1710",
  "editorHoverWidget.foreground": "#f0e6d2",
  "editorHoverWidget.border": "#4a3826",
  "editorHoverWidget.statusBarBackground": "#241b12",
  "editorHoverWidget.highlightForeground": "#ffcf7d",
  "editorGhostText.foreground": "#8f7d64",
  "quickInput.background": "#1e1710",
  "quickInput.foreground": "#f0e6d2",
  "quickInputList.focusBackground": "#2b2117",
  "quickInputList.focusForeground": "#ffcf7d",
  "quickInputList.focusIconForeground": "#ffcf7d",
  "pickerGroup.foreground": "#e8b46a",
  "pickerGroup.border": "#4a3826",
  "badge.background": "#3d2f1f",
  "badge.foreground": "#ffcf7d",
  "list.hoverBackground": "#2b2117",
  "list.activeSelectionBackground": "#3d2f1f",
  "list.activeSelectionForeground": "#ffcf7d",
  "list.inactiveSelectionBackground": "#2b2117",
  "list.focusBackground": "#3d2f1f",
  "list.focusForeground": "#ffcf7d",
  "list.highlightForeground": "#ffcf7d",
  "editorStickyScroll.background": "#17120e",
  "editorStickyScrollHover.background": "#1e1710",
  // 滚动条：与页面同色，不出现系统亮色
  "scrollbar.shadow": "#00000000",
  "scrollbarSlider.background": "#4a382680",
  "scrollbarSlider.hoverBackground": "#5a452baa",
  "scrollbarSlider.activeBackground": "#6b5638cc",
  "editorOverviewRuler.background": "#00000000",
  "minimap.background": "#17120e",
  "tab.activeBackground": "#1e1710",
  "tab.inactiveBackground": "#17120e",
  "panel.background": "#1e1710",
  "panel.border": "#4a3826",
};

let configured = false;

export function configureMonaco(): void {
  if (configured) return;
  configured = true;

  (self as unknown as WorkerGlobal).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new tsWorker();
      return new editorWorker();
    },
  };

  const ts = monaco.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: false,
    noImplicitAny: false,
    strictNullChecks: false,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    lib: ["es2022", "dom"],
  });
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  ts.typescriptDefaults.addExtraLib(SDK_DTS, "file:///loom-sdk.d.ts");

  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8f7c5f", fontStyle: "italic" },
      { token: "keyword", foreground: "e8b46a" },
      { token: "keyword.control", foreground: "e8b46a" },
      { token: "string", foreground: "c9d69a" },
      { token: "string.escape", foreground: "f0d68a" },
      { token: "number", foreground: "e3946b" },
      { token: "regexp", foreground: "e3946b" },
      { token: "type", foreground: "9fc4c9" },
      { token: "type.identifier", foreground: "9fc4c9" },
      { token: "identifier", foreground: "f0e6d2" },
      { token: "delimiter", foreground: "bfae92" },
      { token: "delimiter.bracket", foreground: "e8b46a" },
      { token: "operator", foreground: "e8b46a" },
      { token: "constant", foreground: "e3946b" },
      { token: "tag", foreground: "e8b46a" },
      { token: "attribute.name", foreground: "c9d69a" },
      { token: "attribute.value", foreground: "f0d68a" },
    ],
    colors: THEME_COLORS,
  });
}

export { monaco };
