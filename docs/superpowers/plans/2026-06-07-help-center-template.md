# Help Center Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Daymo's bare help-center UI with the reviewed Claude Design template — a full responsive page (appbar, hero ask bar, chat thread with clip citations, video gallery, player modal, footer, mobile FAB) that any project gets with `import "daymo/help-center.css"` + `<HelpCenter …/>`.

**Architecture:** Behavior stays in the framework-agnostic vanilla mount (`src/help-center/`), split into focused modules: `strings.ts` (every visible string, overridable), `icons.ts` (static SVG constants), `player.ts` (body-appended modal player with real `<video>`), and a rewritten `mount.ts` that assembles the page. All looks live in `styles/help-center.css` behind stable `daymo-help-*` classes and `--daymo-*` tokens so consuming projects (and their coding agents) restyle without forking. Spec: `docs/superpowers/specs/2026-06-07-help-center-template-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vanilla DOM, vitest + jsdom (`// @vitest-environment jsdom` pragma — NOT happy-dom; the repo uses jsdom), plain CSS with `color-mix`. No new dependencies.

**Conventions that must hold everywhere:**
- No `id` attributes, no `document.querySelector` — all lookups scoped to created elements.
- `innerHTML` only for static markup + `ICONS` constants. Anything user-influenced (options, strings, server responses, manifest fields) goes through `textContent` / property assignment.
- The player modal is appended to `document.body`; tokens are therefore declared on `.daymo-help, .daymo-help-modal` in CSS, and `brandColor` is set inline on **both** the root and the modal element.
- Run tests with `npx vitest run <file>`; full suite `npm test`; typecheck `npx tsc --noEmit`.

---

### Task 1: Strings + icons modules

**Files:**
- Create: `src/help-center/strings.ts`
- Create: `src/help-center/icons.ts`

These are constants consumed by Tasks 2–3 (which carry the tests that exercise them). No dedicated test file.

- [ ] **Step 1: Create `src/help-center/strings.ts`**

```ts
/** Every visible string in the help-center template. Override any subset via
 *  `HelpCenterOptions.strings` — these defaults are the shipped design copy.
 *  This is the brand-voice / i18n escape hatch: no string in the UI is
 *  hardcoded anywhere else. */
export interface HelpCenterStrings {
  /** Appbar brand suffix ("Acme Help"); the whole brand text when no name is set. */
  brandSuffix: string;
  navBrowse: string;
  navAsk: string;
  contactLabel: string;
  eyebrow: string;
  heroTitle: string;
  lede: string;
  askPlaceholder: string;
  askButton: string;
  popularLabel: string;
  assistantName: string;
  assistantTag: string;
  errorText: string;
  galleryHeading: string;
  gallerySub: string;
  /** Card footer: "1:04 · 4 steps". */
  stepsSuffix: string;
  stepsHeading: string;
  closeLabel: string;
  fabLabel: string;
  footAllVideos: string;
  footContact: string;
  /** Footer badge prefix; the "Daymo" brand name itself is not configurable. */
  builtWith: string;
}

export const DEFAULT_STRINGS: HelpCenterStrings = {
  brandSuffix: "Help",
  navBrowse: "Browse videos",
  navAsk: "Ask",
  contactLabel: "Contact",
  eyebrow: "Help Center",
  heroTitle: "How can we help?",
  lede: "Search the video guides below, or just ask — answers come with a clip cued to the exact moment.",
  askPlaceholder: "Ask: how do I…?",
  askButton: "Ask",
  popularLabel: "Popular:",
  assistantName: "Assistant",
  assistantTag: "Daymo",
  errorText: "Couldn't reach the assistant. Try again.",
  galleryHeading: "Video guides",
  gallerySub: "Short walkthroughs for everything you can do.",
  stepsSuffix: "steps",
  stepsHeading: "Steps",
  closeLabel: "Close",
  fabLabel: "Ask a question",
  footAllVideos: "All videos",
  footContact: "Contact support",
  builtWith: "Built with",
};
```

- [ ] **Step 2: Create `src/help-center/icons.ts`**

All SVGs come from the design prototype. They are static string constants —
the only thing `innerHTML` is ever fed in this feature.

```ts
/** Static inline SVG markup (from the design prototype). Safe for innerHTML:
 *  constants only, never interpolated with user data. */
export const ICONS = {
  /** Daymo mark: play glyph in a screen. Used for the default brand mark,
   *  the assistant avatar, and the "Built with Daymo" badge. */
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 8 6 4-6 4Z"/><rect x="2" y="4" width="20" height="16" rx="3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 20l1-4.2A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
  contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
} as const;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/help-center/strings.ts src/help-center/icons.ts
git commit -m "feat(help-center): strings (brand-voice/i18n overridable) and icon constants"
```

---

### Task 2: Player modal module (TDD)

**Files:**
- Create: `src/help-center/player.ts`
- Test: `tests/unit/help-center/player.test.ts`

The modal player: real `<video controls>`, step list seeking, clip cueing with
one-shot `endMs` pause, focus trap, body scroll-lock, full cleanup.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/help-center/player.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createPlayer } from "../../../src/help-center/player.js";
import { DEFAULT_STRINGS } from "../../../src/help-center/strings.js";
import type { ManifestDemo } from "../../../src/publish/types.js";

const demo: ManifestDemo = {
  demoId: "d",
  title: "Create a note",
  description: "How to create",
  durationMs: 90000,
  videoUrl: "https://cdn/help/v1/d/output.mp4",
  posterUrl: "https://cdn/help/v1/d/poster.jpg",
  steps: [
    { stepId: "d:0:1", label: "Open the editor", startMs: 0 },
    { stepId: "d:0:2", label: "Click new note", startMs: 30000 },
  ],
};

