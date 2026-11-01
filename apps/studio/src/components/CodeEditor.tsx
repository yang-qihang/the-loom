import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
// 先引入 Monaco 适配层：它第一行会加载 zh-cn NLS（右键菜单/命令文案中文化），
// 因此 monaco-editor 本体必须在这之后再求值，保证全局语言包先就位。
import { configureMonaco, EDITOR_FONT_FAMILY, MONACO_THEME } from "../monaco/setup";
import * as monaco from "monaco-editor";
import { chrome } from "../copy";

export interface CodeEditorHandle {
  setValue(value: string): void;
  focusLine(line: number): void;
  revealLine(line: number): void;
  focus(): void;
}

interface CodeEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  onRun: () => void;
  fontSize?: number;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { initialValue, onChange, onRun, fontSize = 16 },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    configureMonaco();
    if (!hostRef.current) return;
    const model = monaco.editor.createModel(initialValue, "typescript", monaco.Uri.parse("file:///main.ts"));
    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme: MONACO_THEME,
      fontSize,
      fontWeight: "400",
      lineHeight: Math.round(fontSize * 1.625),
      // Round 2：代码编辑器唯一字体 = 随包 Maple Mono CN；开启连字（!= → ≠、=> → ⇒ 等教学可读性更好）。
      fontFamily: EDITOR_FONT_FAMILY,
      fontLigatures: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      cursorStyle: "line",
      cursorWidth: 2,
      renderLineHighlight: "line",
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      wordWrap: "on",
      padding: { top: 16, bottom: 16 },
      // 自适应尺寸：容器变化（伴玩/展开、窗口缩放）时 Monaco 自动 layout。
      automaticLayout: true,
      ariaLabel: chrome.aria.editor,
      // 右键菜单用 Monaco 自带（已中文化）：复制/粘贴/剪切/全选/命令面板等；
      // 浮层挂到 body 级 overflow 容器，避免被 editor-pane 的滚动裁切。
      contextmenu: true,
      fixedOverflowWidgets: true,
      // Monaco 0.57 默认把浮层放进 Shadow DOM，样式/验收无法访问且右键菜单会被浏览器默认层隔离；
      // 这里改成普通 DOM，主题色 + styles.css 兜底才能生效（菜单不透明是本轮验收项）。
      useShadowDOM: false,
      // 括号配色 + 缩进参考线 + 括号对参考线（颜色在 loom-night 主题里）。
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
      // 建议/悬停/查找浮层：不透明深色 + 与页面一致的边框（样式兜底见 styles.css）。
      suggest: { showWords: false, preview: true, showStatusBar: true },
      hover: { enabled: "on", delay: 220, sticky: true },
      quickSuggestions: { other: "on", comments: "off", strings: "off" },
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
        alwaysConsumeMouseWheel: false,
      },
      stickyScroll: { enabled: false },
      unicodeHighlight: { ambiguousCharacters: false },
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());
    const subscription = model.onDidChangeContent(() => onChangeRef.current(model.getValue()));
    editorRef.current = editor;

    return () => {
      subscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // initialValue 只用于首次创建 model；重置与填入参考解走 handle.setValue。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, lineHeight: Math.round(fontSize * 1.625) });
  }, [fontSize]);

  useImperativeHandle(
    ref,
    () => ({
      setValue(value: string) {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (model && model.getValue() !== value) model.setValue(value);
      },
      focusLine(line: number) {
        const editor = editorRef.current;
        if (!editor) return;
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      },
      revealLine(line: number) {
        editorRef.current?.revealLineInCenter(line);
      },
      focus() {
        editorRef.current?.focus();
      },
    }),
    [],
  );

  return <div className="editor-host" ref={hostRef} data-testid="code-editor" />;
});
