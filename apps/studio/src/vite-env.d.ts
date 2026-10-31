/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  readonly VITE_ENGINE_URL?: string;
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 仅端到端验收时挂载（VITE_E2E=1）；玩家界面不可见。 */
  __loomStudio?: {
    fillReference(): void;
    fillStarter(): void;
    setCode(code: string): void;
    run(): void;
    playerBeat(): void;
    reset(): void;
  };
}