beforeAll(() => {
  // jsdom has no media pipeline. Back currentTime with a field and fire
  // `seeking` on assignment (matching browser behavior); stub play/pause.
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get() {
      return (this as unknown as { __ct?: number }).__ct ?? 0;
    },
    set(v: number) {
      (this as unknown as { __ct?: number }).__ct = v;
      this.dispatchEvent(new Event("seeking"));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get() {
      return (this as unknown as { __rs?: number }).__rs ?? 0;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

/** Advance the fake playhead WITHOUT firing `seeking` (i.e., playback, not a
 *  seek), then emit timeupdate — mirrors how browsers report progress. */
function playTo(video: HTMLVideoElement, seconds: number) {
  (video as unknown as { __ct: number }).__ct = seconds;
  video.dispatchEvent(new Event("timeupdate"));
}

function setMetadataLoaded(video: HTMLVideoElement) {
  (video as unknown as { __rs: number }).__rs = 1;
  video.dispatchEvent(new Event("loadedmetadata"));
}

describe("createPlayer", () => {
  it("open() renders the dialog with title, steps, video src, scroll lock and focus", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);

    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.querySelector(".daymo-help-player")?.getAttribute("role")).toBe("dialog");
    expect(modal.textContent).toContain("Create a note");
    expect(modal.textContent).toContain("Open the editor");
    expect(modal.textContent).toContain("0:30"); // step 2 timestamp
    const video = modal.querySelector("video")!;
    expect(video.src).toContain("/d/output.mp4");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement?.classList.contains("daymo-help-player-close")).toBe(true);
  });

  it("clip cue waits for metadata, seeks, and auto-pauses at endMs", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 30000, endMs: 40000, autoplay: true });
    const video = document.body.querySelector("video")!;
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    expect(video.currentTime).toBe(0); // metadata not loaded yet
    setMetadataLoaded(video);
    expect(video.currentTime).toBe(30);

    playTo(video, 35);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    playTo(video, 40.1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    // one-shot: playing past it again does not pause again
    playTo(video, 50);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });

  it("a user seek clears the endMs stop; the programmatic cue seek does not", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 30000, endMs: 40000 });
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video); // fires the programmatic cue seek (seeking event)

    // user drags the native scrubber
    video.currentTime = 10;
    playTo(video, 41);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("step click seeks and the active step tracks timeupdate", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video);

    const steps = document.body.querySelectorAll<HTMLButtonElement>(".daymo-help-step");
    expect(steps).toHaveLength(2);
    steps[1].click();
    expect(video.currentTime).toBe(30);
    playTo(video, 31);
    expect(steps[1].classList.contains("active")).toBe(true);
    expect(steps[0].classList.contains("active")).toBe(false);
  });

  it("step click clears a pending endMs stop", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 0, endMs: 20000 });
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video);
    document.body.querySelectorAll<HTMLButtonElement>(".daymo-help-step")[1].click();
    playTo(video, 45);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("Escape closes: pauses, unlocks scroll, restores focus to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector(".daymo-help-modal")!;
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(modal.classList.contains("open")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("backdrop click closes; clicks inside the dialog do not", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    modal.querySelector<HTMLElement>(".daymo-help-player-title")!.click();
    expect(modal.classList.contains("open")).toBe(true);
    modal.click(); // event.target === modal
    expect(modal.classList.contains("open")).toBe(false);
  });

  it("Tab is trapped inside the dialog", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    const steps = modal.querySelectorAll<HTMLButtonElement>(".daymo-help-step");
    const last = steps[steps.length - 1];
    last.focus();
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.classList.contains("daymo-help-player-close")).toBe(true);
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });

  it("destroy() closes (restoring body state) and removes the modal", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    player.destroy();
    expect(document.body.querySelector(".daymo-help-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/help-center/player.test.ts`
Expected: FAIL — `Cannot find module '../../../src/help-center/player.js'`.

- [ ] **Step 3: Implement `src/help-center/player.ts`**

```ts
import type { ManifestDemo } from "../publish/types.js";
import type { HelpCenterStrings } from "./strings.js";
import { formatDuration } from "./gallery-model.js";
import { ICONS } from "./icons.js";

export interface PlayerCue {
  startMs?: number;
  /** One-shot stop: playback pauses when it reaches this point. Cleared by
   *  any user seek or step click. */
  endMs?: number;
  autoplay?: boolean;
}

export interface Player {
  open(demo: ManifestDemo, cue?: PlayerCue): void;
  close(): void;
  /** Close + remove the body-appended modal. Called by the mount's unmount. */
  destroy(): void;
  /** The modal element (body-appended); the mount mirrors --daymo-accent here. */
  readonly el: HTMLElement;
}

/** Body-appended modal player. The modal lives outside the .daymo-help root
 *  (escapes host stacking contexts), so the stylesheet declares tokens on
 *  `.daymo-help-modal` too, and the mount mirrors brandColor onto `el`. */
export function createPlayer(doc: Document, strings: HelpCenterStrings): Player {
  const modal = doc.createElement("div");
  modal.className = "daymo-help-modal";
  modal.innerHTML =
    `<div class="daymo-help-player" role="dialog" aria-modal="true">` +
    `<div class="daymo-help-player-top">` +
    `<h3 class="daymo-help-player-title"></h3>` +
    `<button type="button" class="daymo-help-player-close">${ICONS.close}</button>` +
    `</div>` +
    `<div class="daymo-help-player-body">` +
    `<div class="daymo-help-stage"><video controls playsinline></video></div>` +
    `<div class="daymo-help-steps">` +
    `<div class="daymo-help-steps-h"></div>` +
    `<div class="daymo-help-steps-list"></div>` +
    `</div>` +
    `</div>` +
    `</div>`;

  const titleEl = modal.querySelector(".daymo-help-player-title") as HTMLElement;
  const closeBtn = modal.querySelector(".daymo-help-player-close") as HTMLButtonElement;
  const video = modal.querySelector("video") as HTMLVideoElement;
  const stepsList = modal.querySelector(".daymo-help-steps-list") as HTMLElement;
  (modal.querySelector(".daymo-help-steps-h") as HTMLElement).textContent = strings.stepsHeading;
  closeBtn.setAttribute("aria-label", strings.closeLabel);

  let demo: ManifestDemo | null = null;
  let clipEndMs: number | null = null;
  let programmaticSeek = false;
  let opener: Element | null = null;
  let scrollLocked = false;
  let prevOverflow = "";

  video.addEventListener("seeking", () => {
    if (programmaticSeek) programmaticSeek = false;
    else clipEndMs = null; // a user seek cancels the clip stop
  });
  video.addEventListener("timeupdate", () => {
    const ms = video.currentTime * 1000;
    if (clipEndMs !== null && ms >= clipEndMs) {
      clipEndMs = null;
      video.pause();
    }
    highlightStep(ms);
  });

  function highlightStep(ms: number): void {
    if (!demo) return;
    let active = 0;
    demo.steps.forEach((s, i) => {
      if (ms >= s.startMs) active = i;
    });
    stepsList.querySelectorAll(".daymo-help-step").forEach((el, i) => {
      el.classList.toggle("active", i === active);
    });
  }

  /** Seek once metadata is available (setting currentTime before
   *  loadedmetadata is unreliable). `programmatic` marks the seek so the
   *  seeking handler doesn't treat it as a user seek. */
  function seekWhenReady(startMs: number, programmatic: boolean): void {
    const apply = () => {
      programmaticSeek = programmatic;
      video.currentTime = startMs / 1000;
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }

  function open(d: ManifestDemo, cue?: PlayerCue): void {
    demo = d;
    titleEl.textContent = d.title;
    video.src = d.videoUrl;
    video.poster = d.posterUrl;

    stepsList.textContent = "";
    for (const s of d.steps) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "daymo-help-step";
      const ix = doc.createElement("span");
      ix.className = "daymo-help-step-ix";
      ix.textContent = formatDuration(s.startMs);
      const lb = doc.createElement("span");
      lb.className = "daymo-help-step-lb";
      lb.textContent = s.label;
      b.append(ix, lb);
      b.addEventListener("click", () => {
        clipEndMs = null;
        seekWhenReady(s.startMs, false);
      });
      stepsList.appendChild(b);
    }

    clipEndMs = cue?.endMs ?? null;
    if (cue?.startMs != null && cue.startMs > 0) seekWhenReady(cue.startMs, true);
    highlightStep(cue?.startMs ?? 0);

    opener = doc.activeElement;
    modal.classList.add("open");
    if (!scrollLocked) {
      prevOverflow = doc.body.style.overflow;
      scrollLocked = true;
    }
    doc.body.style.overflow = "hidden";
    closeBtn.focus();
    if (cue?.autoplay) void Promise.resolve(video.play()).catch(() => undefined);
  }

  function close(): void {
    if (!modal.classList.contains("open")) return;
    video.pause();
    clipEndMs = null;
    modal.classList.remove("open");
    if (scrollLocked) {
      doc.body.style.overflow = prevOverflow;
      scrollLocked = false;
    }
    if (opener instanceof HTMLElement) opener.focus();
    opener = null;
  }

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = modal.querySelectorAll<HTMLElement>("button, video, [href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  doc.body.appendChild(modal);

  return {
    open,
    close,
    destroy(): void {
      close();
      modal.remove();
    },
    el: modal,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/help-center/player.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/help-center/player.ts tests/unit/help-center/player.test.ts
git commit -m "feat(help-center): modal player — real video, step seeking, clip cue with one-shot endMs pause, focus trap"
```

---

### Task 3: Mount rewrite (TDD)

**Files:**
- Modify: `src/help-center/mount.ts` (full rewrite, same export names)
- Test: `tests/unit/help-center/mount.test.ts` (full rewrite)

`gallery-model.ts` is reused unchanged.

- [ ] **Step 1: Rewrite the test file (failing first)**

Replace `tests/unit/help-center/mount.test.ts` entirely:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mountHelpCenter } from "../../../src/help-center/mount.js";
import type { HelpManifest } from "../../../src/publish/types.js";
import type { ChatResponse } from "../../../src/types.js";

const manifest: HelpManifest = {
  version: "v1",
  videoBaseUrl: "https://cdn/help/v1",
  demos: [
    {
      demoId: "d",
      title: "Create a note",
      description: "How to create",
      durationMs: 90000,
      videoUrl: "https://cdn/help/v1/d/output.mp4",
      posterUrl: "https://cdn/help/v1/d/poster.jpg",
      steps: [{ stepId: "d:0:1", label: "click", startMs: 0 }],
    },
  ],
};

beforeAll(() => {
  // jsdom media stubs (same approach as player.test.ts)
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

interface FetchOpts {
  chat?: ChatResponse;
  manifestData?: HelpManifest | null; // null => manifest fetch rejects
}

/** Records chat request bodies in `calls`. */
function makeFetch(opts: FetchOpts, calls: unknown[] = []): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("manifest.json")) {
      if (opts.manifestData === null) throw new Error("network down");
      return new Response(JSON.stringify(opts.manifestData ?? manifest), { status: 200 });
    }
    expect(init?.method).toBe("POST");
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(opts.chat ?? { kind: "no_match", text: "no" }), { status: 200 });
  }) as unknown as typeof fetch;
}

function mount(extra: Record<string, unknown> = {}, fetchImpl?: typeof fetch) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const unmount = mountHelpCenter(container, {
    manifestUrl: "/help/manifest.json",
    chatEndpoint: "/api/help/chat",
    fetchImpl: fetchImpl ?? makeFetch({}),
    ...extra,
  });
  return { container, unmount };
}

