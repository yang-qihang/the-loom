import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import { SDK_DTS } from "../data/sdk";

interface WorkerGlobal {
  MonacoEnvironment?: monaco.Environment;
}

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

  monaco.editor.defineTheme("loom-night", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8f7c5f", fontStyle: "italic" },
      { token: "keyword", foreground: "e8b46a" },
      { token: "string", foreground: "c9d69a" },
      { token: "number", foreground: "e3946b" },
      { token: "type", foreground: "9fc4c9" },
      { token: "identifier", foreground: "f0e6d2" },
    ],
    colors: {
      "editor.background": "#17120e",
      "editor.foreground": "#f0e6d2",
      "editorLineNumber.foreground": "#7b6a52",
      "editorLineNumber.activeForeground": "#e8b46a",
      "editor.lineHighlightBackground": "#221a12",
      "editor.selectionBackground": "#3d2f1f",
      "editorCursor.foreground": "#ffcf7d",
      "editorIndentGuide.background1": "#2c231a",
      "editorBracketMatch.background": "#3a2c1c",
      "editorBracketMatch.border": "#e8b46a",
      "editorWidget.background": "#1e1710",
      "editorWidget.border": "#4a3826",
    },
  });
}

export { monaco };
