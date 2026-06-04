import { describe, it, expect } from "vitest";
import * as next from "../../../src/next/index.js";

describe("daymo/next entrypoint", () => {
  it("exports createChatRoute", () => {
    expect(typeof next.createChatRoute).toBe("function");
  });
});