async function askQuestion(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLInputElement>(".daymo-help-input")!;
  const form = container.querySelector("form")!;
  input.value = text;
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("mountHelpCenter — page & options", () => {
  it("renders chrome (appbar, hero, footer, FAB) with defaults", async () => {
    const { container } = mount();
    expect(container.querySelector(".daymo-help-appbar")).toBeTruthy();
    expect(container.querySelector(".daymo-help-nm")?.textContent).toBe("Help");
    expect(container.querySelector(".daymo-help-h1")?.textContent).toBe("How can we help?");
    expect(container.querySelector(".daymo-help-footer")?.textContent).toContain("Built with");
    expect(container.querySelector(".daymo-help-fab")).toBeTruthy();
    // contact hidden without contactHref
    expect(container.querySelector<HTMLElement>(".daymo-help-contact")?.hidden).toBe(true);
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-card")).toBeTruthy();
    });
  });

  it("wires options through: name, title, brandColor, contactHref, suggestedQuestions", () => {
    const { container } = mount({
      name: "Acme",
      title: "Need a hand?",
      brandColor: "#ff0066",
      contactHref: "mailto:help@acme.io",
      suggestedQuestions: ["How do I start?", "How do I share?"],
    });
    const nm = container.querySelector(".daymo-help-nm")!;
    expect(nm.textContent).toContain("Acme");
    expect(nm.querySelector("span")?.textContent).toBe("Help");
    expect(container.querySelector(".daymo-help-h1")?.textContent).toBe("Need a hand?");
    const root = container.querySelector<HTMLElement>(".daymo-help")!;
    expect(root.style.getPropertyValue("--daymo-accent")).toBe("#ff0066");
    // modal (body-appended) gets the accent too
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    expect(modal.style.getPropertyValue("--daymo-accent")).toBe("#ff0066");
    const contact = container.querySelector<HTMLAnchorElement>(".daymo-help-contact")!;
    expect(contact.hidden).toBe(false);
    expect(contact.href).toContain("mailto:help@acme.io");
    expect(container.querySelectorAll(".daymo-help-suggest .daymo-help-chip")).toHaveLength(2);
  });

  it("chrome:false drops appbar, footer and FAB but keeps hero + gallery", async () => {
    const { container } = mount({ chrome: false });
    expect(container.querySelector(".daymo-help-appbar")).toBeNull();
    expect(container.querySelector(".daymo-help-footer")).toBeNull();
    expect(container.querySelector(".daymo-help-fab")).toBeNull();
    expect(container.querySelector(".daymo-help-hero")).toBeTruthy();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
  });

  it("strings overrides replace visible copy", () => {
    const { container } = mount({
      strings: { galleryHeading: "Tutorials", askPlaceholder: "Frag mich…", lede: "Kurze Videos." },
    });
    expect(container.querySelector(".daymo-help-section h2")?.textContent).toBe("Tutorials");
    expect(container.querySelector<HTMLInputElement>(".daymo-help-input")?.placeholder).toBe("Frag mich…");
    expect(container.querySelector(".daymo-help-lede")?.textContent).toBe("Kurze Videos.");
  });

  it("logoUrl replaces the appbar mark and the assistant avatar", async () => {
    const { container } = mount({ logoUrl: "https://acme.io/logo.png" });
    const mk = container.querySelector(".daymo-help-mk img") as HTMLImageElement;
    expect(mk?.src).toContain("logo.png");
    await askQuestion(container, "hi");
    await vi.waitFor(() => {
      const av = container.querySelector(".daymo-help-a-av img") as HTMLImageElement;
      expect(av?.src).toContain("logo.png");
    });
  });
});

describe("mountHelpCenter — gallery", () => {
  it("renders card buttons from the manifest; click opens the player", async () => {
    const { container } = mount();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    const card = container.querySelector<HTMLButtonElement>(".daymo-help-card")!;
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("data-demo-id")).toBe("d");
    expect(card.textContent).toContain("Create a note");
    expect(card.textContent).toContain("1:30"); // durationLabel
    expect(card.textContent).toContain("1 steps");
    card.click();
    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.textContent).toContain("Create a note");
  });

  it("hides the gallery section (and jump links) when the manifest is empty", async () => {
    const empty: HelpManifest = { version: "v1", videoBaseUrl: "x", demos: [] };
    const { container } = mount({}, makeFetch({ manifestData: empty }));
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>(".daymo-help-section")?.hidden).toBe(true);
    });
  });

  it("hides the gallery section when the manifest fetch fails", async () => {
    const { container } = mount({}, makeFetch({ manifestData: null }));
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>(".daymo-help-section")?.hidden).toBe(true);
    });
  });
});

describe("mountHelpCenter — chat", () => {
  it("shows a typing indicator, then renders text + a clip card that opens the player cued", async () => {
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "Here is how." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 5000, caption: "click new", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    await askQuestion(container, "how do I create a note");
    expect(container.querySelector(".daymo-help-typing")).toBeTruthy();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Here is how.");
    });
    const thread = container.querySelector(".daymo-help-thread")!;
    expect(thread.getAttribute("aria-live")).toBe("polite");
    const clip = container.querySelector<HTMLButtonElement>(".daymo-help-clip")!;
    expect(clip.textContent).toContain("click new");
    expect(clip.textContent).toContain("0:01–0:05");
    expect(clip.textContent).toContain("Create a note");
    clip.click();
    expect(document.body.querySelector(".daymo-help-modal")?.classList.contains("open")).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("falls back to an inline video for an unknown demoId", async () => {
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "video", stepId: "x:0:1", demoId: "unknown", startMs: 1000, endMs: 5000, caption: "cap", mp4Url: "https://cdn/x.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await askQuestion(container, "q");
    await vi.waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>(".daymo-help-thread video");
      expect(video?.src).toContain("x.mp4#t=1,5");
    });
  });

  it("no_match renders server suggestions as chips that re-ask", async () => {
    const chat: ChatResponse = { kind: "no_match", text: "Nothing found.", suggestions: ["Try this"] };
    const calls: unknown[] = [];
    const { container } = mount({ suggestedQuestions: ["Opt A"] }, makeFetch({ chat }, calls));
    await askQuestion(container, "zzz");
    await vi.waitFor(() => expect(container.textContent).toContain("Nothing found."));
    const chips = container.querySelectorAll<HTMLButtonElement>(".daymo-help-a-chips .daymo-help-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Try this"); // server suggestions win over the option
    chips[0].click();
    await vi.waitFor(() => {
      const bubbles = container.querySelectorAll(".daymo-help-q-bubble");
      expect(bubbles[bubbles.length - 1].textContent).toBe("Try this");
    });
  });

  it("no_match falls back to the suggestedQuestions option when the server sends none", async () => {
    const chat: ChatResponse = { kind: "no_match", text: "Nothing found." };
    const { container } = mount({ suggestedQuestions: ["Opt A", "Opt B"] }, makeFetch({ chat }));
    await askQuestion(container, "zzz");
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".daymo-help-a-chips .daymo-help-chip")).toHaveLength(2);
    });
  });

  it("history excludes the current message and truncates to the last 2 turns", async () => {
    const calls: { message: string; history: unknown[] }[] = [];
    const chat: ChatResponse = { kind: "answer", parts: [{ kind: "text", text: "A1" }] };
    const { container } = mount({}, makeFetch({ chat }, calls));
    await askQuestion(container, "q1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].history).toEqual([]);
    await vi.waitFor(() => expect(container.textContent).toContain("A1"));
    await askQuestion(container, "q2");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
    await vi.waitFor(() => expect(container.querySelectorAll(".daymo-help-qa")).toHaveLength(2));
    await askQuestion(container, "q3");
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    // last 2 of [q1,A1,q2,A2] => [q2, A2]
    expect(calls[2].history).toEqual([
      { role: "user", content: "q2" },
      { role: "assistant", content: "A1" }, // NOTE: second answer is also "A1" (same mock)
    ]);
  });

  it("renders the error string when the chat endpoint fails", async () => {
    const failing = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      throw new Error("down");
    }) as unknown as typeof fetch;
    const { container } = mount({}, failing);
    await askQuestion(container, "q");
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-error")?.textContent).toBe(
        "Couldn't reach the assistant. Try again.",
      );
    });
  });
});

