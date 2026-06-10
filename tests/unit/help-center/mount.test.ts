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
      steps: [
        { stepId: "d:0:1", label: "click", startMs: 0 },
        { stepId: "d:0:2", label: "type", startMs: 5000 },
      ],
    },
  ],
};

beforeAll(() => {
  // jsdom media stubs (same approach as player.test.ts): back currentTime with
  // a field so cue seeks are observable, keep readyState at 0 so the player
  // defers seeks until we fire `loadedmetadata`.
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

/** Ask via whichever input is on-screen: the home ask bar first, then the
 *  conversation composer once the thread is open. */
function askQuestion(container: HTMLElement, text: string): void {
  const home = container.querySelector<HTMLTextAreaElement>(".daymo-help-input");
  if (home) {
    home.value = text;
    container.querySelector<HTMLButtonElement>(".daymo-help-send")!.click();
    return;
  }
  const composer = container.querySelector<HTMLTextAreaElement>(".daymo-help-composer-input")!;
  composer.value = text;
  container.querySelector<HTMLButtonElement>(".daymo-help-composer-send")!.click();
}

const libLoaded = (container: HTMLElement) =>
  vi.waitFor(() => expect(container.querySelector(".daymo-help-lib-row")).toBeTruthy());

describe("mountHelpCenter — shell & options", () => {
  it("renders the sidebar shell + home landing with defaults", async () => {
    const { container } = mount();
    expect(container.querySelector(".daymo-help-side")).toBeTruthy();
    expect(container.querySelector(".daymo-help-nm")?.textContent).toBe("Help");
    expect(container.querySelector(".daymo-help-h1")?.textContent).toBe("How can we help?");
    expect(container.querySelector(".daymo-help-side-foot")?.textContent).toContain("Built with");
    expect(container.querySelector(".daymo-help-home")).toBeTruthy();
    // contact hidden without contactHref
    expect(container.querySelector<HTMLElement>(".daymo-help-contact")?.hidden).toBe(true);
    await libLoaded(container);
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

  it("chrome:false drops the sidebar + topbar but keeps the home landing", async () => {
    const { container } = mount({ chrome: false });
    expect(container.querySelector(".daymo-help-side")).toBeNull();
    expect(container.querySelector(".daymo-help-topbar")).toBeNull();
    expect(container.querySelector(".daymo-help-scrim")).toBeNull();
    expect(container.querySelector(".daymo-help-home")).toBeTruthy();
  });

  it("strings overrides replace visible copy", () => {
    const { container } = mount({
      strings: { libraryHeading: "Tutorials", askPlaceholder: "Frag mich…", lede: "Kurze Videos." },
    });
    expect(container.querySelector(".daymo-help-side-grp-tx")?.textContent).toBe("Tutorials");
    expect(container.querySelector<HTMLTextAreaElement>(".daymo-help-input")?.placeholder).toBe("Frag mich…");
    expect(container.querySelector(".daymo-help-lede")?.textContent).toBe("Kurze Videos.");
  });

  it("logoUrl replaces the sidebar mark and the assistant avatar", async () => {
    const { container } = mount({ logoUrl: "https://acme.io/logo.png" });
    const mk = container.querySelector(".daymo-help-mk img") as HTMLImageElement;
    expect(mk?.src).toContain("logo.png");
    askQuestion(container, "hi");
    await vi.waitFor(() => {
      const av = container.querySelector(".daymo-help-a-av img") as HTMLImageElement;
      expect(av?.src).toContain("logo.png");
    });
  });
});

describe("mountHelpCenter — library", () => {
  it("renders library rows from the manifest; click opens the player", async () => {
    const { container } = mount();
    await libLoaded(container);
    const row = container.querySelector<HTMLButtonElement>(".daymo-help-lib-row")!;
    expect(row.getAttribute("data-demo-id")).toBe("d");
    expect(row.textContent).toContain("Create a note");
    expect(row.textContent).toContain("1:30"); // durationLabel
    expect(row.textContent).toContain("2 steps");
    row.click();
    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.textContent).toContain("Create a note");
  });

  it("hides the library group heading when the manifest is empty", async () => {
    const empty: HelpManifest = { version: "v1", videoBaseUrl: "x", demos: [] };
    const { container } = mount({}, makeFetch({ manifestData: empty }));
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>(".daymo-help-side-grp-h")?.hidden).toBe(true);
    });
    expect(container.querySelector(".daymo-help-lib-row")).toBeNull();
  });

  it("leaves the library empty when the manifest fetch fails", async () => {
    const { container } = mount({}, makeFetch({ manifestData: null }));
    // give the rejected fetch a tick to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector(".daymo-help-lib-row")).toBeNull();
    expect(container.querySelector<HTMLElement>(".daymo-help-side-grp-h")?.hidden).toBe(true);
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
    await libLoaded(container);
    askQuestion(container, "how do I create a note");
    expect(container.querySelector(".daymo-help-typing")).toBeTruthy();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Here is how.");
    });
    const thread = container.querySelector(".daymo-help-thread")!;
    expect(thread.getAttribute("aria-live")).toBe("polite");
    const clip = container.querySelector<HTMLButtonElement>(".daymo-help-clip")!;
    // caption is rendered as a step line
    expect(clip.textContent).toContain("click new");
    // full-demo duration (90 000 ms = 1:30), not clip duration
    expect(clip.textContent).toContain("1:30");
    expect(clip.textContent).toContain("Create a note");
    // no steps-mirror list anywhere
    expect(container.querySelector(".daymo-help-steps-mirror")).toBeNull();
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
    askQuestion(container, "q");
    await vi.waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>(".daymo-help-thread video");
      expect(video?.src).toContain("x.mp4#t=1");
    });
  });

  it("no_match renders server suggestions as chips that re-ask", async () => {
    const chat: ChatResponse = { kind: "no_match", text: "Nothing found.", suggestions: ["Try this"] };
    const calls: unknown[] = [];
    const { container } = mount({ suggestedQuestions: ["Opt A"] }, makeFetch({ chat }, calls));
    askQuestion(container, "zzz");
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
    askQuestion(container, "zzz");
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".daymo-help-a-chips .daymo-help-chip")).toHaveLength(2);
    });
  });

  it("history excludes the current message and truncates to the last 2 turns", async () => {
    const calls: { message: string; history: unknown[] }[] = [];
    const chat: ChatResponse = { kind: "answer", parts: [{ kind: "text", text: "A1" }] };
    const { container } = mount({}, makeFetch({ chat }, calls));
    askQuestion(container, "q1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].history).toEqual([]);
    await vi.waitFor(() => expect(container.textContent).toContain("A1"));
    askQuestion(container, "q2");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
    await vi.waitFor(() => expect(container.querySelectorAll(".daymo-help-qa")).toHaveLength(2));
    askQuestion(container, "q3");
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
    askQuestion(container, "q");
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-error")?.textContent).toBe(
        "Couldn't reach the assistant. Try again.",
      );
    });
  });

  it("renders HTML-special content from the server and manifest as inert text", async () => {
    const hostile: HelpManifest = {
      version: "v1",
      videoBaseUrl: "x",
      demos: [
        {
          ...manifest.demos[0],
          title: '<img src=x onerror="window.__pwned=1">',
          description: "<b>desc</b>",
        },
      ],
    };
    const chat: ChatResponse = {
      kind: "answer",
      parts: [{ kind: "text", text: "<script>window.__pwned=1</script>" }],
    };
    const { container } = mount({ name: "<i>Acme</i>" }, makeFetch({ chat, manifestData: hostile }));
    await libLoaded(container);
    askQuestion(container, "<u>q</u>");
    await vi.waitFor(() => expect(container.textContent).toContain("window.__pwned")); // rendered as text
    expect(container.querySelector(".daymo-help-lib-row img[src='x']")).toBeNull();
    expect(container.querySelector(".daymo-help-q-bubble u")).toBeNull();
    expect(container.querySelector(".daymo-help-a-text script")).toBeNull();
    expect(container.querySelector(".daymo-help-nm i")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.querySelector(".daymo-help-lib-title")?.textContent).toContain("onerror");
  });

  it("kicker shows the EARLIER step position when same-demo parts are cited out of chronological order", async () => {
    // d:0:2 (step 2, startMs=5000) is cited first; d:0:1 (step 1, startMs=0) second.
    // The kicker must report "Step 1/2" (the earliest referenced step), not "Step 2/2".
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 5000, endMs: 8000, caption: "Step two caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 3000, caption: "Step one caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await libLoaded(container);
    askQuestion(container, "how?");
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-clip")).toBeTruthy();
    });
    const kicker = container.querySelector(".daymo-help-clip-kicker span:last-child")!;
    // Step 1 is the earliest cited step — kicker must say "1/2", not "2/2"
    expect(kicker.textContent).toContain("1/2");
    expect(kicker.textContent).not.toContain("2/2");
  });

  it("renders ONE card for two video parts citing the same demo, with both captions as step lines", async () => {
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "First point." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 3000, caption: "Step one caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
        { kind: "text", text: "Second point." },
        { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 5000, endMs: 8000, caption: "Step two caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await libLoaded(container);
    askQuestion(container, "how?");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("First point.");
    });
    // exactly one demo card
    const clips = container.querySelectorAll(".daymo-help-clip");
    expect(clips).toHaveLength(1);
    // both captions are step lines inside the card
    const stepLines = clips[0].querySelectorAll(".daymo-help-clip-step-line");
    expect(stepLines).toHaveLength(2);
    expect(stepLines[0].textContent).toContain("Step one caption");
    expect(stepLines[1].textContent).toContain("Step two caption");
    // no steps-mirror anywhere
    expect(container.querySelector(".daymo-help-steps-mirror")).toBeNull();
  });

  it("opens the player cued at the earliest startMs with referencedStepIds and no end stop", async () => {
    // Cited out of chronological order on purpose: the cue must be the
    // EARLIEST referenced startMs (1s), not the first-cited part's (5s) and
    // not any endMs (3s/8s — no end stop).
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 5000, endMs: 8000, caption: "Step two caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 3000, caption: "Step one caption", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await libLoaded(container);
    askQuestion(container, "how?");
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-clip")).toBeTruthy();
    });
    const clip = container.querySelector<HTMLButtonElement>(".daymo-help-clip")!;
    clip.click();
    // player modal opens and plays
    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    // cued at the earliest referenced startMs (seek applies on loadedmetadata)
    const video = modal.querySelector("video")!;
    (video as unknown as { __rs: number }).__rs = 1;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(1);
    // BOTH cited stepIds carry the persistent "referenced" timeline state
    const steps = modal.querySelectorAll(".daymo-help-step");
    expect(steps).toHaveLength(2);
    expect(steps[0].classList.contains("referenced")).toBe(true); // d:0:1
    expect(steps[1].classList.contains("referenced")).toBe(true); // d:0:2
  });

  it("serializes concurrent asks: the second request waits for the first answer", async () => {
    const calls: { message: string; history: unknown[] }[] = [];
    let resolveFirst!: (r: Response) => void;
    const first = new Promise<Response>((res) => (resolveFirst = res));
    let chatCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      calls.push(JSON.parse(String(init?.body)));
      chatCount += 1;
      if (chatCount === 1) return first; // hold the first answer open
      return new Response(JSON.stringify({ kind: "answer", parts: [{ kind: "text", text: "A2" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const { container } = mount({}, fetchImpl);
    askQuestion(container, "q1");
    askQuestion(container, "q2"); // fired while q1 is still in flight (composer)
    await vi.waitFor(() => expect(calls).toHaveLength(1)); // q2 must NOT dispatch yet
    expect(calls[0].message).toBe("q1");
    resolveFirst(new Response(JSON.stringify({ kind: "answer", parts: [{ kind: "text", text: "A1" }] }), { status: 200 }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].message).toBe("q2");
    expect(calls[1].history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
  });
});

describe("mountHelpCenter — unmount hygiene", () => {
  it("unmount removes the UI and the body-appended modal, restoring scroll", async () => {
    const { container, unmount } = mount();
    await libLoaded(container);
    container.querySelector<HTMLButtonElement>(".daymo-help-lib-row")!.click();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(container.querySelector(".daymo-help")).toBeNull();
    expect(document.body.querySelector(".daymo-help-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("two mounts coexist (no ids, no shared state)", async () => {
    const a = mount();
    const b = mount();
    await libLoaded(a.container);
    await libLoaded(b.container);
    a.unmount();
    expect(b.container.querySelector(".daymo-help")).toBeTruthy();
    expect(document.body.querySelectorAll(".daymo-help-modal")).toHaveLength(1);
    b.unmount();
  });
});
