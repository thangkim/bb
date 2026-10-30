import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-file-link-fallback",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