describe("mountHelpCenter — unmount hygiene", () => {
  it("unmount removes the UI and the body-appended modal, restoring scroll", async () => {
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    container.querySelector<HTMLButtonElement>(".daymo-help-card")!.click();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(container.querySelector(".daymo-help")).toBeNull();
    expect(document.body.querySelector(".daymo-help-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("two mounts coexist (no ids, no shared state)", async () => {
    const a = mount();
    const b = mount();
    await vi.waitFor(() => {
      expect(a.container.querySelector(".daymo-help-card")).toBeTruthy();
      expect(b.container.querySelector(".daymo-help-card")).toBeTruthy();
    });
    a.unmount();
    expect(b.container.querySelector(".daymo-help")).toBeTruthy();
    expect(document.body.querySelectorAll(".daymo-help-modal")).toHaveLength(1);
    b.unmount();
  });
});
```

Note the marked quirk in the history test: the mock returns the same answer
("A1") for every chat call, so the expected second assistant turn is also
"A1". Keep the comment in the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/help-center/mount.test.ts`
Expected: FAIL — current mount has none of the new classes/markup.

- [ ] **Step 3: Rewrite `src/help-center/mount.ts`**

Full replacement:

```ts
import type { ChatResponse, VideoPart } from "../types.js";
import type { HelpManifest, ManifestDemo } from "../publish/types.js";
import { buildGalleryModel, formatDuration, type GalleryCard } from "./gallery-model.js";
import { DEFAULT_STRINGS, type HelpCenterStrings } from "./strings.js";
import { createPlayer } from "./player.js";
import { ICONS } from "./icons.js";

export interface HelpCenterOptions {
  manifestUrl: string;
  chatEndpoint: string;
  /** Product name in the appbar brand ("Acme Help"). */
  name?: string;
  /** Hero heading; defaults to "How can we help?". */
  title?: string;
  /** Brand color; set as --daymo-accent (all tints derive from it).
   *  Pair with a --daymo-accent-ink override for light brand colors. */
  brandColor?: string;
  /** Replaces the appbar mark and the assistant avatar (not the footer badge). */
  logoUrl?: string;
  /** "Popular:" chips under the ask bar; also the no-match fallback. */
  suggestedQuestions?: string[];
  /** Shows the appbar Contact button and footer link when set. */
  contactHref?: string;
  /** false drops appbar, footer and the mobile FAB (for hosts with chrome). */
  chrome?: boolean;
  /** Override any visible string (brand voice / i18n). */
  strings?: Partial<HelpCenterStrings>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Turn = { role: "user" | "assistant"; content: string };

const q = <T extends HTMLElement = HTMLElement>(scope: ParentNode, sel: string): T =>
  scope.querySelector(sel) as T;

/** Render the full help-center page (appbar, hero ask, chat thread, gallery,
 *  player modal, footer) into `container`. Returns an unmount function.
 *  Framework-agnostic vanilla DOM; no ids, no document-level listeners. */
export function mountHelpCenter(container: HTMLElement, opts: HelpCenterOptions): () => void {
  const doc = container.ownerDocument;
  const fetchFn = opts.fetchImpl ?? fetch;
  const strings: HelpCenterStrings = { ...DEFAULT_STRINGS, ...opts.strings };
  if (opts.title) strings.heroTitle = opts.title;
  const chrome = opts.chrome !== false;

  const root = doc.createElement("div");
  root.className = "daymo-help";

  const player = createPlayer(doc, strings);
  if (opts.brandColor) {
    root.style.setProperty("--daymo-accent", opts.brandColor);
    player.el.style.setProperty("--daymo-accent", opts.brandColor);
  }

  const demosById = new Map<string, ManifestDemo>();
  const history: Turn[] = [];

  /* ---------- helpers ---------- */

  function brandMark(cls: string, logoUrl: string | undefined): HTMLElement {
    const mk = doc.createElement("span");
    mk.className = cls;
    if (logoUrl) {
      const img = doc.createElement("img");
      img.src = logoUrl;
      img.alt = "";
      mk.appendChild(img);
    } else {
      mk.innerHTML = ICONS.logo;
    }
    return mk;
  }

  function chip(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "daymo-help-chip";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------- hero / ask ---------- */

  const hero = doc.createElement("section");
  hero.className = "daymo-help-hero";
  hero.innerHTML =
    `<div class="daymo-help-hero-bg"></div>` +
    `<div class="daymo-help-wrap">` +
    `<span class="daymo-help-eyebrow"><span class="daymo-help-dot"></span><span class="daymo-help-eyebrow-tx"></span></span>` +
    `<h1 class="daymo-help-h1"></h1>` +
    `<p class="daymo-help-lede"></p>` +
    `<div class="daymo-help-ask">` +
    `<form class="daymo-help-askbar">` +
    `<span class="daymo-help-lead">${ICONS.search}</span>` +
    `<input class="daymo-help-input" type="text" />` +
    `<button class="daymo-help-send" type="submit"><span class="daymo-help-send-tx"></span>${ICONS.arrow}</button>` +
    `</form>` +
    `<div class="daymo-help-suggest" hidden><span class="daymo-help-suggest-lbl"></span></div>` +
    `</div>` +
    `<div class="daymo-help-thread" aria-live="polite"></div>` +
    `</div>`;
  q(hero, ".daymo-help-eyebrow-tx").textContent = strings.eyebrow;
  q(hero, ".daymo-help-h1").textContent = strings.heroTitle;
  q(hero, ".daymo-help-lede").textContent = strings.lede;
  const input = q<HTMLInputElement>(hero, ".daymo-help-input");
  input.placeholder = strings.askPlaceholder;
  input.setAttribute("aria-label", strings.askButton);
  q(hero, ".daymo-help-send-tx").textContent = strings.askButton;
  q(hero, ".daymo-help-send").setAttribute("aria-label", strings.askButton);
  const thread = q(hero, ".daymo-help-thread");

  const suggest = q(hero, ".daymo-help-suggest");
  const suggested = opts.suggestedQuestions ?? [];
  if (suggested.length > 0) {
    suggest.hidden = false;
    q(suggest, ".daymo-help-suggest-lbl").textContent = strings.popularLabel;
    for (const s of suggested) suggest.appendChild(chip(s, () => ask(s)));
  }

  q(hero, ".daymo-help-askbar").addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });

  /* ---------- gallery ---------- */

  const gallerySec = doc.createElement("section");
  gallerySec.className = "daymo-help-section";
  gallerySec.hidden = true; // shown when the manifest yields demos
  gallerySec.innerHTML =
    `<div class="daymo-help-wrap">` +
    `<div class="daymo-help-sec-head"><div><h2></h2><p></p></div></div>` +
    `<div class="daymo-help-gallery"></div>` +
    `</div>`;
  q(gallerySec, "h2").textContent = strings.galleryHeading;
  q(gallerySec, ".daymo-help-sec-head p").textContent = strings.gallerySub;
  const gallery = q(gallerySec, ".daymo-help-gallery");

  function renderCard(card: GalleryCard): HTMLElement {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "daymo-help-card";
    btn.setAttribute("data-demo-id", card.demoId);
    btn.innerHTML =
      `<span class="daymo-help-poster">` +
      `<img alt="" />` +
      `<span class="daymo-help-play">${ICONS.play}</span>` +
      `<span class="daymo-help-dur"></span>` +
      `</span>` +
      `<span class="daymo-help-card-meta">` +
      `<span class="daymo-help-card-title"></span>` +
      `<span class="daymo-help-card-desc"></span>` +
      `<span class="daymo-help-card-foot">${ICONS.clock}<span></span></span>` +
      `</span>`;
    q<HTMLImageElement>(btn, "img").src = card.posterUrl;
    q(btn, ".daymo-help-dur").textContent = card.durationLabel;
    q(btn, ".daymo-help-card-title").textContent = card.title;
    q(btn, ".daymo-help-card-desc").textContent = card.description;
    q(btn, ".daymo-help-card-foot span").textContent =
      `${card.durationLabel} · ${card.stepCount} ${strings.stepsSuffix}`;
    btn.addEventListener("click", () => {
      const demo = demosById.get(card.demoId);
      if (demo) player.open(demo);
    });
    return btn;
  }

  /* ---------- chrome: appbar / footer / FAB ---------- */

  let appbar: HTMLElement | null = null;
  let footer: HTMLElement | null = null;
  let fab: HTMLButtonElement | null = null;
  let navBrowse: HTMLAnchorElement | null = null;
  let footAll: HTMLAnchorElement | null = null;

  function focusAsk(): void {
    hero.scrollIntoView?.({ behavior: "smooth" });
    input.focus();
  }
  function jumpGallery(e: Event): void {
    e.preventDefault();
    gallerySec.scrollIntoView?.({ behavior: "smooth" });
  }

  if (chrome) {
    appbar = doc.createElement("header");
    appbar.className = "daymo-help-appbar";
    appbar.innerHTML =
      `<div class="daymo-help-appbar-in">` +
      `<div class="daymo-help-brand"><span class="daymo-help-nm"></span></div>` +
      `<span class="daymo-help-spacer"></span>` +
      `<nav class="daymo-help-nav">` +
      `<a class="daymo-help-nav-link daymo-help-nav-browse" href="#" hidden></a>` +
      `<a class="daymo-help-nav-link daymo-help-nav-ask" href="#"></a>` +
      `</nav>` +
      `<a class="daymo-help-btn daymo-help-contact" hidden>${ICONS.contact}<span></span></a>` +
      `</div>`;
    const brand = q(appbar, ".daymo-help-brand");
    brand.insertBefore(brandMark("daymo-help-mk", opts.logoUrl), brand.firstChild);
    const nm = q(appbar, ".daymo-help-nm");
    if (opts.name) {
      nm.textContent = `${opts.name} `;
      const suffix = doc.createElement("span");
      suffix.textContent = strings.brandSuffix;
      nm.appendChild(suffix);
    } else {
      // No name: "Help" is the primary label (never an empty brand at ≤380px,
      // where the CSS hides only the suffix span).
      nm.textContent = strings.brandSuffix;
    }
    navBrowse = q<HTMLAnchorElement>(appbar, ".daymo-help-nav-browse");
    navBrowse.textContent = strings.navBrowse;
    navBrowse.addEventListener("click", jumpGallery);
    const navAsk = q<HTMLAnchorElement>(appbar, ".daymo-help-nav-ask");
    navAsk.textContent = strings.navAsk;
    navAsk.addEventListener("click", (e) => {
      e.preventDefault();
      focusAsk();
    });
    if (opts.contactHref) {
      const contact = q<HTMLAnchorElement>(appbar, ".daymo-help-contact");
      contact.hidden = false;
      contact.href = opts.contactHref;
      q(contact, "span").textContent = strings.contactLabel;
    }

    footer = doc.createElement("footer");
    footer.className = "daymo-help-footer";
    footer.innerHTML =
      `<div class="daymo-help-footer-in">` +
      `<div class="daymo-help-foot-links">` +
      `<a class="daymo-help-foot-all" href="#" hidden></a>` +
      `<a class="daymo-help-foot-contact" hidden></a>` +
      `</div>` +
      `<span class="daymo-help-built"><span class="daymo-help-mk">${ICONS.logo}</span><span class="daymo-help-built-tx"></span><b>Daymo</b></span>` +
      `</div>`;
    footAll = q<HTMLAnchorElement>(footer, ".daymo-help-foot-all");
    footAll.textContent = strings.footAllVideos;
    footAll.addEventListener("click", jumpGallery);
    q(footer, ".daymo-help-built-tx").textContent = `${strings.builtWith} `;
    if (opts.contactHref) {
      const fc = q<HTMLAnchorElement>(footer, ".daymo-help-foot-contact");
      fc.hidden = false;
      fc.href = opts.contactHref;
      fc.textContent = strings.footContact;
    }

    fab = doc.createElement("button");
    fab.type = "button";
    fab.className = "daymo-help-fab";
    fab.innerHTML = `${ICONS.chat}<span></span>`;
    q(fab, "span").textContent = strings.fabLabel;
    fab.addEventListener("click", focusAsk);
  }

  /* ---------- chat ---------- */

  function ask(message: string): void {
    message = message.trim();
    if (!message) return;
    input.value = "";

    const qa = doc.createElement("div");
    qa.className = "daymo-help-qa";
    qa.innerHTML =
      `<div class="daymo-help-q-row"><div class="daymo-help-q-bubble"></div></div>` +
      `<div class="daymo-help-a-row">` +
      `<div class="daymo-help-a-body">` +
      `<div class="daymo-help-a-name"><span class="daymo-help-a-nm"></span><span class="daymo-help-a-tag"></span></div>` +
      `<div class="daymo-help-a-text"><span class="daymo-help-typing"><i></i><i></i><i></i></span></div>` +
      `</div>` +
      `</div>`;
    q(qa, ".daymo-help-q-bubble").textContent = message;
    const aRow = q(qa, ".daymo-help-a-row");
    aRow.insertBefore(brandMark("daymo-help-a-av", opts.logoUrl), aRow.firstChild);
    q(qa, ".daymo-help-a-nm").textContent = strings.assistantName;
    q(qa, ".daymo-help-a-tag").textContent = strings.assistantTag;
    thread.appendChild(qa);
    qa.scrollIntoView?.({ behavior: "smooth", block: "nearest" });

    const body = q(qa, ".daymo-help-a-text");
    // history sent = turns BEFORE the current message
    const payload = JSON.stringify({ message, history: history.slice(-2) });
    history.push({ role: "user", content: message });

    void fetchFn(opts.chatEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    })
      .then((r) => r.json() as Promise<ChatResponse>)
      .then((resp) => renderResponse(body, resp))
      .catch(() => {
        body.textContent = "";
        const err = doc.createElement("p");
        err.className = "daymo-help-error";
        err.textContent = strings.errorText;
        body.appendChild(err);
      });
  }

  function renderResponse(body: HTMLElement, resp: ChatResponse): void {
    body.textContent = ""; // removes the typing indicator
    if (resp.kind === "no_match") {
      const p = doc.createElement("p");
      p.className = "daymo-help-a-p";
      p.textContent = resp.text;
      body.appendChild(p);
      const suggestions =
        resp.suggestions && resp.suggestions.length > 0
          ? resp.suggestions
          : (opts.suggestedQuestions ?? []);
      if (suggestions.length > 0) {
        const row = doc.createElement("div");
        row.className = "daymo-help-a-chips";
        for (const s of suggestions) row.appendChild(chip(s, () => ask(s)));
        body.appendChild(row);
      }
      history.push({ role: "assistant", content: resp.text });
      return;
    }
    const summary: string[] = [];
    for (const part of resp.parts) {
      if (part.kind === "text") {
        const p = doc.createElement("p");
        p.className = "daymo-help-a-p";
        p.textContent = part.text;
        body.appendChild(p);
        summary.push(part.text);
      } else {
        body.appendChild(renderVideoPart(part));
      }
    }
    history.push({ role: "assistant", content: summary.join(" ") });
  }

  function renderVideoPart(part: VideoPart): HTMLElement {
    const demo = demosById.get(part.demoId);
    if (!demo) {
      // Manifest not loaded (or unknown demo): inline media-fragment fallback.
      const wrap = doc.createElement("div");
      wrap.className = "daymo-help-clip-fallback";
      const video = doc.createElement("video");
      video.controls = true;
      video.src = `${part.mp4Url}#t=${part.startMs / 1000},${part.endMs / 1000}`;
      wrap.appendChild(video);
      if (part.caption) {
        const cap = doc.createElement("small");
        cap.textContent = part.caption;
        wrap.appendChild(cap);
      }
      return wrap;
    }
    const clip = doc.createElement("button");
    clip.type = "button";
    clip.className = "daymo-help-clip";
    clip.innerHTML =
      `<span class="daymo-help-clip-thumb"><img alt="" /><span class="daymo-help-clip-play">${ICONS.play}</span></span>` +
      `<span class="daymo-help-clip-ci">` +
      `<span class="daymo-help-clip-cap"></span>` +
      `<span class="daymo-help-clip-sub"><b></b></span>` +
      `</span>`;
    q<HTMLImageElement>(clip, "img").src = demo.posterUrl;
    q(clip, ".daymo-help-clip-cap").textContent = part.caption;
    const sub = q(clip, ".daymo-help-clip-sub");
    sub.insertBefore(doc.createTextNode(`${demo.title} · `), sub.firstChild);
    q(sub, "b").textContent = `${formatDuration(part.startMs)}–${formatDuration(part.endMs)}`;
    clip.addEventListener("click", () =>
      player.open(demo, { startMs: part.startMs, endMs: part.endMs, autoplay: true }),
    );
    return clip;
  }

  /* ---------- manifest load ---------- */

  let cancelled = false;
  void fetchFn(opts.manifestUrl)
    .then((r) => r.json() as Promise<HelpManifest>)
    .then((manifest) => {
      if (cancelled) return;
      for (const d of manifest.demos) demosById.set(d.demoId, d);
      const model = buildGalleryModel(manifest);
      if (model.cards.length === 0) return; // gallery stays hidden
      gallerySec.hidden = false;
      if (navBrowse) navBrowse.hidden = false;
      if (footAll) footAll.hidden = false;
      for (const card of model.cards) gallery.appendChild(renderCard(card));
    })
    .catch(() => {
      /* gallery (and its jump links) stay hidden on failure */
    });

  /* ---------- assemble ---------- */

  if (appbar) root.appendChild(appbar);
  const main = doc.createElement("main");
  main.append(hero, gallerySec);
  root.appendChild(main);
  if (footer) root.appendChild(footer);
  if (fab) root.appendChild(fab);
  container.appendChild(root);

  return () => {
    cancelled = true;
    player.destroy();
    root.remove();
  };
}
```

- [ ] **Step 4: Run mount + player + gallery-model tests**

Run: `npx vitest run tests/unit/help-center/`
Expected: PASS (all three files).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/help-center/mount.ts tests/unit/help-center/mount.test.ts
git commit -m "feat(help-center): full-page template mount — appbar/hero/ask, clip-citation chat, gallery, chrome:false"
```

