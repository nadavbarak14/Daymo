import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Allow tests that import from apps/web/... to resolve next/server and
    // other Next.js / Vercel packages that live in apps/web/node_modules.
    moduleDirectories: ["node_modules", path.resolve("apps/web/node_modules")],
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
