// tests/unit/mocks.test.ts
import { describe, it, expect } from "vitest";
import { buildRouteTable } from "../../src/mocks.js";

describe("buildRouteTable", () => {
  it("normalizes raw JSON values into 200/application-json responses", () => {
    const table = buildRouteTable([
      { source: "inline", routes: { "GET /api/me": { name: "Alex" } } },
    ]);
    expect(table).toHaveLength(1);
    const [entry] = table;
    expect(entry.method).toBe("GET");
    expect(entry.urlGlob).toBe("**/api/me");
    expect(entry.response.status).toBe(200);
    expect(entry.response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(entry.response.body)).toEqual({ name: "Alex" });
  });

  it("respects long-form objects with status and custom headers", () => {
    const table = buildRouteTable([
      {
        source: "inline",
        routes: {
          "POST /api/projects": {
            status: 201,
            headers: { "x-rate-limit": "10" },
            body: { id: "p1" },
          },
        },
      },
    ]);
    const [entry] = table;
    expect(entry.method).toBe("POST");
    expect(entry.response.status).toBe(201);
    expect(entry.response.headers["x-rate-limit"]).toBe("10");
  });

  it("loads routes from an external file when `file:` is set", () => {
    const table = buildRouteTable(
      [{ source: "inline", file: "fake.json" }],
      () => ({ "GET /api/x": { ok: true } }),
    );
    expect(table[0].urlGlob).toBe("**/api/x");
  });

  it("throws on a malformed route key", () => {
    expect(() =>
      buildRouteTable([{ source: "inline", routes: { "noverb /api": {} } }]),
    ).toThrow(/method/i);
  });
});