---

### Task 4: React wrapper update

**Files:**
- Modify: `src/react/help-center.tsx`

- [ ] **Step 1: Replace the effect-deps remount key**

Replace the file body with:

```tsx
import { useEffect, useRef, type ReactElement } from "react";
import { mountHelpCenter, type HelpCenterOptions } from "../help-center/mount.js";

export type HelpCenterProps = HelpCenterOptions;

/** React wrapper around the vanilla help-center mount. The component owns a
 *  host div and remounts the vanilla UI whenever any serializable option
 *  changes (`fetchImpl` excluded). Caveat: a remount discards the chat
 *  thread, so pass stable option values. */
export function HelpCenter(props: HelpCenterProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { fetchImpl: _fetchImpl, ...serializable } = props;
  const key = JSON.stringify(serializable);
  useEffect(() => {
    if (!ref.current) return;
    return mountHelpCenter(ref.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className="daymo-help-host" />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the unused `_fetchImpl` underscore prefix avoids
`noUnusedLocals` complaints; if tsc still flags it, destructure as
`const { fetchImpl, ...serializable } = props; void fetchImpl;`).

- [ ] **Step 3: Commit**

```bash
git add src/react/help-center.tsx
git commit -m "feat(react): remount HelpCenter on any option change (serializable key)"
```

---

### Task 5: Stylesheet replacement

**Files:**
- Replace: `styles/help-center.css`

No unit test — CSS is verified by the Task 7 visual smoke check. Replace the
entire file with:

```css
/* =====================================================================
   Daymo Help Center — default template stylesheet.
   Generic, drop-in, responsive. Neutral zinc surfaces + ONE brand color:
   set --daymo-accent (or HelpCenterOptions.brandColor) and every tint
   derives from it via color-mix. Import it:

       import "daymo/help-center.css";

   …or copy this file into your project and own it. Markup class names
   (.daymo-help-*) are a stable API: restyle freely, the behavior in
   `mountHelpCenter` never depends on these styles.

   NOTE for light brand colors (yellow/lime/pastel): also override
   --daymo-accent-ink (the text color used ON accent surfaces).

   Fonts: no third-party @import here by design. Geist is used when the
   host loads it; otherwise the system stack applies.
   ===================================================================== */

