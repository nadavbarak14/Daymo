import { describe, it, expect } from "vitest";
import { migrateProseToFxSay } from "../../src/commands/migrate-prose.js";

describe("migrateProseToFxSay", () => {
  it("wraps prose into fx.say at top of playwright block", () => {
    const src = `---
title: t
url: about:blank
---

# One

This is the intro.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/^await fx\.say\("This is the intro\."\);\nawait fx\.pause/m);
    expect(out).not.toMatch(/^This is the intro\.$/m);
  });

  it("creates a playwright block when scene had none", () => {
    const src = `---
title: t
url: about:blank
---

# One

Hello.
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/```playwright\nawait fx\.say\("Hello\."\);\n```/);
  });

  it("is idempotent", () => {
    const src = `---
title: t
url: about:blank
---

# One

Hi.

\`\`\`playwright
await fx.say("Hi.");
await fx.pause(0.1);
\`\`\`
`;
    const once = migrateProseToFxSay(src);
    const twice = migrateProseToFxSay(once);
    expect(twice).toBe(once);
  });

  it("escapes embedded quotes", () => {
    const src = `---
title: t
url: about:blank
---

# One

She said "hi".

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/fx\.say\("She said \\"hi\\"\."\)/);
  });
});
