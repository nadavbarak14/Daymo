import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Allow tests that import from apps/web/... to resolve next/server and
    // other Next.js / Vercel packages that live in apps/web/node_modules.
    moduleDirectories: ["node_modules", path.resolve("apps/web/node_modules")],
    // Canonical aliases so vi.mock("@vercel/blob") and vi.mock("@vercel/blob/client")
    // resolve to the same module ID whether called from a test file at repo root
    // or from a route file deep inside apps/web.
    alias: {
      "@vercel/blob": path.resolve("apps/web/node_modules/@vercel/blob/dist/index.js"),
      "@vercel/blob/client": path.resolve("apps/web/node_modules/@vercel/blob/dist/client.js"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