.daymo-help,
.daymo-help-modal {
  --daymo-accent: #6355c0;
  --daymo-accent-ink: #ffffff;
  --daymo-a-weak: color-mix(in srgb, var(--daymo-accent) 12%, transparent);
  --daymo-a-weak2: color-mix(in srgb, var(--daymo-accent) 7%, transparent);
  --daymo-a-line: color-mix(in srgb, var(--daymo-accent) 26%, transparent);
  --daymo-a-hover: color-mix(in srgb, var(--daymo-accent) 90%, #000);

  --daymo-bg: #ffffff;
  --daymo-bg-2: #fafafa;
  --daymo-surface: #ffffff;
  --daymo-fg: #18181b;
  --daymo-fg-2: #3f3f46;
  --daymo-muted: #71717a;
  --daymo-border: #e7e7ea;
  --daymo-border-2: #f1f1f3;

  --daymo-r: 14px;
  --daymo-r-sm: 9px;
  --daymo-r-lg: 18px;
  --daymo-shadow-sm: 0 1px 2px rgba(24, 24, 27, 0.05);
  --daymo-shadow: 0 6px 22px -10px rgba(24, 24, 27, 0.18);
  --daymo-shadow-lg: 0 24px 70px -24px rgba(24, 24, 27, 0.32);
  --daymo-maxw: 1080px;
  --daymo-gap: 18px;
  --daymo-z-modal: 80;
  --daymo-z-fab: 60;
  --daymo-z-appbar: 30;

  --daymo-font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --daymo-font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

[data-daymo-theme="dark"] .daymo-help,
[data-daymo-theme="dark"] .daymo-help-modal,
.daymo-help[data-daymo-theme="dark"],
.daymo-help-modal[data-daymo-theme="dark"] {
  --daymo-accent-ink: #0c0c0f;
  --daymo-bg: #0d0d10;
  --daymo-bg-2: #121216;
  --daymo-surface: #17171c;
  --daymo-fg: #f4f4f5;
  --daymo-fg-2: #d4d4d8;
  --daymo-muted: #a1a1aa;
  --daymo-border: #2a2a31;
  --daymo-border-2: #202026;
  --daymo-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --daymo-shadow: 0 8px 26px -10px rgba(0, 0, 0, 0.6);
  --daymo-shadow-lg: 0 28px 80px -24px rgba(0, 0, 0, 0.8);
}

.daymo-help {
  font-family: var(--daymo-font);
  background: var(--daymo-bg);
  color: var(--daymo-fg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.daymo-help *,
.daymo-help-modal * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.daymo-help svg,
.daymo-help-modal svg {
  display: block;
}
.daymo-help ::selection {
  background: var(--daymo-a-weak);
}
.daymo-help a {
  color: inherit;
}
.daymo-help button {
  font: inherit;
  color: inherit;
}

/* ---------------- appbar ---------------- */
.daymo-help-appbar {
  position: sticky;
  top: 0;
  z-index: var(--daymo-z-appbar);
  background: color-mix(in srgb, var(--daymo-bg) 86%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--daymo-border);
}
.daymo-help-appbar-in {
  max-width: var(--daymo-maxw);
  margin: 0 auto;
  padding: 13px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.daymo-help-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.daymo-help-mk {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--daymo-accent);
  color: var(--daymo-accent-ink);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: var(--daymo-shadow-sm);
  overflow: hidden;
}
.daymo-help-mk svg {
  width: 17px;
  height: 17px;
}
.daymo-help-mk img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.daymo-help-nm {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.daymo-help-nm span {
  color: var(--daymo-muted);
  font-weight: 500;
}
.daymo-help-spacer {
  flex: 1;
}
.daymo-help-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.daymo-help-nav-link {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--daymo-muted);
  text-decoration: none;
  padding: 8px 11px;
  border-radius: var(--daymo-r-sm);
  transition: 0.14s;
  white-space: nowrap;
  cursor: pointer;
}
.daymo-help-nav-link:hover {
  color: var(--daymo-fg);
  background: var(--daymo-bg-2);
}
.daymo-help-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  justify-content: center;
  font-weight: 540;
  font-size: 13.5px;
  line-height: 1;
  border-radius: var(--daymo-r-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: 0.15s;
  border: 1px solid var(--daymo-border);
  background: var(--daymo-surface);
  color: var(--daymo-fg);
  padding: 0 14px;
  height: 36px;
  text-decoration: none;
}
.daymo-help-btn:hover {
  background: var(--daymo-bg-2);
}
.daymo-help-btn svg {
  width: 15px;
  height: 15px;
}

/* ---------------- shell ---------------- */
.daymo-help-wrap {
  max-width: var(--daymo-maxw);
  margin: 0 auto;
  padding: 0 24px;
}

/* ---------------- hero / ask ---------------- */
.daymo-help-hero {
  position: relative;
  padding: 60px 0 30px;
  overflow: hidden;
}
.daymo-help-hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.55;
  background-image: radial-gradient(var(--daymo-a-line) 1px, transparent 1px);
  background-size: 26px 26px;
  -webkit-mask-image: linear-gradient(180deg, #000, transparent 72%);
  mask-image: linear-gradient(180deg, #000, transparent 72%);
}
.daymo-help-hero .daymo-help-wrap {
  position: relative;
}
.daymo-help-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--daymo-accent);
  margin-bottom: 15px;
}
.daymo-help-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--daymo-accent);
}
.daymo-help-h1 {
  font-size: clamp(28px, 4.2vw, 42px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.05;
  max-width: 14ch;
}
.daymo-help-lede {
  margin-top: 14px;
  font-size: 16.5px;
  line-height: 1.55;
  color: var(--daymo-muted);
  max-width: 46ch;
  text-wrap: pretty;
}
.daymo-help-ask {
  margin-top: 26px;
  max-width: 660px;
}
.daymo-help-askbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 16px;
  background: var(--daymo-surface);
  border: 1.5px solid var(--daymo-border);
  border-radius: var(--daymo-r-lg);
  box-shadow: var(--daymo-shadow);
  transition: 0.16s;
}
.daymo-help-askbar:focus-within {
  border-color: var(--daymo-accent);
  box-shadow: var(--daymo-shadow-lg);
}
.daymo-help-lead {
  flex-shrink: 0;
  color: var(--daymo-accent);
}
.daymo-help-lead svg {
  width: 19px;
  height: 19px;
}
.daymo-help-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 15.5px;
  color: var(--daymo-fg);
  padding: 11px 0;
}
.daymo-help-input::placeholder {
  color: var(--daymo-muted);
}
.daymo-help-send {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  padding: 0 17px;
  border: 0;
  border-radius: 12px;
  background: var(--daymo-accent);
  color: var(--daymo-accent-ink);
  font-weight: 560;
  font-size: 14px;
  cursor: pointer;
  transition: 0.15s;
  flex-shrink: 0;
}
.daymo-help-send:hover {
  background: var(--daymo-a-hover);
}
.daymo-help-send svg {
  width: 16px;
  height: 16px;
}
.daymo-help-suggest {
  margin-top: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.daymo-help-suggest-lbl {
  font-size: 12.5px;
  color: var(--daymo-muted);
}
.daymo-help-chip {
  border: 1px solid var(--daymo-border);
  background: var(--daymo-surface);
  color: var(--daymo-fg-2);
  border-radius: 999px;
  padding: 7px 13px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: 0.14s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.daymo-help-chip:hover {
  border-color: var(--daymo-accent);
  color: var(--daymo-accent);
  background: var(--daymo-a-weak2);
}

/* ---------------- answer thread ---------------- */
.daymo-help-thread {
  max-width: 720px;
  margin: 6px auto 0;
}
.daymo-help-thread:empty {
  display: none;
}
.daymo-help-qa + .daymo-help-qa {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--daymo-border-2);
}
@media (prefers-reduced-motion: no-preference) {
  .daymo-help-qa {
    animation: daymo-help-rise 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
}
@keyframes daymo-help-rise {
  from {
    transform: translateY(8px);
  }
  to {
    transform: none;
  }
}
.daymo-help-q-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 13px;
}
.daymo-help-q-bubble {
  background: var(--daymo-accent);
  color: var(--daymo-accent-ink);
  font-size: 14px;
  font-weight: 500;
  padding: 9px 15px;
  border-radius: 14px 14px 4px 14px;
  max-width: 82%;
}
.daymo-help-a-row {
  display: flex;
  gap: 12px;
}
.daymo-help-a-av {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  flex-shrink: 0;
  background: var(--daymo-a-weak);
  color: var(--daymo-accent);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.daymo-help-a-av svg {
  width: 17px;
  height: 17px;
}
.daymo-help-a-av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.daymo-help-a-body {
  flex: 1;
  min-width: 0;
}
.daymo-help-a-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--daymo-muted);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.daymo-help-a-tag {
  font-family: var(--daymo-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--daymo-accent);
  border: 1px solid var(--daymo-a-line);
  border-radius: 4px;
  padding: 1px 5px;
}
.daymo-help-a-text {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--daymo-fg);
  text-wrap: pretty;
}
.daymo-help-a-p + .daymo-help-a-p {
  margin-top: 8px;
}
.daymo-help-a-chips {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.daymo-help-error {
  color: #b91c1c;
  font-size: 13.5px;
}

/* clip citation (ChatResponse VideoPart) */
.daymo-help-clip {
  margin-top: 12px;
  display: flex;
  align-items: stretch;
  border: 1px solid var(--daymo-border);
  border-radius: var(--daymo-r);
  overflow: hidden;
  background: var(--daymo-surface);
  max-width: 440px;
  width: 100%;
  cursor: pointer;
  transition: 0.15s;
  text-align: left;
  padding: 0;
}
.daymo-help-clip:hover {
  border-color: var(--daymo-accent);
  box-shadow: var(--daymo-shadow);
}
.daymo-help-clip-thumb {
  width: 108px;
  flex-shrink: 0;
  position: relative;
  background: var(--daymo-bg-2);
}
.daymo-help-clip-thumb img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.daymo-help-clip-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  display: grid;
  place-items: center;
  box-shadow: var(--daymo-shadow);
}
.daymo-help-clip-play svg {
  width: 12px;
  height: 12px;
  color: var(--daymo-accent);
  margin-left: 1px;
}
.daymo-help-clip-ci {
  flex: 1;
  min-width: 0;
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}
.daymo-help-clip-cap {
  font-size: 13px;
  font-weight: 560;
  line-height: 1.3;
}
.daymo-help-clip-sub {
  font-family: var(--daymo-font-mono);
  font-size: 10.5px;
  color: var(--daymo-muted);
}
.daymo-help-clip-sub b {
  color: var(--daymo-accent);
  font-weight: 600;
}
.daymo-help-clip-fallback {
  margin-top: 12px;
}
.daymo-help-clip-fallback video {
  width: 100%;
  max-width: 440px;
  border-radius: var(--daymo-r);
  background: #000;
  display: block;
}
.daymo-help-clip-fallback small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--daymo-muted);
}

