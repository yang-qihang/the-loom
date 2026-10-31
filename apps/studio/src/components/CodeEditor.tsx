import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as monaco from "monaco-editor";
import { chrome } from "../copy";
import { configureMonaco } from "../monaco/setup";

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
      theme: "loom-night",
      fontSize,
      lineHeight: Math.round(fontSize * 1.625),
      fontFamily: '"Departure Mono", "Zpix", "JetBrains Mono", "Fira Code", "Noto Sans Mono", ui-monospace, monospace',
      fontLigatures: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "line",
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      tabSize: 2,
      wordWrap: "on",
      padding: { top: 16, bottom: 16 },
      automaticLayout: true,
      ariaLabel: chrome.aria.editor,
      fixedOverflowWidgets: true,
      contextmenu: true,
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
