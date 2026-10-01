import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-focused-diff",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