/* typing indicator */
.daymo-help-typing {
  display: inline-flex;
  gap: 4px;
  padding: 7px 0;
}
.daymo-help-typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--daymo-muted);
  opacity: 0.5;
  animation: daymo-help-blink 1.2s infinite;
}
.daymo-help-typing i:nth-child(2) {
  animation-delay: 0.2s;
}
.daymo-help-typing i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes daymo-help-blink {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* ---------------- gallery ---------------- */
.daymo-help-section {
  padding: 26px 0 12px;
}
.daymo-help-sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.daymo-help-sec-head h2 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.daymo-help-sec-head p {
  font-size: 13.5px;
  color: var(--daymo-muted);
  margin-top: 3px;
}
.daymo-help-gallery {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--daymo-gap);
}
.daymo-help-card {
  text-align: left;
  border: 1px solid var(--daymo-border);
  background: var(--daymo-surface);
  border-radius: var(--daymo-r);
  overflow: hidden;
  cursor: pointer;
  transition: 0.18s;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.daymo-help-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--daymo-shadow);
  border-color: var(--daymo-a-line);
}
.daymo-help-poster {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--daymo-bg-2);
  display: block;
}
.daymo-help-poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.daymo-help-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  display: grid;
  place-items: center;
  box-shadow: var(--daymo-shadow);
  transition: 0.18s;
}
.daymo-help-play svg {
  width: 17px;
  height: 17px;
  color: var(--daymo-accent);
  margin-left: 2px;
}
.daymo-help-card:hover .daymo-help-play {
  transform: translate(-50%, -50%) scale(1.09);
}
.daymo-help-dur {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-family: var(--daymo-font-mono);
  font-size: 10.5px;
  color: #fff;
  background: rgba(12, 12, 15, 0.74);
  padding: 3px 7px;
  border-radius: 6px;
  backdrop-filter: blur(4px);
}
.daymo-help-card-meta {
  padding: 13px 15px 15px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}
.daymo-help-card-title {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.daymo-help-card-desc {
  font-size: 12.5px;
  color: var(--daymo-muted);
  line-height: 1.45;
  text-wrap: pretty;
}
.daymo-help-card-foot {
  margin-top: auto;
  padding-top: 9px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--daymo-muted);
}
.daymo-help-card-foot svg {
  width: 13px;
  height: 13px;
}

