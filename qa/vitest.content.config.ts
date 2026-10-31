import { defineConfig } from "vitest/config";

/** QA l3：关卡内容验收测试（content/levels/*.test.ts），与 packages 单测分开跑。 */
export default defineConfig({
  test: {
    include: ["content/levels/**/*.test.ts"],
    environment: "node",
  },
});
