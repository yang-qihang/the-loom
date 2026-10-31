import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "content/**/*.test.ts", "apps/engine/**/*.test.ts"], environment: "node" },
});
