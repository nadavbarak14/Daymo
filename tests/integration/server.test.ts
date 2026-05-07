// tests/integration/server.test.ts
import { describe, it, expect } from "vitest";
import { startFixtureServer } from "./server.js";

describe("fixture server", () => {
  it("serves the sample-app html", async () => {
    const s = await startFixtureServer();
    try {
      const html = await fetch(s.url).then((r) => r.text());
      expect(html).toContain("data-testid=\"new-project-btn\"");
    } finally {
      await s.close();
    }
  });
});