/* ---------------- footer ---------------- */
.daymo-help-footer {
  margin-top: 40px;
  border-top: 1px solid var(--daymo-border);
}
.daymo-help-footer-in {
  max-width: var(--daymo-maxw);
  margin: 0 auto;
  padding: 22px 24px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.daymo-help-foot-links {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.daymo-help-foot-links a {
  font-size: 13px;
  color: var(--daymo-muted);
  text-decoration: none;
  cursor: pointer;
}
.daymo-help-foot-links a:hover {
  color: var(--daymo-fg);
}
.daymo-help-built {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--daymo-muted);
}
.daymo-help-built .daymo-help-mk {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.daymo-help-built .daymo-help-mk svg {
  width: 12px;
  height: 12px;
}
.daymo-help-built b {
  color: var(--daymo-fg);
  font-weight: 600;
}

/* ---------------- mobile ask FAB ---------------- */
.daymo-help-fab {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: var(--daymo-z-fab);
  display: none;
  align-items: center;
  gap: 9px;
  height: 50px;
  padding: 0 18px 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--daymo-accent);
  color: var(--daymo-accent-ink);
  font-weight: 560;
  font-size: 14.5px;
  cursor: pointer;
  box-shadow: var(--daymo-shadow-lg);
}
.daymo-help-fab svg {
  width: 19px;
  height: 19px;
}

/* ---------------- player modal ---------------- */
.daymo-help-modal {
  position: fixed;
  inset: 0;
  z-index: var(--daymo-z-modal);
  display: none;
  place-items: center;
  padding: 24px;
  background: rgba(12, 12, 15, 0.5);
  backdrop-filter: blur(4px);
  font-family: var(--daymo-font);
  color: var(--daymo-fg);
}
.daymo-help-modal.open {
  display: grid;
  animation: daymo-help-fade 0.2s ease;
}
@keyframes daymo-help-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.daymo-help-player {
  width: min(900px, 100%);
  max-height: 92dvh;
  overflow: hidden;
  background: var(--daymo-surface);
  border: 1px solid var(--daymo-border);
  border-radius: var(--daymo-r-lg);
  box-shadow: var(--daymo-shadow-lg);
  display: flex;
  flex-direction: column;
  animation: daymo-help-pop 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
@keyframes daymo-help-pop {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.daymo-help-player-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--daymo-border-2);
}
.daymo-help-player-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.daymo-help-player-close {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 1px solid var(--daymo-border);
  background: var(--daymo-surface);
  color: var(--daymo-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: 0.14s;
}
.daymo-help-player-close:hover {
  background: var(--daymo-bg-2);
  color: var(--daymo-fg);
}
.daymo-help-player-close svg {
  width: 17px;
  height: 17px;
}
.daymo-help-player-body {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  min-height: 0;
}
.daymo-help-stage {
  background: #000;
  display: grid;
}
.daymo-help-stage video {
  width: 100%;
  height: 100%;
  max-height: 70dvh;
  object-fit: contain;
  display: block;
}
.daymo-help-steps {
  padding: 8px;
  overflow-y: auto;
  max-height: 70dvh;
  border-left: 1px solid var(--daymo-border-2);
}
.daymo-help-steps-h {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--daymo-muted);
  padding: 9px 10px 6px;
}
.daymo-help-step {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 10px;
  border-radius: var(--daymo-r-sm);
  cursor: pointer;
  transition: 0.13s;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  color: var(--daymo-fg);
}
.daymo-help-step:hover {
  background: var(--daymo-a-weak2);
}
.daymo-help-step.active {
  background: var(--daymo-a-weak);
}
.daymo-help-step-ix {
  font-family: var(--daymo-font-mono);
  font-size: 11px;
  width: 36px;
  flex-shrink: 0;
  color: var(--daymo-muted);
}
.daymo-help-step.active .daymo-help-step-ix {
  color: var(--daymo-accent);
  font-weight: 600;
}
.daymo-help-step-lb {
  font-size: 13px;
  line-height: 1.3;
}
.daymo-help-step.active .daymo-help-step-lb {
  font-weight: 560;
}

/* =====================================================================
   RESPONSIVE
   ===================================================================== */
@media (max-width: 900px) {
  .daymo-help-gallery {
    grid-template-columns: repeat(2, 1fr);
  }
  .daymo-help-player-body {
    grid-template-columns: 1fr;
  }
  .daymo-help-steps {
    border-left: 0;
    border-top: 1px solid var(--daymo-border-2);
    max-height: 34dvh;
  }
  .daymo-help-stage video {
    max-height: 52dvh;
  }
}
@media (max-width: 640px) {
  .daymo-help-appbar-in {
    padding: 11px 16px;
    gap: 10px;
  }
  .daymo-help-nav {
    display: none;
  }
  .daymo-help-contact {
    display: none;
  }
  .daymo-help-wrap {
    padding: 0 16px;
  }
  .daymo-help-hero {
    padding: 30px 0 18px;
  }
  .daymo-help-h1 {
    font-size: 27px;
  }
  .daymo-help-lede {
    font-size: 15px;
  }
  .daymo-help-ask {
    margin-top: 20px;
  }
  .daymo-help-askbar {
    padding: 5px 5px 5px 14px;
  }
  .daymo-help-input {
    font-size: 15px;
  }
  .daymo-help-send .daymo-help-send-tx {
    display: none;
  }
  .daymo-help-send {
    padding: 0;
    width: 42px;
    justify-content: center;
  }
  .daymo-help-gallery {
    grid-template-columns: 1fr;
    gap: 13px;
  }
  .daymo-help-sec-head {
    align-items: flex-start;
  }
  .daymo-help-fab {
    display: inline-flex;
  }
  .daymo-help-footer-in {
    padding: 20px 16px 90px;
  }
  /* full-screen player */
  .daymo-help-modal {
    padding: 0;
  }
  .daymo-help-player {
    width: 100%;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    border: 0;
  }
  .daymo-help-player-body {
    flex: 1;
    min-height: 0;
    grid-template-rows: 1fr auto;
  }
  .daymo-help-stage video {
    max-height: none;
  }
  .daymo-help-steps {
    max-height: 30dvh;
  }
}
@media (max-width: 380px) {
  .daymo-help-nm span {
    display: none;
  }
}
```

- [ ] **Step: Commit**

```bash
git add styles/help-center.css
git commit -m "feat(help-center): template stylesheet — tokens, dark theme, responsive, copy-and-own friendly"
```

---

### Task 6: README — "Help center page" section

**Files:**
- Modify: `README.md` (insert a new `## The help center page` section after the `## Worked example` section, before `# Onboarding`)

- [ ] **Step 1: Add the section**

Insert (adjust placement to fit the file's flow):

````markdown
## The help center page

Daymo ships a full help-center template: a responsive page with an ask bar
(answers cite the exact video moment), a video-guide gallery, and a player
with a clickable step timeline.

```tsx
// app/help/page.tsx
"use client";
import { HelpCenter } from "daymo/react";
import "daymo/help-center.css";

export default function HelpPage() {
  return (
    <HelpCenter
      manifestUrl="/help/index.json"
      chatEndpoint="/api/help/chat"
      name="Acme"
      brandColor="#0ea5e9"
      suggestedQuestions={["How do I create a project?", "How do I invite my team?"]}
      contactHref="mailto:support@acme.io"
    />
  );
}
```

No React? `import { mountHelpCenter } from "daymo/help-center"` renders the
same page into any element and returns an unmount function.

### Making it match your product

- **90% case:** set `brandColor` — every accent tint derives from it. Light
  brand colors should also override `--daymo-accent-ink` (the text color used
  on accent surfaces). Dark mode: put `data-daymo-theme="dark"` on any
  ancestor.
- **Voice / i18n:** every visible string is overridable via `strings`
  (e.g. `strings={{ galleryHeading: "Tutorials", lede: "…" }}`).
- **Own layout:** `chrome={false}` drops the appbar, footer and mobile FAB so
  you can embed the hero + gallery inside your own page shell.
- **Everything else:** copy `node_modules/daymo/styles/help-center.css` into
  your project and let your coding agent restyle it — class names are a
  stable API and the behavior never depends on the styles. The font stack
  uses Geist when your app loads it, your system stack otherwise (the
  stylesheet makes no third-party requests).

Stable class names (the restyling surface): `daymo-help` (root),
`-appbar`, `-brand`, `-mk`, `-nm`, `-nav-link`, `-contact`, `-hero`,
`-hero-bg`, `-eyebrow`, `-h1`, `-lede`, `-askbar`, `-input`, `-send`,
`-suggest`, `-chip`, `-thread`, `-qa`, `-q-bubble`, `-a-av`, `-a-name`,
`-a-tag`, `-a-text`, `-clip`, `-clip-thumb`, `-clip-cap`, `-clip-sub`,
`-typing`, `-error`, `-section`, `-sec-head`, `-gallery`, `-card`,
`-poster`, `-play`, `-dur`, `-card-meta`, `-card-title`, `-card-desc`,
`-card-foot`, `-footer`, `-foot-links`, `-built`, `-fab`, `-modal`,
`-player`, `-player-top`, `-player-title`, `-player-close`, `-stage`,
`-steps`, `-step`, `-step-ix`, `-step-lb` (all prefixed `daymo-help`).
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: help-center template usage + 'making it match your product'"
```

---

### Task 7: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass. Known pre-existing failure unrelated to this work:
`stitch-keyframes.test.ts` (ffmpeg GOP) may fail in this environment — confirm
it also fails on `main` before ignoring it; everything else must pass.

- [ ] **Step 2: Build**

Run: `npx tsc`
Expected: clean compile; `dist/help-center/{mount,player,strings,icons,gallery-model}.js` + `.d.ts` exist.

- [ ] **Step 3: Visual smoke check**

Create a throwaway page that mounts the template against a stub manifest/chat
(e.g. `node -e` static server or a scratch HTML file loading
`dist/help-center/mount.js` + `styles/help-center.css`), open it in the
preview browser at desktop and 390px widths, and compare against the design
(`/tmp/design-bundle/typenote/project/help/index.html` rendered the same way).
Check: appbar blur/sticky, dot-grid hero, ask bar focus ring, chips, gallery
cards hover, clip card, player modal (desktop split / mobile full-screen),
FAB at 390px, dark theme via `data-daymo-theme="dark"`. Delete the scratch
file afterwards.

- [ ] **Step 4: Commit any fixes, then finish**

Use superpowers:finishing-a-development-branch — present merge/PR options for
`feat/help-center-template`.
