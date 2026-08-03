import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/shortest-path-through-a-curved-world/",
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
