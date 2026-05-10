import { describe, it, expect } from "vitest";
import { scanFxSayLiterals } from "../../src/tts/scan.js";

describe("scanFxSayLiterals", () => {
  it("finds simple calls", () => {
    const code = `
      await fx.say("Hello world");
      await page.click("#a");
      const n = fx.say('Goodbye');
    `;
    const calls = scanFxSayLiterals(code);
    expect(calls.map((c) => c.text)).toEqual(["Hello world", "Goodbye"]);
  });

  it("ignores fx.say with template literals (throws)", () => {
    const code = "await fx.say(`Hi ${name}`);";
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores fx.say with concatenation (throws)", () => {
    const code = `await fx.say("Hi " + name);`;
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores fx.say with variable arg (throws)", () => {
    const code = `const t = "x"; await fx.say(t);`;
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores comments and strings that look like fx.say", () => {
    const code = `
      // fx.say("not real");
      const x = "fx.say(\\"also not real\\")";
      await fx.say("real");
    `;
    const calls = scanFxSayLiterals(code);
    expect(calls.map((c) => c.text)).toEqual(["real"]);
  });

  it("returns line numbers (1-based) for each call", () => {
    const code = `await fx.say("a");\nawait fx.say("b");`;
    const calls = scanFxSayLiterals(code);
    expect(calls[0].line).toBe(1);
    expect(calls[1].line).toBe(2);
  });
});
