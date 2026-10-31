import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Studio 通过相对路径复用 packages/level-spec、grading、mockworld（只读），
  // 因此 dev server 必须允许读取仓库根目录。
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    fs: { allow: [repoRoot] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: "es" },
});
